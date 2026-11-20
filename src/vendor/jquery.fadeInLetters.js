/*!
 * jQuery fadeInLetters -- Hover! build
 *
 * Hand de-minified from the last module of the game's library bundle
 * (cdn/scripts/game-libs.922bbe8e.js). There is no published source for this exact file: it is
 * a lightly modified copy of "Shuffle Letters" 1.0 by Martin Angelov (MIT License,
 * http://tutorialzine.com/2011/09/shuffle-letters-effect-jquery/). Differences from that original:
 *   - the plugin is called $.fn.fadeInLetters instead of $.fn.shuffleLetters;
 *   - default options are step 4 / fps 40 (original: 8 / 25);
 *   - after the "already animating" check, the shipped code no longer uses its local jQuery
 *     object but a free variable named `el` (see the note below). Kept exactly as shipped.
 *
 * Effect: the element's text (or options.text) is revealed left to right; a window of
 * options.step random characters (same class -- lower case, upper case or symbol -- as the
 * character they stand for) runs ahead of the revealed text. Spaces stay spaces.
 *
 * Usage: $(selector).fadeInLetters({ step: 4, fps: 40, text: "", callback: function ($el) {} });
 */
(function ($) {

    /**
     * A random character of the given class: "lowerLetter" -> a-z0-9, "upperLetter" -> A-Z0-9,
     * "symbol" -> punctuation. (Any other type gives an empty pool, i.e. undefined.)
     */
    function randomChar(type) {
        var pool = "";

        if (type == "lowerLetter") {
            pool = "abcdefghijklmnopqrstuvwxyz0123456789";
        } else if (type == "upperLetter") {
            pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        } else if (type == "symbol") {
            pool = ",.?/\\(^)![]{}*&^%$#'\"";
        }

        var chars = pool.split("");
        return chars[Math.floor(Math.random() * chars.length)];
    }

    $.fn.fadeInLetters = function (prop) {
        var options = $.extend({
            step: 4,                    // how many random characters run ahead of the text
            fps: 40,                    // frames per second
            text: "",                   // use this text instead of the element's contents
            callback: function () {}    // called (with `el`) when the animation is complete
        }, prop);

        return this.each(function () {
            var $element = $(this);
            var str = "";

            // Prevent parallel animations on the same element.
            if ($element.data("animated")) {
                return true;
            }

            // NOTE: from here on the shipped code refers to `el`, which is NOT declared anywhere in
            // the bundle (the original plugin had `var el = $(this)`). At run time it resolves to a
            // global `el` (or throws a ReferenceError if there is none). The game itself never calls
            // fadeInLetters, so this is preserved verbatim rather than "fixed".
            el.data("animated", true);

            if (options.text) {
                str = options.text.split("");
            } else {
                str = el.text().split("");
            }

            // types[i]: the class of each character; letters: positions of the non-space characters.
            var types = [];
            var letters = [];

            for (var i = 0; i < str.length; i++) {
                var ch = str[i];

                if (ch != " ") {
                    if (/[a-z]/.test(ch)) {
                        types[i] = "lowerLetter";
                    } else if (/[A-Z]/.test(ch)) {
                        types[i] = "upperLetter";
                    } else {
                        types[i] = "symbol";
                    }
                    letters.push(i);
                } else {
                    types[i] = "space";
                }
            }

            el.html("");

            // One animation frame; re-schedules itself until every character is revealed.
            (function shuffle(start) {
                var i;
                var len = letters.length;
                var strCopy = str.slice(0);

                if (start > len) {
                    // Done: clear the flag and run the callback.
                    el.data("animated", false);
                    options.callback(el);
                    return;
                }

                for (i = Math.max(start, 0); i < len; i++) {
                    if (i < start + options.step) {
                        strCopy[letters[i]] = randomChar(types[letters[i]]);
                    } else {
                        strCopy[letters[i]] = "";
                    }
                }

                el.text(strCopy.join(""));

                setTimeout(function () {
                    shuffle(start + 1);
                }, 1000 / options.fps);
            })(-options.step);
        });
    };

})(jQuery);
