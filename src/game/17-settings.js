// Original: game.js lines 3115-3232
//
// Three small modules: Hover.settings (persistent settings in localStorage),
// Hover.social (Twitter / Facebook share pop-ups) and browser feature detection
// (Hover.supports3d, Hover.upgrade, Hover.use3d, Hover.arm, ...).

// Hover.settings: localStorage-backed settings; silently does nothing without localStorage.
(function ($, Hover) {
    var hasLocalStorage = false;
    try {
        hasLocalStorage = !!window.localStorage;
    } catch (e) {
    }
    Hover.settings = {
        get: function (key) {
            return hasLocalStorage ? localStorage.getItem(key) : null;
        },
        /** Stores value.toString(); a null/undefined value removes the key. */
        set: function (key, value) {
            if (hasLocalStorage) {
                if (null == value) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, value.toString());
                }
            }
        },
        remove: function (key) {
            if (hasLocalStorage) {
                localStorage.removeItem(key);
            }
        },
        getBoolOrDefault: function (key, defaultValue) {
            var value = this.get(key);
            return null == value ? defaultValue : "true" === value;
        },
        getIntOrDefault: function (key, defaultValue) {
            var value = this.get(key);
            return null == value ? defaultValue : parseInt(value, 10);
        },
        getSoundEnabled: function () {
            return this.getBoolOrDefault("sound", true);
        },
        setSoundEnabled: function (enabled) {
            this.set("sound", enabled);
            Hover.events.trigger("soundChanged", enabled);
        },
        getPlayerName: function () {
            return this.get("playerName") || "";
        },
        setPlayerName: function (name) {
            this.set("playerName", name);
        },
        getHyperColorEnabled: function () {
            return hyperColorEnabled;
        },
        setHyperColorEnabled: function (enabled) {
            this.set("hyperColorEnabled", enabled);
            hyperColorEnabled = enabled;
            Hover.events.trigger("hyperColorChanged", enabled);
        },
        getIntroMessageShown: function () {
            return this.getBoolOrDefault("introMessageShown", false);
        },
        setIntroMessageShown: function (shown) {
            this.set("introMessageShown", shown);
        },
        /** Whether the help message for a pick-up (pod) type has already been shown. */
        getPickupMessageShown: function (type) {
            return this.getBoolOrDefault("pickupShown-" + type, false);
        },
        setPickupMessageShown: function (type, shown) {
            this.set("pickupShown-" + type, shown);
        },
        resetPickupMessageShown: function () {
            if (hasLocalStorage) {
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (0 === key.indexOf("pickupShown-")) {
                        this.set(key, false);
                    }
                }
            }
        },
        getLocalGameId: function () {
            return this.getIntOrDefault("localGameId", null);
        },
        setLocalGameId: function (id) {
            this.set("localGameId", id);
        },
        // Added in this edition: the last choices, so the game starts with them next time.
        /** The craft last chosen for the modern look: 0, 1 or 2 (CustomizeView). */
        getLastCraft: function () {
            var index = this.getIntOrDefault("lastCraft", 0);
            return index >= 0 && index <= 2 ? index : 0;
        },
        setLastCraft: function (index) {
            this.set("lastCraft", index);
        },
        /** The difficulty last chosen for classic mode: "beginner", "intermediate" or "expert". */
        getClassicDifficulty: function () {
            var difficulty = this.get("classicDifficulty");
            return difficulty === "intermediate" || difficulty === "expert" ? difficulty : "beginner";
        },
        setClassicDifficulty: function (difficulty) {
            this.set("classicDifficulty", difficulty);
        }
    };
    // Multiplayer (SignalR) server. Originally hard-coded to "http://hovermp.azurewebsites.net/";
    // this project ships its own multiplayer server, so the page's own origin is used instead.
    Hover.settings.gameServerUrl = window.location.protocol + "//" + window.location.host + "/";
    var hyperColorEnabled = Hover.settings.getBoolOrDefault("hyperColorEnabled", false);
})(jQuery, Hover);

// Hover.social: share pop-up windows.
(function ($, Hover) {
    Hover.social = {
        shareUrl: "http://hover.ie/",
        tweet: function (message) {
            message = message || "I just got my nostalgia on - with Hover and #IE11";
            var width = 550,
                height = 300,
                left = screen.width / 2 - width / 2,
                top = screen.height / 3 - height / 2;
            window.open("http://twitter.com/share?url=" + encodeURIComponent(this.shareUrl) + "&text=" + encodeURIComponent(message) + "&count=none/", "tweet", "height=" + height + ",width=" + width + ",left=" + left + ",top=" + top + ",resizable=1");
        },
        share: function (message) {
            message = message || "I just got my nostalgia on - with Hover and #IE11";
            var width = 550,
                height = 300,
                left = screen.width / 2 - width / 2,
                top = screen.height / 3 - height / 2,
                url = "http://www.facebook.com/sharer.php?s=100&p[title]=" + encodeURIComponent("Hover!") + "&p[summary]=" + encodeURIComponent(message) + "&p[url]=" + encodeURIComponent(this.shareUrl);
            window.open(url, "facebook", "height=" + height + ",width=" + width + ",left=" + left + ",top=" + top + ",resizable=1");
        }
    };
})(jQuery, Hover);

// Feature detection: decides between the full 3D game and the "upgrade your browser" page.
(function ($, Hover) {
    /** True if a WebGL context can actually be created. */
    function canCreateWebGLContext() {
        var supported = false;
        try {
            var canvas = document.createElement("canvas");
            supported = !(!window.WebGLRenderingContext || !canvas.getContext("experimental-webgl") && !canvas.getContext("webgl"));
            canvas = undefined;
        } catch (e) {
            supported = false;
        }
        return supported;
    }

    Modernizr.Detectizr.detect({
        addAllFeaturesAsClass: true,
        detectDevice: true,
        detectOS: true,
        detectBrowser: true,
        detectScreen: false,
        detectPlugins: false
    });
    Hover.supports3d = Modernizr.webgl && canCreateWebGLContext();
    var supportsTransforms3d = Modernizr.csstransforms3d || "PointerEvent" in window,
        meetsRequirements = Modernizr.canvas && Modernizr.audio && Modernizr.video && Modernizr.csstransforms && supportsTransforms3d && Hover.supports3d,
        pageUrl = $.url(),
        forceFull = undefined !== pageUrl.param("full");
    // Query flags: ?full forces the game even on unsupported browsers, ?stats, ?nopreload.
    Hover.upgrade = !meetsRequirements && !forceFull;
    Hover.showStats = undefined !== pageUrl.param("stats");
    Hover.nopreload = undefined !== pageUrl.param("nopreload");
    Hover.use3d = Hover.supports3d && !Hover.upgrade;
    Hover.arm = "arm" === window.navigator.cpuClass;
    if (Hover.arm) {
        $("html").addClass("arm");
    }
    if (navigator.msMaxTouchPoints) {
        $("body").addClass("touch");
    }
})(jQuery, Hover);
