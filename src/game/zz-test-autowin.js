// Test helper, NOT loaded by index.html (add a <script> tag for it after 22-classic-menu.js to use it).
// With ?autowin in the address it wins each classic level a few seconds after it starts (by taking the
// blue flags inside a physics step, as a real win does) and presses "Next Level", showing the level in
// the page title; ?layoutdebug shows where the classic window, desktop and loading panel are. It was
// used to check level-to-level switching; it can be deleted.
(function ($, Hover) {
    if (/[?&]layoutdebug\b/.test(window.location.search)) {
        setInterval(function () {
            var d = $("#retroDesktop")[0];
            var dr = d ? d.getBoundingClientRect() : {};
            var h = $("#retroDesktop #header")[0];
            var hr = h ? h.getBoundingClientRect() : {};
            document.title = "body=" + document.body.className + " desk(" + (d && d.parentNode.id) + " " +
                Math.round(dr.width) + "x" + Math.round(dr.height) + " z=" + (d && getComputedStyle(d).zIndex) +
                " disp=" + (d && getComputedStyle(d).display) + ") hdr(" + Math.round(hr.left) + "," + Math.round(hr.top) + " " +
                Math.round(hr.width) + "x" + Math.round(hr.height) + ") | " + $("#main > #gameView").map(function () {
                var c = $(this).find("#gameContainer")[0];
                if (!c) {
                    return "nocontainer";
                }
                var r = c.getBoundingClientRect();
                var l = $(this).find("#gameLoading")[0];
                var lr = l ? l.getBoundingClientRect() : {};
                return "view(" + this.offsetWidth + "x" + this.offsetHeight + " disp=" + this.style.display +
                    " op=" + this.style.opacity + ") cont(" + Math.round(r.left) + "," + Math.round(r.top) + " " +
                    Math.round(r.width) + "x" + Math.round(r.height) + " par=" + (c.offsetParent && (c.offsetParent.id || c.offsetParent.tagName)) +
                    " inl=" + c.style.left + "/" + c.style.transform + ") load(" + (l && l.parentNode.id) + " " +
                    Math.round(lr.left) + "," + Math.round(lr.top) + ")";
            }).get().join(" | ");
        }, 300);
    }
    if (!/[?&]autowin\b/.test(window.location.search)) {
        return;
    }
    setInterval(function () {
        var view = Hover.router && Hover.router.currentView;
        if (view && view.id === "gameView") {
            document.title = "L" + (view.options.level || 1) + " M" + view.options.mazeId +
                (view.$el.hasClass("ready") ? " ready" : " loading") + (view.playing ? " playing" : "") +
                " views:" + $("#main > #gameView").length;
        }
        if ($(".msgButton:visible").length) {
            $(".msgButton:visible").first().click();
            return;
        }
        if (!view || view.id !== "gameView" || !view.playing || !view.game || !view.game.world || view.autowinArmed) {
            return;
        }
        view.autowinArmed = true;
        setTimeout(function () {
            var game = view.game;
            var original = game.updatePhysics;
            game.updatePhysics = function () {
                original.apply(this, arguments);
                game.updatePhysics = original;
                _.each(game.world.flags, function (flag) {
                    if (flag.team === "blue") {
                        flag.capture(game.craft);
                    }
                });
            };
        }, 4000);
    }, 1000);
})(jQuery, Hover);
