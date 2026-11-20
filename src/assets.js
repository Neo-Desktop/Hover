/*
 * Hover! asset manifest (readable replacement for scripts/cdn-files.js).
 *
 * The original pointed every image and sound at the Azure CDN
 * (http://mshovercdn.blob.core.windows.net/) and used content-hashed file names. This rebuild
 * serves everything from this folder, so the base URL is empty and each name below is a file that
 * really exists here (restored from the Wayback Machine). Load order: after scripts/mazes.js and
 * before src/game/00-namespace.js.
 *
 * Differences from the 2017 original:
 *  - The "Modern" sounds are the 2014 recordings (same names, older hashes); the 2017 re-encodes
 *    were never archived.
 *  - No .ogg files were archived, so the .ogg files here were made for this rebuild (the game
 *    only uses them when the browser reports it can't play m4a):
 *      sounds/Modern/NAME.ogg  re-encoded from the Modern .m4a files (Vorbis q4).
 *      sounds/Retro/NAME.ogg   encoded from the original Windows 95 Hover! WAVs (SOUNDS/MIXED,
 *                              copied to sounds/Retro/original-wav/), shaped like the 2013 .m4a
 *                              files: 11025 Hz stereo, each channel -3 dB (Vorbis q4).
 *  - Retro mode now has music, which the 2013 remake never shipped: the three songs of the 1995
 *    game. sounds/Retro/music/MUSICn.mid are lossless conversions of the game's MIDI-stream files
 *    (SOUNDS/MUSIC/MUSICn.MUZ); the .m4a/.ogg next to them are those songs rendered once (no loop
 *    points in the originals) with go-meltysynth and the GeneralUser GS v2.0.3 SoundFont by
 *    S. Christian Collins (free for any use, see its LICENSE.txt). The game loops "MUSIC" with
 *    the element's own loop flag, as in modern mode.
 */
var Hover = window.Hover || {};
window.Hover = Hover;

// Where assets live. getUrl() keeps the original's "pick one of several base URLs" hashing so the
// rest of the code is unchanged; with a single empty base URL every path stays relative.
(function (Hover) {
    Hover.cdn = Hover.cdn || {};
    Hover.cdn.useAzure = false;
    Hover.cdn.baseUrls = [""];

    Hover.cdn.getUrl = function (path) {
        var hash = 0;
        for (var i = 0, length = path.length; i < length; i++) {
            hash = (hash << 5) - hash + path.charCodeAt(i);
            hash &= hash;
        }
        var index = Math.abs(hash) % Hover.cdn.baseUrls.length;
        return Hover.cdn.baseUrls[index] + path;
    };

    Hover.cdn.getSoundUrl = function (fileName) {
        return Hover.cdn.getUrl("sounds/" + fileName);
    };

    Hover.cdn.filenames = {
        retroProgress: "Images/ui/retroprogress.be469e2f.gif"
    };
})(Hover);

// Images shown by the loading screen, and images to fetch before the game starts.
(function (Hover) {
    Hover.images = {};
    Hover.loaderImages = {
        star: "Images/ui/star.de017a50.png"
    };
    Hover.preloadAndCacheImages = {};
    Hover.preloadImages = ["Images/ui/sprite.93147d77.png"];
})(Hover);

// Sound effects and music for the modern (3D) look, by sound name.
(function (Hover) {
    var m4a = {
        ATTKPING: "Modern/ATTKPING.a4230c0e.m4a",
        CLOAK_EN: "Modern/CLOAK_EN.2cdc05c8.m4a",
        CLOAK_ST: "Modern/CLOAK_ST.b7bb4a3f.m4a",
        FLAGR_DR: "Modern/FLAGR_DR.787d6c69.m4a",
        FLAGR_ST: "Modern/FLAGR_ST.8bb12e73.m4a",
        GAMEOVR: "Modern/GAMEOVR.e3383884.m4a",
        HIT_MAPE: "Modern/HIT_MAPE.1280f218.m4a",
        HIT_POD: "Modern/HIT_POD.29c0cdec.m4a",
        HIT_ROBT: "Modern/HIT_ROBT.58b620e2.m4a",
        HIT_SHLD: "Modern/HIT_SHLD.77fcc616.m4a",
        HIT_WALL: "Modern/HIT_WALL.2d3224ed.m4a",
        HOLD_EN: "Modern/HOLD_EN.8aadacce.m4a",
        HOLD_ST: "Modern/HOLD_ST.c5539c60.m4a",
        INVIN_EN: "Modern/INVIN_EN.fd5ec5b0.m4a",
        INVIN_ST: "Modern/INVIN_ST.3322e4be.m4a",
        JUMP_EN: "Modern/JUMP_EN.2bc192f3.m4a",
        JUMP_ST: "Modern/JUMP_ST.f727f498.m4a",
        LEVLSTRT: "Modern/LEVLSTRT.c3f2742a.m4a",
        MUSIC: "Modern/MUSIC.4108bf25.m4a",
        OBT_CLOA: "Modern/OBT_CLOA.7c33646e.m4a",
        OBT_HFLG: "Modern/OBT_HFLG.1895f98d.m4a",
        OBT_JUMP: "Modern/OBT_JUMP.7c33646e.m4a",
        OBT_RFLG: "Modern/OBT_RFLG.47c8bc85.m4a",
        OBT_WALL: "Modern/OBT_WALL.88af3c83.m4a",
        SHIELD: "Modern/SHIELD.bedd1e91.m4a",
        SKID_ST: "Modern/SKID_ST.e857b77a.m4a",
        SPEED_EN: "Modern/SPEED_EN.0af6b541.m4a",
        SPEED_RE: "Modern/SPEED_RE.5fa58732.m4a",
        WINLEVEL: "Modern/WINLEVEL.2bf6c0ba.m4a"
    };
    // Made for this rebuild from the .m4a files above; see the note at the top.
    var ogg = {
        ATTKPING: "Modern/ATTKPING.ogg",
        CLOAK_EN: "Modern/CLOAK_EN.ogg",
        CLOAK_ST: "Modern/CLOAK_ST.ogg",
        FLAGR_DR: "Modern/FLAGR_DR.ogg",
        FLAGR_ST: "Modern/FLAGR_ST.ogg",
        GAMEOVR: "Modern/GAMEOVR.ogg",
        HIT_MAPE: "Modern/HIT_MAPE.ogg",
        HIT_POD: "Modern/HIT_POD.ogg",
        HIT_ROBT: "Modern/HIT_ROBT.ogg",
        HIT_SHLD: "Modern/HIT_SHLD.ogg",
        HIT_WALL: "Modern/HIT_WALL.ogg",
        HOLD_EN: "Modern/HOLD_EN.ogg",
        HOLD_ST: "Modern/HOLD_ST.ogg",
        INVIN_EN: "Modern/INVIN_EN.ogg",
        INVIN_ST: "Modern/INVIN_ST.ogg",
        JUMP_EN: "Modern/JUMP_EN.ogg",
        JUMP_ST: "Modern/JUMP_ST.ogg",
        LEVLSTRT: "Modern/LEVLSTRT.ogg",
        MUSIC: "Modern/MUSIC.ogg",
        OBT_CLOA: "Modern/OBT_CLOA.ogg",
        OBT_HFLG: "Modern/OBT_HFLG.ogg",
        OBT_JUMP: "Modern/OBT_JUMP.ogg",
        OBT_RFLG: "Modern/OBT_RFLG.ogg",
        OBT_WALL: "Modern/OBT_WALL.ogg",
        SHIELD: "Modern/SHIELD.ogg",
        SKID_ST: "Modern/SKID_ST.ogg",
        SPEED_EN: "Modern/SPEED_EN.ogg",
        SPEED_RE: "Modern/SPEED_RE.ogg",
        WINLEVEL: "Modern/WINLEVEL.ogg"
    };
    Hover.modernSoundFiles = {
        m4a: m4a,
        ogg: ogg
    };
})(Hover);

// Sound effects and music for the retro (Windows 95) look, by sound name.
(function (Hover) {
    // "MUSIC" is the 1995 game's first song (rendered from sounds/Retro/music/MUSIC1.mid; see the
    // note at the top); the game plays and loops it. The other two songs are in sounds/Retro/music/
    // but aren't listed, because the game downloads every listed sound before a level starts.
    var m4a = {
        ATTKPING: "Retro/ATTKPING.d23955d8.m4a",
        CLOAK_EN: "Retro/CLOAK_EN.366bc1c7.m4a",
        CLOAK_ST: "Retro/CLOAK_ST.77d873df.m4a",
        ENG_HIGH: "Retro/ENG_HIGH.7b103777.m4a",
        ENG_IDLE: "Retro/ENG_IDLE.691e705d.m4a",
        ENG_LOW: "Retro/ENG_LOW.83da01f2.m4a",
        ENG_NORM: "Retro/ENG_NORM.3e25c46d.m4a",
        FLAGR_DR: "Retro/FLAGR_DR.59b4d96d.m4a",
        FLAGR_ST: "Retro/FLAGR_ST.04408e52.m4a",
        GAMEOVR: "Retro/GAMEOVR.694d9d74.m4a",
        HIT_MAPE: "Retro/HIT_MAPE.7748817c.m4a",
        HIT_POD: "Retro/HIT_POD.064e9e13.m4a",
        HIT_ROBT: "Retro/HIT_ROBT.15f38001.m4a",
        HIT_SHLD: "Retro/HIT_SHLD.d01b8f15.m4a",
        HIT_WALL: "Retro/HIT_WALL.9cb94807.m4a",
        HOLD_EN: "Retro/HOLD_EN.6362464d.m4a",
        HOLD_ST: "Retro/HOLD_ST.f8bba184.m4a",
        INVIN_EN: "Retro/INVIN_EN.863dc1af.m4a",
        INVIN_ST: "Retro/INVIN_ST.56a67347.m4a",
        JUMP_EN: "Retro/JUMP_EN.35e53a74.m4a",
        JUMP_ST: "Retro/JUMP_ST.034aacfb.m4a",
        LEVLSTRT: "Retro/LEVLSTRT.a919ae82.m4a",
        MUSIC: "Retro/music/MUSIC1.m4a",
        OBT_CLOA: "Retro/OBT_CLOA.f5e549bc.m4a",
        OBT_HFLG: "Retro/OBT_HFLG.6cea2517.m4a",
        OBT_JUMP: "Retro/OBT_JUMP.9eafb41a.m4a",
        OBT_RFLG: "Retro/OBT_RFLG.3ce65425.m4a",
        OBT_WALL: "Retro/OBT_WALL.1609a7fe.m4a",
        SHIELD: "Retro/SHIELD.9e91467f.m4a",
        SKID_ST: "Retro/SKID_ST.995ad503.m4a",
        SPEED_EN: "Retro/SPEED_EN.10635660.m4a",
        SPEED_RE: "Retro/SPEED_RE.1c9e1131.m4a",
        WINLEVEL: "Retro/WINLEVEL.85f25fd5.m4a"
    };
    // Made for this rebuild from the original WAVs; see the note at the top.
    var ogg = {
        ATTKPING: "Retro/ATTKPING.ogg",
        CLOAK_EN: "Retro/CLOAK_EN.ogg",
        CLOAK_ST: "Retro/CLOAK_ST.ogg",
        ENG_HIGH: "Retro/ENG_HIGH.ogg",
        ENG_IDLE: "Retro/ENG_IDLE.ogg",
        ENG_LOW: "Retro/ENG_LOW.ogg",
        ENG_NORM: "Retro/ENG_NORM.ogg",
        FLAGR_DR: "Retro/FLAGR_DR.ogg",
        FLAGR_ST: "Retro/FLAGR_ST.ogg",
        GAMEOVR: "Retro/GAMEOVR.ogg",
        HIT_MAPE: "Retro/HIT_MAPE.ogg",
        HIT_POD: "Retro/HIT_POD.ogg",
        HIT_ROBT: "Retro/HIT_ROBT.ogg",
        HIT_SHLD: "Retro/HIT_SHLD.ogg",
        HIT_WALL: "Retro/HIT_WALL.ogg",
        HOLD_EN: "Retro/HOLD_EN.ogg",
        HOLD_ST: "Retro/HOLD_ST.ogg",
        INVIN_EN: "Retro/INVIN_EN.ogg",
        INVIN_ST: "Retro/INVIN_ST.ogg",
        JUMP_EN: "Retro/JUMP_EN.ogg",
        JUMP_ST: "Retro/JUMP_ST.ogg",
        LEVLSTRT: "Retro/LEVLSTRT.ogg",
        MUSIC: "Retro/music/MUSIC1.ogg",
        OBT_CLOA: "Retro/OBT_CLOA.ogg",
        OBT_HFLG: "Retro/OBT_HFLG.ogg",
        OBT_JUMP: "Retro/OBT_JUMP.ogg",
        OBT_RFLG: "Retro/OBT_RFLG.ogg",
        OBT_WALL: "Retro/OBT_WALL.ogg",
        SHIELD: "Retro/SHIELD.ogg",
        SKID_ST: "Retro/SKID_ST.ogg",
        SPEED_EN: "Retro/SPEED_EN.ogg",
        SPEED_RE: "Retro/SPEED_RE.ogg",
        WINLEVEL: "Retro/WINLEVEL.ogg"
    };
    Hover.retroSoundFiles = {
        m4a: m4a,
        ogg: ogg
    };
})(Hover);
