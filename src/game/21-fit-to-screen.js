// Added in this edition (not in the original game).
//
// Scales the game window to fill the browser window. The original drew the game at a fixed size
// (the modern dashboard frame is 1220 x 774 px, the classic Windows 95 window 808 x 652 px) and only
// ever shrank it on small screens, using fixed steps in css/game.css; on large screens it stayed
// small in the middle. This scales it up or down to the largest size that fits, keeping its shape.
//
// The 3D view keeps drawing at its original resolution and is enlarged by the browser, so on very
// large screens it looks a little soft, like the original did when shrunk.

(function ($, Hover) {
    // The game window's own size in each look (the #gameContainer boxes in css/game.css).
    var SIZES = {
        modern: { width: 1220, height: 774 },
        retro: { width: 808, height: 652 }
    };
    // Embedded on another site (embed/hover-embed.js adds ?embed=1): the frame already has the
    // game's shape, so fill it exactly and drop the page footer (css/classic-menu.css).
    var EMBEDDED = /[?&]embed=1\b/.test(window.location.search);
    if (EMBEDDED) {
        document.documentElement.className += " hover-embedded";
    }
    // Leave a little room around the window, except when embedded.
    var FILL = EMBEDDED ? 1 : 0.98;

    /**
     * Fits one game view, or every game view on the page when none is given (while one level
     * replaces another, the old and new views are both on the page for a moment).
     */
    function fitGameToWindow($view) {
        if (!$view) {
            $("#main").children("#gameView").each(function () {
                fitGameToWindow($(this));
            });
            return;
        }
        var $container = $view.find("#gameContainer");
        if (!$container.length) {
            return;
        }
        var isRetro = $view.hasClass("retro");
        var size = isRetro ? SIZES.retro : SIZES.modern;
        var scale = FILL * Math.min(window.innerWidth / size.width, window.innerHeight / size.height);
        var transform = "scale(" + scale + ")";

        $container.css({
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: -size.width / 2 + "px",
            marginTop: -size.height / 2 + "px",
            webkitTransformOrigin: "50% 50%",
            transformOrigin: "50% 50%",
            webkitTransform: transform,
            transform: transform
        });

        if (isRetro) {
            // The classic look puts a Windows 95 "desktop" behind the game window. It lives inside the
            // game window's markup but is meant to cover the whole screen; a scaled parent would shrink
            // it into the window, so it is moved next to the window instead (the game finds elements
            // anywhere inside #gameView, so nothing else changes).
            var $desktop = $container.find("#retroDesktop");
            if ($desktop.length) {
                $desktop.prependTo($view);
            }
            // The "Mute" switch sits in the window's menu bar. The original placed it relative to the
            // screen centre, which only lines up with an unscaled window, and as part of the desktop it
            // would now be hidden behind the window. Put it inside the window instead, so it scales
            // and stays on top: at the right end of the menu bar, since the menus (22-classic-menu.js)
            // now take the left end where the original had it.
            // While a level loads, the original hid the whole classic window and showed a lone
            // hourglass on the desktop. Keep the window on screen and show the loading panel inside
            // it instead (styled in css/classic-menu.css).
            var $loading = $view.find("#gameLoading");
            if ($loading.length && !$loading.parent().is($container)) {
                $loading.appendTo($container);
            }
            var $sound = $view.find("#sound");
            if ($sound.length && !$sound.parent().is($container)) {
                $sound.appendTo($container);
            }
            $sound.css({
                position: "absolute",
                left: "auto",
                right: "10px",
                top: "28px",
                margin: 0,
                zIndex: 20
            });
        }
    }

    // Re-fit when the window changes size and whenever views are swapped in (the game view is
    // created and filled in after the page loads).
    var pending = false;

    function scheduleFit() {
        if (pending) {
            return;
        }
        pending = true;
        window.requestAnimationFrame(function () {
            pending = false;
            fitGameToWindow();
        });
    }

    $(window).on("resize", scheduleFit);
    $(function () {
        var main = document.getElementById("main");
        if (main && window.MutationObserver) {
            // Only direct children: views are swapped in as children of #main (watching the whole
            // tree would fire every frame as the dashboard numbers change).
            new MutationObserver(scheduleFit).observe(main, { childList: true });
        }
        scheduleFit();
    });

    Hover.fitGameToWindow = fitGameToWindow;
})(jQuery, Hover);
