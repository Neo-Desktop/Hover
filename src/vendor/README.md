# Hover! — third-party libraries (readable copies)

Readable (non-minified) copies of every library the 2013/2014 web game **Hover!** loads, for the
readable-source rebuild. They replace:

- `jquery.min.js` 1.10.2 (loaded by the page from `ajax.googleapis.com`),
- the minified library bundle `cdn/scripts/game-libs.922bbe8e.js` (120 KB, 4 lines),
- `scripts/three.min.js` (three.js r61 with the game's own patches).

Load them as classic `<script>` tags in the order of [`load-order.txt`](load-order.txt):
jQuery first, then the bundle's components in the order they appear inside `game-libs`, then
three.js last.

## Files (in load order)

| # | File | Library / version | Source of this copy | Licence |
|---|------|-------------------|---------------------|---------|
| 1 | `jquery-1.10.2.js` | jQuery 1.10.2 | https://code.jquery.com/jquery-1.10.2.js | MIT |
| 2 | `typedarray.js` | Typed Array polyfill (ArrayBuffer, *Array, DataView for old IE) by Joshua Bell, commit `bcdd09c29773` (2013-09-02, "Round to even") | https://raw.githubusercontent.com/inexorabletash/polyfill/bcdd09c29773/typedarray.js | MIT (Linden Research, Joshua Bell) |
| 3 | `modernizr-2.6.2.js` | Modernizr 2.6.2, full development build (superset of the game's custom build, see notes) | https://raw.githubusercontent.com/Modernizr/Modernizr/v2.6.2/modernizr.js | MIT / BSD (bundled html5shiv 3.6.1: MIT / GPL2) |
| 4 | `yepnope-1.5.4.js` | yepnope.js 1.5.4 (file header says "1.5.4pre"; identical to cdnjs `yepnope/1.5.4/yepnope.js`) | https://raw.githubusercontent.com/SlexAxton/yepnope.js/v1.5.4/yepnope.js | WTFPL / MIT / BSD |
| 5 | `modernizr.load.js` | `Modernizr.load` glue line emitted by the Modernizr 2.6.2 download builder | written here (one statement, same code as the bundle) | MIT / BSD (Modernizr) |
| 6 | `detectizr-1.4.4.js` | Detectizr 1.4.4, commit `65d7e597e04d` (2013-07-22) | https://raw.githubusercontent.com/barisaydinoglu/Detectizr/65d7e597e04d/detectizr.js | LGPL-3.0-or-later (as stated in that version's header; later versions are MIT) |
| 7 | `underscore-1.5.1.js` | Underscore.js 1.5.1 | https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.5.1/underscore.js | MIT |
| 8 | `backbone-1.0.0.js` | Backbone.js 1.0.0 | https://cdnjs.cloudflare.com/ajax/libs/backbone.js/1.0.0/backbone.js | MIT |
| 9 | `purl-2.2.1.js` | purl (jQuery URL Parser) 2.2.1 | https://raw.githubusercontent.com/allmarkedup/purl/v2.2.1/purl.js | MIT |
| 10 | `PxLoader.js` | PxLoader, commit `3386ff5873b2` (2013-07-17; same file content as `dcc799709264`) | https://raw.githubusercontent.com/thinkpixellab/PxLoader/3386ff5873b2/PxLoader.js | MIT (Pixel Lab) |
| 11 | `PxLoaderImage.js` | PxLoader image plugin, same commit | …/PxLoader/3386ff5873b2/PxLoaderImage.js | MIT |
| 12 | `PxLoaderSound.js` | PxLoader SoundManager2 plugin, same commit | …/PxLoader/3386ff5873b2/PxLoaderSound.js | MIT |
| 13 | `PxLoaderVideo.js` | PxLoader video plugin, same commit | …/PxLoader/3386ff5873b2/PxLoaderVideo.js | MIT |
| 14 | `jquery.pxtouch.js` | PxTouch (jQuery pointer/gesture special events), commit `25094b15873e` (2013-09-18): the 8 files of `js/` concatenated in the gruntfile order | https://github.com/thinkpixellab/PxTouch/tree/25094b15873e/js | MIT (Pixel Lab; licence text in the repo README) |
| 15 | `jquery.signalR-2.0.3.js` | ASP.NET SignalR jQuery client 2.0.3 (kept byte-identical, CRLF line endings) | https://ajax.aspnetcdn.com/ajax/signalr/jquery.signalr-2.0.3.js | Apache-2.0 (Microsoft Open Technologies) |
| 16 | `jquery.easing-1.3.js` | jQuery Easing 1.3 (George McGinley Smith) | http://gsgd.co.uk/sandbox/jquery/easing/jquery.easing.1.3.js | BSD-3-Clause |
| 17 | `jquery.fadeInLetters.js` | `$.fn.fadeInLetters` text "scramble" reveal effect — no published source; **hand de-minified** from the bundle. A modified copy of "Shuffle Letters" 1.0 by Martin Angelov | bundle `game-libs.922bbe8e.js`, last module; original plugin: http://tutorialzine.com/2011/09/shuffle-letters-effect-jquery/ | MIT (Shuffle Letters) |
| 18 | `three-r61.js` | three.js r61 `build/three.js` **plus the game's patches** (marked `HOVER PATCH`) | https://raw.githubusercontent.com/mrdoob/three.js/r61/build/three.js | MIT |

## What `game-libs.922bbe8e.js` contains (in order)

The bundle is one UglifyJS-minified script. Uglify hoisted the three PxLoader plugin constructor
*declarations* (`function PxLoaderImage/Sound/Video`) to the very top of the file; in the source
concatenation they came after `PxLoader.js`, which is the order used here (function declarations are
global either way, so this changes nothing).

| Bundle order | Component | Vendor file |
|---|---|---|
| (hoisted) | `function PxLoaderImage`, `PxLoaderSound`, `PxLoaderVideo` | `PxLoaderImage.js`, `PxLoaderSound.js`, `PxLoaderVideo.js` |
| 1 | Typed Array polyfill `(function(global){"use strict"…}(this))` | `typedarray.js` |
| 2 | Modernizr 2.6.2 custom build | `modernizr-2.6.2.js` |
| 3 | yepnope 1.5.4 (as embedded by the Modernizr builder) | `yepnope-1.5.4.js` |
| 4 | `Modernizr.load = function(){ yepnope.apply(…) }` | `modernizr.load.js` |
| 5 | Detectizr 1.4.4 | `detectizr-1.4.4.js` |
| 6 | Underscore 1.5.1 | `underscore-1.5.1.js` |
| 7 | Backbone 1.0.0 | `backbone-1.0.0.js` |
| 8 | purl 2.2.1 | `purl-2.2.1.js` |
| 9 | PxLoader core (+ `Date.now` / `Array.isArray` shims), then the `addImage` / `addSound` / `addVideo` tails of the three plugins | `PxLoader.js`, `PxLoaderImage.js`, `PxLoaderSound.js`, `PxLoaderVideo.js` |
| 10 | PxTouch: specialEvents, pointers, gestures, taps, doubleTap, pinch, drag, swipe | `jquery.pxtouch.js` |
| 11 | SignalR 2.0.3: core, transports (common, webSockets, serverSentEvents, foreverFrame, longPolling), hubs, version stamp | `jquery.signalR-2.0.3.js` |
| 12 | jQuery Easing 1.3 | `jquery.easing-1.3.js` |
| 13 | `$.fn.fadeInLetters` | `jquery.fadeInLetters.js` |

Each official file was matched against its bundle segment by comparing the ordered/unordered
sequence of string literals, numbers and property names; the remaining differences are all minifier
artefacts (constant folding such as `20*1000`→`2e4`, string-concatenation folding, `<\/script>`
escaping, merged assignments, dead code dropped by the minifier). The candidate versions this
ruled out are recorded in the notes below.

## Globals and jQuery extensions the bundle defines → vendor file

| Defined by `game-libs` | Vendor file |
|---|---|
| `PxLoaderImage`, `PxLoaderSound`, `PxLoaderVideo` (global functions); `PxLoader.prototype.addImage` / `addSound` / `addVideo` | `PxLoaderImage.js` / `PxLoaderSound.js` / `PxLoaderVideo.js` |
| `ArrayBuffer`, `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, `DataView` (only where missing); `Object.defineProperty` / `Object.getOwnPropertyNames` fallbacks | `typedarray.js` |
| `Modernizr` (tests, `addTest`, `testProp`, `testAllProps`, `testStyles`, `_version`, `_prefixes`, `_domPrefixes`, `_cssomPrefixes`), `html5` (html5shiv), `Function.prototype.bind` fallback, classes on `<html>` | `modernizr-2.6.2.js` |
| `yepnope` (+ `yepnope.injectJs`, `injectCss`, `errorTimeout`, `executeStack`, `addPrefix`, `addFilter`) | `yepnope-1.5.4.js` |
| `Modernizr.load` | `modernizr.load.js` |
| `Modernizr.Detectizr` (`.device`, `.detect`) and its `Modernizr.addTest` classes | `detectizr-1.4.4.js` |
| `_` | `underscore-1.5.1.js` |
| `Backbone` | `backbone-1.0.0.js` |
| `jQuery.fn.url`, `jQuery.url` (or `window.purl` when jQuery is absent) | `purl-2.2.1.js` |
| `PxLoader`; `Date.now`, `Array.isArray` fallbacks | `PxLoader.js` |
| `PxTouch` (`PxTouch.registerSpecialEvents`); jQuery special events `pxpointerstart/move/end`, `pxgesturestart/move/end`, `pxtap`, `pxholdstart`, `pxholdend`, `pxdoubletap`, `pxpinchstart/move/end`, `pxdragstart/move/end`, `pxswipestart/move/end` | `jquery.pxtouch.js` |
| `jQuery.signalR` (= `jQuery.connection`, `.transports`, `.hub`, `.version` "2.0.3"), `jQuery.hubConnection` | `jquery.signalR-2.0.3.js` |
| `jQuery.easing.def`, `jswing`, `swing` override and the 30 `easeIn*/easeOut*/easeInOut*` functions | `jquery.easing-1.3.js` |
| `jQuery.fn.fadeInLetters` | `jquery.fadeInLetters.js` |
| AMD `define("PxLoader" / "PxLoaderImage" / "PxLoaderSound" / "PxLoaderVideo")`, purl's anonymous `define` — only when an AMD loader is present (none is) | the same files |

Nothing in the bundle is left without a vendor file.

## Notes and caveats

- **Modernizr**: the bundle's custom build contains only standard Modernizr 2.6.2 modules — tests
  `canvas`, `webgl`, `touch`, `cssanimations`, `csstransforms`, `csstransforms3d`, `video`,
  `audio`, `localstorage`, plus `shiv`, `cssclasses`, `addtest`, `teststyles`, `testprop`,
  `testallprops`, `prefixes`, `domprefixes` and `load`. No non-standard tests. The full
  development build used here is a superset, with two visible side-effects: (a) many more
  `feature` / `no-feature` classes are added to `<html>`; (b) it defines `Modernizr.mq`, which
  the custom build lacked, so Detectizr's `detectScreen` branch (guarded by `Modernizr.mq`) now
  runs and adds/removes the `smallScreen` / `verySmallScreen` / `veryVerySmallScreen` classes
  too. Neither is used by the game: `game.js` reads only `Modernizr.audio`, `.canvas`,
  `.csstransforms`, `.csstransforms3d`, `.video`, `.webgl` and `.Detectizr`, and `css/game.css`
  uses only Detectizr's `.windows` / `.mobile` / `.iphone` classes. If exact `<html>` class parity
  matters anyway, delete the extra tests (and `Modernizr.mq`) from this file.
  `Modernizr.load` is not part of the development build, hence `yepnope-1.5.4.js` +
  `modernizr.load.js`.
- **typedarray.js**: identified by content; the polyfill's history pins it between
  `bcdd09c29773` (2013-09-02) and `179158c7fa9b` (2013-09-08, adds a 1e5 size limit the bundle
  does not have). It still has the `USE_NATIVE_IF_AVAILABLE` switch, so native typed arrays win
  when present.
- **PxLoaderSound** needs SoundManager 2's global `soundManager` when `addSound` is called. It is
  not in the bundle and the game never calls `addSound` (it uses `addImage` only).
- **SignalR**: the page also needs the server-generated hub proxies; the game loads them at run time
  with `$.getScript(<hub url> + "/hubs")`.
- **fadeInLetters** (hand de-minified): behaviour kept exactly, including a latent bug — after the
  "already animated" check the shipped code uses an undeclared free variable `el` instead of its
  local jQuery object (it would throw a ReferenceError unless a global `el` exists). The game's
  script never calls `fadeInLetters`, so the bug is inert; it is documented in the file instead of
  fixed.
- **three.js**: `scripts/three.min.js` is not the official r61 minified build. Comparing it class by
  class with the official `build/three.js` showed these game patches, all re-applied in
  `three-r61.js` and marked `// HOVER PATCH`:
  1. `THREE.isIE = navigator.userAgent.indexOf('Trident') > 0` (after `THREE.extend`);
  2. `WebGLRenderer` `buildProgram`: `gl.bindAttribLocation(program, 0, …)` skipped when `THREE.isIE`;
  3. `WebGLRenderer` `setDefaultGLState`: `gl.clearStencil(0)` skipped when `THREE.isIE`;
  4. `WebGLRenderer.render`: a second frustum used for culling — built from
     `camera.clipper.projectionMatrix × camera.matrixWorldInverse` when the camera has a `clipper`,
     otherwise the normal view-projection — and a render counter that disables frustum culling for
     the first 4 `render()` calls. (The local names `_cullFrustum` and `_renderCount` are new.
     `immediateRenderCallback` still receives the normal camera frustum, as in the game's build.)
  Other differences between the two builds are minifier artefacts (constant folding, dead branches
  removed from `TubeGeometry.FrenetFrames`, string concatenation). The comparison is based on
  strings, numbers and property names, so a purely operator-level change elsewhere could in principle
  have gone unnoticed.
- `src/vendor` copies were syntax-checked with the esbuild-based `jscheck.exe` (all OK).
- Unrelated, noticed while checking: the project's `scripts/game-libs.js` is byte-identical to
  `scripts/game.js` (a mislabelled copy), so the authentic bundle is only the one in the attic
  (`cdn/scripts/game-libs.922bbe8e.js`).
