// Command build makes the release version of Hover! in dist/: the four files a browser loads.
//
//	index.html                 the page; it names the other three
//	script.<fingerprint>.js    every script index.html lists, in its order, combined and shrunk
//	style.<fingerprint>.css    both style sheets, combined and shrunk, with the fonts and the
//	                           main menu's pictures inside (so the menu shows without waiting)
//	assets.<fingerprint>.pack  every other picture, 3D model and sound the game loads, in one
//	                           file (src/pack.js reads it)
//
// A fingerprint is the start of the file's SHA-256, so a changed file gets a new name: browsers
// may keep the fingerprinted files for a year, and only index.html is checked each visit (the
// server sends them that way when started with -dist). The script and style sheet also get a
// .gz copy the server sends to browsers that accept it. The files of the build before stay in
// dist/ beside the new ones, for pages opened before the update; older ones are removed.
//
//	cd tools/build && go run .                     writes <project>/dist
//	go run . -root <project folder> -out <folder>
//
// Shrinking uses esbuild's Go library (github.com/evanw/esbuild), downloaded by Go on first use.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// packFolders hold the files the game loads while it runs; packTypes are the kinds packed (the
// sounds' .ogg copies, the original .WAV and .mid files are left out: browsers that play Hover!
// play .m4a, the format the game picks whenever it can).
var (
	packFolders = []string{"Images", "3d", "sounds"}
	packTypes   = map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".ico":  "image/x-icon",
		".svg":  "image/svg+xml",
		".json": "application/json",
		".m4a":  "audio/mp4",
	}
	fontTypes = map[string]string{
		".woff2": "font/woff2",
		".woff":  "font/woff",
	}
)

// Style-sheet pictures up to inlineLimit bytes go inside the style sheet, and so do the main
// menu's (menuPictures, by the start of their file name); the larger rest come from the pack.
const inlineLimit = 64 * 1024

var menuPictures = []string{
	"images/ui/homebg.", "images/ui/lightclouds.", "images/ui/streaks.", "images/ui/hoverlogo.",
	"images/ui/sprite.", "images/ui/retro.",
}

func main() {
	rootFlag := flag.String("root", "", "project folder holding index.html (default: found from here)")
	outFlag := flag.String("out", "", "folder to write the release build to (default: <project>/dist)")
	flag.Parse()
	log.SetFlags(0)

	root, err := findRoot(*rootFlag)
	if err != nil {
		log.Fatal(err)
	}
	out := *outFlag
	if out == "" {
		out = filepath.Join(root, "dist")
	}
	if err := build(root, out); err != nil {
		log.Fatal("build: ", err)
	}
}

func findRoot(flagValue string) (string, error) {
	if flagValue != "" {
		return filepath.Abs(flagValue)
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if exists(filepath.Join(dir, "index.html")) && exists(filepath.Join(dir, "src", "pack.js")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("can't find the project folder (index.html and src/pack.js); give it with -root")
		}
		dir = parent
	}
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

var (
	scriptTag = regexp.MustCompile(`(?m)^[ \t]*<script src="([^"]+)"></script>[ \t]*\r?\n`)
	styleTag  = regexp.MustCompile(`(?m)^[ \t]*<link href="([^"]+)" rel="stylesheet"[^>]*>[ \t]*\r?\n`)
)

func build(root, out string) error {
	pageBytes, err := os.ReadFile(filepath.Join(root, "index.html"))
	if err != nil {
		return err
	}
	page := string(pageBytes)
	var scripts, sheets []string
	for _, m := range scriptTag.FindAllStringSubmatch(page, -1) {
		if !strings.Contains(m[1], "//") {
			scripts = append(scripts, m[1])
		}
	}
	for _, m := range styleTag.FindAllStringSubmatch(page, -1) {
		sheets = append(sheets, m[1])
	}
	if len(scripts) == 0 || len(sheets) == 0 {
		return errors.New("index.html lists no scripts or style sheets")
	}

	pack, packed, err := buildPack(root)
	if err != nil {
		return err
	}
	style, deferred, err := buildCSS(root, sheets, packed)
	if err != nil {
		return err
	}
	script, err := buildJS(root, scripts)
	if err != nil {
		return err
	}
	inline, err := loaderImages(root)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	previous := referencedBuildFiles(filepath.Join(out, "index.html"))

	packName := fingerprinted("assets", ".pack", pack)
	styleName := fingerprinted("style", ".css", style)
	scriptName := fingerprinted("script", ".js", script)
	config, err := json.Marshal(map[string]any{
		"url":    packName,
		"size":   len(pack),
		"inline": inline,
		"css":    deferred,
	})
	if err != nil {
		return err
	}
	html, err := buildHTML(root, page, scriptName, styleName, string(config))
	if err != nil {
		return err
	}

	for _, f := range []struct {
		name string
		data []byte
		gz   bool
	}{{packName, pack, false}, {styleName, style, true}, {scriptName, script, true}} {
		if err := writeFile(filepath.Join(out, f.name), f.data); err != nil {
			return err
		}
		if f.gz {
			if err := writeFile(filepath.Join(out, f.name+".gz"), gzipped(f.data)); err != nil {
				return err
			}
		}
	}
	if err := writeFile(filepath.Join(out, "index.html"), []byte(html)); err != nil {
		return err
	}
	keep := map[string]bool{packName: true, styleName: true, scriptName: true}
	for name := range previous {
		keep[name] = true
	}
	removeOldBuilds(out, keep)

	fmt.Printf("Hover! release build in %s\n", out)
	fmt.Printf("  index.html  %8s\n", size(len(html)))
	fmt.Printf("  %s  %8s  (%s compressed; %d scripts)\n", scriptName, size(len(script)), size(len(gzipped(script))), len(scripts))
	fmt.Printf("  %s  %8s  (%s compressed; %d style sheets)\n", styleName, size(len(style)), size(len(gzipped(style))), len(sheets))
	fmt.Printf("  %s  %8s  (%d files)\n", packName, size(len(pack)), len(packed))
	return nil
}

func size(n int) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

func fingerprinted(base, ext string, data []byte) string {
	sum := sha256.Sum256(data)
	return base + "." + hex.EncodeToString(sum[:])[:12] + ext
}

var buildFile = regexp.MustCompile(`^(script|style|assets)\.[0-9a-f]{12}\.(js|css|pack)(\.gz)?$`)

// referencedBuildFiles lists the fingerprinted files an index.html names.
func referencedBuildFiles(indexPath string) map[string]bool {
	names := map[string]bool{}
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return names
	}
	for _, m := range regexp.MustCompile(`(?:script|style|assets)\.[0-9a-f]{12}\.(?:js|css|pack)`).FindAllString(string(data), -1) {
		names[m] = true
	}
	return names
}

func removeOldBuilds(out string, keep map[string]bool) {
	entries, err := os.ReadDir(out)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !buildFile.MatchString(name) || keep[strings.TrimSuffix(name, ".gz")] {
			continue
		}
		if err := os.Remove(filepath.Join(out, name)); err == nil {
			fmt.Printf("  removed the older %s\n", name)
		}
	}
}

func writeFile(p string, data []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func gzipped(data []byte) []byte {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	_, _ = w.Write(data)
	_ = w.Close()
	return buf.Bytes()
}

// --- Asset pack ---------------------------------------------------------------------------------

type packEntry struct {
	key  string // lower-case path, as the game's addresses are matched (src/pack.js)
	file string
	typ  string
}

// packOrder puts what is needed first near the start: the interface, sounds, 3D models, then
// the mazes' textures.
func packOrder(key string) int {
	for i, prefix := range []string{"images/ui/", "sounds/", "3d/", "images/"} {
		if strings.HasPrefix(key, prefix) {
			return i
		}
	}
	return 4
}

// buildPack returns the pack and its files by lower-case path.
func buildPack(root string) ([]byte, map[string]packEntry, error) {
	var entries []packEntry
	byKey := map[string]packEntry{}
	for _, folder := range packFolders {
		err := filepath.WalkDir(filepath.Join(root, folder), func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if strings.HasPrefix(d.Name(), ".") {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			typ, ok := packTypes[strings.ToLower(filepath.Ext(p))]
			if d.IsDir() || !ok {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			key := strings.ToLower(filepath.ToSlash(rel))
			if other, dup := byKey[key]; dup {
				return fmt.Errorf("%s and %s differ only in case", other.file, p)
			}
			e := packEntry{key: key, file: p, typ: typ}
			byKey[key] = e
			entries = append(entries, e)
			return nil
		})
		if err != nil {
			return nil, nil, err
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := packOrder(entries[i].key), packOrder(entries[j].key)
		if a != b {
			return a < b
		}
		return entries[i].key < entries[j].key
	})

	var data bytes.Buffer
	list := make([][]any, 0, len(entries))
	for _, e := range entries {
		b, err := os.ReadFile(e.file)
		if err != nil {
			return nil, nil, err
		}
		list = append(list, []any{e.key, data.Len(), len(b), e.typ})
		data.Write(b)
	}
	index, err := json.Marshal(list)
	if err != nil {
		return nil, nil, err
	}
	var pack bytes.Buffer
	pack.WriteString("HOVERPAK")
	_ = binary.Write(&pack, binary.LittleEndian, uint32(len(index)))
	pack.Write(index)
	pack.Write(data.Bytes())
	return pack.Bytes(), byKey, nil
}

// --- Style sheet --------------------------------------------------------------------------------

var (
	fontFace = regexp.MustCompile(`@font-face\s*\{[^}]*\}`)
	srcDecl  = regexp.MustCompile(`src\s*:[^;}]*;?`)
	cssURL   = regexp.MustCompile(`url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)`)
)

func urlValue(m []string) string {
	return m[1] + m[2] + m[3]
}

func isExternal(u string) bool {
	return strings.HasPrefix(u, "data:") || strings.Contains(u, "//") || u == ""
}

// fileOnDisk finds a project file by path, matching case like the server does.
func fileOnDisk(root, rel string) (string, error) {
	p := filepath.Join(root, filepath.FromSlash(rel))
	if exists(p) {
		return p, nil
	}
	dir := root
	for _, part := range strings.Split(rel, "/") {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return "", err
		}
		found := ""
		for _, e := range entries {
			if strings.EqualFold(e.Name(), part) {
				found = e.Name()
				break
			}
		}
		if found == "" {
			return "", fmt.Errorf("%s: no such file", rel)
		}
		dir = filepath.Join(dir, found)
	}
	return dir, nil
}

func dataURI(typ string, data []byte) string {
	return "data:" + typ + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// buildCSS combines the style sheets. Fonts (their .woff2 or .woff) and the main menu's and small
// pictures go inside it; other pictures become var(--hpN), which src/pack.js sets to the packed
// file (the returned map) once the pack has arrived. Each picture is written once, in a custom
// property on :root, however many rules use it.
func buildCSS(root string, sheets []string, packed map[string]packEntry) ([]byte, map[string]string, error) {
	var body strings.Builder
	var props strings.Builder
	propOf := map[string]string{}
	deferred := map[string]string{}
	var failure error
	fail := func(err error) {
		if failure == nil {
			failure = err
		}
	}

	for _, sheet := range sheets {
		text, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(sheet)))
		if err != nil {
			return nil, nil, err
		}
		dir := path.Dir(sheet)
		resolve := func(u string) string {
			if i := strings.IndexAny(u, "?#"); i >= 0 {
				u = u[:i]
			}
			return path.Clean(path.Join(dir, u))
		}

		css := fontFace.ReplaceAllStringFunc(string(text), func(block string) string {
			best, bestType := "", ""
			for _, m := range cssURL.FindAllStringSubmatch(block, -1) {
				u := urlValue(m)
				if isExternal(u) {
					continue
				}
				rel := resolve(u)
				typ, ok := fontTypes[strings.ToLower(path.Ext(rel))]
				if ok && (best == "" || typ == "font/woff2") {
					best, bestType = rel, typ
				}
			}
			if best == "" {
				fail(fmt.Errorf("%s: a font without a .woff or .woff2 file", sheet))
				return block
			}
			file, err := fileOnDisk(root, best)
			if err != nil {
				fail(err)
				return block
			}
			data, err := os.ReadFile(file)
			if err != nil {
				fail(err)
				return block
			}
			format := strings.TrimPrefix(bestType, "font/")
			block = srcDecl.ReplaceAllString(block, "")
			open := strings.Index(block, "{") + 1
			return block[:open] + `src:url("` + dataURI(bestType, data) + `") format("` + format + `");` + block[open:]
		})

		css = cssURL.ReplaceAllStringFunc(css, func(match string) string {
			u := urlValue(cssURL.FindStringSubmatch(match))
			if isExternal(u) {
				return match
			}
			rel := resolve(u)
			key := strings.ToLower(rel)
			if prop, ok := propOf[key]; ok {
				return "var(" + prop + ")"
			}
			file, err := fileOnDisk(root, rel)
			if err != nil {
				fail(fmt.Errorf("%s: %v", sheet, err))
				return match
			}
			info, err := os.Stat(file)
			if err != nil {
				fail(err)
				return match
			}
			menu := false
			for _, prefix := range menuPictures {
				menu = menu || strings.HasPrefix(key, prefix)
			}
			if info.Size() <= inlineLimit || menu {
				typ, ok := packTypes[strings.ToLower(path.Ext(rel))]
				if !ok {
					fail(fmt.Errorf("%s: %s is not a picture type the build knows", sheet, rel))
					return match
				}
				data, err := os.ReadFile(file)
				if err != nil {
					fail(err)
					return match
				}
				prop := fmt.Sprintf("--hi%d", len(propOf)+1)
				propOf[key] = prop
				fmt.Fprintf(&props, "%s:url(\"%s\");", prop, dataURI(typ, data))
				return "var(" + prop + ")"
			}
			if _, ok := packed[key]; !ok {
				fail(fmt.Errorf("%s: %s is not in the asset pack", sheet, rel))
				return match
			}
			prop := fmt.Sprintf("--hp%d", len(deferred)+1)
			propOf[key] = prop
			deferred[prop] = key
			return "var(" + prop + ")"
		})
		body.WriteString(css)
		body.WriteString("\n")
	}
	if failure != nil {
		return nil, nil, failure
	}

	result := api.Transform(":root{"+props.String()+"}\n"+body.String(), api.TransformOptions{
		Loader:           api.LoaderCSS,
		MinifyWhitespace: true,
		MinifySyntax:     true,
		Sourcefile:       "style.css",
		LogLevel:         api.LogLevelSilent,
		LegalComments:    api.LegalCommentsNone,
		Charset:          api.CharsetUTF8,
	})
	if err := messages("style sheets", result.Errors, result.Warnings); err != nil {
		return nil, nil, err
	}
	return result.Code, deferred, nil
}

// --- Script -------------------------------------------------------------------------------------

// buildJS shrinks each script on its own and joins them in order. They are classic scripts that
// share global names, so esbuild keeps every top-level name and only shortens local ones.
func buildJS(root string, scripts []string) ([]byte, error) {
	var out bytes.Buffer
	for _, s := range scripts {
		code, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(s)))
		if err != nil {
			return nil, err
		}
		result := api.Transform(string(code), api.TransformOptions{
			Loader:            api.LoaderJS,
			MinifyWhitespace:  true,
			MinifyIdentifiers: true,
			MinifySyntax:      true,
			Target:            api.ES2017,
			Sourcefile:        s,
			LogLevel:          api.LogLevelSilent,
			LegalComments:     api.LegalCommentsInline,
			Charset:           api.CharsetUTF8,
		})
		if err := messages(s, result.Errors, nil); err != nil {
			return nil, err
		}
		out.Write(bytes.TrimRight(result.Code, "\n"))
		out.WriteString("\n")
	}
	return out.Bytes(), nil
}

func messages(what string, errs, warnings []api.Message) error {
	for _, w := range warnings {
		log.Printf("%s: warning: %s", what, describe(w))
	}
	if len(errs) == 0 {
		return nil
	}
	var lines []string
	for _, e := range errs {
		lines = append(lines, describe(e))
	}
	return fmt.Errorf("%s:\n  %s", what, strings.Join(lines, "\n  "))
}

func describe(m api.Message) string {
	if m.Location == nil {
		return m.Text
	}
	return fmt.Sprintf("%s:%d:%d: %s", m.Location.File, m.Location.Line, m.Location.Column, m.Text)
}

// loaderImages reads Hover.loaderImages (src/assets.js), the pictures the loading screen and the
// title screen's star field use before the pack arrives, as data: addresses.
func loaderImages(root string) (map[string]string, error) {
	text, err := os.ReadFile(filepath.Join(root, "src", "assets.js"))
	if err != nil {
		return nil, err
	}
	block := regexp.MustCompile(`Hover\.loaderImages\s*=\s*\{([^}]*)\}`).FindSubmatch(text)
	if block == nil {
		return nil, errors.New("src/assets.js: Hover.loaderImages not found")
	}
	inline := map[string]string{}
	for _, m := range regexp.MustCompile(`"([^"]+/[^"]+)"`).FindAllSubmatch(block[1], -1) {
		rel := strings.TrimPrefix(string(m[1]), "/")
		typ, ok := packTypes[strings.ToLower(path.Ext(rel))]
		if !ok {
			return nil, fmt.Errorf("src/assets.js: %s is not a picture type the build knows", rel)
		}
		file, err := fileOnDisk(root, rel)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		inline[strings.ToLower(rel)] = dataURI(typ, data)
	}
	return inline, nil
}

// --- Page ---------------------------------------------------------------------------------------

var (
	comment    = regexp.MustCompile(`<!--[\s\S]*?-->`)
	iconLink   = regexp.MustCompile(`href="([^"]+\.ico)"`)
	imageMeta  = regexp.MustCompile(`(?m)^[ \t]*<meta [^>]*content="[^"]*\.(?:png|jpe?g)"[^>]*>[ \t]*\r?\n`)
	blankLines = regexp.MustCompile(`\n{2,}`)
)

func buildHTML(root, page, scriptName, styleName, config string) (string, error) {
	// The site icon goes inside the page; the share and tile pictures (which need a full web
	// address to work anyway) are left out.
	var failure error
	page = iconLink.ReplaceAllStringFunc(page, func(m string) string {
		rel := iconLink.FindStringSubmatch(m)[1]
		file, err := fileOnDisk(root, rel)
		if err != nil {
			failure = err
			return m
		}
		data, err := os.ReadFile(file)
		if err != nil {
			failure = err
			return m
		}
		return `href="` + dataURI("image/x-icon", data) + `"`
	})
	if failure != nil {
		return "", failure
	}
	page = imageMeta.ReplaceAllString(page, "")

	first := true
	page = styleTag.ReplaceAllStringFunc(page, func(string) string {
		if !first {
			return ""
		}
		first = false
		return `<link href="` + styleName + `" rel="stylesheet">` + "\n"
	})
	first = true
	page = scriptTag.ReplaceAllStringFunc(page, func(m string) string {
		if strings.Contains(scriptTag.FindStringSubmatch(m)[1], "//") {
			return m
		}
		if !first {
			return ""
		}
		first = false
		return "<script>window.HOVER_PACK=" + config + ";</script>\n<script src=\"" + scriptName + "\"></script>\n"
	})

	page = comment.ReplaceAllString(page, "")
	lines := strings.Split(strings.ReplaceAll(page, "\r\n", "\n"), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	page = blankLines.ReplaceAllString(strings.Join(lines, "\n"), "\n")
	return strings.TrimSpace(page) + "\n", nil
}
