// Command server runs Hover! locally: it serves the game's files from this folder and
// stands in for the original Azure backend (hovermp.azurewebsites.net), which hosted
// the SignalR multiplayer hub and the scoreboard / maze APIs.
//
//	go run ./server              (from the project folder)
//	go run ./server -addr :9000  (another port)
//	go run ./server -dist        (the release build in dist/, made by tools/build)
//
// Then open http://localhost:8080/ in a WebGL-capable browser.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	addr := flag.String("addr", ":8080", "address to listen on")
	root := flag.String("root", "", "project folder holding index.html (default: found automatically)")
	matchMinutes := flag.Int("match-minutes", 0, "multiplayer time limit in minutes (0 = play until a team takes every flag)")
	release := flag.Bool("dist", false, "serve the release build in dist/ (made by tools/build) instead of the readable files")
	scoresFile := flag.String("scores", "", "file for the classic-mode high scores (default: server/data/highscores.json in the project folder)")
	flag.Parse()

	dir, err := findRoot(*root)
	if err != nil {
		log.Fatal(err)
	}

	mazes, err := loadMazes(filepath.Join(dir, "scripts", "mazes.js"))
	if err != nil {
		log.Fatalf("reading maze data: %v", err)
	}

	hub := newHoverHub(mazes, time.Duration(*matchMinutes)*time.Minute)
	sr := newSignalR(hub)
	hub.sr = sr

	mux := http.NewServeMux()
	mux.Handle("/signalr/", sr)
	if *scoresFile == "" {
		*scoresFile = filepath.Join(dir, "server", "data", "highscores.json")
	}
	mux.Handle("/api/", newAPI(hub, mazes, newHighScores(*scoresFile, mazes)))
	files := "files from " + dir
	if *release {
		distDir := filepath.Join(dir, "dist")
		if _, err := os.Stat(filepath.Join(distDir, "index.html")); err != nil {
			log.Fatalf("no release build in %s: make one with  cd tools/build && go run .", distDir)
		}
		mux.Handle("/", releaseFiles{dir: distDir})
		files = "release build from " + distDir
	} else {
		mux.Handle("/", newStatic(dir))
	}
	// Shortcut to classic (Windows 95 look) mode: the game opens it from the "#retro" address.
	mux.HandleFunc("/classic", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/#retro", http.StatusFound)
	})
	// Shortcut to creating a classic-mode multiplayer game.
	mux.HandleFunc("/classic-multiplayer", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/#classic-multiplayer", http.StatusFound)
	})

	shown := *addr
	if strings.HasPrefix(shown, ":") {
		shown = "localhost" + shown
	}
	log.Printf("Hover! is running at http://%s/  (%s)", shown, files)
	srv := &http.Server{Addr: *addr, Handler: logRequests(mux), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

// findRoot returns the folder holding index.html: the -root flag, the working directory,
// or the folder above this program.
func findRoot(flagValue string) (string, error) {
	candidates := []string{flagValue}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd, filepath.Dir(wd))
	}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		candidates = append(candidates, d, filepath.Dir(d), filepath.Dir(filepath.Dir(d)))
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			return filepath.Abs(c)
		}
	}
	return "", os.ErrNotExist
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		if rec.status >= 400 {
			log.Printf("%d %s %s", rec.status, r.Method, r.URL.Path)
		}
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController and websocket hijacking reach the real writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
