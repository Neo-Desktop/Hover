package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// api answers the small HTTP API the game calls besides SignalR:
//
//	GET  api/scoreboard/<gameId>       kiosk scoreboard, JSONP (?callback=...)
//	GET  api/MazeAPI/Maze               list of mazes (id, name, scheme)
//	GET  api/MazeAPI/Maze/<id>          one maze (the game normally reads these from scripts/mazes.js)
//	GET  api/SchemeAPI/All              list of texture schemes
//	GET  api/SchemeAPI/One/<id>         one scheme by id
//	GET  api/SchemeAPI/Name/<name>      one scheme by name
//	POST api/MazeAPI/New, SaveMaze      the old maze editor's save calls (not available here)
//	     api/classic/...                classic-mode high scores (highscores.go; added in this edition)
type api struct {
	hub    *hoverHub
	mazes  *mazeData
	scores *highScores
}

func newAPI(hub *hoverHub, mazes *mazeData, scores *highScores) *api {
	return &api{hub: hub, mazes: mazes, scores: scores}
}

var jsonpCallback = regexp.MustCompile(`^[A-Za-z_$][\w$.]*$`)

func (a *api) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	head := strings.ToLower(parts[0])
	sub := ""
	if len(parts) > 1 {
		sub = strings.ToLower(parts[1])
	}
	arg := ""
	if len(parts) > 2 {
		arg = parts[2]
	}

	switch {
	case head == "classic" && len(parts) == 2 && a.scores != nil:
		a.scores.ServeHTTP(w, r, sub, func(v any) { a.reply(w, r, v) })

	case head == "scoreboard" && len(parts) == 2:
		id, _ := strconv.Atoi(parts[1])
		a.reply(w, r, a.hub.scoreboard(id))

	case head == "mazeapi" && sub == "maze" && arg == "":
		list := []map[string]any{}
		for _, id := range a.mazes.order {
			m := a.mazes.mazes[id]
			list = append(list, map[string]any{"MazeId": m.MazeID, "Name": m.Name, "Scheme": m.Scheme})
		}
		a.reply(w, r, list)

	case head == "mazeapi" && sub == "maze":
		id, _ := strconv.Atoi(arg)
		if m := a.mazes.mazes[id]; m != nil {
			a.reply(w, r, m.raw)
			return
		}
		http.NotFound(w, r)

	case head == "mazeapi" && (sub == "new" || sub == "savemaze"):
		http.Error(w, "The maze editor's save service isn't part of this rebuild.", http.StatusNotImplemented)

	case head == "schemeapi" && sub == "all":
		list := []json.RawMessage{}
		for _, s := range a.mazes.schemes {
			list = append(list, s)
		}
		a.reply(w, r, list)

	case head == "schemeapi" && sub == "name":
		if s, ok := a.mazes.schemes[strings.ToLower(arg)]; ok {
			a.reply(w, r, s)
			return
		}
		http.NotFound(w, r)

	case head == "schemeapi" && sub == "one":
		id, _ := strconv.Atoi(arg)
		for _, s := range a.mazes.schemes {
			var meta struct {
				MazeSchemeId int `json:"MazeSchemeId"`
			}
			if json.Unmarshal(s, &meta) == nil && meta.MazeSchemeId == id {
				a.reply(w, r, s)
				return
			}
		}
		http.NotFound(w, r)

	default:
		http.NotFound(w, r)
	}
}

// reply writes JSON, or JSONP when the request names a callback (the scoreboard uses JSONP).
func (a *api) reply(w http.ResponseWriter, r *http.Request, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if cb := r.URL.Query().Get("callback"); cb != "" && jsonpCallback.MatchString(cb) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Write([]byte(cb + "("))
		w.Write(body)
		w.Write([]byte(");"))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(body)
}
