package main

// A small server for the ASP.NET SignalR 2.0 wire protocol (protocol version 1.3), which is what
// the game's bundled jquery.signalR-2.0.3 client speaks. It supports the WebSocket and long-polling
// transports and one hub ("hoverHub"); the original server ran ASP.NET SignalR on Azure.
//
// Endpoints (all under /signalr):
//   hubs        the JavaScript hub proxy the client loads with $.getScript
//   negotiate   hands out a connection id and token
//   connect     opens a transport (WebSocket upgrade, or a long-poll request)
//   reconnect   re-opens a transport after a network drop
//   poll        long-polling: waits for messages
//   send        long-polling: client -> server hub calls
//   abort       the client is leaving
//   ping, start keep-alive and start acknowledgement used by newer clients
//
// Messages to the client are "persistent responses": {"C": cursor, "M": [hub messages]}.
// Hub messages are {"H": "HoverHub", "M": "methodName", "A": [args]}. Hub calls from the
// client are {"H": "hoverhub", "M": "Method", "A": [args], "I": callId} and are answered with
// {"I": callId, "R": result} or {"I": callId, "E": "error"}.

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed hubs.js
var hubsProxyJS []byte

const (
	keepAliveEvery   = 10 * time.Second // the client expects something at least every 20 s
	disconnectAfter  = 30 * time.Second // drop a connection that has no transport for this long
	longPollHoldTime = 50 * time.Second // how long a poll request waits for messages
)

// hubHandler is implemented by the game hub.
type hubHandler interface {
	invoke(connID, method string, args []json.RawMessage) (any, error)
	disconnected(connID string)
}

type signalR struct {
	hub      hubHandler
	upgrader websocket.Upgrader

	mu    sync.Mutex
	conns map[string]*srConn // by connection token
	byID  map[string]*srConn // by connection id
}

type srConn struct {
	id, token string

	mu        sync.Mutex
	cursor    int64
	pending   [][]byte      // messages waiting for a long poll
	wake      chan struct{} // signalled when pending grows
	ws        *websocket.Conn
	wsWrite   sync.Mutex
	lastAlive time.Time
	closed    bool
}

func newSignalR(hub hubHandler) *signalR {
	s := &signalR{
		hub:   hub,
		conns: make(map[string]*srConn),
		byID:  make(map[string]*srConn),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
	go s.reapIdle()
	return s
}

func (s *signalR) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	action := strings.TrimPrefix(r.URL.Path, "/signalr/")
	switch strings.ToLower(strings.Trim(action, "/")) {
	case "hubs", "js":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(hubsProxyJS)
	case "negotiate":
		s.negotiate(w, r)
	case "connect":
		s.connect(w, r, true)
	case "reconnect":
		s.connect(w, r, false)
	case "poll":
		s.poll(w, r)
	case "send":
		s.send(w, r)
	case "abort":
		if c := s.lookup(r); c != nil {
			s.drop(c)
		}
		w.WriteHeader(http.StatusOK)
	case "ping":
		writeJSON(w, map[string]string{"Response": "pong"})
	case "start":
		writeJSON(w, map[string]string{"Response": "started"})
	default:
		http.NotFound(w, r)
	}
}

func (s *signalR) negotiate(w http.ResponseWriter, r *http.Request) {
	c := &srConn{id: randomID(16), token: randomID(24), wake: make(chan struct{}, 1), lastAlive: time.Now()}
	s.mu.Lock()
	s.conns[c.token] = c
	s.byID[c.id] = c
	s.mu.Unlock()
	writeJSON(w, map[string]any{
		"Url":                     "/signalr",
		"ConnectionToken":         c.token,
		"ConnectionId":            c.id,
		"KeepAliveTimeout":        20.0,
		"DisconnectTimeout":       disconnectAfter.Seconds(),
		"TryWebSockets":           true,
		"ProtocolVersion":         "1.3",
		"TransportConnectTimeout": 5.0,
		"LongPollDelay":           0.0,
	})
}

func (s *signalR) lookup(r *http.Request) *srConn {
	token := r.URL.Query().Get("connectionToken")
	if token == "" {
		_ = r.ParseForm()
		token = r.Form.Get("connectionToken")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conns[token]
}

func (s *signalR) connect(w http.ResponseWriter, r *http.Request, initial bool) {
	c := s.lookup(r)
	if c == nil {
		http.Error(w, "unknown connection token", http.StatusForbidden)
		return
	}
	switch r.URL.Query().Get("transport") {
	case "webSockets":
		ws, err := s.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		s.serveWebSocket(c, ws, initial)
	case "longPolling":
		c.touch()
		if initial {
			// The first response initialises the connection (the "S" field).
			writeJSON(w, map[string]any{"C": c.cursorString(), "S": 1, "M": []any{}})
			return
		}
		s.poll(w, r)
	default:
		// Server-sent events and forever-frame aren't offered; failing fast makes the client
		// move on to the next transport.
		http.Error(w, "transport not supported", http.StatusBadRequest)
	}
}

func (s *signalR) serveWebSocket(c *srConn, ws *websocket.Conn, initial bool) {
	c.mu.Lock()
	if c.ws != nil {
		c.ws.Close()
	}
	c.ws = ws
	queued := c.pending
	c.pending = nil
	c.lastAlive = time.Now()
	c.mu.Unlock()

	msgs := make([]json.RawMessage, 0, len(queued))
	for _, m := range queued {
		msgs = append(msgs, m)
	}
	first := map[string]any{"C": c.cursorString(), "M": msgs}
	if initial {
		first["S"] = 1
	}
	c.writeWS(first)

	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(keepAliveEvery)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				if err := c.writeWSRaw([]byte("{}")); err != nil {
					return
				}
			}
		}
	}()

	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			break
		}
		c.touch()
		reply := s.handleInvocation(c, data)
		if reply != nil {
			c.writeWS(reply)
		}
	}
	close(stop)
	c.mu.Lock()
	if c.ws == ws {
		c.ws = nil
		c.lastAlive = time.Now() // start the disconnect countdown now
	}
	c.mu.Unlock()
	ws.Close()
}

func (s *signalR) poll(w http.ResponseWriter, r *http.Request) {
	c := s.lookup(r)
	if c == nil {
		http.Error(w, "unknown connection token", http.StatusForbidden)
		return
	}
	c.touch()
	deadline := time.NewTimer(longPollHoldTime)
	defer deadline.Stop()
	for {
		c.mu.Lock()
		if len(c.pending) > 0 || c.closed {
			msgs := make([]json.RawMessage, 0, len(c.pending))
			for _, m := range c.pending {
				msgs = append(msgs, m)
			}
			c.pending = nil
			closed := c.closed
			c.mu.Unlock()
			resp := map[string]any{"C": c.cursorString(), "M": msgs}
			if closed {
				resp["D"] = 1
			}
			writeJSON(w, resp)
			c.touch()
			return
		}
		c.mu.Unlock()
		select {
		case <-c.wake:
		case <-deadline.C:
			writeJSON(w, map[string]any{"C": c.cursorString(), "M": []any{}})
			c.touch()
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (s *signalR) send(w http.ResponseWriter, r *http.Request) {
	c := s.lookup(r)
	if c == nil {
		http.Error(w, "unknown connection token", http.StatusForbidden)
		return
	}
	c.touch()
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	reply := s.handleInvocation(c, []byte(r.PostForm.Get("data")))
	if reply == nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	writeJSON(w, reply)
}

type hubInvocation struct {
	Hub    string            `json:"H"`
	Method string            `json:"M"`
	Args   []json.RawMessage `json:"A"`
	ID     json.RawMessage   `json:"I"`
}

func (s *signalR) handleInvocation(c *srConn, data []byte) map[string]any {
	var inv hubInvocation
	if err := json.Unmarshal(data, &inv); err != nil || inv.Method == "" {
		return nil
	}
	id := strings.Trim(string(inv.ID), `"`)
	if !strings.EqualFold(inv.Hub, "hoverHub") {
		return map[string]any{"I": id, "E": fmt.Sprintf("'%s' Hub could not be resolved.", inv.Hub)}
	}
	result, err := s.hub.invoke(c.id, inv.Method, inv.Args)
	if err != nil {
		return map[string]any{"I": id, "E": err.Error()}
	}
	return map[string]any{"I": id, "R": result}
}

// clientCall sends a hub message ("call this client-side function") to one connection.
func (s *signalR) clientCall(connID, method string, args ...any) {
	s.mu.Lock()
	c := s.byID[connID]
	s.mu.Unlock()
	if c == nil {
		return
	}
	if args == nil {
		args = []any{}
	}
	msg, err := json.Marshal(map[string]any{"H": "HoverHub", "M": method, "A": args})
	if err != nil {
		log.Printf("signalr: encoding %s: %v", method, err)
		return
	}
	c.mu.Lock()
	c.cursor++
	ws := c.ws
	if ws == nil {
		c.pending = append(c.pending, msg)
		select {
		case c.wake <- struct{}{}:
		default:
		}
	}
	c.mu.Unlock()
	if ws != nil {
		c.writeWS(map[string]any{"C": c.cursorString(), "M": []json.RawMessage{msg}})
	}
}

func (s *signalR) drop(c *srConn) {
	s.mu.Lock()
	delete(s.conns, c.token)
	delete(s.byID, c.id)
	s.mu.Unlock()
	c.mu.Lock()
	c.closed = true
	if c.ws != nil {
		c.ws.Close()
	}
	select {
	case c.wake <- struct{}{}:
	default:
	}
	c.mu.Unlock()
	s.hub.disconnected(c.id)
}

// reapIdle drops connections whose transport has been gone longer than the disconnect timeout.
func (s *signalR) reapIdle() {
	for range time.Tick(5 * time.Second) {
		var dead []*srConn
		s.mu.Lock()
		for _, c := range s.conns {
			c.mu.Lock()
			if c.ws == nil && time.Since(c.lastAlive) > disconnectAfter+longPollHoldTime {
				dead = append(dead, c)
			}
			c.mu.Unlock()
		}
		s.mu.Unlock()
		for _, c := range dead {
			s.drop(c)
		}
	}
}

func (c *srConn) touch() {
	c.mu.Lock()
	c.lastAlive = time.Now()
	c.mu.Unlock()
}

func (c *srConn) cursorString() string {
	return strconv.FormatInt(c.cursor, 10)
}

func (c *srConn) writeWS(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	_ = c.writeWSRaw(data)
}

func (c *srConn) writeWSRaw(data []byte) error {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()
	if ws == nil {
		return fmt.Errorf("no websocket")
	}
	c.wsWrite.Lock()
	defer c.wsWrite.Unlock()
	_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.WriteMessage(websocket.TextMessage, data)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_ = json.NewEncoder(w).Encode(v)
}

func randomID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
