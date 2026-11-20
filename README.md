# Hover! — readable source edition

Hover! (hover.ie, 2013) was Microsoft's and Dan Church's WebGL remake of the Windows 95
capture-the-flag game. This folder holds a readable rebuild of the last version of the site
(July 2017 build), every asset the Wayback Machine kept, and a small Go server that replaces the
original Azure backend (multiplayer hub, scoreboard and maze APIs).

## Running it

With Go 1.22 or later installed, from this folder (no internet needed: the server's dependencies
are in `server/vendor/`):

```sh
cd server && go run . -root ..
# or build the server program once and run it from this folder:
cd server && go build -o bin/hover-server . && cd .. && ./server/bin/hover-server
```

Ready-built server programs for Windows, macOS and Linux, with the release build, come from the
GitHub build (see "Continuous integration" below).

Then open <http://localhost:8080/>. Options: `-addr :9000` (another port), `-match-minutes 10`
(give multiplayer games a time limit; the default is to play until a team takes every flag).

Classic mode (the Windows 95 look): open <http://localhost:8080/classic> (or
<http://localhost:8080/#retro>), or do what the original asked and type `bambi` on the title
screen. Classic mode drives with the 1995 game's own handling (Beginner settings read from the
original HOVER.EXE: grip that pulls a sliding craft back in line with its nose, slower turning,
and the original speed-pod strengths) and plays the 1995 music. The 1995 game's other difficulty
levels drive faster: <http://localhost:8080/#retro/intermediate> (3x the acceleration, top speed 65)
and <http://localhost:8080/#retro/expert> (5x, top speed 75, very little grip).

The game remembers your last choices in the browser's local storage: classic mode opens with the
difficulty you last picked (from Customize Game or an address like `#retro/expert`;
`#retro/beginner` goes back to Beginner), and the modern look's craft chooser starts on the craft
you picked last.

The classic window has the 1995 game's menu bar and dialogs (read from the original HOVER.EXE):
Game (Start Game F2, Start At... to pick a level, Pause F3, Exit), Options (Sound Options with
separate Music / Game Sounds / Engine switches, Player Controls F8, Customize Game F9 with Vehicle
Controls Easy / Intermediate / Difficult and Maze Type Sequential / Random, Full Screen F4) and Help
(Quick Help, About) (`src/game/22-classic-menu.js`, `css/classic-menu.css`). 1995 settings this
edition can't use (Speed & Detail, map rotation, the Start At points) are greyed out. Customize
Game > Show Rear View (on by default) shows the 1995 rear-view mirror in place of the "HOVER 950"
plate. Start At and Customize Game are laid out control by control from the 1995 dialog resources,
with Windows 95 option buttons, check boxes and slider. Springs, walls and cloaks you haven't used
go with you to the next level, and in classic single player nothing moves until the level-start
sound has finished (the 1995 game's two-second countdown). The hold and flag pads follow the 1995
rules in classic mode: a hold pad cuts your engine for 4.5 seconds (you slide to a stop and can still
turn) and can't catch you again until you have left it, a flag pad gives a flag back once each time
you drive onto it, both need the whole craft on the pad, and the shield ignores them. In
classic mode you can drive through flags you can't take, and a slow-down or map-eraser pod taken
while the shield is on makes no sound (it has no effect then).
Dialogs and message boxes can be dragged by their title bars; settings are kept in the browser.
Everything is drawn in the Windows 95 menu font (`fonts/ms-sans-serif/`, a pixel recreation of MS
Sans Serif under the MIT licence from 98.css).

Like the 1995 game, classic mode opens on its start-up room (the "main menu level": a small room
with neon walls, a checkered floor and the team's photos, converted from the original
`MAZES\SMALL.MAZ` / `SMALL.TEX` into `scripts/small-maze.js` and `Images/Schemes/SMALL/Retro/`).
It stays still behind the menus; Game > Start Game (F2) starts level 1. Typing the 1995 game's
hidden code `ibmab` there (Ctrl+I Ctrl+B Ctrl+M Ctrl+A Ctrl+B as in 1995, or just the letters) lets
you drive around the room, with its song (`src/game/23-main-menu-level.js`).

Classic mode keeps score as the 1995 game did (its rules read from HOVER.EXE): the top-right box of
the dashboard counts in the original's green LED digits; each robot flag you take, each of your own
flags still standing when you win a level ("Bonus Score"), and a level bonus for a game begun with
Start At are worth more each level and on harder settings, and Start At shows what the chosen level
is worth. A new game, Start At, a defeat or Exit ends the score, and a score in the top 15 asks for
your name for High Scores.

High scores are kept by the server (`server/highscores.go`, saved to
`server/data/highscores.json`; `-scores <file>` puts them elsewhere). The browser never sends a
score: the server decides where each level's flags go, is told each flag taken and each level won,
checks every report (only its own robot flags, in order, no faster than a craft at full speed could
drive between them, a win only with every flag taken, a few new games per address an hour, one
entry per game) and works out the score itself. Each browser gets a player id from the server the
first time (a random UUID signed with the server's key, `server/data/player-key`, so ids can't be
made up); the browser keeps it, with the name last typed for the high scores, in local storage
(`hoverClassicPlayer`). New games need a valid id and are limited per id as well as per address,
high-score rows are recorded against it (never shown to others), your own rows show in bold, and
the name box fills in your last name.

Both the server's table and the one kept in the browser start with the 1995 game's default high
scores: Greg, John, Josh, Steve, Larry, Jo, Jon, Patrick, Julie, Tony, Charles, Joy, Jennifer,
Harley and Kevin, with 24,570 down to 1,638 shuffled among them as the original does. Each is saved
as soon as it is made, so the order stays put, and the server's worldwide positions count those
15 scores.

The server also keeps a longer named board (the best 100 games: any score good enough for it asks
for a name) and a record of every finished, checked game (`server/data/results.json`). The High
Scores box has two tabs: **Top 15**, the 1995 page, and **More Scores**, a scrolling list of the
board beyond the first 15. Under both tabs it shows your last and best scores, each with its
worldwide position among all recorded games ("12,345 (#37 of 512)"). A third tab, **Your
Scores**, lists this browser's own finished games, newest first: the date, the level reached, the
vehicle controls and the score (your best in bold). The last 100 games are kept in local storage.
A new player's name starts as "Player #<number>", e.g. "Player #12" for the twelfth player the
server has seen (it counts the player ids it hands out), until they type their own. Your last and best scores are
also kept in the browser, so they show without the server too. Editing or replaying requests is refused; faking a
score would mean playing out a believable game in real time. Without the server (the files hosted
elsewhere) the scores are kept in the browser instead.

Maze 3's big central hall has its 1995 stone ceiling again (from `MAZES\MAZE3.MAZ`: a CBASE_00
roof at height 768 over the whole cross-shaped hall). The 2013 data had put that ceiling on top of
one pillar instead, so the rock "sky" showed above the hall. The 1995 game tiles the 256-pixel rock
background 15 times around the horizon, as this edition does, but with every room roofed it is
hardly ever seen.

Classic-mode robots behave as in 1995 (`src/game/24-classic-robots.js`, from HOVER.EXE's robot
code). Each robot has its own craft; the remake gave all robots of one kind a single shared craft.
They drive with the 1995 robot handling (top speed 40, 50 or 60 a tick by difficulty, a little slower
than you) and think 20 times a second:
- **Attackers** see you within 5,000 / 7,000 / 10,000 units on the same floor unless you're cloaked,
  and chase you at full speed.
- **Flag hunters** go for one of your flags they can see within 5,000.
- **Otherwise** they head for the nearest free beacon they can see, then plan 3 or 4 beacons ahead
  toward a place their goal can be seen from, or wander. A beacon is claimed by one robot at a
  time, so they spread out.
- **Bumps:** after any wall hit or after ramming a craft, a robot reverses for 3 seconds, stops
  and thinks again, so it can't pin you. Crafts bump by the 1995 rule: the approaching speed passes
  between them, and they are pushed apart only when deep in each other, never into a wall.
- **Walls and edges:** walls push crafts away from the wall itself, a craft touching a wall can only
  move away from it, and nothing can be pushed off the edge of the maze.
- **Flags and pods:** both kinds take your flags; robots never take pods.

The modern look's drones follow the same rules and bump the same way, each with its own craft.
They keep the modern models and handling and the modern numbers per level; how far an attacker sees
and how far ahead drones plan follow the craft you choose (Easy, Normal, Hard).

In the debug view (`/?retro=1&mazeId=44&level=10#debug`, or without `retro=1` for the modern look),
the stats line shows what each robot is doing.

Classic mode plays on like the 1995 game: each won level shows the 1995 "Good Job! Starting level
N!" box and moves to the next maze (back to Maze 1 after Maze 3; or a random one with Maze Type
Random) with more robots; a lost level asks "Would you like to play again?". Each classic level is
set up with the 1995 game's own level table and rules (read from HOVER.EXE): from level 1 an
attacking robot and a flag-hunting robot (up to 6 and 4 by level 16), 3 to 6 flags per team, every
robot, pod and flag at a random free spot at least 80 units from anything else, and 28 pods (4 of
each kind, a quarter disguised as "?") instead of one on every pod spot
(`SinglePlayerGame.spawnClassicLevel` in `src/game/11-game.js`). Each maze plays its own 1995 song
(Maze 1: MUSIC1, Maze 2: MUSIC2, Maze 3: MUSIC3), and while a level loads the classic window stays
on screen with "Loading Level N...".

On the home screen, **Single Player** and **Multiplayer** first ask which Hover! to play: the
orange **Modern** button goes on to the 2013 remake's screens (choose a craft, or create a
multiplayer game), and the Windows 95-style **Classic (Windows 95)** button to classic mode
(single player opens on the 1995 start-up room; multiplayer on the create screen, making a
classic-look game). **Back** returns to the two buttons.

Classic mode greets you with the 1995 Quick Help box ("To start a game, click Start Game from the
Game menu, or press F2...") once a visit, laid out as the original dialog; its **Skip Quick Help at
Startup** box stops it, and is kept in the browser's local storage (Help > Quick Help still shows
it). Under it, in the middle of the play field, is the 1995 game's "Press F2 to start a game of
Hover!" box, which goes away when a game starts (or when `ibmab` lets you drive the room).

This edition drops the home screen's "a collaboration with Internet Explorer" badge, and its page
footer links to the source at <https://github.com/Neo-Desktop/hover> (shown as the GitHub mark and
"Neo-Desktop/hover"; the mark is GitHub's Octicons "mark-github", MIT licence) instead of the 2013
site's Microsoft copyright, privacy and terms links.

Classic multiplayer: choose Multiplayer > Classic (Windows 95) on the home screen, or open
<http://localhost:8080/classic-multiplayer>. Everyone who joins through the game's link plays in
the classic look with the 1995 Beginner handling; the other players appear as the 1995 drones.

The game window scales to fill your browser window (`src/game/21-fit-to-screen.js`, added in this
edition; the original stayed at a fixed size on large screens).

Multiplayer: choose Multiplayer, create a game, and open the link it shows in other browser
windows or on other computers on your network (use this computer's address instead of
`localhost`).

## Release build

For putting the game online, `tools/build` turns the readable files into four, in `dist/`:

| File | What |
|---|---|
| `index.html` | The page. |
| `script.<fingerprint>.js` | Every script `index.html` lists, in its order, combined and shrunk (1.2 MB; 280 KB as sent). |
| `style.<fingerprint>.css` | Both style sheets, combined and shrunk, with the fonts and the title screen's pictures inside, so the title screen shows at once. |
| `assets.<fingerprint>.pack` | Every other picture, 3D model and sound the game loads (about 67 MB). It downloads while the title screen is up; any other screen opened before it has arrived shows the loading screen with its progress. |

```sh
cd tools/build && go run .      # writes dist/ (Go downloads esbuild, the shrinking library, the first time)
cd server && go run . -root .. -dist      # or: ./server/bin/hover-server -dist
```

The fingerprint is the start of each file's SHA-256, so a changed file gets a new name. The server
(`-dist`) tells browsers to keep the fingerprinted files for a year without asking again
(`Cache-Control: public, max-age=31536000, immutable`) and to check `index.html`, which names them,
on every visit (`no-cache`); the script and style sheet go out gzip-compressed. The previous
build's files stay in `dist/` for pages opened before an update; older ones are removed. Another
web server can host `dist/` the same way (the multiplayer and high-score features still need this
server's `/signalr/` and `/api/`).

How the pack works: `src/pack.js` (first in `index.html`, and doing nothing without the build)
downloads it and gives the game's ordinary file addresses (`Images/...`, `/3d/...`,
`sounds/...`) in-memory copies from it, so the game's code is unchanged. The pack carries the
sounds' `.m4a` files only (the game plays `.m4a` in every browser that supports it; `.ogg` was for
the others), not the original `.WAV` and `.mid` files. The share-picture and tile tags in the page
head are left out (they need a full web address to work).

## Continuous integration

`.github/workflows/build.yml` runs on GitHub for every push and pull request (and can be started
by hand from the Actions tab):

1. checks and tests the server (`go vet`, `go test`);
2. builds the server program for Windows, macOS (Intel and Apple silicon) and Linux (x64 and ARM);
3. makes the release build (`tools/build`) and checks it: the four files, their fingerprinted
   names, and that the server starts with them and sends them with the caching above;
4. uploads `hover-release`: a folder ready to run anywhere, with the release build in `dist/`, the
   server programs, `index.html` and `scripts/mazes.js` (the server reads the mazes from it).
   Run the program for your system from inside it with `-dist`.

Pushing a tag such as `v1.0.0` also attaches that folder, zipped, to a GitHub release.

## Putting the game on another website

Host the game (this folder with its server, or any web server for single player) and add to the
other site:

```html
<script src="https://your-hover-host/embed/hover-embed.js" async></script>
<div data-hover-game data-mode="classic" data-difficulty="expert"></div>
```

`data-mode` is `classic`, `modern`, `multiplayer` or `classic-multiplayer`; `data-difficulty`
(classic only) is `beginner`, `intermediate` or `expert`; `data-width` sets the width (the height
follows the game's shape). From script: `HoverGame.embed(element, { mode: "classic" })`. The game
runs in a frame from its own host, so it can't clash with the other site. See
<http://localhost:8080/embed/demo.html>. The game expects to be at the root of its host
(it loads files like `/3d/...`), so give it its own domain or subdomain.

## What's where

| Path | What |
|---|---|
| `index.html` | The page. Loads the readable libraries, the maze data, the asset list and the game. |
| `src/game/` | The game, de-minified into named files (`00-namespace.js` … `20-app.js`, loaded in that order). Each file says which lines of the original it came from. |
| `src/templates/` | The game's HTML templates as editable HTML (the running copies are in `src/game/16-templates.js`). |
| `src/vendor/` | Readable copies of the third-party libraries (jQuery, underscore, Backbone, SignalR client, Modernizr, three.js r61, …); see `src/vendor/README.md`. |
| `src/assets.js` | Readable list of the sounds and images the game loads (replaces the original's `scripts/cdn-files.js`). |
| `scripts/mazes.js` | The three mazes and their texture schemes (data, already readable). |
| `server/` | The Go server (its own Go module: `go.mod`, `go.sum`, `vendor/`, ready-built programs in `bin/`): `main.go` (start-up), `static.go` (file serving), `signalr.go` (SignalR 2 protocol), `hub.go` (multiplayer games), `api.go` (scoreboard and maze APIs), `mazes.go` (reads `scripts/mazes.js`). |
| `src/pack.js` | Loads the release build's asset pack (see "Release build"); does nothing otherwise. |
| `tools/build/` | Makes the release build in `dist/` (its own Go module). `tools/render-music.sh` records the classic music sets. |
| `css/`, `fonts/`, `Images/`, `3d/`, `sounds/` | Assets. (`ieflyout/` holds the original promo flyout, which this edition no longer shows.) |
| `.github/workflows/build.yml` | The GitHub build (see "Continuous integration"). |

File names in the game don't always match the case on disk (`images/` vs `Images/`); the server
matches names without regard to case, as the original Windows hosting did.

## Assets: what's here and what was never archived

Restored from the Wayback Machine in this rebuild: the 2017 versions of the interface images
(logo, home background, dashboard, sprites, tiles), the Segoe UI web fonts the stylesheet uses,
one Proxima Nova font file, and two Maze 3 power-up frames. Everything else was already in this
folder (it matches what the Wayback Machine holds).

Extracted from the original 1995 Windows game:

- Classic-mode textures for Maze 2 and Maze 3 (`Images/Schemes/MAZE2|MAZE3/Retro/`), decoded from
  `TEXT2.TEX` / `TEXT3.TEX` (the same decoder reproduces the 2013 team's Maze 1 set exactly).
- The three songs: `sounds/Retro/music/MUSICn.mid` (lossless MIDI from the `.MUZ` files), recorded
  with several MIDI synthesizers (see "Music recordings" below).

### Music recordings

The 1995 game played its MIDI songs on whatever synthesizer Windows had. Classic mode's **Options >
Sounds > Music Played On** chooses which recording to play (kept in the browser):

| Choice | Folder | Made with |
|---|---|---|
| Windows (Microsoft GS Wavetable), the default | `sounds/Retro/music/windows/` | Windows' own `gm.dls` (Roland GS sound set licensed to Microsoft), rendered with FluidSynth 2.6.2 |
| Sound Blaster 16 (FM) | `soundblaster/` | the card's Yamaha OPL3 FM chip (Nuked OPL3 emulation) playing Windows 9x's FM instruments, through libADLMIDI (its bank 58 and "Win9x generic FM" volume model) |
| ESS AudioDrive (FM) | `ess/` | the ESS FM chip (ESFMu emulation) playing the same Windows 9x FM instruments in its OPL3-compatible mode (ESS's own driver instruments for its native FM mode aren't available) |
| Roland MT-32 | `mt32/` | Munt 2.7.1's MT-32 emulation with MT-32 ROMs (control ROM 2.07; not in this repository, as they are copyrighted). The MT-32 predates General MIDI, so `tools/music/mt32convert.py` first does what an MT-32 owner's setup did: the song's 8 busiest parts go to the MT-32's 8 parts on channels 2-9 (the other parts are dropped), each General MIDI instrument becomes the nearest MT-32 one, pan is mirrored and pitch bends are scaled to 2 semitones. A few General MIDI drums the MT-32 lacks stay silent. |
| Roland SC-88 | `sc88/` | a Roland SC-88 SoundFont (`Roland_SC-88.sf2`; not in this repository), rendered with FluidSynth 2.6.2 |
| GeneralUser GS | the music folder itself | the GeneralUser GS SoundFont (the first recordings) |

All are made equally loud (-16.6 LUFS) with the fading tail after the last note cut off, so the
songs loop without a pause. To make a set again, run from this folder `tools/render-music.sh <set>
<bank.sf2 or .dls>`, `tools/render-music.sh soundblaster --fm` (or `ess --fm`), or
`tools/render-music.sh mt32 --mt32 <your MT-32 ROM folder>`; it records the songs and adds the set to
`sounds/Retro/music/sets.json`, which the game reads (a set missing from it shows greyed out).

The two players for `--fm` and `--mt32` are small programs in `tools/music/`, built against
libADLMIDI (<https://github.com/Wohlstand/libADLMIDI>) and Munt's libmt32emu
(<https://github.com/munt/munt>, tag `libmt32emu_2_7_1`). Built by hand with g++ (no CMake needed):

```sh
# adlrender, from libADLMIDI's folder:
gcc -O2 -Iinclude -Isrc -c src/chips/nuked/nukedopl3.c src/chips/nuked/nukedopl2.c src/chips/nuked_fast/nukedopl3_fast.c src/chips/nuked_cqm/cqm.c src/chips/esfmu/esfm.c src/chips/esfmu/esfm_registers.c src/wopl/wopl_file.c src/models/*.c
g++ -O2 -std=c++11 -DADLMIDI_DISABLE_DOSBOX_EMULATOR -DADLMIDI_DISABLE_JAVA_EMULATOR -DADLMIDI_DISABLE_MAME_OPL -DADLMIDI_DISABLE_OPAL_EMULATOR -DADLMIDI_DISABLE_YMFM_EMULATOR -Iinclude -Isrc -c src/adlmidi*.cpp src/inst_db.cpp src/chips/nuked_opl3.cpp src/chips/nuked_opl3_fast.cpp src/chips/nuked_opl2.cpp src/chips/nuked_cqm.cpp src/chips/esfmu_opl3.cpp <project>/tools/music/adlrender.cpp
g++ -o adlrender *.o
# mt32render, from munt's mt32emu/src folder (copy tools/music/mt32emu-config.h to config.h first):
g++ -O2 -std=c++11 -I. -Isrchelper/srctools/include -c $(ls *.cpp | grep -v VersionTagging) sha1/*.cpp srchelper/InternalResampler.cpp srchelper/srctools/src/*.cpp <project>/tools/music/mt32render.cpp
g++ -o mt32render *.o
```
- The original sound effect WAVs (`sounds/Retro/original-wav/`) and `.ogg` versions of every sound.

Never archived, so not available anywhere we could find:

- The low-detail `*_QUARTER` textures used only on ARM (Surface RT) devices.
- A few Maze 2/3 texture variants (e.g. `MAZE2/WBASE_09…12`, `MAZE2/FBASE_02`, some glow/normal maps).
- The 2017 re-encodes of the "Modern" sounds (the 2014 recordings are used).
- `images/ui/hoverfb.png` (the Facebook share picture).

## The multiplayer server

Only the browser side of the original multiplayer survives, plus the list of the twelve hub
methods. `server/hub.go` rebuilds the server from what the browser sends and expects; the places
where the original's behaviour is unknown are marked "estimate" there (team assignment, flag
choice, no pod respawn, no default time limit, high scores).
