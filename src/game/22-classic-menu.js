// Added in this edition (not in the 2013 remake).
//
// The Windows 95 menu bar, dialog boxes and message boxes of classic mode. The 2013 remake drew an
// empty menu bar in its classic window, with only a "Mute" switch, and showed wins and losses as
// pictures. This puts back the 1995 game's own menus and dialogs, as stored in the resources of the
// original HOVER.EXE (menu 128; dialogs 100 About, 101 Customize Game, 106 Start At, 109 Sound
// Options, 113 Player Controls, 115 Quick Help; string table texts), wired to what this game can do:
//
//   Game:    Start Game (F2), Start At... (choose a level), Pause (F3), High Scores..., Exit
//   Options: Sounds..., Player Controls... (F8), Customize Game... (F9), Full Screen (F4)
//   Help:    Help Topics..., How To Play..., Quick Help..., About Hover!...
//
// Settings the 1995 game had but this one can't use (Speed & Detail, map rotation,
// joystick calibration) are shown greyed out. In a multiplayer game the items that would restart or
// pause it are greyed out too. Every dialog and message box can be dragged by its title bar.
// Styles are in css/classic-menu.css.

(function ($, Hover) {
    /** The three mazes, in the 1995 order. */
    var MAZES = [
        { id: 44, name: "Maze 1" },
        { id: 46, name: "Maze 2" },
        { id: 47, name: "Maze 3" }
    ];

    /** The 1995 "Vehicle Controls" choices, with the address names used by #retro/<key>. */
    var DIFFICULTIES = [
        { key: "beginner", name: "Easy" },
        { key: "intermediate", name: "Intermediate" },
        { key: "expert", name: "Difficult" }
    ];

    /** Menu titles and items. `&` marks the underlined letter, as in a Windows menu resource. */
    var MENUS = [
        {
            title: "&Game",
            items: [
                { label: "&Start Game", shortcut: "F2", action: "startGame", singlePlayerOnly: true },
                { label: "S&tart At...", action: "startAt", singlePlayerOnly: true },
                { label: "&Pause", shortcut: "F3", action: "pause", singlePlayerOnly: true },
                null,
                { label: "&High Scores...", action: "highScores" },
                null,
                { label: "E&xit", action: "exit" }
            ]
        },
        {
            title: "&Options",
            items: [
                { label: "&Sounds...", action: "sounds" },
                { label: "&Player Controls...", shortcut: "F8", action: "controls" },
                { label: "&Customize Game...", shortcut: "F9", action: "customize", singlePlayerOnly: true },
                null,
                { label: "&Full Screen", shortcut: "F4", action: "fullScreen" }
            ]
        },
        {
            title: "&Help",
            items: [
                { label: "&Help Topics...", action: "howToPlay" },
                { label: "How To &Play...", action: "howToPlay" },
                null,
                { label: "&Quick Help...", action: "quickHelp" },
                null,
                { label: "&About Hover!...", action: "about" }
            ]
        }
    ];

    var SHORTCUT_KEYS = {
        113: "startGame",  // F2
        114: "pause",      // F3
        115: "fullScreen", // F4
        119: "controls",   // F8
        120: "customize"   // F9
    };

    // --- Settings kept between visits (the 1995 game kept them in the registry) ----------------

    var settings = (function () {
        var defaults = { mazeType: "sequential", music: true, gameSounds: true, engine: true, showRearView: true };
        var stored = {};
        try {
            stored = JSON.parse(window.localStorage.getItem("hoverClassicSettings") || "{}") || {};
        } catch (error) {
            stored = {};
        }
        var values = _.extend({}, defaults, stored);
        return {
            get: function (name) {
                return values[name];
            },
            set: function (name, value) {
                values[name] = value;
                try {
                    window.localStorage.setItem("hoverClassicSettings", JSON.stringify(values));
                } catch (error) {
                    // Private browsing: keep the setting for this visit only.
                }
            }
        };
    })();

    /**
     * The maze after `mazeId`: the next one in order (Maze Type "Sequential", the 1995 default) or a
     * random one ("Random"). Used by GameView when a classic level is won.
     */
    Hover.classicNextMaze = function (mazeId, mazeIds) {
        if (settings.get("mazeType") === "random") {
            return mazeIds[Math.floor(Math.random() * mazeIds.length)];
        }
        var index = _.indexOf(mazeIds, mazeId);
        return mazeIds[(index + 1) % mazeIds.length];
    };

    // --- The score (1995 rules, read from HOVER.EXE) ------------------------------------------
    //
    // Points per level and difficulty, as HOVER.EXE works them out at start-up (0x41c2b3): each
    // captured flag is worth 1,000 + 500 per level after the first, each of your own flags still
    // standing when the level is won 2.5 times that, and the level bonus (paid once, for the level a
    // Start At game began on) is the sum of a whole level's flags for every level after the first.
    // Easy is 9/10 and Difficult 11/10 of these. From level 16 on the values stay at level 16's.
    // Rows: [captured E, I, D, remaining E, I, D, level bonus E, I, D].
    var CLASSIC_SCORE = [[900, 1000, 1100, 2250, 2500, 2750, 0, 0, 0], [1350, 1500, 1650, 3375, 3750, 4125, 4050, 4500, 4950],
        [1800, 2000, 2200, 4500, 5000, 5500, 9450, 10500, 11550], [2250, 2500, 2750, 5625, 6250, 6875, 18450, 20500, 22550],
        [2700, 3000, 3300, 6750, 7500, 8250, 29250, 32500, 35750], [3150, 3500, 3850, 7875, 8750, 9625, 45000, 50000, 55000],
        [3600, 4000, 4400, 9000, 10000, 11000, 63000, 70000, 77000], [4050, 4500, 4950, 10125, 11250, 12375, 87300, 97000, 106700],
        [4500, 5000, 5500, 11250, 12500, 13750, 114300, 127000, 139700], [4950, 5500, 6050, 12375, 13750, 15125, 144000, 160000, 176000],
        [5400, 6000, 6600, 13500, 15000, 16500, 176400, 196000, 215600], [5850, 6500, 7150, 14625, 16250, 17875, 211500, 235000, 258500],
        [6300, 7000, 7700, 15750, 17500, 19250, 249300, 277000, 304700], [6750, 7500, 8250, 16875, 18750, 20625, 289800, 322000, 354200],
        [7200, 8000, 8800, 18000, 20000, 22000, 333000, 370000, 407000], [7650, 8500, 9350, 19125, 21250, 23375, 378900, 421000, 463100]];

    /** The points of `level` (1-based) at difficulty 0 (Easy), 1 (Intermediate) or 2 (Difficult). */
    function scoreRow(level, difficulty) {
        var row = CLASSIC_SCORE[Math.min(15, Math.max(0, level - 1))];
        return { perCapturedFlag: row[difficulty], perRemainingFlag: row[3 + difficulty], levelBonus: row[6 + difficulty] };
    }

    /** Whether the start-up Quick Help has been shown on this visit. */
    var quickHelpShown = false;

    /** The game's score; like the 1995 game's it carries on from level to level. */
    var score = { value: 0, bonusPending: false };

    // --- High scores on the server (server/highscores.go) ---------------------------------------
    //
    // When the game runs on its own server, the high scores are kept there. The server never takes a
    // score from the browser: it decides where each level's flags go, is told what happens (a flag
    // taken, a level won) and works the score out itself, refusing anything a real game couldn't do.
    // Without the server (the files hosted elsewhere) the scores are kept in this browser instead.
    var ranked = {
        available: null, // null: not asked yet; true or false once the server has answered
        session: null,   // this game's id on the server (null: the game isn't being checked)
        seq: 0,
        plan: null       // the server's flags for the next level to load: { mazeId, red, blue }
    };

    function classicApi(action, body, done, fail) {
        $.ajax({
            type: body ? "POST" : "GET",
            url: "/api/classic/" + action,
            data: body ? JSON.stringify(body) : undefined,
            contentType: "application/json",
            dataType: "json",
            cache: false,
            timeout: 8000,
            success: function (reply) {
                ranked.available = true;
                if (done) {
                    done(reply);
                }
            },
            error: function (xhr) {
                if (xhr.status === 0 || xhr.status === 404 || xhr.status === 405) {
                    ranked.available = false;
                }
                if (fail) {
                    fail(xhr);
                }
            }
        });
    }

    /** Keeps the flag positions the server sent for the level in `mazeId`. */
    function receivePlan(mazeId) {
        return function (reply) {
            if (reply && reply.red && reply.blue) {
                ranked.plan = { mazeId: mazeId, red: reply.red, blue: reply.blue };
            }
        };
    }

    /**
     * This browser's player: the id the server issued (a signed UUID) and the name last typed for
     * the high scores, kept in local storage. The id goes with each new game, so the server records
     * whose games and high scores they are; the name fills in the Enter High Score box.
     */
    var player = (function () {
        var stored = {};
        try {
            stored = JSON.parse(window.localStorage.getItem("hoverClassicPlayer") || "{}") || {};
        } catch (error) {
            stored = {};
        }
        return {
            id: typeof stored.id === "string" ? stored.id : "",
            name: typeof stored.name === "string" ? stored.name : "",
            // The score of this browser's last finished game, and its best (shown on High Scores).
            lastScore: stored.lastScore > 0 ? stored.lastScore : 0,
            bestScore: stored.bestScore > 0 ? stored.bestScore : 0,
            // This browser's finished games, newest first: { score, level, difficulty, at } (the
            // "Your Scores" page of High Scores). The last 100 are kept.
            history: _.isArray(stored.history) ? stored.history : [],
            confirmed: false, // the server has seen the id since the page loaded
            save: function () {
                try {
                    window.localStorage.setItem("hoverClassicPlayer", JSON.stringify({
                        id: this.id,
                        name: this.name,
                        lastScore: this.lastScore,
                        bestScore: this.bestScore,
                        history: this.history
                    }));
                } catch (error) {
                    // Private browsing: kept for this visit only.
                }
            }
        };
    })();

    /** Makes sure this browser has a player id from the server (asking for one the first time). */
    function ensurePlayer(done) {
        if (player.confirmed || ranked.available === false) {
            done();
            return;
        }
        classicApi("player", { player: player.id }, function (reply) {
            if (reply && reply.player) {
                player.id = reply.player;
                player.confirmed = true;
                if (!player.name && reply.number) {
                    // A new player's default name: "Player #<number>", e.g. "Player #12" for the
                    // twelfth player this server has seen.
                    player.name = "Player #" + reply.number;
                }
                player.save();
            }
            done();
        }, done);
    }

    function rankedNewGame(level, difficulty, startAt, mazeId) {
        ranked.session = null;
        ranked.plan = null;
        ranked.seq = 0;
        ranked.queue = $.Deferred().resolve().promise();
        if (ranked.available === false) {
            return;
        }
        var game = ranked.game = {};
        ensurePlayer(function () {
            if (ranked.game !== game || !player.id) {
                return; // another game has started meanwhile, or there's no server
            }
            classicApi("session", { player: player.id, level: level, difficulty: difficulty, startAt: !!startAt, mazeId: mazeId },
                function (reply) {
                    if (ranked.game === game) {
                        ranked.session = reply.session;
                        receivePlan(mazeId)(reply);
                    }
                });
        });
    }

    /** Reports one event of this game; a refusal means the game can't enter the server's table. */
    function rankedEvent(action, details, done) {
        if (!ranked.session) {
            return;
        }
        ranked.seq++;
        var session = ranked.session,
            body = _.extend({ session: session, seq: ranked.seq }, details);
        // One at a time, in order: the server refuses reports that arrive out of turn.
        ranked.queue = (ranked.queue || $.Deferred().resolve().promise()).then(function () {
            var finished = $.Deferred();
            if (ranked.session !== session) {
                return finished.resolve().promise();
            }
            classicApi(action, body, function (reply) {
                if (done) {
                    done(reply);
                }
                finished.resolve();
            }, function () {
                if (ranked.session === session) {
                    ranked.session = null;
                }
                finished.resolve();
            });
            return finished.promise();
        });
    }

    /**
     * The server's flag positions for a classic level about to be set up in `mazeId`
     * (SinglePlayerGame.spawnClassicLevel), or null to place them as usual. A level set up without
     * them can't be checked, so the game stops being reported.
     */
    Hover.classicFlagPlan = function (mazeId) {
        var plan = ranked.plan;
        ranked.plan = null;
        if (plan && plan.mazeId === mazeId && ranked.session) {
            return plan;
        }
        ranked.session = null;
        return null;
    };

    /** The next classic level is starting in `mazeId` (GameView.onGameWon). */
    Hover.classicLevelStarting = function (mazeId) {
        rankedEvent("level", { mazeId: mazeId }, receivePlan(mazeId));
    };

    function difficultyIndex(profile) {
        return _.indexOf(_.pluck(DIFFICULTIES, "key"), difficultyOf(profile || Profiles.Classic).key);
    }

    /** 24570 -> "24,570" */
    function formatNumber(number) {
        return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /** The 15 high scores (kept in the browser; the 1995 game kept them in the registry). */
    function highScoreTable() {
        var table = null;
        try {
            table = JSON.parse(window.localStorage.getItem("hoverClassicHighScores"));
        } catch (error) {
            table = null;
        }
        if (!_.isArray(table) || table.length !== 15) {
            // The 1995 defaults: these names with 24,570 down to 1,638, shuffled among them.
            var names = ["Greg", "John", "Josh", "Steve", "Larry", "Jo", "Jon", "Patrick", "Julie", "Tony", "Charles",
                "Joy", "Jennifer", "Harley", "Kevin"];
            var scores = _.shuffle(_.map(_.range(15), function (i) {
                return 24570 - 1638 * i;
            }));
            table = _.sortBy(_.map(names, function (name, i) {
                return { name: name, score: scores[i] };
            }), function (entry) {
                return -entry.score;
            });
            saveHighScores(table);
        }
        return table;
    }

    function saveHighScores(table) {
        try {
            window.localStorage.setItem("hoverClassicHighScores", JSON.stringify(table));
        } catch (error) {
            // Private browsing: keep them for this visit only.
        }
    }

    /** Shows the score in the top-right box of the dashboard: seven green LED digits, as in 1995. */
    function showScore() {
        var view = currentClassicGameView();
        if (!view || isMultiplayer(view)) {
            return;
        }
        var $box = view.$("#classicScore");
        if (!$box.length) {
            $box = $('<div id="classicScore"></div>');
            for (var i = 0; i < 7; i++) {
                $box.append('<span class="classicScoreDigit"></span>');
            }
            view.$("#dash_top").append($box);
        }
        var digits = ("0000000" + (score.value % 10000000)).slice(-7);
        $box.children().each(function (i) {
            $(this).css("background-position", (parseInt(digits.charAt(i), 10) * 100 / 9) + "% 0");
        });
    }

    function playingClassicSinglePlayer() {
        var view = currentClassicGameView();
        return view && !isMultiplayer(view) && !view.options.mainMenu ? view : null;
    }

    /** The player took one of the robots' flags (Flag.capture). */
    Hover.classicFlagCaptured = function (flag) {
        var view = playingClassicSinglePlayer();
        if (view) {
            score.value += scoreRow(view.options.level || 1, difficultyIndex(view.options.craftProfile)).perCapturedFlag;
            showScore();
            var index = flag ? _.indexOf(view.game.world.getFlagLocations(), flag.initialArgs.location) : -1;
            rankedEvent("capture", { flag: index });
        }
    };

    /**
     * A classic level is won (GameView.onGameWon): add the points for the player's flags still
     * standing and any level bonus, then show the 1995 "Bonus Score" box; OK starts the next level.
     */
    Hover.classicLevelWon = function (view, nextLevel, startNextLevel) {
        var row = scoreRow(view.options.level || 1, difficultyIndex(view.options.craftProfile));
        var world = view.game.world;
        var ownFlags = _.filter(world.flags, function (flag) {
            return flag.team == world.team;
        });
        var left = _.filter(ownFlags, function (flag) {
            return !flag.captured;
        }).length;
        var bonus = score.bonusPending ? row.levelBonus : 0;
        score.bonusPending = false;
        score.value += left * row.perRemainingFlag + bonus;
        showScore();
        rankedEvent("win", { flagsLeft: left });
        var lines = [
            left + (left === 1 ? " Flag left x " : " Flags left x ") + row.perRemainingFlag + " = " + left * row.perRemainingFlag,
            "Good Job! Starting level " + nextLevel + "!"
        ];
        if (bonus) {
            lines.push("Level bonus of " + bonus);
        }
        Hover.showClassicMessage(view, "Bonus Score", lines.join("\n\n"), "info", [
            { label: "OK", action: startNextLevel }
        ]);
    };

    /**
     * The robots took all the player's flags (GameView.onGameLost): as in 1995 the score goes to the
     * high scores, then "play again?"; Yes opens Start At.
     */
    Hover.classicDefeat = function (view) {
        var menu = attachMenu();
        if (!menu || menu.view !== view) {
            return false;
        }
        menu.checkHighScore(function () {
            score.value = 0;
            score.bonusPending = false;
            showScore();
            menu.message("Hover!", "You have been defeated!  The Drones have captured all of your flags.\n\n" +
                "Would you like to play again?", "question", [
                { label: "Yes", action: function () {
                    menu.openStartAt();
                } },
                { label: "No" }
            ]);
        });
        return true;
    };

    /** Whether Customize Game > Show Rear View is on (read every frame by Game.drawRearView). */
    Hover.classicRearView = function () {
        return settings.get("showRearView") !== false;
    };

    /** The maze a game started at `level` begins on. */
    function mazeForLevel(level) {
        if (settings.get("mazeType") === "random") {
            return MAZES[Math.floor(Math.random() * MAZES.length)].id;
        }
        return MAZES[(level - 1) % MAZES.length].id;
    }

    // The 1995 Sound Options: music, game sounds and engine can each be switched off. In classic mode
    // a switched-off group plays silently; the Mute switch still silences everything.
    (function filterClassicSounds() {
        var audio = Hover.audio;
        var getSound = audio.getSound;
        audio.getSound = function (name) {
            if (Hover.retro && !soundGroupEnabled(name)) {
                return this.nonsound;
            }
            return getSound.call(this, name);
        };
    })();

    // Recordings of the 1995 MIDI songs, each made with a different MIDI synthesizer (Options >
    // Sounds > Music Played On). Each set is a folder of sounds/Retro/music/ with MUSIC1-3.m4a and
    // .ogg; `available` sets have been recorded (see README, "Music recordings"). The 1995 game
    // played its music on whatever MIDI device Windows had, most often Microsoft's GS Wavetable
    // synthesizer, which is the default here. The Sound Blaster 16 and ESS AudioDrive played MIDI
    // on their FM synthesizer chips with Windows 95's FM instruments.
    var MUSIC_SETS = [
        { key: "windows", name: "Windows (Microsoft GS Wavetable)", folder: "windows/", available: true },
        { key: "soundblaster", name: "Sound Blaster 16 (FM)", folder: "soundblaster/", available: false },
        { key: "ess", name: "ESS AudioDrive (FM)", folder: "ess/", available: false },
        { key: "mt32", name: "Roland MT-32", folder: "mt32/", available: false },
        { key: "sc88", name: "Roland SC-88", folder: "sc88/", available: true },
        { key: "generaluser", name: "GeneralUser GS", folder: "", available: true }
    ];

    // Which sets have been recorded comes from sounds/Retro/music/sets.json (tools/render-music.sh
    // keeps it up to date), so adding a recording needs no code change. (In the release build it is
    // in the asset pack, src/pack.js, so it is read once the pack has arrived.)
    HoverPack.whenReady(function () {
        $.ajax({ url: "sounds/Retro/music/sets.json", dataType: "json", cache: false }).done(function (list) {
            if (list && _.isArray(list.recorded)) {
                _.each(MUSIC_SETS, function (set) {
                    set.available = _.contains(list.recorded, set.key);
                });
            }
        });
    });

    function musicSet() {
        var key = settings.get("musicSet");
        return _.find(MUSIC_SETS, function (set) {
            return set.key === key && set.available;
        }) || MUSIC_SETS[0];
    }

    /** The folder (under sounds/Retro/music/) of the chosen recording (GameView picks the song). */
    Hover.classicMusicFolder = function () {
        return musicSet().folder;
    };

    /** Whether the classic game on screen is playing (its music may sound). */
    function musicMayPlay() {
        var view = currentClassicGameView();
        return !!(view && view.game && view.playing && view.game.playedStart && !view.game.demoLocked);
    }

    /** Swaps the song that is loaded (and playing) for the same song from the chosen recording. */
    function switchMusicSet() {
        var audio = Hover.audio;
        if (!audio.retroMusic) {
            return;
        }
        audio.retroMusic = audio.retroMusic.replace(/^Retro\/music\/(?:[a-z0-9]+\/)?/, "Retro/music/" + musicSet().folder);
        audio.applyRetroMusic();
        if (settings.get("music") !== false && Hover.settings.getSoundEnabled() && musicMayPlay()) {
            audio.getSound("MUSIC").play();
        }
    }

    function soundGroupOf(name) {
        if (name === "MUSIC") {
            return "music";
        }
        if (/^ENG_/.test(name)) {
            return "engine";
        }
        return "gameSounds";
    }

    function soundGroupEnabled(name) {
        return settings.get(soundGroupOf(name)) !== false;
    }

    // --- Helpers ---------------------------------------------------------------------------------

    /** "&Game" -> "<u>G</u>ame" */
    function menuLabel(text) {
        return _.escape(text).replace(/&amp;(.)/, "<u>$1</u>");
    }

    /** The classic GameView currently on screen, or null. */
    function currentClassicGameView() {
        var view = Hover.router && Hover.router.currentView;
        if (view && view.id === "gameView" && view.$el.hasClass("retro")) {
            return view;
        }
        return null;
    }

    function isMultiplayer(view) {
        return !!view.options.gameId;
    }

    function difficultyOf(profile) {
        return _.find(DIFFICULTIES, function (difficulty) {
            return Profiles.classicFor(difficulty.key) === profile;
        }) || DIFFICULTIES[0];
    }

    /** A Windows 95 group box (the etched frame with a caption). */
    function groupBox(caption, $content) {
        return $('<fieldset class="classicGroup"></fieldset>')
            .append($("<legend></legend>").html(menuLabel(caption)))
            .append($content);
    }

    function radio(name, value, label, checked, disabled) {
        return $('<label class="classicRadio"></label>')
            .toggleClass("disabled", !!disabled)
            .append($('<input type="radio">').attr("name", name).val(value).prop("checked", !!checked).prop("disabled", !!disabled))
            .append($("<span></span>").html(" " + menuLabel(label)));
    }

    function checkbox(id, label, checked, disabled) {
        return $('<label class="classicCheckbox"></label>')
            .toggleClass("disabled", !!disabled)
            .append($('<input type="checkbox">').attr("id", id).prop("checked", !!checked).prop("disabled", !!disabled))
            .append($("<span></span>").html(" " + menuLabel(label)));
    }

    /**
     * Converts a rectangle [x, y, width, height] in Windows dialog units, as stored in HOVER.EXE's
     * dialog resources, to pixels. With MS Sans Serif 8 point a dialog unit is 1.5 pixels across and
     * 1.625 pixels down.
     */
    function dialogUnits(rect) {
        return {
            left: Math.round(rect[0] * 1.5),
            top: Math.round(rect[1] * 1.625),
            width: Math.round(rect[2] * 1.5),
            height: Math.round(rect[3] * 1.625)
        };
    }

    /**
     * Builds a dialog's contents where its 1995 resource puts them. `size` is the dialog's [width,
     * height] and each control is { type, rect, ... } with type:
     *   group    a group box with `label`
     *   static   text `text`, `align` left (default), right or center, optional `id`, `disabled`
     *   radio    `name`, `value`, `label`, `checked`, `disabled`
     *   check    `id`, `label`, `checked`, `disabled`
     *   trackbar a slider with `ticks` positions and the thumb at `value`, `disabled`
     *   edit     a text box with `id` and `value`
     *   updown   arrows that step the number in the edit box `target` between `min` and `max`
     * Buttons are given to dialog() with their own `rect`.
     */
    function resourceLayout(size, controls) {
        var $layout = $('<div class="classicLayout"></div>').css(dialogUnits([0, 0, size[0], size[1]]));
        _.each(controls, function (control) {
            var $control;
            switch (control.type) {
                case "group":
                    $control = $('<div class="classicGroupBox"></div>')
                        .append($('<span class="classicGroupLabel"></span>').html(menuLabel(control.label)));
                    break;
                case "static":
                    $control = $('<div class="classicStatic"></div>').text(control.text)
                        .css("text-align", control.align || "left")
                        .css("font-weight", control.bold ? "bold" : "normal")
                        .css("white-space", control.wrap ? "normal" : "nowrap"); // `wrap`: text over several lines
                    if (control.id) {
                        $control.attr("id", control.id);
                    }
                    break;
                case "radio":
                    $control = radio(control.name, control.value, control.label, control.checked, control.disabled);
                    break;
                case "check":
                    $control = checkbox(control.id, control.label, control.checked, control.disabled);
                    break;
                case "trackbar":
                    // A Windows trackbar with ticks on both sides: the thumb's centre runs from 8 pixels
                    // in from one end of the channel to 8 pixels in from the other.
                    var along = function (fraction) {
                        return "calc(8px + (100% - 16px) * " + fraction + ")";
                    };
                    $control = $('<div class="classicTrackbar"></div>').append('<div class="classicTrackChannel"></div>');
                    for (var tick = 0; tick < control.ticks; tick++) {
                        var at = along(tick / (control.ticks - 1));
                        $control.append($('<div class="classicTick top"></div>').css("left", at))
                            .append($('<div class="classicTick bottom"></div>').css("left", at));
                    }
                    $control.append($('<div class="classicThumb"></div>').css("left", along(control.value / (control.ticks - 1))));
                    break;
                case "edit":
                    $control = $('<input type="text" class="classicEdit">').attr("id", control.id).val(control.value);
                    break;
                case "select":
                    // A drop-down list: `options` are { value, label, disabled }, `value` the chosen one.
                    $control = $('<select class="classicSelect"></select>').attr("id", control.id);
                    _.each(control.options, function (option) {
                        $control.append($("<option></option>").val(option.value).text(option.label)
                            .prop("disabled", !!option.disabled));
                    });
                    $control.val(control.value);
                    break;
                case "updown":
                    $control = $('<div class="classicUpDown"></div>')
                        .append($('<div class="classicArrow up"></div>').attr("data-step", 1))
                        .append($('<div class="classicArrow down"></div>').attr("data-step", -1));
                    $control.on("click", ".classicArrow", function (event) {
                        var $target = $layout.find("#" + control.target);
                        var value = (parseInt($target.val(), 10) || control.min) + parseInt($(event.currentTarget).attr("data-step"), 10);
                        $target.val(Math.max(control.min, Math.min(control.max, value))).trigger("change");
                    });
                    break;
            }
            $control.addClass("placed").toggleClass("disabled", !!control.disabled).css(dialogUnits(control.rect));
            $layout.append($control);
        });
        return $layout;
    }

    // --- The menu bar ------------------------------------------------------------------------------

    function ClassicMenu(view) {
        this.view = view;
        this.$container = view.$("#gameContainer");
        this.openIndex = -1;
        this.build();
        if (view.options.mainMenu) {
            score.value = 0; // a fresh start in the start-up room
            score.bonusPending = false;
            ranked.session = null;
            // The 1995 start-up room's note in the middle of the play field (gone once "ibmab" lets
            // you drive: 23-main-menu-level.js).
            this.$container.append('<div id="classicStartNote">Press F2 to start<br>a game of Hover!</div>');
            // The 1995 game greets you with Quick Help ("...press F2"), unless you asked it not to.
            if (settings.get("skipQuickHelp") !== true && !quickHelpShown) {
                quickHelpShown = true; // once a visit, like the 1995 game's start-up
                this.quickHelp();
            }
        }
        showScore();
    }

    ClassicMenu.prototype.build = function () {
        var self = this;
        var $bar = $('<div id="classicMenuBar"></div>');
        _.each(MENUS, function (menu, index) {
            var $title = $('<div class="classicMenuTitle"></div>').html(menuLabel(menu.title));
            var $list = $('<div class="classicMenuList"></div>');
            _.each(menu.items, function (item) {
                if (!item) {
                    $list.append('<div class="classicMenuSeparator"></div>');
                    return;
                }
                var $item = $('<div class="classicMenuItem"></div>')
                    .append($('<span class="classicMenuLabel"></span>').html(menuLabel(item.label)))
                    .append($('<span class="classicMenuShortcut"></span>').text(item.shortcut || ""))
                    .attr("data-action", item.action);
                if (item.singlePlayerOnly && isMultiplayer(self.view)) {
                    $item.addClass("disabled");
                }
                $list.append($item);
            });
            var $menu = $('<div class="classicMenu"></div>').append($title, $list);
            $title.on("mousedown", function (event) {
                self.toggle(index);
                event.preventDefault();
                event.stopPropagation();
            }).on("mouseenter", function () {
                if (self.openIndex !== -1 && self.openIndex !== index) {
                    self.open(index);
                }
            });
            $list.on("mousedown", function (event) {
                event.stopPropagation();
            }).on("click", ".classicMenuItem", function (event) {
                var $item = $(event.currentTarget);
                self.close();
                if (!$item.hasClass("disabled")) {
                    self.run($item.attr("data-action"));
                }
            });
            $bar.append($menu);
        });
        this.$bar = $bar;
        this.$container.append($bar);

        this.onDocumentMouseDown = function () {
            self.close();
        };
        this.onKeyDown = function (event) {
            if (currentClassicGameView() !== self.view) {
                return;
            }
            if (event.which === 27) {
                self.close();
                if (self.$dialog && !self.$dialog.data("isMessage")) {
                    self.closeDialog();
                }
                return;
            }
            var action = SHORTCUT_KEYS[event.which];
            if (action) {
                event.preventDefault();
                if (!(isMultiplayer(self.view) && _.contains(["startGame", "pause", "customize"], action))) {
                    self.run(action);
                }
            }
        };
        $(document).on("mousedown", this.onDocumentMouseDown).on("keydown", this.onKeyDown);
    };

    ClassicMenu.prototype.destroy = function () {
        $(document).off("mousedown", this.onDocumentMouseDown).off("keydown", this.onKeyDown);
    };

    ClassicMenu.prototype.open = function (index) {
        this.openIndex = index;
        this.$bar.find('[data-action="pause"]').toggleClass("disabled", !this.canPause() && !this.view.classicPaused);
        this.$bar.children(".classicMenu").removeClass("open").eq(index).addClass("open");
    };

    /**
     * Whether a game is under way to pause. As in 1995, Pause is greyed out (and F3 does nothing)
     * before a game starts: in the start-up room until "ibmab", while a level loads, and after it
     * ends.
     */
    ClassicMenu.prototype.canPause = function () {
        var view = this.view,
            game = view.game;
        return !isMultiplayer(view) && !!game && view.playing && !game.stopped && !game.demoLocked;
    };

    ClassicMenu.prototype.close = function () {
        this.openIndex = -1;
        this.$bar.children(".classicMenu").removeClass("open");
    };

    ClassicMenu.prototype.toggle = function (index) {
        if (this.openIndex === index) {
            this.close();
        } else {
            this.open(index);
        }
    };

    ClassicMenu.prototype.run = function (action) {
        if (action === "pause" && !this.view.classicPaused && !this.canPause()) {
            return; // nothing to pause yet (F3 included)
        }
        if (this[action]) {
            this[action]();
        }
    };

    // --- Game ----------------------------------------------------------------------------------

    /**
     * Start classic single player again at `level` (default 1) with the given handling (default:
     * the current one). The maze follows the level and the Maze Type setting.
     */
    ClassicMenu.prototype.restart = function (level, craftProfile, sameGame) {
        var options = this.view.options;
        level = level || 1;
        craftProfile = craftProfile || options.craftProfile;
        var mazeId = mazeForLevel(level);
        // Tell the high-score server: a new game (from Start At when the level bonus is due), or the
        // same game going on with new handling (Customize Game).
        if (sameGame) {
            rankedEvent("restart", { difficulty: difficultyIndex(craftProfile), mazeId: mazeId }, receivePlan(mazeId));
        } else {
            rankedNewGame(level, difficultyIndex(craftProfile), score.bonusPending, mazeId);
        }
        this.prepareToLeave();
        // Stop this game before the new one loads: stopping clears the shared maze geometry, so doing
        // it afterwards (when the old view is removed) would wipe out the new game's walls and floors.
        this.view.stopGame();
        Hover.router.setCurrentView(new Hover.views.GameView({
            retro: true,
            mazeId: mazeId,
            level: level,
            craftProfile: craftProfile
        }));
    };

    /** Game > Start Game: a new game at level 1 (the score is checked for the high scores first). */
    ClassicMenu.prototype.startGame = function () {
        var self = this;
        this.checkHighScore(function () {
            score.value = 0;
            score.bonusPending = false;
            self.restart(1);
        });
    };

    /**
     * The 1995 Start At dialog (dialog 106): a level number with a spinner, the points that level is
     * worth at the current difficulty, the current game settings, and OK / Cancel / Customize... down
     * the right-hand side. As in 1995, opening it ends the game in progress (its score is checked for
     * the high scores first), and a game started from it earns the level bonus when its first level
     * is won.
     */
    ClassicMenu.prototype.startAt = function () {
        var self = this;
        this.checkHighScore(function () {
            score.value = 0;
            showScore();
            self.openStartAt();
        });
    };

    ClassicMenu.prototype.openStartAt = function () {
        var self = this;
        var current = this.view.options.level || 1;
        var difficulty = difficultyIndex(this.view.options.craftProfile);
        var $body = resourceLayout([207, 151], [
            { type: "group", rect: [5, 3, 140, 30], label: "Level" },
            { type: "static", rect: [12, 17, 50, 8], text: "Start At:", align: "center" },
            { type: "edit", rect: [68, 14, 30, 15], id: "classicStartLevel", value: current },
            { type: "updown", rect: [100, 14, 10, 14], target: "classicStartLevel", min: 1, max: 99 },
            { type: "group", rect: [5, 35, 140, 66], label: "Scoring" },
            { type: "static", rect: [11, 50, 80, 8], text: "Completed Level:", align: "right" },
            { type: "static", rect: [98, 50, 32, 8], text: "", align: "right", id: "classicLevelBonus" },
            { type: "static", rect: [11, 66, 80, 8], text: "Each Captured Flag:", align: "right" },
            { type: "static", rect: [98, 66, 32, 8], text: "", align: "right", id: "classicCapturedValue" },
            { type: "static", rect: [11, 82, 80, 8], text: "Each Remaining Flag:", align: "right" },
            { type: "static", rect: [98, 82, 32, 8], text: "", align: "right", id: "classicRemainingValue" },
            { type: "group", rect: [5, 103, 140, 43], label: "Game Settings" },
            { type: "static", rect: [26, 115, 65, 8], text: "Vehicle Controls:", align: "right" },
            { type: "static", rect: [95, 115, 42, 8], text: difficultyOf(this.view.options.craftProfile || Profiles.Classic).name },
            { type: "static", rect: [26, 130, 65, 8], text: "Maze Type:", align: "right" },
            { type: "static", rect: [95, 130, 42, 8], text: settings.get("mazeType") === "random" ? "Random" : "Sequential" }
        ]);
        // The 1995 label underlines the S of "Start At:".
        $body.find(".classicStatic").first().html(menuLabel("&Start At:"));
        // The points for the level shown, updated as it changes.
        var showPoints = function () {
            var level = parseInt($body.find("#classicStartLevel").val(), 10) || 1;
            var row = scoreRow(Math.max(1, level), difficulty);
            $body.find("#classicLevelBonus").text(formatNumber(row.levelBonus));
            $body.find("#classicCapturedValue").text(formatNumber(row.perCapturedFlag));
            $body.find("#classicRemainingValue").text(formatNumber(row.perRemainingFlag));
        };
        $body.on("input change", "#classicStartLevel", showPoints);
        showPoints();
        this.dialog("Start At", $body, [
            { label: "OK", isDefault: true, rect: [150, 7, 52, 14], action: function ($dialog) {
                var level = parseInt($dialog.find("#classicStartLevel").val(), 10);
                level = Math.max(1, Math.min(99, isNaN(level) ? 1 : level));
                score.value = 0;
                score.bonusPending = true;
                self.restart(level);
            } },
            { label: "Cancel", rect: [150, 24, 52, 14], action: function () {
                score.bonusPending = false;
            } },
            { label: "&Customize...", rect: [150, 106, 52, 14], action: function () {
                self.customize();
            } }
        ]);
    };

    ClassicMenu.prototype.pause = function () {
        var view = this.view;
        var $item = this.$bar.find('[data-action="pause"]');
        if (view.classicPaused) {
            view.classicPaused = false;
            $item.removeClass("checked");
            this.$container.find("#classicPausedNote").remove();
            view.game.clock.getDelta(); // don't count the paused time as one long frame
            view.game.startControllers();
            view.game.toggleSound(Hover.settings.getSoundEnabled());
            view.playing = true;
            var loop = function () {
                if (view.playing) {
                    view.game.runFrame();
                    window.requestAnimationFrame(loop);
                }
            };
            window.requestAnimationFrame(loop);
        } else if (view.playing) {
            view.playing = false;
            view.classicPaused = true;
            $item.addClass("checked");
            view.game.stopControllers();
            view.game.toggleSound(false);
            // The 1995 game's own pause text (string table 61205, 61206).
            this.$container.append('<div id="classicPausedNote"><span>GAME PAUSED</span><span>Press F3 to Continue</span></div>');
        }
    };

    /**
     * Gets the high scores as { scores (the 15 of the 1995 page), more (the server's longer board
     * beyond them), qualify (the score to beat for a name on the board), mine (this player's last and
     * best scores with their worldwide positions, from the server), fromServer }. Without the server,
     * the 15 kept in this browser.
     */
    function loadHighScores(done) {
        function local() {
            var table = highScoreTable();
            done({ scores: table, more: [], qualify: table[table.length - 1].score, mine: null, fromServer: false });
        }
        if (ranked.available === false) {
            local();
            return;
        }
        classicApi("highscores?player=" + encodeURIComponent(player.id), null, function (reply) {
            if (reply && _.isArray(reply.scores) && reply.scores.length === 15) {
                done(boardFrom(reply));
            } else {
                local();
            }
        }, local);
    }

    function boardFrom(reply) {
        return {
            scores: reply.scores,
            more: _.isArray(reply.more) ? reply.more : [],
            qualify: typeof reply.qualify === "number" ? reply.qualify : reply.scores[reply.scores.length - 1].score,
            mine: reply.mine || null,
            fromServer: true
        };
    }

    /** "12,345 (#37 of 512)" */
    function scoreWithRank(value, rank, total) {
        return formatNumber(value) + (rank ? " (#" + formatNumber(rank) + " of " + formatNumber(total) + ")" : "");
    }

    /**
     * The 1995 High Scores dialog (108): the 15 best scores, with Clear Scores. This edition adds a
     * second page ("More Scores") listing the server's board beyond the 15, and a line with your last
     * and best scores, each with its worldwide position among every game the server has checked.
     */
    ClassicMenu.prototype.highScores = function (onClosed, board) {
        var self = this;
        if (!board) {
            loadHighScores(function (loaded) {
                self.highScores(onClosed, loaded);
            });
            return;
        }
        var top = 16; // dialog units: room for the page tabs above the 1995 rows
        var controls = [];
        _.each(board.scores, function (entry, i) {
            var y = top + (i === 0 ? 5 : 16 + (i - 1) * 12);
            controls.push({ type: "static", rect: [5, y, 10, 8], text: (i + 1) + ")", align: "right" });
            // Your own entries (same player id) are shown in bold.
            controls.push({ type: "static", rect: [20, y, 122, 8], text: entry.name, bold: !!entry.mine });
            controls.push({ type: "static", rect: [149, y, 46, 8], text: formatNumber(entry.score), align: "right" });
        });
        // Your last and best scores: the server's (with positions), or the ones kept in this browser.
        var mine = board.mine;
        var lastText = mine ? scoreWithRank(mine.last, mine.lastRank, mine.total) : player.lastScore ? formatNumber(player.lastScore) : "none yet",
            bestText = mine ? scoreWithRank(mine.best, mine.bestRank, mine.total) : player.bestScore ? formatNumber(player.bestScore) : "none yet";
        controls.push({ type: "static", rect: [5, top + 186, 255, 8], text: "Your last score: " + lastText });
        controls.push({ type: "static", rect: [5, top + 197, 255, 8], text: "Your best score: " + bestText });
        var $layout = resourceLayout([269, top + 210], controls);
        $layout.children(".classicStatic").slice(0, board.scores.length * 3).addClass("classicPageTop");

        // The tabs, and the second page: a scrolling list of the board past the first 15.
        var $tabs = $('<div class="classicTabs placed"></div>').css(dialogUnits([5, 3, 195, 14]))
            .append('<div class="classicTab selected" data-page="top">Top 15</div>')
            .append('<div class="classicTab" data-page="more">More Scores</div>')
            .append('<div class="classicTab" data-page="yours">Your Scores</div>');
        var $more = $('<div class="classicScoreList placed"></div>').css(dialogUnits([5, top + 3, 195, 180])).hide();
        if (board.more.length) {
            _.each(board.more, function (entry, i) {
                $more.append($('<div class="classicScoreRow"></div>').toggleClass("mine", !!entry.mine)
                    .append($("<span></span>").text((i + 16) + ")"))
                    .append($("<span></span>").text(entry.name))
                    .append($("<span></span>").text(formatNumber(entry.score))));
            });
        } else {
            $more.append($('<div class="classicScoreEmpty"></div>').text(board.fromServer ?
                "No more scores yet." : "Only the game's server keeps scores beyond the top 15."));
        }
        // The third page: this browser's own games, newest first (kept in local storage).
        var $yours = $('<div class="classicScoreList placed"></div>').css(dialogUnits([5, top + 3, 195, 180])).hide();
        if (player.history.length) {
            $yours.append($('<div class="classicScoreRow classicGameRow classicScoreHeading"></div>')
                .append("<span>Date</span><span>Level</span><span>Controls</span><span>Score</span>"));
            _.each(player.history, function (game) {
                var date = new Date(game.at);
                $yours.append($('<div class="classicScoreRow classicGameRow"></div>')
                    .toggleClass("mine", game.score === player.bestScore)
                    .append($("<span></span>").text(isNaN(date.getTime()) ? "" : date.toLocaleDateString()))
                    .append($("<span></span>").text(game.level))
                    .append($("<span></span>").text(game.difficulty || ""))
                    .append($("<span></span>").text(formatNumber(game.score))));
            });
        } else {
            $yours.append($('<div class="classicScoreEmpty"></div>').text("No finished games yet."));
        }
        $tabs.on("click", ".classicTab", function () {
            var page = $(this).attr("data-page");
            $tabs.children().removeClass("selected").filter(this).addClass("selected");
            $layout.children(".classicPageTop").toggle(page === "top");
            $more.toggle(page === "more");
            $yours.toggle(page === "yours");
        });
        $layout.append($tabs, $more, $yours);

        var $dialog = this.dialog("High Scores", $layout, [
            { label: "OK", isDefault: true, rect: [205, top + 5, 50, 14], action: function () {
                if (onClosed) {
                    onClosed();
                }
            } },
            { label: "Clear Scores", rect: [205, top + 25, 50, 15], action: function () {
                self.message("Hover!", "Are you sure you want to clear the high score table?", "question", [
                    { label: "Yes", action: function () {
                        saveHighScores(_.map(_.range(15), function () {
                            return { name: "", score: 0 };
                        }));
                        self.highScores(onClosed);
                    } },
                    { label: "No", action: function () {
                        self.highScores(onClosed);
                    } }
                ]);
            } }
        ]);
        if (board.fromServer) {
            // The server's table is shared by everyone who plays here; it can't be cleared from a game.
            $dialog.find(".classicButton").filter(function () {
                return $(this).text() === "Clear Scores";
            }).addClass("disabled");
        }
    };

    /**
     * The 1995 high-score check, run before a game's score is thrown away (new game, Start At,
     * defeat, exit): the score is kept as this browser's last (and maybe best) score, the server
     * records the game, and a score good enough for the board asks for a name (dialog 112), goes in
     * and shows the table, then `next` runs. With the server, the server enters the score it worked
     * out itself, and only for a game it checked from the start.
     */
    ClassicMenu.prototype.checkHighScore = function (next) {
        var self = this;
        var finalScore = score.value,
            session = ranked.session;
        if (isMultiplayer(this.view) || finalScore <= 0) {
            next();
            return;
        }
        score.value = 0; // counted once, even if this is cut short
        ranked.session = null; // this game is over
        player.lastScore = finalScore;
        player.bestScore = Math.max(player.bestScore, finalScore);
        player.history.unshift({
            score: finalScore,
            level: this.view.options.level || 1,
            difficulty: difficultyOf(this.view.options.craftProfile || Profiles.Classic).name,
            at: Date.now()
        });
        player.history = player.history.slice(0, 100);
        player.save();
        var afterReports = ranked.queue || $.Deferred().resolve().promise();
        afterReports.then(function () {
            if (session) {
                // The server adds the game's checked score to its record of all games.
                classicApi("finish", { session: session }, function () {
                    loadHighScores(offerBoard);
                }, function () {
                    loadHighScores(offerBoard);
                });
            } else {
                loadHighScores(offerBoard);
            }
        });

        function offerBoard(board) {
            if (!(finalScore > board.qualify) || board.fromServer && !session) {
                next();
                return;
            }
            var $body = resourceLayout([232, 50], [
                { type: "static", rect: [5, 5, 160, 10], text: "Congratulations on a stellar game!" },
                { type: "static", rect: [5, 23, 160, 10], text: "Enter your name into the High Score list." },
                { type: "edit", rect: [5, 35, 160, 12], id: "classicHighScoreName", value: player.name || "Player #1" }
            ]);
            self.dialog("Enter High Score", $body, [
                { label: "OK", isDefault: true, rect: [175, 5, 50, 14], action: function ($dialog) {
                    var name = $.trim($dialog.find("#classicHighScoreName").val()).slice(0, 26) || "  ";
                    player.name = $.trim(name);
                    player.save();
                    if (board.fromServer) {
                        classicApi("submit", { session: session, name: name }, function (reply) {
                            self.highScores(next, boardFrom(reply));
                        }, function () {
                            self.highScores(next);
                        });
                        return;
                    }
                    var table = board.scores;
                    table.pop();
                    // Descending; a score equal to one already there goes below it.
                    var at = 0;
                    while (at < table.length && table[at].score >= finalScore) {
                        at++;
                    }
                    table.splice(at, 0, { name: name, score: finalScore });
                    saveHighScores(table);
                    self.highScores(next, { scores: table, more: [], qualify: 0, mine: null, fromServer: false });
                } }
            ], true);
            setTimeout(function () {
                $body.find("#classicHighScoreName").focus().select();
            }, 0);
        }
    };

    /** The GameView only tidies the game up when it is still "playing"; un-pause first. */
    ClassicMenu.prototype.prepareToLeave = function () {
        if (this.view.classicPaused) {
            this.view.classicPaused = false;
            this.view.playing = true;
        }
    };

    ClassicMenu.prototype.exit = function () {
        var self = this;
        this.checkHighScore(function () {
            score.value = 0;
            self.prepareToLeave();
            Hover.router.navigate("", {
                trigger: true
            });
        });
    };

    // --- Options -------------------------------------------------------------------------------

    /** The 1995 Sound Options dialog. */
    ClassicMenu.prototype.sounds = function () {
        // Laid out as the 1995 dialog 109, with a Music group added below it (this edition): which
        // recording of the 1995 MIDI songs to play, each made with a different MIDI synthesizer.
        var current = musicSet();
        var $body = resourceLayout([162, 112], [
            { type: "group", rect: [5, 3, 94, 55], label: "Effects" },
            { type: "check", rect: [11, 14, 81, 10], id: "classicMusic", label: "&Music", checked: settings.get("music") },
            { type: "check", rect: [11, 29, 81, 10], id: "classicGameSounds", label: "&Game Sounds", checked: settings.get("gameSounds") },
            { type: "check", rect: [11, 43, 81, 10], id: "classicEngine", label: "&Engine", checked: settings.get("engine") },
            { type: "check", rect: [7, 62, 125, 10], id: "classicMixing", label: "&Sound Effects Mixing", checked: true, disabled: true },
            { type: "group", rect: [5, 76, 150, 32], label: "Music Played On" },
            { type: "select", rect: [11, 88, 138, 13], id: "classicMusicSet", value: current.key,
                options: _.map(MUSIC_SETS, function (set) {
                    return { value: set.key, label: set.name + (set.available ? "" : " (not recorded)"), disabled: !set.available };
                }) }
        ]);
        this.dialog("Sound Options", $body, [
            { label: "OK", isDefault: true, rect: [105, 7, 50, 14], action: function ($dialog) {
                var chosen = $dialog.find("#classicMusicSet").val();
                if (chosen && chosen !== current.key) {
                    settings.set("musicSet", chosen);
                    switchMusicSet();
                }
                var wanted = {
                    music: $dialog.find("#classicMusic").is(":checked"),
                    gameSounds: $dialog.find("#classicGameSounds").is(":checked"),
                    engine: $dialog.find("#classicEngine").is(":checked")
                };
                _.each(wanted, function (on, group) {
                    settings.set(group, on);
                });
                // Silence what's playing now in the groups just switched off.
                var sounds = Hover.audio.sounds || {};
                _.each(sounds, function (sound, name) {
                    if (!wanted[soundGroupOf(name)] && sound && sound.stop) {
                        sound.stop();
                    }
                });
                if (wanted.music && Hover.settings.getSoundEnabled() && sounds.MUSIC && musicMayPlay()) {
                    sounds.MUSIC.play();
                }
            } },
            { label: "Cancel", rect: [105, 26, 50, 14] }
        ]);
    };

    /** The 1995 Player Controls dialog (the keys are fixed here; joystick and key changes are greyed). */
    ClassicMenu.prototype.controls = function () {
        function keyName(name) {
            return $('<select disabled></select>').append($("<option></option>").text(name));
        }
        var $body = $('<div class="classicControls"></div>')
            .append(groupBox("Movement", $('<div class="classicRow"></div>')
                .append(radio("classicMovement", "keyboard", "Keyboard", true))
                .append($('<div class="classicButton disabled">&Set Keys...</div>'.replace("&S", "<u>S</u>")))))
            .append(groupBox("Objects", $('<table class="classicSettingsTable"></table>')
                .append($("<tr></tr>").append($("<td></td>").html(menuLabel("J&ump")), $("<td></td>").append(keyName("A"))))
                .append($("<tr></tr>").append($("<td></td>").html(menuLabel("&Wall")), $("<td></td>").append(keyName("S"))))
                .append($("<tr></tr>").append($("<td></td>").html(menuLabel("C&loak")), $("<td></td>").append(keyName("D"))))))
            .append($('<p class="classicNote"></p>').text("Arrow keys drive and turn. Space fires; + and - zoom the radar."));
        this.dialog("Player Controls", $body, [{ label: "OK", isDefault: true }, { label: "Cancel" }]);
    };

    /** The 1995 Customize Game dialog. */
    ClassicMenu.prototype.customize = function () {
        var self = this;
        var current = this.view.options.craftProfile || Profiles.Classic;
        var currentKey = difficultyOf(current).key;
        var mazeType = settings.get("mazeType");
        // Laid out as the 1995 dialog 101. The Speed & Detail slider can't change anything here, so it
        // is shown disabled at the middle.
        var $body = resourceLayout([256, 167], [
            { type: "group", rect: [5, 0, 185, 65], label: "&Speed & Detail" },
            { type: "static", rect: [12, 12, 77, 8], text: "Less Speed" },
            { type: "static", rect: [112, 12, 72, 8], text: "More Speed", align: "right" },
            { type: "trackbar", rect: [16, 24, 168, 25], ticks: 9, value: 4, disabled: true },
            { type: "static", rect: [12, 52, 75, 8], text: "More Detail" },
            { type: "static", rect: [96, 52, 88, 8], text: "Less Detail", align: "right" },
            { type: "group", rect: [5, 70, 90, 55], label: "Vehicle Controls" },
            { type: "radio", rect: [10, 80, 80, 10], name: "classicDifficulty", value: "beginner", label: "&Easy", checked: currentKey === "beginner" },
            { type: "radio", rect: [10, 95, 80, 10], name: "classicDifficulty", value: "intermediate", label: "&Intermediate", checked: currentKey === "intermediate" },
            { type: "radio", rect: [10, 110, 80, 10], name: "classicDifficulty", value: "expert", label: "&Difficult", checked: currentKey === "expert" },
            { type: "group", rect: [5, 130, 90, 30], label: "Mirror Option" },
            { type: "check", rect: [11, 144, 79, 10], id: "classicRearView", label: "Show Rear &View", checked: settings.get("showRearView") !== false },
            { type: "group", rect: [100, 70, 90, 40], label: "Maze Type" },
            { type: "radio", rect: [105, 80, 78, 10], name: "classicMazeType", value: "sequential", label: "Se&quential", checked: mazeType !== "random" },
            { type: "radio", rect: [105, 95, 77, 10], name: "classicMazeType", value: "random", label: "&Random", checked: mazeType === "random" },
            { type: "group", rect: [100, 115, 90, 45], label: "Map Options" },
            { type: "radio", rect: [105, 130, 80, 10], name: "classicMap", value: "map", label: "Rotate &Map", checked: true, disabled: true },
            { type: "radio", rect: [105, 145, 80, 10], name: "classicMap", value: "craft", label: "Rotate &Craft", disabled: true }
        ]);
        this.dialog("Customize Game", $body, [
            { label: "OK", isDefault: true, rect: [202, 4, 50, 14], action: function ($dialog) {
                settings.set("mazeType", $dialog.find("input[name=classicMazeType]:checked").val());
                settings.set("showRearView", $dialog.find("#classicRearView").is(":checked"));
                var key = $dialog.find("input[name=classicDifficulty]:checked").val();
                Hover.settings.setClassicDifficulty(key); // used next time classic mode opens
                var profile = Profiles.classicFor(key);
                if (profile !== current) {
                    // A new vehicle setting starts a new game, at the current level.
                    Hover.router.navigate(key === "beginner" ? "retro" : "retro/" + key, {
                        trigger: false
                    });
                    if (self.view.options.mainMenu) {
                        // In the start-up room: stay there, with the new handling.
                        self.prepareToLeave();
                        self.view.stopGame();
                        Hover.router.setCurrentView(new Hover.views.GameView({
                            retro: true,
                            mainMenu: true,
                            craftProfile: profile
                        }));
                    } else {
                        self.restart(self.view.options.level || 1, profile, true);
                    }
                }
            } },
            { label: "Cancel", rect: [202, 22, 50, 14] }
        ]);
    };

    ClassicMenu.prototype.fullScreen = function () {
        var doc = document,
            root = doc.documentElement;
        var isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
        if (isFull) {
            (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
        } else if (root.requestFullscreen || root.webkitRequestFullscreen) {
            (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        }
    };

    // --- Help ----------------------------------------------------------------------------------

    ClassicMenu.prototype.howToPlay = function () {
        var $body = $("<div></div>")
            .append($("<p></p>").text(
                "Capture all of the other team's flags before their robots capture yours. Drive over a " +
                "flag to take it."))
            .append($("<p></p>").text(
                "Pick up pods along the way: springs let you jump, walls let you block a corridor behind " +
                "you, cloaks make you invisible, and other pods change your speed or protect you."))
            .append($("<p></p>").text(
                "Coloured floor pads hold you in place, slide you along, or give one of your captured " +
                "flags back. Watch the radar at the bottom of the dashboard to find your way."));
        this.dialog("How To Play", $body, [{ label: "OK", isDefault: true }]);
    };

    /** The 1995 Quick Help dialog, with its own instructions (dialog 115). */
    ClassicMenu.prototype.quickHelp = function () {
        // Laid out as the 1995 dialog 115, which the game also shows at start-up (see the ClassicMenu
        // constructor) unless "Skip Quick Help at Startup" is ticked ("QuickHelpFlag" in 1995).
        var $body = resourceLayout([277, 121], [
            { type: "group", rect: [5, 3, 208, 100], label: "Instructions" },
            { type: "static", rect: [12, 16, 193, 18], wrap: true, text: "To start a game, click Start Game from the Game menu, or press F2." },
            { type: "static", rect: [12, 39, 193, 18], wrap: true, text: "The object of the game is to collect all your opponents' blue flags before they collect all your red flags." },
            { type: "static", rect: [12, 60, 193, 18], wrap: true, text: "Use the arrow keys to maneuver your Hover 950. To change the maneuvering keys, press F8." },
            { type: "static", rect: [12, 82, 193, 18], wrap: true, text: "To pause the game and use the menus, press F3." },
            { type: "check", rect: [5, 107, 206, 10], id: "classicSkipQuickHelp", label: "Skip Quick Help at Startup", checked: settings.get("skipQuickHelp") === true }
        ]);
        $body.on("change", "#classicSkipQuickHelp", function () {
            settings.set("skipQuickHelp", $(this).is(":checked"));
        });
        this.dialog("Quick Help", $body, [{ label: "OK", isDefault: true, rect: [219, 7, 50, 14] }]);
    };

    /** The 1995 About box (dialog 100), plus a line about this edition. */
    ClassicMenu.prototype.about = function () {
        var $body = $('<div class="classicAbout"></div>')
            .append('<div class="classicAppIcon"></div>')
            .append($('<div class="classicAboutText"></div>')
                .append($("<p></p>").text("Hover! Version 1.0.9.5"))
                .append($("<p></p>").text("Copyright © 1994-1995  Microsoft Co."))
                .append('<hr>')
                .append($("<p></p>").text("Build M7 03/13/95"))
                .append($('<p class="classicNote"></p>').text("Readable web edition, based on the 2013 remake by Microsoft and Dan Church.")));
        this.dialog("About Hover!", $body, [{ label: "OK", isDefault: true }]);
    };

    // --- Dialog and message boxes ---------------------------------------------------------------

    /**
     * Shows a Windows 95 dialog box inside the game window. `buttons` are { label, action, isDefault }
     * (default: OK and Cancel); a button without an action just closes the box. `isMessage` marks a
     * message box, which can't be dismissed with Esc or a close box and so always runs one of its
     * buttons.
     */
    ClassicMenu.prototype.dialog = function (title, $content, buttons, isMessage) {
        var self = this;
        this.closeDialog();
        buttons = buttons || [{ label: "OK", isDefault: true }, { label: "Cancel" }];
        var $dialog = $('<div class="classicDialog"></div>').toggleClass("classicMessage", !!isMessage).data("isMessage", !!isMessage);
        var $titleBar = $('<div class="classicDialogTitle"></div>').append($("<span></span>").text(title));
        var $buttonRow = $('<div class="classicDialogButtons"></div>');
        var done = false;
        _.each(buttons, function (button) {
            var $button = $('<div class="classicButton"></div>').html(menuLabel(button.label))
                .toggleClass("isDefault", !!button.isDefault);
            $button.on("click", function () {
                if (done) {
                    return;
                }
                done = true;
                self.closeDialog();
                if (button.action) {
                    button.action($dialog);
                }
            });
            if (button.rect && $content.hasClass("classicLayout")) {
                // A dialog laid out from its 1995 resource places its buttons too.
                $content.append($button.addClass("placed").css(dialogUnits(button.rect)));
            } else {
                $buttonRow.append($button);
            }
        });
        if (!isMessage) {
            $titleBar.append($('<div class="classicDialogClose">&times;</div>').on("click", function () {
                self.closeDialog();
            }));
        } else {
            // A Windows 95 message box has a close button too: with one button it does what that
            // button does; with a choice (Yes / No) it is greyed out.
            var $close = $('<div class="classicDialogClose">&times;</div>').toggleClass("disabled", buttons.length > 1);
            $titleBar.append($close.on("click", function () {
                if (buttons.length === 1) {
                    $buttonRow.children().first().click();
                }
            }));
        }
        $dialog.append($titleBar, $('<div class="classicDialogBody"></div>').append($content));
        if ($buttonRow.children().length) {
            $dialog.append($buttonRow);
        }
        $dialog.toggleClass("resourceLayout", $content.hasClass("classicLayout"));
        // Keep clicks and keys in the dialog away from the game and the menu.
        $dialog.on("mousedown keydown keyup", function (event) {
            event.stopPropagation();
        });
        // Enter presses the default button.
        $dialog.on("keydown", function (event) {
            if (event.which === 13) {
                $dialog.find(".classicButton.isDefault").first().click();
            }
        });
        makeDraggable($dialog, $titleBar, this.$container);
        this.$dialog = $dialog;
        this.$container.append($dialog);
        $dialog.attr("tabindex", "-1").focus();
        return $dialog;
    };

    ClassicMenu.prototype.closeDialog = function () {
        if (this.$dialog) {
            this.$dialog.remove();
            this.$dialog = null;
        }
    };

    /** A Windows 95 message box: an icon ("info" or "question"), text and buttons. */
    ClassicMenu.prototype.message = function (title, text, icon, buttons) {
        var $content = $('<div class="classicMessageBody"></div>')
            .append($('<div class="classicIcon"></div>').addClass("classicIcon-" + (icon || "info")))
            .append($('<div class="classicMessageText"></div>').text(text));
        var $dialog = this.dialog(title, $content, buttons, true);
        $dialog.find(".classicButton").first().addClass("isDefault");
        return $dialog;
    };

    /**
     * Lets a box be moved by dragging its title bar, like a Windows window. The game window is scaled
     * to the screen, so mouse movement is divided by that scale.
     */
    function makeDraggable($box, $handle, $container) {
        $handle.on("mousedown", function (event) {
            if ($(event.target).closest(".classicDialogClose").length || event.which !== 1) {
                return;
            }
            event.preventDefault();
            var containerRect = $container[0].getBoundingClientRect();
            var scale = containerRect.width / ($container[0].offsetWidth || 1);
            var boxRect = $box[0].getBoundingClientRect();
            var startLeft = (boxRect.left - containerRect.left) / scale;
            var startTop = (boxRect.top - containerRect.top) / scale;
            var startX = event.pageX,
                startY = event.pageY;
            // From now on the box is placed by left/top only.
            $box.css({ left: startLeft, top: startTop, marginLeft: 0, marginTop: 0, transform: "none", webkitTransform: "none" });
            function onMove(moveEvent) {
                $box.css({
                    left: startLeft + (moveEvent.pageX - startX) / scale,
                    top: startTop + (moveEvent.pageY - startY) / scale
                });
            }
            function onUp() {
                $(document).off("mousemove", onMove).off("mouseup", onUp);
            }
            $(document).on("mousemove", onMove).on("mouseup", onUp);
        });
    }

    // --- Attach to each classic game view --------------------------------------------------------

    var activeMenu = null;

    function attachMenu() {
        var view = currentClassicGameView();
        if (activeMenu && activeMenu.view !== view) {
            activeMenu.destroy();
            activeMenu = null;
        }
        if (view && !activeMenu && view.$("#gameContainer").length) {
            activeMenu = new ClassicMenu(view);
        }
        return activeMenu;
    }

    /**
     * Shows a classic message box in `view`'s window (used by GameView for "Good Job! Starting level
     * N!" and "You have been defeated!").
     */
    Hover.showClassicMessage = function (view, title, text, icon, buttons) {
        var menu = attachMenu();
        if (!menu || menu.view !== view) {
            menu = new ClassicMenu(view);
        }
        menu.message(title, text, icon, buttons);
    };

    $(function () {
        var main = document.getElementById("main");
        if (main && window.MutationObserver) {
            // Views are swapped in as direct children of #main.
            new MutationObserver(function () {
                window.requestAnimationFrame(attachMenu);
            }).observe(main, { childList: true });
        }
    });
})(jQuery, Hover);
