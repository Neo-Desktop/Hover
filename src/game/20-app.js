// Original: game.js lines 4372-4655
// Application plumbing: analytics, asset preloader, view transitions, the Backbone router,
// the SignalR multiplayer client wrapper, and the document-ready bootstrap.

// ---------------------------------------------------------------------------------------------
// Hover.analytics (original lines 4372-4412)
// Thin wrapper over Google Analytics' `ga()` command queue.
// NOTE: this code does not itself load Google Analytics; it calls window.ga (the Universal
// Analytics tracker from the internet, if the page included its snippet) and falls back to a
// no-op. Kept unchanged on purpose.
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    /** Debug logging hook (empty in the shipped build). */
    function debugLog(message) {
    }

    // Captured once at load time: window.ga (Google Analytics) or a no-op.
    var gaSend = window.ga || $.noop;

    Hover.analytics = {
        start: function () {
            if (Hover.upgrade) {
                gaSend("send", "pageview", "/upgrade");
                debugLog("analytics - upgrade view");
            } else {
                this.pageView(Backbone.history.fragment);
            }
        },

        currentFragment: null,

        /** Reports a page view for a route fragment ("" becomes "home"); repeated fragments are ignored. */
        pageView: function (fragment) {
            if (!(fragment && "" !== fragment)) {
                fragment = "home";
            }
            if (fragment !== this.currentFragment) {
                this.currentFragment = fragment;
                var path = "/" === fragment[0] ? fragment : "/" + fragment;
                gaSend("send", "pageview", path);
                debugLog("analytics - page view: " + fragment);
            }
        },

        videoPlay: function (videoName) {
            gaSend("send", "event", "video", "play", videoName);
            debugLog("analytics - video play: " + videoName);
        },

        buttonClick: function (buttonName) {
            gaSend("send", "event", "button", "click", buttonName);
            debugLog("analytics - button click: " + buttonName);
        },

        singlePlayerGame: function (level) {
            gaSend("send", "event", "single-player", "level", level);
            debugLog("analytics - single-player level: " + level);
        },

        createMultiplayerGame: function (playerCount) {
            gaSend("send", "event", "multiplayer", "create", playerCount);
            debugLog("analytics - multiplayer create, player count: " + playerCount);
        },

        joinMultiplayerGame: function () {
            gaSend("send", "event", "multiplayer", "join");
            debugLog("analytics - multiplayer join game");
        },

        /** Atlas (ad tracking) action, optionally deferred; the tracker itself is stubbed out. */
        atlasAction: function (action, deferred) {
            if (deferred) {
                setTimeout(function () {
                    sendAtlasAction(action);
                }, 1);
            } else {
                sendAtlasAction(action);
            }
        }
    };

    var sendAtlasAction = function (action) {
    };
})(jQuery, Hover);

// ---------------------------------------------------------------------------------------------
// Hover.loader (original lines 4413-4450)
// Preloads images with PxLoader and sounds via Hover.audio; fires "loaderReady" when the
// loading-screen images are in, and "loadComplete" when images and sounds are both done.
//
// This edition: in the release build (src/pack.js) the game's pictures and sounds arrive in one
// file. "loadComplete" (which shows the title screen) then waits only for the loading-screen
// images, and the rest load once the pack is in; "assetsReady" (Hover.loader.assetsReady) says
// everything is there. With the readable files both happen together, as in the original.
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    function checkLoadComplete() {
        if (imagesLoaded && soundsLoaded) {
            Hover.loader.isComplete = true;
            Hover.events.trigger("loadComplete");
            pxLoader = null;
            if (HoverPack.ready) {
                assetsLoaded();
            }
        }
    }

    function assetsLoaded() {
        if (!Hover.loader.assetsReady) {
            Hover.loader.assetsReady = true;
            Hover.events.trigger("assetsReady");
        }
    }

    function addGameImages(loader) {
        var count = 0;
        if (!Hover.upgrade && !Hover.nopreload) {
            $.each(Hover.preloadAndCacheImages, function (name, url) {
                Hover.images[name] = loader.addImage(url);
                count++;
            });
            $.each(Hover.preloadImages, function (name, url) {
                loader.addImage(url);
                count++;
            });
        }
        return count;
    }

    /** Release build: loads the game's images from the pack once it has arrived. */
    function loadFromPack() {
        var later = new PxLoader({
            loggingDelay: 15000,
            noProgressTimeout: 20000
        });
        if (addGameImages(later) === 0) {
            assetsLoaded();
            return;
        }
        later.addCompletionListener(function () {
            if (Hover.loader.isComplete) {
                assetsLoaded();
            } else {
                Hover.events.once("loadComplete", assetsLoaded);
            }
        });
        later.start();
    }

    var mediaCdn = "",
        siteCdn = "",
        pxLoader = null,
        imagesLoaded = false,
        soundsLoaded = false;

    Hover.loader = {
        progress: 0,
        isComplete: false,
        assetsReady: false,
        mediaCdn: mediaCdn,
        siteCdn: siteCdn
    };

    Hover.loader.initialize = function () {
        pxLoader = new PxLoader({
            loggingDelay: 15000,
            noProgressTimeout: 20000
        });
        // Images needed by the loading screen itself are tagged so their completion can be signalled first.
        var readyTag = "loaderReady";
        $.each(Hover.loaderImages, function (name, url) {
            Hover.images[name] = pxLoader.addImage(url, readyTag);
        });
        pxLoader.addCompletionListener(function () {
            Hover.events.trigger(readyTag);
        }, readyTag);
        if (HoverPack.ready) {
            addGameImages(pxLoader);
        } else {
            HoverPack.whenReady(loadFromPack);
        }
        pxLoader.addCompletionListener(function () {
            imagesLoaded = true;
            checkLoadComplete();
        });
    };

    Hover.loader.start = function () {
        if (Hover.upgrade) {
            soundsLoaded = true;
        } else {
            HoverPack.whenReady(function () {
                Hover.audio.loadSounds(function () {
                    soundsLoaded = true;
                    checkLoadComplete();
                });
            });
        }
        // Sounds do not block load completion (set unconditionally, as in the original).
        soundsLoaded = true;
        pxLoader.start();
    };
})(jQuery, Hover);

// ---------------------------------------------------------------------------------------------
// Hover.transitionManager (original lines 4451-4471)
// Cross-fades from the old view to the new one and keeps a "view-<name>" class on <body>.
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    Hover.transitionManager = {
        currentView: null,
        currentViewName: null,

        transition: function (oldView, newView) {
            if (!newView.viewName) {
                if (newView.id) {
                    newView.viewName = newView.id;
                } else {
                    newView.viewName = hashString(newView.constructor + "");
                }
            }
            if (this.currentViewName) {
                $("body").removeClass("view-" + this.currentViewName);
            }
            this.currentView = newView;
            this.currentViewName = newView.viewName;
            $("body").addClass("view-" + this.currentViewName);
            if (oldView) {
                // fadeOutDuration/fadeInDuration are not defined here (jQuery default duration is used).
                oldView.$el.fadeOut(this.fadeOutDuration, function () {
                    oldView.remove();
                });
            }
            if (newView) {
                newView.$el.fadeIn(this.fadeInDuration, function () {
                });
            }
            if (Hover.backgroundView) {
                if ("homeView" === newView.viewName) {
                    Hover.backgroundView.setStarSpeed(0.05, 0);
                } else if ("singlePlayerView" === newView.viewName) {
                    Hover.backgroundView.setStarSpeed(0, 0);
                } else {
                    Hover.backgroundView.setStarSpeed(0, 0);
                }
            }
        }
    };

    /** Java-style 32-bit string hash; used as a fallback view name. */
    var hashString = function (text) {
        var hash = 0;
        if (0 === text.length) {
            return hash;
        }
        for (var i = 0; i < text.length; i++) {
            var charCode = text.charCodeAt(i);
            hash = (hash << 5) - hash + charCode;
            hash &= hash;
        }
        return hash;
    };
})(jQuery, Hover);

// ---------------------------------------------------------------------------------------------
// Hover.Router (original lines 4472-4574)
// Backbone router. Views requested while assets are still loading are parked in pendingView and
// shown on "loadComplete"; unsupported browsers (Hover.upgrade) only ever see the UpgradeView.
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    Hover.Router = Backbone.Router.extend({
        routes: {
            "": "home",
            "single-player(/:action)": "singlePlayer",
            "multiplayer(/:gameId)": "multiplayer",
            "mp/:gameId": "mpGameLink",
            customize: "customize",
            "local-game": "playLocalGame",
            "local-game/set": "setLocalGame",
            "local-game/scoreboard": "scoreboard",
            debug: "debug",
            // Added in this edition: "#retro" opens classic (Windows 95) mode directly. The original
            // only reached it by typing "bambi" on the title screen (see 19-views-home.js).
            "retro(/:difficulty)": "retro",
            // Added in this edition: create a multiplayer game in classic mode.
            "classic-multiplayer": "classicMultiplayer",
            "*path": "defaultRoute"
        },

        fadeInDuration: 1500,
        fadeOutDuration: 1500,
        currentView: null,
        pendingView: null,
        isLoading: true,
        $main: $("#main"),
        $body: $("body"),

        /**
         * This edition: every screen but the title screen waits for the game's pictures and
         * sounds (Hover.loader.assetsReady; in the release build they arrive in one file after the
         * title screen shows), with the loading screen showing meanwhile. Only the latest
         * request waits; going back to the title screen drops it.
         */
        route: function (route, name, callback) {
            var router = this,
                handler = callback || this[name];
            if (handler) {
                callback = function () {
                    var args = arguments,
                        run = function () {
                            handler.apply(router, args);
                        };
                    if (name === "home" || name === "defaultRoute") {
                        router.waitingRoute = null;
                        run();
                    } else {
                        router.afterAssets(run);
                    }
                };
            }
            return Backbone.Router.prototype.route.call(this, route, name, callback);
        },

        waitingRoute: null,

        afterAssets: function (run) {
            if (Hover.loader.assetsReady) {
                this.waitingRoute = null;
                run();
                return;
            }
            this.waitingRoute = run;
            if (!this.isLoading && !(this.currentView instanceof Hover.views.LoadingView)) {
                Hover.loadingView = new Hover.views.LoadingView;
                this.setCurrentView(Hover.loadingView, true);
            }
        },

        onAssetsReady: function () {
            var run = this.waitingRoute;
            this.waitingRoute = null;
            if (run) {
                run();
            }
        },

        initialize: function () {
            this.listenTo(Hover.events, "loadComplete", _.bind(this.onLoadComplete, this));
            this.listenTo(Hover.events, "assetsReady", _.bind(this.onAssetsReady, this));
            // Only show the loading screen if no view was shown within 500 ms.
            setTimeout(_.bind(function () {
                if (!this.currentView) {
                    Hover.loadingView = new Hover.views.LoadingView;
                    this.setCurrentView(Hover.loadingView, true);
                }
            }, this), 500);
        },

        /** Backbone navigate plus an analytics page view. */
        navigate: function (fragment, options) {
            Backbone.Router.prototype.navigate.call(this, fragment, options);
            Hover.analytics.pageView(fragment);
        },

        onLoadComplete: function () {
            if (this.isLoading) {
                this.isLoading = false;
                Hover.loadingView = null;
                if (Hover.upgrade) {
                    this.pendingView = new Hover.views.UpgradeView;
                }
                if (this.pendingView) {
                    this.setCurrentView(this.pendingView, true);
                    this.pendingView = null;
                } else if (this.currentView && this.begin) {
                    // Note: the router defines no begin() method. (This edition: so the loading
                    // screen stays up for a screen that is waiting for assetsReady.)
                    this.begin();
                }
            }
        },

        defaultRoute: function (path) {
            Hover.router.navigate("", {
                trigger: true
            });
        },

        home: function () {
            if (this.isSupportedView(Hover.views.HomeView)) {
                this.setCurrentView(new Hover.views.HomeView);
            }
        },

        singlePlayer: function (action) {
            if (action) {
                Hover.router.navigate("single-player", {
                    trigger: true
                });
            } else if (this.isSupportedView(Hover.views.SinglePlayerView)) {
                this.setCurrentView(new Hover.views.SinglePlayerView);
            }
        },

        /**
         * Classic mode. This edition adds an optional 1995 difficulty ("#retro/intermediate",
         * "#retro/expert"; Beginner otherwise), which picks that level's handling.
         */
        retro: function (difficulty) {
            if (this.isSupportedView(Hover.views.GameView)) {
                // This edition: an address with a difficulty sets it; without one, the difficulty
                // chosen last time (kept in local storage) is used.
                difficulty = (difficulty || "").toLowerCase();
                if (difficulty === "beginner" || difficulty === "intermediate" || difficulty === "expert") {
                    Hover.settings.setClassicDifficulty(difficulty);
                } else {
                    difficulty = Hover.settings.getClassicDifficulty();
                }
                if (difficulty === "beginner") {
                    difficulty = "";
                }
                Hover.router.navigate(difficulty ? "retro/" + difficulty : "retro", {
                    trigger: false
                });
                // Like the 1995 game, classic mode opens on its start-up room (the "main menu level",
                // 23-main-menu-level.js); Game > Start Game (F2) starts level 1.
                this.setCurrentView(new Hover.views.GameView({
                    retro: true,
                    mainMenu: true,
                    craftProfile: Profiles.classicFor(difficulty)
                }));
            }
        },

        multiplayer: function (gameId) {
            if (this.isSupportedView(Hover.views.MultiplayerView)) {
                this.setCurrentView(new Hover.views.MultiplayerView({
                    gameId: gameId
                }));
            }
        },

        /** Added in this edition: the multiplayer create screen with "Classic look" ticked. */
        classicMultiplayer: function () {
            if (this.isSupportedView(Hover.views.MultiplayerView)) {
                this.setCurrentView(new Hover.views.MultiplayerView({
                    classic: true
                }));
            }
        },

        /** Short share link "#mp/<id>" → "#multiplayer/<id>". */
        mpGameLink: function (gameId) {
            Hover.router.navigate("multiplayer/" + gameId, {
                trigger: true
            });
        },

        playLocalGame: function () {
            var localGameId = Hover.settings.getLocalGameId();
            if (localGameId) {
                this.multiplayer(localGameId);
            } else {
                this.defaultRoute();
            }
        },

        customize: function () {
            if (this.isSupportedView(Hover.views.CustomizeView)) {
                this.setCurrentView(new Hover.views.CustomizeView);
            }
        },

        /** "#debug": starts a GameView configured from query-string parameters (purl). */
        debug: function () {
            Hover.showStats = true;
            var pageUrl = $.url();
            this.setCurrentView(new Hover.views.GameView({
                retro: pageUrl.param("retro"),
                mazeId: pageUrl.param("mazeId"),
                gameId: pageUrl.param("gameId"),
                createGame: pageUrl.param("createGame"),
                numPlayers: pageUrl.param("numPlayers"),
                numFlags: pageUrl.param("numFlags"),
                level: pageUrl.param("level"),
                volume: pageUrl.param("volume")
            }));
        },

        setLocalGame: function () {
            if (this.isSupportedView(Hover.views.SetLocalGameView)) {
                this.setCurrentView(new Hover.views.SetLocalGameView);
            }
        },

        scoreboard: function () {
            if (this.isSupportedView(Hover.views.ScoreboardView)) {
                if (Hover.settings.getLocalGameId()) {
                    this.setCurrentView(new Hover.views.ScoreboardView);
                } else {
                    Hover.router.navigate("local-game/set", {
                        trigger: true
                    });
                }
            }
        },

        isSupportedView: function (viewClass) {
            if (viewClass === Hover.views.LoadingView) {
                return true;
            }
            if (Hover.upgrade) {
                return viewClass === Hover.views.UpgradeView;
            }
            return true;
        },

        /**
         * Shows a view (prepends it to #main and cross-fades). While loading, non-forced views are
         * kept as pendingView instead. The same view (by id/equalState) is not shown twice.
         */
        setCurrentView: function (view, force) {
            if (this.isSupportedView(view.constructor)) {
                if (this.isLoading && !force) {
                    this.pendingView = view;
                    return;
                }
                var previousView = this.currentView;
                if (!previousView || !view || previousView.id !== view.id || previousView.equalState && !previousView.equalState(view)) {
                    this.currentView = view;
                    this.$main.prepend(view.$el.hide());
                    Hover.transitionManager.transition(previousView, view);
                    if (view.onLoaded) {
                        view.onLoaded();
                    }
                }
            }
        }
    });
})(jQuery, Hover);

// ---------------------------------------------------------------------------------------------
// Hover.signalr (original lines 4575-4648)
// Wraps the SignalR "hoverHub" connection: lazily downloads the generated hub proxies, creates
// and joins games, and forwards server→client hub events to the attached MultiplayerGame
// (buffering them until the game instance attaches).
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    function SignalRClient() {
        this.started = false;
        this.joinedGameId = null;
        this.game = null;
        this.bufferedMessages = [];
    }

    var hubUrl = Hover.settings.gameServerUrl + "signalr";

    /** Ensures the hub connection is started, then calls onConnected (or onFailure). */
    SignalRClient.prototype.connect = function (onConnected, onFailure) {
        var self = this,
            startHub = function () {
                $.connection.hub.start().done(function () {
                    self.started = true;
                    onConnected();
                }).fail(function (error) {
                    console.log("signalr start failure: " + error);
                    onFailure();
                });
            };
        if (this.started) {
            setTimeout(onConnected, 0);
        } else if ($.connection.hub.url !== hubUrl) {
            // First connection: load the server-generated hub proxy script (<server>/signalr/hubs).
            $.getScript(hubUrl + "/hubs").done(function (script, textStatus) {
                $.connection.hub.url = hubUrl;
                self.attachHubListeners();
                startHub();
            }).fail(function (jqXHR, settings, exception) {
                console.log("signalr failed getting hubs JS");
                onFailure();
            });
        } else {
            startHub();
        }
    };

    SignalRClient.prototype.disconnect = function () {
        if (this.started) {
            this.stopGame();
            $.connection.hub.stop();
            this.started = false;
            console.log("disconnected from signalr server");
        }
    };

    SignalRClient.prototype.stopGame = function () {
        if (this.joinedGameId) {
            console.log("unjoined game:" + this.joinedGameId);
            this.joinedGameId = null;
        }
        if (this.game) {
            this.game = null;
            console.log("detach game instance");
        }
    };

    /** Asks the server to create a game; onCreated receives the new game id. */
    SignalRClient.prototype.createGame = function (playersPerTeam, onCreated, onFailure, classic) {
        this.stopGame();
        var doCreate = function () {
            playersPerTeam = playersPerTeam || 1;
            var mazeId = 44,
                numFlags = 4;
            // `classic` (4th argument) was added in this edition: the server remembers the game's look
            // and tells every player in waitingUpdate (Classic: true).
            $.connection.hoverHub.server.createGame(mazeId, numFlags, playersPerTeam, !!classic).done(onCreated).fail(onFailure);
        };
        this.connect(doCreate, onFailure);
    };

    SignalRClient.prototype.joinGame = function (gameId, craftProfileId, playerName, onJoined, onFailure) {
        this.stopGame();
        var self = this,
            doJoin = function () {
                self.joinedGameId = gameId;
                $.connection.hoverHub.server.join(gameId, craftProfileId, playerName).done(function () {
                    onJoined();
                }).fail(function (error) {
                    console.log("signalr join game failure: " + error);
                    self.joinedGameId = null;
                    onFailure();
                });
            };
        this.connect(doJoin, onFailure);
    };

    /** Registers the client-side hub callbacks (done once, after the hub proxies are loaded). */
    SignalRClient.prototype.attachHubListeners = function () {
        $.connection.hub.error(function (error) {
            console.log("SignalR error: " + error);
        });
        this.proxyHubEventToGame("useMazeId");
        this.proxyHubEventToGame("spawnAt");
        this.proxyHubEventToGame("placeFlagAt");
        this.proxyHubEventToGame("spawnPod");
        this.proxyHubEventToGame("removePod");
        this.proxyHubEventToGame("startGame");
        this.proxyHubEventToGame("onHit");
        this.proxyHubEventToGame("onBulletFired");
        this.proxyHubEventToGame("onFlagCaptured");
        this.proxyHubEventToGame("onFlagUncaptured");
        this.proxyHubEventToGame("onTempWallCreated");
        this.proxyHubEventToGame("hitByBullet");
        this.proxyHubEventToGame("bulletDestroyed");
        this.proxyHubEventToGame("showMessage");
        var client = $.connection.hoverHub.client;
        // Lobby events go to the app-wide event bus (MultiplayerView listens).
        client.waitingUpdate = function (waiting) {
            Hover.events.trigger("waitingUpdate", waiting);
        };
        client.disconnectWithError = function (message) {
            Hover.events.trigger("disconnectWithError", message);
        };
    };

    /**
     * Routes hub event `eventName` to game[gameMethodName] (default: same name). Before a game
     * instance is attached, events for the joined game are buffered.
     */
    SignalRClient.prototype.proxyHubEventToGame = function (eventName, gameMethodName) {
        var client = $.connection.hoverHub.client,
            self = this;
        gameMethodName = gameMethodName || eventName;
        client[eventName] = function () {
            var game = self.game;
            if (game) {
                var method = game[gameMethodName];
                if (method && typeof method == "function") {
                    method.apply(game, arguments);
                }
            } else if (self.joinedGameId) {
                self.bufferedMessages.push({
                    gameEvent: gameMethodName,
                    args: arguments
                });
            }
        };
    };

    /** Called by MultiplayerGame's constructor: replays buffered hub events, then attaches. */
    SignalRClient.prototype.attachGameInstance = function (game, gameId) {
        if (this.game) {
            console.log("error attaching game to signalr connection");
            return;
        }
        if (this.joinedGameId !== gameId) {
            console.log("error: trying to join different game");
            return;
        }
        for (var message, method; message = this.bufferedMessages.shift();) {
            method = game[message.gameEvent];
            if (method && typeof method == "function") {
                method.apply(game, message.args);
            }
        }
        this.game = game;
    };

    Hover.signalr = new SignalRClient;
})(jQuery, Hover);

// ---------------------------------------------------------------------------------------------
// Bootstrap (original lines 4649-4655)
// ---------------------------------------------------------------------------------------------
(function ($, Hover) {
    // Stop the page from scrolling/bouncing on touch devices.
    $(document).bind("touchmove", function (event) {
        event.preventDefault();
    });
    $(function () {
        Hover.events = new Backbone.Model;
        // Release build: the loading screen shows how much of the asset pack has arrived.
        HoverPack.onProgress(function (loaded, total) {
            Hover.events.trigger("packProgress", total ? Math.floor(100 * loaded / total) : 0);
        });
        Hover.router = new Hover.Router;
        Hover.loader.initialize();
        if (!Hover.upgrade) {
            Hover.backgroundView = new Hover.views.BackgroundView;
            // The original also started the "Rethink IE" promo flyout here
            // (Hover.ieFlyoutView = new Hover.views.IEFlyoutView); it has been removed.
        }
        Backbone.history.start();
        Hover.analytics.start();
        Hover.loader.start();
    });
})(jQuery, Hover);
