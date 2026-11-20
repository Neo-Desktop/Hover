package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestReleaseFilesCaching(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, data []byte) {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", []byte("<!DOCTYPE html>"))
	write("script.0123456789ab.js", []byte("var a=1;"))
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	_, _ = w.Write([]byte("var a=1;"))
	_ = w.Close()
	write("script.0123456789ab.js.gz", gz.Bytes())
	write("assets.0123456789ab.pack", []byte("HOVERPAK"))
	write("notes.txt", []byte("not served"))
	h := releaseFiles{dir: dir}

	get := func(target, encoding string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if encoding != "" {
			req.Header.Set("Accept-Encoding", encoding)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := get("/", ""); rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("index: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	rec := get("/script.0123456789ab.js", "gzip, br")
	if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "gzip" || !bytes.Equal(rec.Body.Bytes(), gz.Bytes()) {
		t.Errorf("script with gzip: %d %q", rec.Code, rec.Header().Get("Content-Encoding"))
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("script cache: %q", cc)
	}
	if rec := get("/script.0123456789ab.js", ""); rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != "var a=1;" {
		t.Errorf("script without gzip: %q %q", rec.Header().Get("Content-Encoding"), rec.Body.String())
	}
	if rec := get("/assets.0123456789ab.pack", ""); rec.Code != 200 || rec.Header().Get("Content-Type") != "application/octet-stream" {
		t.Errorf("pack: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	for _, target := range []string{"/notes.txt", "/script.0123456789ab.js.gz", "/../index.html", "/src/pack.js"} {
		if rec := get(target, ""); rec.Code != 404 && target != "/../index.html" {
			t.Errorf("%s: %d, want 404", target, rec.Code)
		}
	}
}
