package main

// HoverHub: the multiplayer game server.
//
// Only the client side of the original survives, so this is rebuilt from what the client sends and
// expects (the archived /signalr/hubs proxy lists the twelve server methods and their parameters).
// The flow, as the client drives it:
//
//  1. The host calls CreateGame(mazeId, numFlags, playersPerTeam) and shares the link #mp/<gameId>.
//  2. Every player calls Join(gameId, craftProfileId, name). The server answers each join with
//     waitingUpdate{WaitingCount, TotalCount, WaitingNames} to everyone in the game.
//  3. When the game is full the clients open the game view; the server sends useMazeId(mazeId).
//  4. Each client loads the maze and calls SpawnMe(); the server answers with spawnAt (start
//     point and team), placeFlagAt for every flag and spawnPod for every power-up.
//  5. Once everyone has spawned, startGame(endTime) goes to all players. From then on each client
//     calls SetCraftState ~15 times a second and gets every other player's state back, and the
//     server relays shots, hits, walls, flag captures and pod pick-ups to the other players.
//
// Choices made here where the original's behaviour is unknown (marked "estimate"):
//   - teams fill alternately, Red first;
//   - each team gets numFlags flags chosen at random from the maze's flag spots, as single player does;
//   - every pod spot gets a random pod type, as single player does, and picked-up pods don't return
//     (single player doesn't bring them back either);
//   - there is no time limit unless the server is started with -match-minutes;
//   - a game nobody is connected to is removed.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"
)

// classicProfileID is Profiles.Classic.id in src/game/11-game.js.
const classicProfileID = 4

type player struct {
	connID   string
	name     string
	profile  int
	team     string // "Red" or "Blue"
	spawned  bool
	state    map[string]any // last SetCraftState payload
	captured int
	joined   time.Time
}

type flagState struct {
	teamPoint
	captured bool
}

type podState struct {
	netVector
	PodType float64 `json:"PodType"`
	active  bool
}

type game struct {
	id        int
	mazeID    int
	numFlags  int
	perTeam   int
	created   time.Time
	players   []*player
	full      bool
	started   bool
	startedAt time.Time
	endTime   time.Time
	flags     []*flagState
	pods      []*podState
	classic   bool // played in the classic (Windows 95) look; added in this edition
	startTmr  *time.Timer
}

type hoverHub struct {
	sr         *signalR
	mazes      *mazeData
	matchLimit time.Duration

	mu     sync.Mutex
	games  map[int]*game
	byConn map[string]*game
	rnd    *rand.Rand

	highScores []highScore
}

type highScore struct {
	Name    string `json:"name"`
	Flags   int    `json:"flags"`
	Seconds int    `json:"seconds"`
}

func newHoverHub(mazes *mazeData, matchLimit time.Duration) *hoverHub {
	return &hoverHub{
		mazes:      mazes,
		matchLimit: matchLimit,
		games:      map[int]*game{},
		byConn:     map[string]*game{},
		rnd:        rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// invoke dispatches a hub call from a client. Method names are matched without regard to case,
// as ASP.NET SignalR does.
func (h *hoverHub) invoke(connID, method string, args []json.RawMessage) (any, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch strings.ToLower(method) {
	case "creategame":
		var mazeID, numFlags, perTeam int
		var classic bool // 4th argument, added in this edition (older clients send three)
		if err := decodeArgs(args, &mazeID, &numFlags, &perTeam, &classic); err != nil {
			return nil, err
		}
		return h.createGame(mazeID, numFlags, perTeam, classic)
	case "join":
		var gameID, profile int
		var name string
		if err := decodeArgs(args, &gameID, &profile, &name); err != nil {
			return nil, err
		}
		return nil, h.join(connID, gameID, profile, name)
	case "spawnme":
		return nil, h.spawnMe(connID)
	case "setcraftstate":
		var state map[string]any
		if err := decodeArgs(args, &state); err != nil {
			return nil, err
		}
		return h.setCraftState(connID, state)
	case "sendcollision":
		var c map[string]any
		if err := decodeArgs(args, &c); err != nil {
			return nil, err
		}
		if target, _ := c["Target"].(string); target != "" && h.sameGame(connID, target) {
			h.sr.clientCall(target, "onHit", c)
		}
		return nil, nil
	case "firebullet":
		return nil, h.relay(connID, "onBulletFired", args)
	case "sendbulletdestroyed":
		return nil, h.relay(connID, "bulletDestroyed", args)
	case "sendmybullethitcraft":
		var bulletID any
		var target string
		if err := decodeArgs(args, &bulletID, &target); err != nil {
			return nil, err
		}
		if h.sameGame(connID, target) {
			h.sr.clientCall(target, "hitByBullet", bulletID)
		}
		return nil, nil
	case "createtempwall":
		return nil, h.relay(connID, "onTempWallCreated", args)
	case "capturedflag":
		return nil, h.flagChange(connID, args, true)
	case "uncapturedflag":
		return nil, h.flagChange(connID, args, false)
	case "hitpod":
		var pos netVector
		if err := decodeArgs(args, &pos); err != nil {
			return nil, err
		}
		if g := h.byConn[connID]; g != nil {
			if p := nearestPod(g, pos); p != nil {
				p.active = false
			}
		}
		return nil, h.relay(connID, "removePod", args)
	}
	return nil, fmt.Errorf("'%s' method could not be resolved.", method)
}

func (h *hoverHub) createGame(mazeID, numFlags, perTeam int, classic bool) (int, error) {
	m := h.mazes.mazes[mazeID]
	if m == nil {
		m = h.mazes.mazes[h.mazes.order[0]]
	}
	if perTeam < 1 {
		perTeam = 1
	}
	if perTeam > 4 {
		perTeam = 4
	}
	if numFlags < 1 {
		numFlags = 4
	}
	h.removeStaleGames()

	id := 0
	for id == 0 || h.games[id] != nil {
		id = 10000 + h.rnd.Intn(90000)
	}
	g := &game{id: id, mazeID: m.MazeID, numFlags: numFlags, perTeam: perTeam, created: time.Now(), classic: classic}

	// Flags: numFlags per team, picked at random from the maze's flag spots (estimate; single
	// player picks the same way).
	for _, team := range []string{"RED", "BLUE"} {
		var spots []teamPoint
		for _, f := range m.Flags {
			if strings.EqualFold(f.Team, team) {
				spots = append(spots, f)
			}
		}
		h.rnd.Shuffle(len(spots), func(i, j int) { spots[i], spots[j] = spots[j], spots[i] })
		for i := 0; i < len(spots) && i < numFlags; i++ {
			g.flags = append(g.flags, &flagState{teamPoint: spots[i]})
		}
	}
	// Pods: every spot, with a random type from 1 up to (not including) 9, like single player.
	for _, p := range m.Pods {
		g.pods = append(g.pods, &podState{netVector: p, PodType: 1 + h.rnd.Float64()*8, active: true})
	}
	h.games[id] = g
	log.Printf("hub: game %d created (maze %d, %d per team, %d flags each)", id, g.mazeID, perTeam, numFlags)
	return id, nil
}

func (h *hoverHub) join(connID string, gameID, profile int, name string) error {
	g := h.games[gameID]
	if g == nil {
		h.sr.clientCall(connID, "disconnectWithError", "That game doesn't exist any more.")
		return errors.New("game not found")
	}
	if old := h.byConn[connID]; old != nil && old != g {
		h.leave(connID)
	}
	for _, p := range g.players {
		if p.connID == connID {
			return nil
		}
	}
	if g.full {
		h.sr.clientCall(connID, "disconnectWithError", "That game is already full.")
		return errors.New("game is full")
	}
	red, blue := g.teamCounts()
	team := "Red"
	if red > blue {
		team = "Blue"
	}
	if g.classic {
		// Classic games all drive with the 1995 handling (Profiles.Classic in the game code).
		profile = classicProfileID
	}
	p := &player{connID: connID, name: name, profile: profile, team: team, joined: time.Now()}
	g.players = append(g.players, p)
	h.byConn[connID] = g
	if len(g.players) == g.perTeam*2 {
		g.full = true
	}
	h.sendWaitingUpdate(g)
	if g.full {
		for _, p := range g.players {
			h.sr.clientCall(p.connID, "useMazeId", g.mazeID)
		}
		// Start even if someone never finishes loading the maze.
		g.startTmr = time.AfterFunc(45*time.Second, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.games[g.id] == g {
				h.startGame(g)
			}
		})
	}
	return nil
}

func (g *game) teamCounts() (red, blue int) {
	for _, p := range g.players {
		if p.team == "Red" {
			red++
		} else {
			blue++
		}
	}
	return
}

func (h *hoverHub) sendWaitingUpdate(g *game) {
	names := make([]any, 0, len(g.players))
	for _, p := range g.players {
		if p.name == "" {
			names = append(names, nil)
		} else {
			names = append(names, p.name)
		}
	}
	update := map[string]any{"WaitingCount": len(g.players), "TotalCount": g.perTeam * 2, "WaitingNames": names, "Classic": g.classic}
	for _, p := range g.players {
		h.sr.clientCall(p.connID, "waitingUpdate", update)
	}
}

func (h *hoverHub) spawnMe(connID string) error {
	g := h.byConn[connID]
	if g == nil {
		return errors.New("not in a game")
	}
	p := g.player(connID)
	m := h.mazes.mazes[g.mazeID]

	// Start points: the maze's RED spawns for the red team, the others (drone spawns in single
	// player) for the blue team; players of a team take them in join order.
	var spots []teamPoint
	for _, s := range m.Spawns {
		if strings.EqualFold(s.Team, "RED") == (p.team == "Red") {
			spots = append(spots, s)
		}
	}
	if len(spots) == 0 {
		spots = m.Spawns
	}
	index := 0
	for _, other := range g.players {
		if other == p {
			break
		}
		if other.team == p.team {
			index++
		}
	}
	spot := spots[index%len(spots)]
	h.sr.clientCall(connID, "spawnAt", map[string]any{"X": spot.X, "Y": spot.Y, "Z": spot.Z, "Team": p.team})

	for _, f := range g.flags {
		h.sr.clientCall(connID, "placeFlagAt", f.teamPoint)
	}
	for _, f := range g.flags {
		if f.captured {
			h.sr.clientCall(connID, "onFlagCaptured", netVector{f.X, f.Y, f.Z})
		}
	}
	for _, pod := range g.pods {
		if pod.active {
			h.sr.clientCall(connID, "spawnPod", map[string]any{"X": pod.X, "Y": pod.Y, "Z": pod.Z, "PodType": pod.PodType})
		}
	}
	p.spawned = true

	if g.started {
		h.sr.clientCall(connID, "startGame", g.endTimeValue())
		return nil
	}
	for _, other := range g.players {
		if !other.spawned {
			return nil
		}
	}
	h.startGame(g)
	return nil
}

func (h *hoverHub) startGame(g *game) {
	if g.started {
		return
	}
	g.started = true
	g.startedAt = time.Now()
	if g.startTmr != nil {
		g.startTmr.Stop()
	}
	if h.matchLimit > 0 {
		g.endTime = g.startedAt.Add(h.matchLimit)
	}
	for _, p := range g.players {
		h.sr.clientCall(p.connID, "startGame", g.endTimeValue())
	}
	log.Printf("hub: game %d started with %d players", g.id, len(g.players))
}

// endTimeValue is what startGame sends: an ISO date the client turns into its countdown, or null
// for no time limit.
func (g *game) endTimeValue() any {
	if g.endTime.IsZero() {
		return nil
	}
	return g.endTime.UTC().Format(time.RFC3339)
}

func (g *game) player(connID string) *player {
	for _, p := range g.players {
		if p.connID == connID {
			return p
		}
	}
	return nil
}

// setCraftState stores the caller's state and returns everyone else's, which the client uses to
// add, move and remove the other crafts.
func (h *hoverHub) setCraftState(connID string, state map[string]any) ([]map[string]any, error) {
	g := h.byConn[connID]
	if g == nil {
		return nil, errors.New("not in a game")
	}
	if p := g.player(connID); p != nil {
		p.state = state
		if n, ok := state["Name"].(string); ok && n != "" {
			p.name = n
		}
		if c, ok := state["CapturedFlags"].(float64); ok {
			p.captured = int(c)
		}
	}
	others := make([]map[string]any, 0, len(g.players))
	for _, p := range g.players {
		if p.connID == connID || p.state == nil {
			continue
		}
		s := make(map[string]any, len(p.state)+4)
		for k, v := range p.state {
			s[k] = v
		}
		s["ConnectionId"] = p.connID
		s["Name"] = p.name
		s["Team"] = p.team
		s["Profile"] = p.profile
		others = append(others, s)
	}
	return others, nil
}

// relay passes a call on to every other player in the caller's game.
func (h *hoverHub) relay(connID, clientMethod string, args []json.RawMessage) error {
	g := h.byConn[connID]
	if g == nil {
		return errors.New("not in a game")
	}
	out := make([]any, len(args))
	for i, a := range args {
		out[i] = a
	}
	for _, p := range g.players {
		if p.connID != connID {
			h.sr.clientCall(p.connID, clientMethod, out...)
		}
	}
	return nil
}

func (h *hoverHub) flagChange(connID string, args []json.RawMessage, captured bool) error {
	var pos netVector
	if err := decodeArgs(args, &pos); err != nil {
		return err
	}
	g := h.byConn[connID]
	if g == nil {
		return errors.New("not in a game")
	}
	if f := nearestFlag(g, pos); f != nil {
		f.captured = captured
	}
	if p := g.player(connID); p != nil && captured {
		h.maybeRecordHighScore(g, p)
	}
	method := "onFlagUncaptured"
	if captured {
		method = "onFlagCaptured"
	}
	return h.relay(connID, method, args)
}

// maybeRecordHighScore remembers how fast a team took all the other team's flags, for the
// scoreboard (estimate: the original's high-score rules are unknown).
func (h *hoverHub) maybeRecordHighScore(g *game, p *player) {
	enemy := "BLUE"
	if p.team == "Blue" {
		enemy = "RED"
	}
	for _, f := range g.flags {
		if strings.EqualFold(f.Team, enemy) && !f.captured {
			return
		}
	}
	secs := int(time.Since(g.startedAt).Seconds())
	h.highScores = append(h.highScores, highScore{Name: p.name, Flags: g.numFlags, Seconds: secs})
	if len(h.highScores) > 10 {
		h.highScores = h.highScores[len(h.highScores)-10:]
	}
}

func nearestFlag(g *game, pos netVector) *flagState {
	var best *flagState
	bestDist := math.MaxFloat64
	for _, f := range g.flags {
		d := math.Hypot(f.X-pos.X, f.Z-pos.Z)
		if d < bestDist {
			best, bestDist = f, d
		}
	}
	if bestDist > 256 {
		return nil
	}
	return best
}

func nearestPod(g *game, pos netVector) *podState {
	var best *podState
	bestDist := math.MaxFloat64
	for _, p := range g.pods {
		d := math.Hypot(p.X-pos.X, p.Z-pos.Z)
		if p.active && d < bestDist {
			best, bestDist = p, d
		}
	}
	if bestDist > 256 {
		return nil
	}
	return best
}

func (h *hoverHub) sameGame(a, b string) bool {
	g := h.byConn[a]
	return g != nil && g == h.byConn[b]
}

// disconnected is called by the SignalR layer when a connection goes away.
func (h *hoverHub) disconnected(connID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.leave(connID)
}

func (h *hoverHub) leave(connID string) {
	g := h.byConn[connID]
	if g == nil {
		return
	}
	delete(h.byConn, connID)
	var left *player
	kept := g.players[:0]
	for _, p := range g.players {
		if p.connID == connID {
			left = p
			continue
		}
		kept = append(kept, p)
	}
	g.players = kept
	if len(g.players) == 0 {
		if g.startTmr != nil {
			g.startTmr.Stop()
		}
		delete(h.games, g.id)
		log.Printf("hub: game %d closed (everyone left)", g.id)
		return
	}
	if !g.full {
		h.sendWaitingUpdate(g)
		return
	}
	if left != nil {
		name := left.name
		if name == "" {
			name = "A player"
		}
		for _, p := range g.players {
			h.sr.clientCall(p.connID, "showMessage", name+" left the game")
		}
	}
	if !g.started {
		// Someone dropped while the maze loaded: don't keep everyone else waiting for them.
		all := true
		for _, p := range g.players {
			all = all && p.spawned
		}
		if all {
			h.startGame(g)
		}
	}
}

// removeStaleGames drops games that never filled up within an hour.
func (h *hoverHub) removeStaleGames() {
	for id, g := range h.games {
		if !g.full && time.Since(g.created) > time.Hour {
			for _, p := range g.players {
				delete(h.byConn, p.connID)
			}
			delete(h.games, id)
		}
	}
}

// scoreboard answers the kiosk scoreboard (api/scoreboard/<gameId>).
func (h *hoverHub) scoreboard(gameID int) map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	result := map[string]any{"scores": []any{}, "description": "", "highScores": append([]highScore{}, h.highScores...)}
	g := h.games[gameID]
	if g == nil {
		result["description"] = "Waiting for a game"
		return result
	}
	scores := make([]any, 0, len(g.players))
	for _, p := range g.players {
		name := p.name
		if name == "" {
			name = "PLAYER"
		}
		scores = append(scores, map[string]any{"name": name, "team": p.team, "capturedFlags": p.captured})
	}
	result["scores"] = scores
	m := h.mazes.mazes[g.mazeID]
	result["description"] = fmt.Sprintf("%s - %d vs %d", m.Name, g.perTeam, g.perTeam)
	if g.classic {
		result["description"] = result["description"].(string) + " (classic)"
	}
	if v := g.endTimeValue(); v != nil {
		result["endTime"] = v
	}
	return result
}

// decodeArgs unpacks hub call arguments into the given pointers; missing trailing arguments keep
// their zero value.
func decodeArgs(args []json.RawMessage, into ...any) error {
	for i, dst := range into {
		if i >= len(args) {
			break
		}
		if err := json.Unmarshal(args[i], dst); err != nil {
			// Numbers sometimes arrive as strings (e.g. a game id typed into a link).
			var s string
			if json.Unmarshal(args[i], &s) == nil {
				if err2 := json.Unmarshal([]byte(s), dst); err2 == nil {
					continue
				}
			}
			return fmt.Errorf("argument %d: %v", i+1, err)
		}
	}
	return nil
}
