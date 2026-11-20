// Original: game.js lines 3698-3877
// GameView: the in-game screen. Creates a SinglePlayerGame or (with options.gameId) a
// MultiplayerGame, runs its frame loop, shows win/lose messages, and handles the toolbar
// (logo, sound, social links, options menu, hyper-colour toggle) and touch-control visibility.
//
// Options: retro, mazeId, level, gameId, volume, playerName, craftProfile.

(function ($, Hover) {
    Hover.views.GameView = Backbone.View.extend({
        id: "gameView",
        /** Single-player levels, in order (level N plays mazeIds[N - 1]). */
        mazeIds: [44, 46, 47],
        events: {
            "click #logo": "clickLogo",
            "click #sound": "toggleSound",
            "click #twitter": "clickTweet",
            "click #facebook": "clickFacebook",
            "click #funstuff": "clickFunStuff",
            "click #options": "clickOptions",
            "click #hyper": "clickHyper",
            "click #reset-help": "clickResetHelp",
            "click #options-clickoff": "clickOptionsOff"
        },

        initialize: function () {
            Hover.retro = this.options.retro || false;
            this.options.mazeId = parseInt(this.options.mazeId, 10) || this.mazeIds[0];
            this.mazeIndex = Math.max(0, this.mazeIds.indexOf(this.options.mazeId));
            if (Hover.retro) {
                $("body").addClass("view-retro");
            }
            this.listenTo(Hover.events, "soundChanged", _.bind(this.updateSound, this));
            this.render();
            this.activeTouchCount = 0;
            this.hideTouchControlsTimer = null;
            this.gameContainerEvents = {
                pxpointerstart: _.bind(this.touchStart, this),
                pxpointerend: _.bind(this.touchEnd, this),
                MSHoldVisual: function (event) {
                    event.preventDefault();
                },
                contextmenu: function (event) {
                    event.preventDefault();
                }
            };
            this.$("#gameContainer").on(this.gameContainerEvents);
            this.updateSound();
            Hover.audio.setEnabled(Hover.settings.getSoundEnabled());
            this.updateHyperColor();
            this.playing = false;
            this.game = null;
            this.initGame();
        },

        equalState: function () {
            return false;
        },

        render: function () {
            this.$el.html(Hover.templates.game({
                // This edition: classic mode counts levels past the three mazes (see onGameWon).
                level: Hover.retro && this.options.level ? this.options.level : this.mazeIndex + 1
            }));
            if (this.options.mainMenu) {
                this.$("#gameLoadingText").text("Loading..."); // the start-up room isn't a level
            }
            this.$messageBg = this.$("#gameMessageBackground");
            this.gameMessageView = new Hover.views.GameMessageView(this.$messageBg);
            this.$("#gameMessage").append(this.gameMessageView.$el);
            Hover.messageView = this.gameMessageView;
            Hover.messageTypes = this.gameMessageView.messageTypes;
            var hudHtml;
            var hudClass;
            if (Hover.retro) {
                hudHtml = Hover.templates.retroHud();
                hudClass = "retro";
            } else {
                hudHtml = Hover.templates.modernHud();
                hudClass = "modern";
            }
            this.$el.addClass(hudClass);
            this.$("#hud").addClass(hudClass).html(hudHtml);
            // This edition: size the game window to the screen straight away, before the view is
            // shown (21-fit-to-screen.js, which loads after this file; it's there when views render).
            if (Hover.fitGameToWindow) {
                Hover.fitGameToWindow(this.$el);
            }
            return this;
        },

        /** Create the game: multiplayer when options.gameId is set, otherwise single player. */
        initGame: function () {
            var level = this.options.level || 1;
            var gameId = this.options.gameId || 0;
            var volume = this.options.volume || 1;
            var mazeId = this.mazeIds[this.mazeIndex];
            if (this.options.mainMenu) {
                mazeId = Hover.mainMenuMazeId; // this edition: the 1995 start-up room
            }
            Hover.audio.volume = volume;
            var dimensions = Hover.retro ? Hover.dimensions.retro : Hover.dimensions.modern;
            if (gameId) {
                this.game = new MultiplayerGame({
                    domElement: this.el,
                    dimensions: dimensions,
                    mazeId: mazeId,
                    gameId: gameId,
                    playerName: this.options.playerName,
                    craftProfile: this.options.craftProfile
                });
                this.game.onReady.register(_.bind(this.onGameReady, this));
                this.game.onDisconnectedWithError.register(_.bind(function (sender, message) {
                    console.log("disconnect message: " + message);
                }, this));
                this.game.onShowMessage.register(_.bind(function (sender, message) {
                    console.log("status message: " + message);
                }, this));
            } else {
                this.game = new SinglePlayerGame({
                    domElement: this.el,
                    dimensions: dimensions,
                    mazeId: mazeId,
                    level: level,
                    craftProfile: this.options.craftProfile,
                    carriedItems: this.options.carriedItems,
                    demo: !!this.options.mainMenu
                });
                this.game.onReady.register(_.bind(this.onGameReady, this));
                this.game.load();
                Hover.analytics.singlePlayerGame(this.mazeIndex + 1);
            }
        },

        /** Show touch controls while any finger is down. */
        touchStart: function (event) {
            if (event.pointer.type === "touch") {
                this.activeTouchCount++;
                Hover.events.trigger("toggleTouchControls", true);
                if (this.hideTouchControlsTimer) {
                    clearTimeout(this.hideTouchControlsTimer);
                    this.hideTouchControlsTimer = null;
                }
            }
        },

        /** Hide touch controls 5 s after the last finger lifts. */
        touchEnd: function (event) {
            if (event.pointer.type === "touch") {
                this.activeTouchCount--;
                if (this.activeTouchCount === 0) {
                    var self = this;
                    this.hideTouchControlsTimer = setTimeout(function () {
                        Hover.events.trigger("toggleTouchControls", false);
                        self.hideTouchControlsTimer = null;
                    }, 5000);
                }
            }
        },

        toggleSound: function () {
            var enabled = !Hover.settings.getSoundEnabled();
            Hover.settings.setSoundEnabled(enabled);
            Hover.audio.setEnabled(enabled);
            if (this.game) {
                this.game.toggleSound(enabled);
            }
        },

        updateSound: function () {
            var enabled = Hover.settings.getSoundEnabled();
            if (enabled) {
                this.$("#sound").removeClass("off").addClass("on");
            } else {
                this.$("#sound").removeClass("on").addClass("off");
            }
        },

        toggleHyperColor: function () {
            var enabled = !Hover.settings.getHyperColorEnabled();
            Hover.settings.setHyperColorEnabled(enabled);
        },

        updateHyperColor: function () {
            var enabled = Hover.settings.getHyperColorEnabled();
            if (enabled) {
                this.$("#hyper").removeClass("off").addClass("on");
            } else {
                this.$("#hyper").removeClass("on").addClass("off");
            }
        },

        onGameReady: function () {
            if (Hover.retro) {
                // This edition: each maze has its own 1995 song (Maze 1 = MUSIC1, ...).
                // The start-up room has MUSIC3, which only plays once "ibmab" has been typed.
                // From the recording chosen in Options > Sounds (22-classic-menu.js).
                Hover.audio.retroMusic = "Retro/music/" + (Hover.classicMusicFolder ? Hover.classicMusicFolder() : "") +
                    "MUSIC" + (this.options.mainMenu ? 3 : this.mazeIndex + 1) +
                    (Modernizr.audio.m4a ? ".m4a" : ".ogg");
            }
            var onReady = _.bind(this.onSoundAndGameReady, this);
            // Note: _.delay schedules onReady itself; loadSounds receives the timer id.
            Hover.audio.loadSounds(_.delay(onReady, 1500));
        },

        /** Show the intro (first single-player game only), hook up win/tie/lose and start the frame loop. */
        onSoundAndGameReady: function () {
            if (!this.options.gameId) {
                var introShown = Hover.settings.getIntroMessageShown();
                if (!introShown) {
                    this.gameMessageView.showMessage(this.gameMessageView.messageTypes.INTRO);
                    Hover.settings.setIntroMessageShown(true);
                }
            }
            this.$el.addClass("ready");
            this.playing = true;
            this.game.onWin.register(_.bind(this.onGameWon, this));
            this.game.onTie.register(_.bind(this.onGameTied, this));
            this.game.onLose.register(_.bind(this.onGameLost, this));
            var frameLoop = _.bind(function () {
                if (this.playing) {
                    this.game.runFrame();
                    window.requestAnimationFrame(frameLoop);
                }
            }, this);
            window.requestAnimationFrame(frameLoop);
        },

        /** Multiplayer / last level / retro: back home after the message; otherwise go to the next level. */
        onGameWon: function () {
            if (this.isStale()) {
                return;
            }
            // This edition: the springs, walls and cloaks not used yet go on to the next level.
            var craft = this.game && this.game.craft;
            var carriedItems = craft ? {
                springs: craft.springCount,
                walls: craft.wallCount,
                cloaks: craft.cloakCount
            } : null;
            this.stopGame();
            var nextMazeIndex = this.mazeIndex + 1;
            var wasLastMaze = nextMazeIndex >= this.mazeIds.length;
            if (this.options.gameId) {
                this.gameMessageView.showMessage(this.gameMessageView.messageTypes.MULTIPLAYER_WON, function () {
                    Hover.router.navigate("", {
                        trigger: true
                    });
                });
            } else if (Hover.retro) {
                // This edition: classic mode plays on like the 1995 game. The remake ended it after
                // one maze; now each win moves to the next maze (back to Maze 1 after Maze 3) and the
                // level number rises, which brings in more robots (SinglePlayerGame.spawnDrones).
                // The next maze follows Options > Customize Game > Maze Type (Sequential or Random),
                // and the message is the 1995 game's own ("Good Job! Starting level %d!").
                var nextLevel = (this.options.level || 1) + 1;
                var startNextLevel = _.bind(function () {
                    var nextOptions = _.extend({}, this.options, {
                        mazeId: Hover.classicNextMaze ? Hover.classicNextMaze(this.options.mazeId, this.mazeIds) :
                            this.mazeIds[nextMazeIndex % this.mazeIds.length],
                        level: nextLevel,
                        carriedItems: carriedItems
                    });
                    if (Hover.classicLevelStarting) {
                        Hover.classicLevelStarting(nextOptions.mazeId); // the high-score server places its flags
                    }
                    Hover.router.setCurrentView(new Hover.views.GameView(nextOptions));
                }, this);
                if (Hover.classicLevelWon) {
                    // The 1995 "Bonus Score" box with the points for the flags left (22-classic-menu.js).
                    Hover.audio.getSound("WINLEVEL").play();
                    Hover.classicLevelWon(this, nextLevel, startNextLevel);
                } else {
                    this.gameMessageView.showMessage(this.gameMessageView.messageTypes.LEVEL_WON, startNextLevel);
                }
            } else if (wasLastMaze) {
                this.gameMessageView.showMessage(this.gameMessageView.messageTypes.GAME_WON, function () {
                    Hover.router.navigate("", {
                        trigger: true
                    });
                });
            } else {
                this.gameMessageView.showMessage(this.gameMessageView.messageTypes.LEVEL_WON, _.bind(function () {
                    var nextOptions = _.extend({}, this.options, {
                        mazeId: this.mazeIds[nextMazeIndex],
                        carriedItems: carriedItems
                    });
                    Hover.router.setCurrentView(new Hover.views.GameView(nextOptions));
                }, this));
            }
        },

        onGameTied: function () {
            this.stopGame();
            this.gameMessageView.showMessage(this.gameMessageView.messageTypes.MULTIPLAYER_TIED, function () {
                Hover.router.navigate("", {
                    trigger: true
                });
            });
        },

        /** Multiplayer / retro: back home after the message; otherwise retry the same level. */
        onGameLost: function () {
            if (this.isStale()) {
                return;
            }
            this.stopGame();
            if (this.options.gameId) {
                this.gameMessageView.showMessage(this.gameMessageView.messageTypes.MULTIPLAYER_LOST, function () {
                    Hover.router.navigate("", {
                        trigger: true
                    });
                });
            } else {
                var retryLevel = _.bind(function () {
                    // This edition: classic mode retries the level too (the remake sent it home).
                    var sameOptions = _.clone(this.options);
                    Hover.router.setCurrentView(new Hover.views.GameView(sameOptions));
                }, this);
                if (Hover.retro && Hover.classicDefeat) {
                    // The 1995 game's own message (after the high-score check); Yes opens Start At.
                    Hover.audio.getSound("GAMEOVR").play();
                    if (!Hover.classicDefeat(this)) {
                        retryLevel();
                    }
                } else if (Hover.retro && Hover.showClassicMessage) {
                    Hover.audio.getSound("GAMEOVR").play();
                    Hover.showClassicMessage(this, "Hover!", "You have been defeated!  The Drones have captured all " +
                        "of your flags.\n\nWould you like to play again?", "question", [
                        { label: "Yes", action: retryLevel },
                        { label: "No", action: function () {
                            Hover.router.navigate("", {
                                trigger: true
                            });
                        } }
                    ]);
                } else {
                    this.gameMessageView.showMessage(this.gameMessageView.messageTypes.LEVEL_LOST, retryLevel);
                }
            }
        },

        /**
         * Added in this edition: true when another view has already replaced this one (a game that
         * is being taken off screen must not start the next level).
         */
        isStale: function () {
            return !!(Hover.router && Hover.router.currentView && Hover.router.currentView !== this);
        },

        stopGame: function () {
            if (this.playing) {
                this.playing = false;
                if (this.game) {
                    this.game.craft.hud.update(0);
                    this.game.stop();
                }
            }
        },

        clickLogo: function () {
            Hover.router.navigate("", {
                trigger: true
            });
        },

        clickTweet: function () {
            if (!Hover.retro) {
                Hover.social.tweet();
            }
            Hover.analytics.buttonClick("twitter");
        },

        clickFacebook: function () {
            if (!Hover.retro) {
                Hover.social.share();
            }
            Hover.analytics.buttonClick("facebook");
        },

        clickFunStuff: function () {
            Hover.analytics.buttonClick("funstuff");
        },

        clickOptions: function () {
            this.$("#reset-help").html("Reset Hints");
            this.$("#options").addClass("open");
            return false;
        },

        clickHyper: function () {
            this.toggleHyperColor();
            this.updateHyperColor();
        },

        /** Re-enable the intro and pod pick-up hints. */
        clickResetHelp: function () {
            Hover.settings.resetPickupMessageShown();
            Hover.settings.setIntroMessageShown(false);
            this.$("#options").removeClass("open");
            return false;
        },

        clickOptionsOff: function () {
            this.$("#options").removeClass("open");
            return false;
        },

        remove: function () {
            this.stopListening(Hover.events);
            this.stopGame();
            this.$("#gameContainer").off(this.gameContainerEvents);
            // This edition: when one classic game replaces another (next level, restart), the new view
            // has already set the body's classic styling; keep it.
            var nextView = Hover.router && Hover.router.currentView;
            if (!(nextView && nextView !== this && nextView.id === "gameView" && nextView.$el.hasClass("retro"))) {
                $("body").removeClass("view-retro");
            }
            Backbone.View.prototype.remove.call(this);
            Hover.signalr.disconnect();
        }
    });
})(jQuery, Hover);
