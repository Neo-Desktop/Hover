/*
 * Hover! embed loader (added in this edition).
 *
 * Puts the game on another website. Include this script from wherever the game is hosted, then
 * mark the places it should appear:
 *
 *   <script src="https://your-hover-host/embed/hover-embed.js" async></script>
 *   <div data-hover-game data-mode="classic" data-difficulty="expert"></div>
 *
 * or call it from your own code:
 *
 *   HoverGame.embed(document.getElementById("game"), { mode: "classic", difficulty: "expert" });
 *
 * Options (as data-* attributes or in the options object):
 *   mode        "classic" (Windows 95 look), "modern" (the 2013 3D look, starts at its title
 *               screen), "multiplayer", or "classic-multiplayer". Default "modern".
 *   difficulty  classic only: "beginner" (default), "intermediate" or "expert".
 *   width       any CSS width for the frame (default "100%"); the height follows the game's shape.
 *   host        where the game is served (default: the folder above this script).
 *
 * The game runs in a frame from its own host (it needs that host's files, and its server for
 * multiplayer), so it can't clash with the page's own scripts or styles. Click the game once to
 * give it the keyboard. HoverGame.embed returns the frame element.
 */
(function (window, document) {
    "use strict";

    if (window.HoverGame && window.HoverGame.embed) {
        return;
    }

    // The game's shape in each look (its window size), so the frame fits it without bars.
    var ASPECT = {
        classic: 808 / 652,
        modern: 1220 / 774
    };

    var scriptUrl = (document.currentScript && document.currentScript.src) || "";
    var defaultHost = scriptUrl ? new URL("..", scriptUrl).href : "";

    function routeFor(mode, difficulty) {
        switch (mode) {
            case "classic":
                // A named difficulty (beginner too) is used as given; without one, the game uses the
                // difficulty the player chose last time.
                return difficulty ? "retro/" + difficulty : "retro";
            case "classic-multiplayer":
                return "classic-multiplayer";
            case "multiplayer":
                return "multiplayer";
            default:
                return "";
        }
    }

    function embed(target, options) {
        if (typeof target === "string") {
            target = document.querySelector(target);
        }
        if (!target) {
            throw new Error("HoverGame.embed: no element to put the game in");
        }
        options = options || {};
        var mode = (options.mode || "modern").toLowerCase();
        var difficulty = (options.difficulty || "").toLowerCase();
        var host = options.host || defaultHost;
        if (host && host.charAt(host.length - 1) !== "/") {
            host += "/";
        }
        var isClassic = mode.indexOf("classic") === 0;

        var frame = document.createElement("iframe");
        frame.src = host + "index.html?embed=1#" + routeFor(mode, difficulty);
        frame.title = "Hover!";
        frame.setAttribute("allow", "fullscreen; autoplay; gamepad");
        frame.setAttribute("allowfullscreen", "");
        frame.style.display = "block";
        frame.style.border = "0";
        frame.style.width = options.width || "100%";
        frame.style.aspectRatio = String(isClassic ? ASPECT.classic : ASPECT.modern);
        frame.style.background = isClassic ? "#117f80" : "#0e0617";

        // Give the game the keyboard as soon as the pointer goes down on it.
        frame.addEventListener("pointerdown", function () {
            frame.focus();
        });

        target.innerHTML = "";
        target.appendChild(frame);
        return frame;
    }

    function embedAll() {
        var places = document.querySelectorAll("[data-hover-game]");
        for (var i = 0; i < places.length; i++) {
            var place = places[i];
            if (place.getAttribute("data-hover-embedded")) {
                continue;
            }
            place.setAttribute("data-hover-embedded", "1");
            embed(place, {
                mode: place.getAttribute("data-mode"),
                difficulty: place.getAttribute("data-difficulty"),
                width: place.getAttribute("data-width"),
                host: place.getAttribute("data-host")
            });
        }
    }

    window.HoverGame = {
        embed: embed,
        embedAll: embedAll
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", embedAll);
    } else {
        embedAll();
    }
})(window, document);
