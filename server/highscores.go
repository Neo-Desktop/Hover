package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	mrand "math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

// Classic-mode high scores, kept by the server (added in this edition).
//
// The browser never sends a score. A game is a server-side session: the server picks where each
// level's flags go, the browser reports what happens ("took flag 7", "won the level with 2 of my
// flags left"), and the server checks every report and works out the score itself with the 1995
// game's rules (the table HOVER.EXE builds at start-up). What it checks:
//
//   - every report belongs to a live session (a random 128-bit id) and comes in order (seq);
//   - a captured flag is one of the robots' flags the server placed on this level, not taken yet;
//   - it was taken no sooner than a craft at full speed could have got there from where it was
//     (the start spot or the last flag), plus the 2-second start countdown for the first one;
//   - a level is won only when every robot flag has been taken, and the flags-left count is
//     possible for that level;
//   - only a few new games per address per hour; each game can enter the table once.
//
// So adding a score needs a believable game played out in real time, flag by flag, against the
// server's own flag positions; an edited request or a replayed one is refused. (Like any game that
// runs in the browser, a patient enough cheat could still script one; this makes it slow and hard.)
//
//	GET  api/classic/highscores?player=<id>          the table (rows of that player marked "mine")
//	POST api/classic/player   {player}                               -> {player} (a new id if not valid)
//	POST api/classic/session  {player, level, difficulty, startAt, mazeId} -> {session, red, blue}
//	POST api/classic/level    {session, seq, mazeId}                 -> {red, blue} (after a win)
//	POST api/classic/restart  {session, seq, difficulty, mazeId}     -> {red, blue} (new handling)
//	POST api/classic/capture  {session, seq, flag}                   -> {score}
//	POST api/classic/win      {session, seq, flagsLeft}              -> {score}
//	POST api/classic/end      {session, seq}                         -> {score}
//	POST api/classic/finish   {session}                              -> {score, rank, total}
//	POST api/classic/submit   {session, name}                        -> {placed, scores}
//
// Every finished game's checked score is also kept (results.json), so the table can show a player's
// last and best scores with their worldwide position (GET highscores?player=... adds "mine").
//
// red and blue are indexes into the maze's Flags list (scripts/mazes.js): the player's flags and
// the robots' flags.

// classicScoreTable is HOVER.EXE's score table (0x41c2b3): per level 1..16, [captured flag E, I, D,
// remaining flag E, I, D, level bonus E, I, D]. Levels after 16 use the last row.
var classicScoreTable = [16][9]int{
	{900, 1000, 1100, 2250, 2500, 2750, 0, 0, 0}, {1350, 1500, 1650, 3375, 3750, 4125, 4050, 4500, 4950},
	{1800, 2000, 2200, 4500, 5000, 5500, 9450, 10500, 11550}, {2250, 2500, 2750, 5625, 6250, 6875, 18450, 20500, 22550},
	{2700, 3000, 3300, 6750, 7500, 8250, 29250, 32500, 35750}, {3150, 3500, 3850, 7875, 8750, 9625, 45000, 50000, 55000},
	{3600, 4000, 4400, 9000, 10000, 11000, 63000, 70000, 77000}, {4050, 4500, 4950, 10125, 11250, 12375, 87300, 97000, 106700},
	{4500, 5000, 5500, 11250, 12500, 13750, 114300, 127000, 139700}, {4950, 5500, 6050, 12375, 13750, 15125, 144000, 160000, 176000},
	{5400, 6000, 6600, 13500, 15000, 16500, 176400, 196000, 215600}, {5850, 6500, 7150, 14625, 16250, 17875, 211500, 235000, 258500},
	{6300, 7000, 7700, 15750, 17500, 19250, 249300, 277000, 304700}, {6750, 7500, 8250, 16875, 18750, 20625, 289800, 322000, 354200},
	{7200, 8000, 8800, 18000, 20000, 22000, 333000, 370000, 407000}, {7650, 8500, 9350, 19125, 21250, 23375, 378900, 421000, 463100},
}

// classicFlagsPerTeam is the 1995 level table's flags per team for levels 1..18 (src/game/11-game.js
// CLASSIC_LEVELS); from level 17 the last three rows repeat, all with 6.
var classicFlagsPerTeam = []int{3, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6}

// classicMazes are the mazes classic levels are played in.
var classicMazes = map[int]bool{44: true, 46: true, 47: true}

// classicTopSpeed is the fastest a classic craft can go, in world units per second, at each
// difficulty: the 1995 top speed (50, 65 or 75 a tick, 20 ticks a second), doubled to allow for
// speed pods and sled pads. Walls make real routes longer than the straight lines measured here.
var classicTopSpeed = [3]float64{2000, 2600, 3000}

const (
	classicStartHold       = 2 * time.Second // the start countdown before anything moves
	classicLatencyAllow    = 750 * time.Millisecond
	classicSessionIdle     = 4 * time.Hour
	classicSessionsPerHour = 30
	classicMaxSessions     = 5000
	classicFlagClearance   = 80
	classicTableSize       = 15  // the 1995 High Scores page
	classicBoardSize       = 100 // the named board kept, the rest on the dialog's second page
	classicNameLength      = 26
)

func classicFlags(level int) int {
	if level-1 < len(classicFlagsPerTeam) {
		return classicFlagsPerTeam[level-1]
	}
	return 6
}

func classicPoints(level, difficulty int) (captured, remaining, bonus int) {
	row := classicScoreTable[min(15, max(0, level-1))]
	return row[difficulty], row[3+difficulty], row[6+difficulty]
}

type highScoreEntry struct {
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Player string `json:"player,omitempty"` // the player's id (kept on the server, never shown)
}

// publicEntry is a table row as the browser sees it: no ids, only whether the row is the asker's.
type publicEntry struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
	Mine  bool   `json:"mine,omitempty"`
}

type classicSession struct {
	id           string
	player       string
	difficulty   int
	level        int
	maze         *maze
	bonusPending bool
	score        int
	seq          int
	lastSeen     time.Time
	levelActive  bool
	red, blue    []int
	captured     map[int]bool
	lastX, lastZ float64
	lastTime     time.Time
	firstPending bool
	over         bool
	submitted    bool
	refused      bool // a report was refused: the game counts for nothing
	recorded     bool // its score is in the record of all games
}

// The record of every finished, checked game (results.json beside the table): each game's score, kept
// in order to give a score's worldwide position, and each player's last and best.
type gameResults struct {
	Players map[string]*playerResult `json:"players"`
	Scores  []int                    `json:"scores"` // highest first
	Issued  int                      `json:"issued"` // player ids handed out so far
}

type playerResult struct {
	Last int `json:"last"`
	Best int `json:"best"`
}

const classicMaxResults = 200000 // the lowest are dropped beyond this many games

func (h *highScores) loadResults() {
	h.results = &gameResults{Players: map[string]*playerResult{}}
	if data, err := os.ReadFile(h.resultsPath); err == nil {
		var saved gameResults
		if json.Unmarshal(data, &saved) == nil {
			if saved.Players != nil {
				h.results.Players = saved.Players
			}
			h.results.Scores = saved.Scores
			h.results.Issued = saved.Issued
			sort.Sort(sort.Reverse(sort.IntSlice(h.results.Scores)))
			return
		}
	}
	// A new record starts with the 15 games of the 1995 default table, so positions count them
	// ("#16 of 16" for a game below them all).
	for _, entry := range h.table {
		if entry.Score > 0 {
			h.results.Scores = append(h.results.Scores, entry.Score)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(h.results.Scores)))
	h.saveResults()
}

func (h *highScores) saveResults() error {
	data, err := json.Marshal(h.results)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(h.resultsPath), 0o755); err != nil {
		return err
	}
	tmp := h.resultsPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, h.resultsPath)
}

// recordResult adds a finished game's checked score to the record (once per game).
func (h *highScores) recordResult(s *classicSession) {
	if s.recorded || s.refused || s.score <= 0 || s.player == "" {
		return
	}
	s.recorded = true
	scores := h.results.Scores
	at := sort.Search(len(scores), func(i int) bool { return scores[i] < s.score })
	scores = append(scores, 0)
	copy(scores[at+1:], scores[at:])
	scores[at] = s.score
	if len(scores) > classicMaxResults {
		scores = scores[:classicMaxResults]
	}
	h.results.Scores = scores
	result := h.results.Players[s.player]
	if result == nil {
		result = &playerResult{}
		h.results.Players[s.player] = result
	}
	result.Last = s.score
	if s.score > result.Best {
		result.Best = s.score
	}
	h.saveResults()
}

// rankOf is a score's worldwide position among all recorded games (1 = the best; equal scores share
// a position), and how many games there are.
func (h *highScores) rankOf(score int) (rank, total int) {
	scores := h.results.Scores
	return sort.Search(len(scores), func(i int) bool { return scores[i] <= score }) + 1, len(scores)
}

type highScores struct {
	mu          sync.Mutex
	path        string
	table       []highScoreEntry
	sessions    map[string]*classicSession
	starts      map[string][]time.Time // new games per address and per player, for the hourly limits
	mazes       *mazeData
	now         func() time.Time
	secret      []byte // signs player ids, so a browser can't make one up or take someone else's
	results     *gameResults
	resultsPath string
}

func newHighScores(path string, mazes *mazeData) *highScores {
	h := &highScores{path: path, sessions: map[string]*classicSession{}, starts: map[string][]time.Time{}, mazes: mazes, now: time.Now}
	h.load()
	h.secret = loadSecret(filepath.Join(filepath.Dir(path), "player-key"))
	h.resultsPath = filepath.Join(filepath.Dir(path), "results.json")
	h.loadResults()
	return h
}

// loadSecret reads the key that signs player ids, making one the first time. Without a saved key
// (a read-only folder) ids last until the server restarts.
func loadSecret(path string) []byte {
	if data, err := os.ReadFile(path); err == nil && len(data) >= 32 {
		return data
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(err)
	}
	if os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		os.WriteFile(path, key, 0o600)
	}
	return key
}

// Player ids. The server gives each new player a random UUID (version 4) the first time their
// browser asks, signed with the server's key: "<uuid>.<signature>". The browser keeps it (with the
// last name typed for the high scores) and sends it with each new game; games and high-score rows
// are recorded against it.

func (h *highScores) newPlayerToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // RFC 4122 variant
	id := hex.EncodeToString(b[0:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" + hex.EncodeToString(b[6:8]) + "-" +
		hex.EncodeToString(b[8:10]) + "-" + hex.EncodeToString(b[10:16])
	return id + "." + h.sign(id)
}

func (h *highScores) sign(id string) string {
	mac := hmac.New(sha256.New, h.secret)
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

// player returns the UUID in a token the server signed, or "" for anything else.
func (h *highScores) player(token string) string {
	id, sig, ok := strings.Cut(token, ".")
	if !ok || len(id) != 36 || !hmac.Equal([]byte(sig), []byte(h.sign(id))) {
		return ""
	}
	return id
}

// recentStarts drops start times over an hour old and returns the rest.
func (h *highScores) recentStarts(key string, now time.Time) []time.Time {
	recent := h.starts[key][:0]
	for _, t := range h.starts[key] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	h.starts[key] = recent
	return recent
}

// publicTable is the table for the browser, marking the rows of `player`.
func (h *highScores) publicTable(player string) []publicEntry {
	out := make([]publicEntry, len(h.table))
	for i, e := range h.table {
		out[i] = publicEntry{Name: e.Name, Score: e.Score, Mine: player != "" && e.Player == player}
	}
	return out
}

// qualifyingScore is the score to beat to get onto the named board: its lowest while it is full,
// otherwise 0 (any score).
func (h *highScores) qualifyingScore() int {
	if len(h.table) < classicBoardSize {
		return 0
	}
	return h.table[len(h.table)-1].Score
}

// tableReply adds the board to a reply: "scores" (the 1995 page's 15), "more" (the rest of the board,
// for the dialog's second page), "qualify" (the score to beat), and "mine" (this player's last and
// best checked scores, each with its worldwide position among all recorded games).
func (h *highScores) tableReply(player string, out map[string]any) map[string]any {
	board := h.publicTable(player)
	out["scores"] = board[:min(classicTableSize, len(board))]
	out["more"] = board[min(classicTableSize, len(board)):]
	out["qualify"] = h.qualifyingScore()
	if result := h.results.Players[player]; player != "" && result != nil {
		lastRank, total := h.rankOf(result.Last)
		bestRank, _ := h.rankOf(result.Best)
		out["mine"] = map[string]any{"last": result.Last, "lastRank": lastRank, "best": result.Best, "bestRank": bestRank, "total": total}
	}
	return out
}

// load reads the table, or starts with the 1995 defaults: these names with 24,570 down to 1,638,
// shuffled among them.
func (h *highScores) load() {
	if data, err := os.ReadFile(h.path); err == nil {
		var table []highScoreEntry
		if json.Unmarshal(data, &table) == nil && len(table) >= classicTableSize && len(table) <= classicBoardSize {
			h.table = table
			return
		}
	}
	names := []string{"Greg", "John", "Josh", "Steve", "Larry", "Jo", "Jon", "Patrick", "Julie", "Tony", "Charles", "Joy", "Jennifer", "Harley", "Kevin"}
	order := mrand.Perm(classicTableSize)
	h.table = make([]highScoreEntry, classicTableSize)
	for i, name := range names {
		h.table[i] = highScoreEntry{Name: name, Score: 24570 - 1638*order[i]}
	}
	sort.SliceStable(h.table, func(a, b int) bool { return h.table[a].Score > h.table[b].Score })
	// Saved straight away, so the defaults keep their order from one start of the server to the next.
	h.save()
}

func (h *highScores) save() error {
	data, err := json.MarshalIndent(h.table, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		return err
	}
	tmp := h.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, h.path)
}

var errRefused = errors.New("refused")

// placeFlags picks the level's flags as the 1995 game did: for each team, random spots from that
// team's own list, none within 80 units of the start spot or of another flag.
func placeFlags(m *maze, level int) (red, blue []int, startX, startZ float64) {
	for _, s := range m.Spawns {
		if s.Team == "RED" {
			startX, startZ = s.X, s.Z
			break
		}
	}
	type spot struct{ x, z float64 }
	taken := []spot{{startX, startZ}}
	pick := func(team string) []int {
		var candidates []int
		for i, f := range m.Flags {
			if strings.EqualFold(f.Team, team) {
				candidates = append(candidates, i)
			}
		}
		mrand.Shuffle(len(candidates), func(a, b int) { candidates[a], candidates[b] = candidates[b], candidates[a] })
		var chosen []int
		for _, i := range candidates {
			if len(chosen) == classicFlags(level) {
				break
			}
			f := m.Flags[i]
			free := true
			for _, t := range taken {
				if math.Hypot(t.x-f.X, t.z-f.Z) < classicFlagClearance {
					free = false
					break
				}
			}
			if free {
				taken = append(taken, spot{f.X, f.Z})
				chosen = append(chosen, i)
			}
		}
		return chosen
	}
	red = pick("RED")
	blue = pick("BLUE")
	return
}

// startLevel places a level's flags and starts its clock.
func (s *classicSession) startLevel(m *maze, now time.Time) {
	s.maze = m
	var x, z float64
	s.red, s.blue, x, z = placeFlags(m, s.level)
	s.captured = map[int]bool{}
	s.lastX, s.lastZ, s.lastTime = x, z, now
	s.firstPending = true
	s.levelActive = true
}

func (h *highScores) ServeHTTP(w http.ResponseWriter, r *http.Request, action string, reply func(any)) {
	if action == "highscores" && r.Method == http.MethodGet {
		h.mu.Lock()
		out := h.tableReply(h.player(r.URL.Query().Get("player")), map[string]any{})
		h.mu.Unlock()
		reply(out)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Session    string `json:"session"`
		Seq        int    `json:"seq"`
		Level      int    `json:"level"`
		Difficulty int    `json:"difficulty"`
		StartAt    bool   `json:"startAt"`
		MazeID     int    `json:"mazeId"`
		Flag       int    `json:"flag"`
		FlagsLeft  int    `json:"flagsLeft"`
		Name       string `json:"name"`
		Player     string `json:"player"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	h.expire(now)

	if action == "player" {
		// A player id for a new browser; one the server signed is handed back unchanged.
		if h.player(req.Player) != "" {
			reply(map[string]any{"player": req.Player})
			return
		}
		ip := "player " + clientAddress(r)
		recent := h.recentStarts(ip, now)
		if len(recent) >= classicSessionsPerHour {
			http.Error(w, "refused", http.StatusForbidden)
			return
		}
		h.starts[ip] = append(recent, now)
		// The new player's number, for their default name ("Player #12").
		h.results.Issued++
		h.saveResults()
		reply(map[string]any{"player": h.newPlayerToken(), "number": h.results.Issued})
		return
	}

	if action == "session" {
		ip := clientAddress(r)
		player := h.player(req.Player)
		recent := h.recentStarts(ip, now)
		byPlayer := h.recentStarts("id "+player, now)
		m := h.mazes.mazes[req.MazeID]
		if player == "" || len(recent) >= classicSessionsPerHour || len(byPlayer) >= classicSessionsPerHour || m == nil ||
			!classicMazes[req.MazeID] || req.Level < 1 || req.Level > 99 || req.Difficulty < 0 || req.Difficulty > 2 ||
			len(h.sessions) >= classicMaxSessions {
			http.Error(w, "refused", http.StatusForbidden)
			return
		}
		h.starts[ip] = append(recent, now)
		h.starts["id "+player] = append(byPlayer, now)
		s := &classicSession{id: newSessionID(), player: player, difficulty: req.Difficulty, level: req.Level, bonusPending: req.StartAt, lastSeen: now}
		s.startLevel(m, now)
		h.sessions[s.id] = s
		reply(map[string]any{"session": s.id, "red": s.red, "blue": s.blue})
		return
	}

	s := h.sessions[req.Session]
	if s == nil {
		http.Error(w, "no such game", http.StatusForbidden)
		return
	}
	s.lastSeen = now
	if action == "finish" {
		// The game is over: its checked score joins the record of all games.
		s.over = true
		h.recordResult(s)
		rank, total := h.rankOf(s.score)
		reply(map[string]any{"score": s.score, "rank": rank, "total": total})
		return
	}
	if action == "submit" {
		h.recordResult(s)
		placed := false
		if !s.submitted && s.score > h.qualifyingScore() {
			s.submitted = true
			s.over = true
			// Highest first; a score equal to one already there goes below it.
			at := 0
			for at < len(h.table) && h.table[at].Score >= s.score {
				at++
			}
			entry := highScoreEntry{Name: cleanName(req.Name), Score: s.score, Player: s.player}
			h.table = append(h.table[:at], append([]highScoreEntry{entry}, h.table[at:]...)...)
			if len(h.table) > classicBoardSize {
				h.table = h.table[:classicBoardSize]
			}
			placed = h.save() == nil
		}
		reply(h.tableReply(s.player, map[string]any{"placed": placed, "score": s.score}))
		return
	}
	if s.over || req.Seq != s.seq+1 {
		http.Error(w, "out of order", http.StatusConflict)
		return
	}
	if err := h.apply(s, action, req.MazeID, req.Difficulty, req.Flag, req.FlagsLeft, now); err != nil {
		s.over = true // a game with a refused report can't enter the table or the record
		s.refused = true
		http.Error(w, "refused", http.StatusForbidden)
		return
	}
	s.seq = req.Seq
	switch action {
	case "level", "restart":
		reply(map[string]any{"red": s.red, "blue": s.blue, "score": s.score})
	default:
		reply(map[string]any{"score": s.score})
	}
}

// apply checks one report against the rules and updates the session.
func (h *highScores) apply(s *classicSession, action string, mazeID, difficulty, flag, flagsLeft int, now time.Time) error {
	switch action {
	case "capture":
		if !s.levelActive || s.captured[flag] || !contains(s.blue, flag) {
			return errRefused
		}
		f := s.maze.Flags[flag]
		need := time.Duration(math.Hypot(f.X-s.lastX, f.Z-s.lastZ) / classicTopSpeed[s.difficulty] * float64(time.Second))
		if s.firstPending {
			need += classicStartHold
		}
		if now.Sub(s.lastTime)+classicLatencyAllow < need {
			return errRefused // faster than the craft can go
		}
		captured, _, _ := classicPoints(s.level, s.difficulty)
		s.captured[flag] = true
		s.score += captured
		s.lastX, s.lastZ, s.lastTime, s.firstPending = f.X, f.Z, now, false
	case "win":
		if !s.levelActive || len(s.captured) != len(s.blue) || flagsLeft < 0 || flagsLeft > len(s.red) {
			return errRefused
		}
		_, remaining, bonus := classicPoints(s.level, s.difficulty)
		s.score += flagsLeft * remaining
		if s.bonusPending {
			s.score += bonus
		}
		s.bonusPending = false
		s.level++
		s.levelActive = false
	case "level":
		m := h.mazes.mazes[mazeID]
		if s.levelActive || m == nil || !classicMazes[mazeID] {
			return errRefused
		}
		s.startLevel(m, now)
	case "restart":
		m := h.mazes.mazes[mazeID]
		if m == nil || !classicMazes[mazeID] || difficulty < 0 || difficulty > 2 {
			return errRefused
		}
		s.difficulty = difficulty
		s.startLevel(m, now)
	case "end":
		s.levelActive = false
	default:
		return errRefused
	}
	return nil
}

func (h *highScores) expire(now time.Time) {
	for id, s := range h.sessions {
		if now.Sub(s.lastSeen) > classicSessionIdle {
			delete(h.sessions, id)
		}
	}
}

func contains(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func newSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// cleanName keeps a name to 26 printable characters; an empty one becomes two spaces, as in 1995.
func cleanName(name string) string {
	var b strings.Builder
	n := 0
	for _, r := range strings.TrimSpace(name) {
		if n == classicNameLength {
			break
		}
		if unicode.IsPrint(r) {
			b.WriteRune(r)
			n++
		}
	}
	if b.Len() == 0 {
		return "  "
	}
	return b.String()
}

func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
