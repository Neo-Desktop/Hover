// Added in this edition (not in the 2013 remake).
//
// The 1995 game's start-up room, its "main menu level". Behind the menus at start-up the 1995 game
// shows a small room (MAZES\SMALL.MAZ with SMALL.TEX: a neon wall, a checkered floor and framed
// photos of the team), frozen, with no robots, flags or pods and no music. Typing the hidden code
// "ibmab" there ("bambi" backwards, entered in 1995 as Ctrl+I Ctrl+B Ctrl+M Ctrl+A Ctrl+B; HOVER.EXE
// 0x429380) lets you drive around the room, and its song (MUSIC3) starts. Game > Start Game (F2)
// leaves it for level 1.
//
// The room itself was converted from the 1995 files into scripts/small-maze.js (window.HoverSmallMaze)
// with its pictures in Images/Schemes/SMALL/Retro/. Classic mode (#retro) opens on it
// (Router.retro in 20-app.js); SinglePlayerGame keeps it still until Game.unlockDemo.

(function ($, Hover) {
    var room = window.HoverSmallMaze;
    if (!room) {
        return;
    }
    Hover.mainMenuMazeId = room.MazeId;
    Hover.json.mazes[room.MazeId] = room;
    Hover.json.schemes[room.Scheme] = room.SchemeData;

    // The code, letter by letter. Both the 1995 way (with Ctrl held) and plain letters count.
    var CODE = "ibmab";
    var typed = 0;

    $(document).on("keydown", function (event) {
        var view = Hover.router && Hover.router.currentView;
        var game = view && view.options && view.options.mainMenu && view.game;
        if (!game || !game.demoLocked || $(event.target).is("input[type=text], input[type=number], textarea")) {
            typed = 0;
            return;
        }
        var key = (event.key || String.fromCharCode(event.which || 0)).toLowerCase();
        if (key.length !== 1 || event.altKey || event.metaKey) {
            return;
        }
        if (key === CODE.charAt(typed)) {
            typed++;
        } else {
            typed = key === CODE.charAt(0) ? 1 : 0;
        }
        if (event.ctrlKey) {
            event.preventDefault(); // Ctrl+B, Ctrl+I and Ctrl+A would otherwise reach the browser
        }
        if (typed === CODE.length) {
            typed = 0;
            game.unlockDemo();
            view.$("#classicStartNote").remove(); // "Press F2 to start a game of Hover!"
        }
    });
})(jQuery, Hover);
