// Added in this edition: the release build's asset pack (tools/build; README, "Release build").
//
// The release build puts every picture, 3D model and sound the game loads into one file,
// assets.<fingerprint>.pack, and writes its address into index.html as window.HOVER_PACK:
//
//     { url: "assets.<fingerprint>.pack", size: <bytes>,
//       inline: { "<path>": "data:..." },     small files the page needs before the pack arrives
//       css:    { "--hp1": "<path>", ... } }  style-sheet pictures that come from the pack
//
// This file downloads the pack and lets the game keep using its ordinary file addresses
// ("Images/ui/sprite.png", "/3d/Hover_A.json", "sounds/Retro/BOUNCE.m4a"): when a picture,
// sound or XMLHttpRequest is pointed at a packed file, it gets an in-memory (blob:) address of
// that file instead. The main menu's pictures and fonts are already inside the style sheet, so
// the menu shows straight away while the pack downloads; everything else waits for
// HoverPack.whenReady (20-app.js holds back the other screens until then).
//
// With the readable files (no HOVER_PACK) it does nothing: HoverPack.ready is true from the start
// and every address is used as it is.
//
// Pack layout: "HOVERPAK", a 4-byte little-endian length, a JSON list of
// [path (lower case), offset, length, type] (offsets count from the end of the list), the files.
(function (window, document) {
    var config = window.HOVER_PACK;
    var readyCallbacks = [];
    var progressCallbacks = [];

    var HoverPack = window.HoverPack = {
        /** True once every packed file can be used (always true with the readable files). */
        ready: !config,
        loaded: 0,
        total: config ? config.size : 0,

        /** The address to load for a file address: a packed file's blob: address, or the same. */
        url: function (address) {
            return address;
        },

        /** Calls back once the pack has arrived (at once if it has, or there is none). */
        whenReady: function (callback) {
            if (HoverPack.ready) {
                callback();
            } else {
                readyCallbacks.push(callback);
            }
        },

        /** Calls back with (bytes loaded, bytes in all) while the pack downloads. */
        onProgress: function (callback) {
            progressCallbacks.push(callback);
        }
    };
    if (!config) {
        return;
    }

    var MAGIC = "HOVERPAK";
    var inline = config.inline || {};
    var files = null; // lower-case path -> { start, length, type, url }
    var pack = null; // the downloaded pack (a Blob; files are slices of it, never copies)

    /** The pack's name for an address on this site, or null for other sites, data: and blob:. */
    function packPath(address) {
        if (typeof address !== "string" || address === "") {
            return null;
        }
        var origin = location.protocol + "//" + location.host;
        if (address.indexOf(origin) === 0) {
            address = address.substring(origin.length);
        }
        if (/^[a-z][a-z0-9+.\-]*:/i.test(address) || address.indexOf("//") === 0) {
            return null;
        }
        address = address.replace(/[?#].*$/, "").replace(/^(\.?\/)+/, "");
        try {
            address = decodeURIComponent(address);
        } catch (e) {
        }
        return address.toLowerCase();
    }

    function resolve(address) {
        var path = packPath(address);
        if (path === null) {
            return address;
        }
        if (inline.hasOwnProperty(path)) {
            return inline[path];
        }
        var file = files && files.hasOwnProperty(path) ? files[path] : null;
        if (!file) {
            return address;
        }
        if (!file.url) {
            file.url = URL.createObjectURL(pack.slice(file.start, file.start + file.length, file.type));
        }
        return file.url;
    }
    HoverPack.url = resolve;

    // --- Point the browser's loaders at the pack ----------------------------------------------

    function patchSrc(proto) {
        var property = proto && Object.getOwnPropertyDescriptor(proto, "src");
        if (!property || !property.set) {
            return;
        }
        Object.defineProperty(proto, "src", {
            configurable: true,
            enumerable: property.enumerable,
            get: property.get,
            set: function (value) {
                property.set.call(this, resolve(value));
            }
        });
    }
    patchSrc(window.HTMLImageElement && HTMLImageElement.prototype); // new Image(), PxLoader, three.js
    patchSrc(window.HTMLMediaElement && HTMLMediaElement.prototype); // <audio>, <video>
    patchSrc(window.HTMLSourceElement && HTMLSourceElement.prototype);

    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (String(name).toLowerCase() === "src") {
            value = resolve(String(value));
        }
        return setAttribute.call(this, name, value);
    };

    // new Audio(file) sets its file without going through the src property.
    var NativeAudio = window.Audio;
    if (NativeAudio) {
        var PackAudio = function (file) {
            var audio = new NativeAudio();
            audio.preload = "auto";
            if (file !== undefined) {
                audio.src = file;
            }
            return audio;
        };
        PackAudio.prototype = NativeAudio.prototype;
        window.Audio = PackAudio;
    }

    // jQuery's $.ajax (sets.json) and three.js's JSONLoader (the 3D models).
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, address) {
        var args = Array.prototype.slice.call(arguments);
        args[1] = resolve(address);
        return open.apply(this, args);
    };

    // --- Download ----------------------------------------------------------------------------

    function progress() {
        for (var i = 0; i < progressCallbacks.length; i++) {
            progressCallbacks[i](HoverPack.loaded, HoverPack.total);
        }
    }

    function finish(blob, list, dataStart) {
        files = {};
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            files[entry[0]] = { start: dataStart + entry[1], length: entry[2], type: entry[3] };
        }
        pack = blob;
        HoverPack.ready = true;
        HoverPack.loaded = HoverPack.total;
        progress();
        var root = document.documentElement;
        for (var name in config.css || {}) {
            if (config.css.hasOwnProperty(name)) {
                root.style.setProperty(name, 'url("' + resolve(config.css[name]) + '")');
            }
        }
        var waiting = readyCallbacks;
        readyCallbacks = [];
        for (var j = 0; j < waiting.length; j++) {
            waiting[j]();
        }
    }

    function read(blob, asText, done, failed) {
        var reader = new FileReader();
        reader.onload = function () {
            done(reader.result);
        };
        reader.onerror = failed;
        if (asText) {
            reader.readAsText(blob, "utf-8");
        } else {
            reader.readAsArrayBuffer(blob);
        }
    }

    var attempts = 0;

    function download() {
        attempts++;
        var failed = function (why) {
            if (window.console) {
                console.error("Hover: the game's files did not load (" + why + "); trying again");
            }
            setTimeout(download, Math.min(30000, 1000 * Math.pow(2, attempts)));
        };
        var xhr = new XMLHttpRequest();
        open.call(xhr, "GET", config.url, true);
        xhr.responseType = "blob";
        xhr.onprogress = function (event) {
            HoverPack.loaded = event.loaded;
            progress();
        };
        xhr.onerror = function () {
            failed("network error");
        };
        xhr.onload = function () {
            if (xhr.status !== 200) {
                failed("status " + xhr.status);
                return;
            }
            var blob = xhr.response;
            read(blob.slice(0, 12), false, function (head) {
                var bytes = new Uint8Array(head);
                if (String.fromCharCode.apply(null, bytes.subarray(0, 8)) !== MAGIC) {
                    failed("not a Hover! pack");
                    return;
                }
                var listLength = new DataView(head).getUint32(8, true);
                read(blob.slice(12, 12 + listLength), true, function (text) {
                    finish(blob, JSON.parse(text), 12 + listLength);
                }, function () {
                    failed("unreadable");
                });
            }, function () {
                failed("unreadable");
            });
        };
        xhr.send();
    }

    download();
})(window, document);
