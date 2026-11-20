package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// scoreServer runs the high-score API with a clock the test moves by hand.
type scoreServer struct {
	t      *testing.T
	api    *api
	scores *highScores
	clock  time.Time
	player string // this test browser's id, sent with each new game unless the test sets one
}

func newScoreServer(t *testing.T) *scoreServer {
	mazes, err := loadMazes(filepath.Join("..", "scripts", "mazes.js"))
	if err != nil {
		t.Fatal(err)
	}
	s := &scoreServer{t: t, clock: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	s.scores = newHighScores(filepath.Join(t.TempDir(), "highscores.json"), mazes)
	s.scores.now = func() time.Time { return s.clock }
	s.api = newAPI(nil, mazes, s.scores)
	_, reply := s.post("player", map[string]any{})
	s.player, _ = reply["player"].(string)
	if s.player == "" {
		t.Fatalf("no player id: %v", reply)
	}
	return s
}

func (s *scoreServer) post(action string, body map[string]any) (int, map[string]any) {
	if _, set := body["player"]; action == "session" && !set {
		body["player"] = s.player
	}
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/classic/"+action, bytes.NewReader(data))
	req.RemoteAddr = "192.0.2.1:5000"
	rec := httptest.NewRecorder()
	s.api.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func ints(v any) []int {
	var out []int
	for _, x := range v.([]any) {
		out = append(out, int(x.(float64)))
	}
	return out
}

func TestClassicHighScoreGame(t *testing.T) {
	s := newScoreServer(t)
	code, start := s.post("session", map[string]any{"level": 1, "difficulty": 1, "mazeId": 44})
	if code != 200 {
		t.Fatalf("session: %d", code)
	}
	id := start["session"].(string)
	blue := ints(start["blue"])
	if len(blue) != 3 || len(ints(start["red"])) != 3 {
		t.Fatalf("level 1 should have 3 flags a team, got %v", start)
	}
	seq := 0
	for _, flag := range blue {
		s.clock = s.clock.Add(60 * time.Second) // plenty of time to drive there
		seq++
		if code, _ := s.post("capture", map[string]any{"session": id, "seq": seq, "flag": flag}); code != 200 {
			t.Fatalf("capture %d refused: %d", flag, code)
		}
	}
	seq++
	code, won := s.post("win", map[string]any{"session": id, "seq": seq, "flagsLeft": 2})
	// 3 flags x 1,000 + 2 left x 2,500 (Intermediate, level 1; no level bonus without Start At)
	if code != 200 || won["score"].(float64) != 8000 {
		t.Fatalf("win: %d %v", code, won)
	}
	code, sub := s.post("submit", map[string]any{"session": id, "name": "Tester"})
	if code != 200 || sub["placed"] != true {
		t.Fatalf("8,000 beats the 15th default score (1,638) and must be placed: %d %v", code, sub)
	}
	found := false
	for _, e := range sub["scores"].([]any) {
		entry := e.(map[string]any)
		if entry["name"] == "Tester" && entry["score"].(float64) == 8000 {
			found = entry["mine"] == true // marked as this player's row
		}
		if _, leaked := entry["player"]; leaked {
			t.Fatal("player ids must not be sent to browsers")
		}
	}
	if !found || len(sub["scores"].([]any)) != classicTableSize {
		t.Fatalf("table after placing: %v", sub["scores"])
	}
	if _, again := s.post("submit", map[string]any{"session": id, "name": "Tester"}); again["placed"] != false {
		t.Fatal("a game must enter the table only once")
	}
}

func TestClassicHighScoreRefusesImpossibleCapture(t *testing.T) {
	s := newScoreServer(t)
	_, start := s.post("session", map[string]any{"level": 16, "difficulty": 2, "mazeId": 46})
	id := start["session"].(string)
	blue := ints(start["blue"])
	// Straight away: inside the start countdown, so no craft could have reached it.
	if code, _ := s.post("capture", map[string]any{"session": id, "seq": 1, "flag": blue[0]}); code != http.StatusForbidden {
		t.Fatalf("an instant capture must be refused, got %d", code)
	}
	// The game is now spoilt: later reports are refused too.
	s.clock = s.clock.Add(time.Minute)
	if code, _ := s.post("capture", map[string]any{"session": id, "seq": 2, "flag": blue[1]}); code == 200 {
		t.Fatal("a game with a refused report must stay refused")
	}
}

func TestClassicHighScoreRefusesForgedReports(t *testing.T) {
	s := newScoreServer(t)
	_, start := s.post("session", map[string]any{"level": 1, "difficulty": 0, "mazeId": 44})
	id := start["session"].(string)
	red := ints(start["red"])
	s.clock = s.clock.Add(time.Minute)
	// One of the player's own flags is not a robot flag.
	if code, _ := s.post("capture", map[string]any{"session": id, "seq": 1, "flag": red[0]}); code != http.StatusForbidden {
		t.Fatalf("capturing an own flag must be refused, got %d", code)
	}
	// An unknown game, and a win without the flags.
	if code, _ := s.post("win", map[string]any{"session": "0123456789abcdef0123456789abcdef", "seq": 1, "flagsLeft": 3}); code != http.StatusForbidden {
		t.Fatalf("an unknown game must be refused, got %d", code)
	}
	_, other := s.post("session", map[string]any{"level": 1, "difficulty": 0, "mazeId": 44})
	if code, _ := s.post("win", map[string]any{"session": other["session"], "seq": 1, "flagsLeft": 3}); code != http.StatusForbidden {
		t.Fatalf("a win before taking the flags must be refused, got %d", code)
	}
}

func TestClassicPlayerIDs(t *testing.T) {
	s := newScoreServer(t)
	id, sig, ok := strings.Cut(s.player, ".")
	if !ok || len(id) != 36 || id[14] != '4' || sig == "" {
		t.Fatalf("expected a signed version-4 UUID, got %q", s.player)
	}
	// A valid id is handed back unchanged; a made-up or altered one gets a fresh id.
	if _, again := s.post("player", map[string]any{"player": s.player}); again["player"] != s.player {
		t.Fatalf("a valid id must be kept, got %v", again)
	}
	forged := "00000000-0000-4000-8000-000000000000." + sig
	if _, fresh := s.post("player", map[string]any{"player": forged}); fresh["player"] == forged {
		t.Fatal("a forged id must not be accepted")
	}
	// New games need a valid id.
	for _, player := range []string{"", forged, id} {
		if code, _ := s.post("session", map[string]any{"player": player, "level": 1, "difficulty": 0, "mazeId": 44}); code != http.StatusForbidden {
			t.Fatalf("a game with player %q must be refused, got %d", player, code)
		}
	}
}

func TestClassicHighScoreLimitsNewGames(t *testing.T) {
	s := newScoreServer(t)
	for i := 0; i < classicSessionsPerHour; i++ {
		if code, _ := s.post("session", map[string]any{"level": 1, "difficulty": 0, "mazeId": 44}); code != 200 {
			t.Fatalf("game %d refused", i)
		}
	}
	if code, _ := s.post("session", map[string]any{"level": 1, "difficulty": 0, "mazeId": 44}); code != http.StatusForbidden {
		t.Fatalf("too many new games in an hour must be refused, got %d", code)
	}
}

// playGame plays out a level-1 game that wins with `left` of the player's flags standing.
func (s *scoreServer) playGame(t *testing.T, left int) string {
	_, start := s.post("session", map[string]any{"level": 1, "difficulty": 1, "mazeId": 44})
	id := start["session"].(string)
	seq := 0
	for _, flag := range ints(start["blue"]) {
		s.clock = s.clock.Add(time.Minute)
		seq++
		if code, _ := s.post("capture", map[string]any{"session": id, "seq": seq, "flag": flag}); code != 200 {
			t.Fatalf("capture refused: %d", code)
		}
	}
	seq++
	if code, _ := s.post("win", map[string]any{"session": id, "seq": seq, "flagsLeft": left}); code != 200 {
		t.Fatalf("win refused: %d", code)
	}
	return id
}

func TestClassicResultsAndRank(t *testing.T) {
	s := newScoreServer(t)
	// The record starts with the 15 default scores (24,570 down to 1,638 in steps of 1,638).
	// Two games: 3,000 + 3 x 2,500 = 10,500 (9 defaults above it), then 3,000 + 1 x 2,500 = 5,500.
	first := s.playGame(t, 3)
	if _, done := s.post("finish", map[string]any{"session": first}); done["rank"].(float64) != 10 || done["total"].(float64) != 16 {
		t.Fatalf("first game: %v", done)
	}
	second := s.playGame(t, 1)
	_, done := s.post("finish", map[string]any{"session": second})
	if done["score"].(float64) != 5500 || done["rank"].(float64) != 14 || done["total"].(float64) != 17 {
		t.Fatalf("second game: %v", done)
	}
	// Finishing again doesn't count the game twice.
	if _, again := s.post("finish", map[string]any{"session": second}); again["total"].(float64) != 17 {
		t.Fatalf("a game must be recorded once: %v", again)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/classic/highscores?player="+s.player, nil)
	rec := httptest.NewRecorder()
	s.api.ServeHTTP(rec, req)
	var table struct {
		Mine map[string]float64 `json:"mine"`
	}
	json.Unmarshal(rec.Body.Bytes(), &table)
	if table.Mine["last"] != 5500 || table.Mine["lastRank"] != 14 || table.Mine["best"] != 10500 || table.Mine["bestRank"] != 10 || table.Mine["total"] != 17 {
		t.Fatalf("player's results: %v", table.Mine)
	}
}

func TestClassicBoardBeyondFifteen(t *testing.T) {
	s := newScoreServer(t)
	// A score below the 15 defaults still gets onto the longer board, on its second page.
	_, start := s.post("session", map[string]any{"level": 1, "difficulty": 1, "mazeId": 44})
	id := start["session"].(string)
	s.clock = s.clock.Add(time.Minute)
	if code, _ := s.post("capture", map[string]any{"session": id, "seq": 1, "flag": ints(start["blue"])[0]}); code != 200 {
		t.Fatalf("capture refused: %d", code)
	}
	// One flag: 1,000, below the lowest default (1,638).
	_, sub := s.post("submit", map[string]any{"session": id, "name": "Low"})
	more := sub["more"].([]any)
	if sub["placed"] != true || len(sub["scores"].([]any)) != classicTableSize || len(more) != 1 ||
		more[0].(map[string]any)["name"] != "Low" || more[0].(map[string]any)["mine"] != true {
		t.Fatalf("expected the score on the second page: %v", sub)
	}
}

func TestClassicPlayerNumbers(t *testing.T) {
	s := newScoreServer(t) // has taken player #1
	_, second := s.post("player", map[string]any{})
	if second["number"].(float64) != 2 {
		t.Fatalf("the second new player is number 2: %v", second)
	}
	if _, again := s.post("player", map[string]any{"player": s.player}); again["number"] != nil {
		t.Fatalf("a known player isn't counted again: %v", again)
	}
}
