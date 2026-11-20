package main

import (
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// servedFolders are the only top-level folders (and files) the game may load. Everything else in
// the project folder (backups, editor settings, build records) is not served.
var servedFolders = map[string]bool{
	"index.html": true,
	"src":        true,
	"css":        true,
	"fonts":      true,
	"images":     true,
	"3d":         true,
	"sounds":     true,
	"scripts":    true,
	"ieflyout":   true,
	"embed":      true, // embed/hover-embed.js and its demo page (added for embedding)
}

func init() {
	// Types Go's table may not know on every platform.
	for ext, typ := range map[string]string{
		".m4a":  "audio/mp4",
		".ogg":  "audio/ogg",
		".woff": "font/woff",
		".ttf":  "font/ttf",
		".eot":  "application/vnd.ms-fontobject",
		".svg":  "image/svg+xml",
		".json": "application/json",
		".js":   "application/javascript",
		".ico":  "image/x-icon",
	} {
		_ = mime.AddExtensionType(ext, typ)
	}
}

// static serves the game's files. Paths are matched case-insensitively, because the game asks for
// "images/flags.png" and "3d/Textures/HOVER_B_RED.jpg" while the files on disk are "Images/flags.png"
// and "3d/Textures/Hover_B_RED.jpg" (the original Windows/Azure hosting ignored case).
type static struct {
	root string

	mu    sync.Mutex
	index map[string]string // lower-case relative path -> real relative path
}

func newStatic(root string) *static {
	s := &static{root: root}
	s.rebuildIndex()
	return s
}

func (s *static) rebuildIndex() {
	idx := make(map[string]string)
	_ = filepath.WalkDir(s.root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(s.root, p)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		top := strings.ToLower(strings.SplitN(rel, "/", 2)[0])
		if !servedFolders[top] {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			idx[strings.ToLower(rel)] = rel
		}
		return nil
	})
	s.mu.Lock()
	s.index = idx
	s.mu.Unlock()
}

func (s *static) resolve(rel string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	real, ok := s.index[strings.ToLower(rel)]
	return real, ok
}

func (s *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if rel == "" {
		rel = "index.html"
	}
	top := strings.ToLower(strings.SplitN(rel, "/", 2)[0])
	if !servedFolders[top] {
		http.NotFound(w, r)
		return
	}
	real, ok := s.resolve(rel)
	if !ok {
		// A file may have been added since start-up (e.g. a newly downloaded asset).
		s.rebuildIndex()
		if real, ok = s.resolve(rel); !ok {
			http.NotFound(w, r)
			return
		}
	}
	if strings.HasSuffix(real, ".html") || strings.HasPrefix(real, "src/") || strings.HasPrefix(real, "css/") || strings.HasPrefix(real, "embed/") {
		// Readable sources and styles change while someone edits them; make the browser check for
		// a newer copy every time (unchanged files still come from its cache).
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, filepath.Join(s.root, filepath.FromSlash(real)))
}

// releaseFiles serves the release build (dist/, made by tools/build): index.html and three
// fingerprinted files whose names change whenever their content does. Those may be kept by
// browsers (and any cache on the way) for a year without asking again; index.html, which names
// them, is checked on every visit. The script and style sheet are sent gzip-compressed (from
// their .gz copies) to browsers that accept it.
type releaseFiles struct {
	dir string
}

var fingerprintedFile = regexp.MustCompile(`^[a-z]+\.[0-9a-f]{12}\.(js|css|pack)$`)

func (d releaseFiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if name != "index.html" && !fingerprintedFile.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(d.dir, name)
	h := w.Header()
	if name == "index.html" {
		h.Set("Cache-Control", "no-cache")
	} else {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	if ext := path.Ext(name); ext == ".js" || ext == ".css" {
		h.Set("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			if _, err := os.Stat(file + ".gz"); err == nil {
				h.Set("Content-Encoding", "gzip")
				h.Set("Content-Type", mime.TypeByExtension(ext))
				file += ".gz"
			}
		}
	} else if ext == ".pack" {
		h.Set("Content-Type", "application/octet-stream")
	}
	f, err := os.Open(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
}
