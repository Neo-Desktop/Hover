package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// The maze and scheme data ship in scripts/mazes.js as JavaScript assignments:
//
//	Hover.json.mazes["44"] = { ...JSON... };
//	Hover.json.schemes["Maze1"] = { ...JSON... };
//
// The server reads the same file so multiplayer uses the same spawn points, flags and pods as the
// game, and so the old maze/scheme APIs can be answered.

type netVector struct {
	X float64 `json:"X"`
	Y float64 `json:"Y"`
	Z float64 `json:"Z"`
}

type teamPoint struct {
	Team string  `json:"Team"`
	X    float64 `json:"X"`
	Y    float64 `json:"Y"`
	Z    float64 `json:"Z"`
}

type maze struct {
	MazeID int         `json:"MazeId"`
	Name   string      `json:"Name"`
	Scheme string      `json:"Scheme"`
	Spawns []teamPoint `json:"Spawns"`
	Flags  []teamPoint `json:"Flags"`
	Pods   []netVector `json:"Pods"`

	raw json.RawMessage // the full maze, served by the maze API
}

type mazeData struct {
	mazes   map[int]*maze
	order   []int
	schemes map[string]json.RawMessage // by lower-case scheme name
}

var assignment = regexp.MustCompile(`(?m)^Hover\.json\.(mazes|schemes)\["([^"]+)"\]\s*=\s*`)

func loadMazes(path string) (*mazeData, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	text := string(src)
	d := &mazeData{mazes: map[int]*maze{}, schemes: map[string]json.RawMessage{}}
	locs := assignment.FindAllStringSubmatchIndex(text, -1)
	for i, loc := range locs {
		kind, key := text[loc[2]:loc[3]], text[loc[4]:loc[5]]
		end := len(text)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		body := strings.TrimSpace(text[loc[1]:end])
		body = strings.TrimSuffix(body, ";")
		if !json.Valid([]byte(body)) {
			return nil, fmt.Errorf("%s[%q] is not valid JSON", kind, key)
		}
		switch kind {
		case "mazes":
			var m maze
			if err := json.Unmarshal([]byte(body), &m); err != nil {
				return nil, fmt.Errorf("maze %s: %w", key, err)
			}
			if m.MazeID == 0 {
				m.MazeID, _ = strconv.Atoi(key)
			}
			m.raw = json.RawMessage(body)
			d.mazes[m.MazeID] = &m
			d.order = append(d.order, m.MazeID)
		case "schemes":
			d.schemes[strings.ToLower(key)] = json.RawMessage(body)
		}
	}
	if len(d.mazes) == 0 {
		return nil, fmt.Errorf("no mazes found in %s", path)
	}
	return d, nil
}
