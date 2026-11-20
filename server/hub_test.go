package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// testClient speaks the SignalR 2.0 protocol over a WebSocket, like the game's jQuery client.
type testClient struct {
	t       *testing.T
	ws      *websocket.Conn
	id      string
	nextID  int
	events  chan map[string]any // hub messages ({"H","M","A"})
	replies chan map[string]any // call results ({"I","R"/"E"})
}

func connectClient(t *testing.T, base string) *testClient {
	t.Helper()
	var neg struct{ ConnectionToken, ConnectionId string }
	resp, err := httpGetJSON(base+"/signalr/negotiate?clientProtocol=1.3", &neg)
	if err != nil || resp != 200 {
		t.Fatalf("negotiate: %v %d", err, resp)
	}
	u := strings.Replace(base, "http", "ws", 1) + "/signalr/connect?transport=webSockets&connectionToken=" + url.QueryEscape(neg.ConnectionToken)
	ws, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	c := &testClient{t: t, ws: ws, id: neg.ConnectionId, events: make(chan map[string]any, 256), replies: make(chan map[string]any, 16)}
	_, first, err := ws.ReadMessage()
	if err != nil || !strings.Contains(string(first), `"S":1`) {
		t.Fatalf("expected init message, got %s (%v)", first, err)
	}
	go func() {
		for {
			_, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			var msg map[string]any
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			if _, ok := msg["I"]; ok {
				c.replies <- msg
				continue
			}
			if list, ok := msg["M"].([]any); ok {
				for _, m := range list {
					c.events <- m.(map[string]any)
				}
			}
		}
	}()
	return c
}

func (c *testClient) call(method string, args ...any) map[string]any {
	c.t.Helper()
	c.nextID++
	if args == nil {
		args = []any{}
	}
	if err := c.ws.WriteJSON(map[string]any{"H": "hoverhub", "M": method, "A": args, "I": c.nextID}); err != nil {
		c.t.Fatal(err)
	}
	select {
	case r := <-c.replies:
		if e, ok := r["E"]; ok {
			c.t.Fatalf("%s failed: %v", method, e)
		}
		return r
	case <-time.After(3 * time.Second):
		c.t.Fatalf("%s: no reply", method)
	}
	return nil
}

// expect waits for the named client callback and returns its arguments.
func (c *testClient) expect(method string) []any {
	c.t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case m := <-c.events:
			if m["M"] == method {
				return m["A"].([]any)
			}
		case <-deadline:
			c.t.Fatalf("never received %s", method)
		}
	}
}

func httpGetJSON(u string, into any) (int, error) {
	resp, err := http.Get(u)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, json.NewDecoder(resp.Body).Decode(into)
}

func TestTwoPlayerGame(t *testing.T) {
	mazes, err := loadMazes(filepath.Join("..", "scripts", "mazes.js"))
	if err != nil {
		t.Fatal(err)
	}
	hub := newHoverHub(mazes, 0)
	sr := newSignalR(hub)
	hub.sr = sr
	srv := httptest.NewServer(sr)
	defer srv.Close()

	host := connectClient(t, srv.URL)
	guest := connectClient(t, srv.URL)

	created := host.call("CreateGame", 44, 4, 1)
	gameID := int(created["R"].(float64))
	if gameID == 0 {
		t.Fatal("no game id")
	}

	host.call("Join", gameID, 0, "HOST")
	if w := host.expect("waitingUpdate")[0].(map[string]any); w["WaitingCount"].(float64) != 1 || w["TotalCount"].(float64) != 2 {
		t.Fatalf("bad waiting update %v", w)
	}
	guest.call("Join", gameID, 1, "GUEST")
	for _, c := range []*testClient{host, guest} {
		c.expect("waitingUpdate")
		if maze := c.expect("useMazeId")[0].(float64); maze != 44 {
			t.Fatalf("maze %v", maze)
		}
	}

	host.call("SpawnMe")
	spawn := host.expect("spawnAt")[0].(map[string]any)
	if spawn["Team"] != "Red" {
		t.Fatalf("host team %v", spawn["Team"])
	}
	flags := 0
	for flags < 8 {
		host.expect("placeFlagAt")
		flags++
	}
	host.expect("spawnPod")
	guest.call("SpawnMe")
	if team := guest.expect("spawnAt")[0].(map[string]any)["Team"]; team != "Blue" {
		t.Fatalf("guest team %v", team)
	}
	host.expect("startGame")
	guest.expect("startGame")

	state := map[string]any{"Position": map[string]any{"X": 1, "Y": 2, "Z": 3}, "Velocity": map[string]any{"X": 0, "Y": 0, "Z": 0}, "AngleY": 0.5, "Name": "HOST", "CapturedFlags": 0}
	host.call("SetCraftState", state)
	others := guest.call("SetCraftState", state)["R"].([]any)
	if len(others) != 1 || others[0].(map[string]any)["ConnectionId"] != host.id || others[0].(map[string]any)["Team"] != "Red" {
		t.Fatalf("guest sees %v", others)
	}

	host.call("FireBullet", map[string]any{"Bullet": "StandardBullet", "Id": 7})
	if b := guest.expect("onBulletFired")[0].(map[string]any); b["Id"].(float64) != 7 {
		t.Fatalf("bullet %v", b)
	}
	host.call("SendMyBulletHitCraft", 7, guest.id)
	if id := guest.expect("hitByBullet")[0].(float64); id != 7 {
		t.Fatalf("hit %v", id)
	}
	host.call("CapturedFlag", map[string]any{"X": 1, "Y": 1, "Z": 1})
	guest.expect("onFlagCaptured")

	board := hub.scoreboard(gameID)
	if len(board["scores"].([]any)) != 2 {
		t.Fatalf("scoreboard %v", board)
	}
}

// A classic-mode game tells every player so (waitingUpdate.Classic) and gives them the 1995 profile.
func TestClassicGame(t *testing.T) {
	mazes, err := loadMazes(filepath.Join("..", "scripts", "mazes.js"))
	if err != nil {
		t.Fatal(err)
	}
	hub := newHoverHub(mazes, 0)
	sr := newSignalR(hub)
	hub.sr = sr
	srv := httptest.NewServer(sr)
	defer srv.Close()

	host := connectClient(t, srv.URL)
	guest := connectClient(t, srv.URL)
	gameID := int(host.call("CreateGame", 44, 4, 1, true)["R"].(float64))
	host.call("Join", gameID, 0, "HOST")
	if w := host.expect("waitingUpdate")[0].(map[string]any); w["Classic"] != true {
		t.Fatalf("waiting update should say classic: %v", w)
	}
	guest.call("Join", gameID, 2, "GUEST")
	if w := guest.expect("waitingUpdate")[0].(map[string]any); w["Classic"] != true || w["WaitingCount"].(float64) != 2 {
		t.Fatalf("guest waiting update %v", w)
	}
	for _, c := range []*testClient{host, guest} {
		c.expect("useMazeId")
	}
	host.call("SpawnMe")
	guest.call("SpawnMe")
	host.expect("startGame")
	state := map[string]any{"Position": map[string]any{"X": 1, "Y": 2, "Z": 3}, "Name": "GUEST"}
	guest.call("SetCraftState", state)
	others := host.call("SetCraftState", state)["R"].([]any)
	if len(others) != 1 || others[0].(map[string]any)["Profile"].(float64) != classicProfileID {
		t.Fatalf("host sees %v", others)
	}

	// Games made by the original three-argument call stay modern.
	modern := int(host.call("CreateGame", 44, 4, 1)["R"].(float64))
	if hub.games[modern].classic {
		t.Fatal("three-argument CreateGame should not be classic")
	}
}
