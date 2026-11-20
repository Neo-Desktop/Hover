// Original: game.js lines 4097-4232
// MultiplayerView: create a multiplayer game (choose player count, get a shareable link),
// pick a craft and a name, join, and wait in the lobby until every player has joined.

(function ($, Hover) {
    /** Whether the local player has joined the server-side game. */
    var JoinState = {
        UNJOINED: 0,
        JOINING: 1,
        JOINED: 2
    };

    /** Screen states; each adds an "mpState-<state>" class to the view. */
    var ViewState = {
        CREATE: "create",
        LINK: "link",
        CRAFT: "craft",
        WAIT: "wait"
    };

    /** Indexed by players per team. */
    var playersPerTeamWords = ["zero", "One ", "Two ", "Three ", "Four "];

    Hover.views.MultiplayerView = Backbone.View.extend({
        className: "multiPlayerView",
        viewName: "multiPlayerView",

        events: {
            "click .mpPlayerMeter": "clickPlayers",
            "click .createButton": "createGame",
            "click .enterButton": "enterGame",
            "click #joinButton": "joinGame",
            "click .leftChooserButton": "previousCraft",
            "click .rightChooserButton": "nextCraft",
            "click #gameLink": "clickLink",
            "click #waitLink": "clickLink",
            "mousemove .mpPlayerMeter": "movePlayers"
        },

        initialize: function () {
            this.listenTo(Hover.events, "waitingUpdate", _.bind(this.onWaitingUpdate, this));
            this.listenTo(Hover.events, "disconnectWithError", _.bind(this.onDisconnectWithError, this));
            this.joinState = JoinState.UNJOINED;
            this.gameId = parseInt(this.options.gameId, 10);
            // Added in this edition: create the game in classic (Windows 95) mode (chosen on the home
            // screen: Multiplayer > Classic, or the classic-multiplayer address).
            this.classic = !!this.options.classic;
            this.render();
            this.craftSelector = new Hover.views.CustomizeView;
            this.$(".craft").append(this.craftSelector.$el);
            this.playerCount = 2;
        },

        /** Used by the router: the same view for the same game id is not re-shown. */
        equalState: function (otherView) {
            return otherView && otherView.gameId === this.gameId;
        },

        render: function () {
            this.$el.html(Hover.templates.multiplayer());
            var initialState = this.gameId ? ViewState.CRAFT : ViewState.CREATE;
            this.renderState(initialState);
            this.$playerMeter = this.$(".mpPlayerMeter");
            this.$playerMeterHover = this.$(".mpPlayerMeterHover");
            return this;
        },

        onLoaded: function () {
            this.craftSelector.onLoaded();
        },

        renderState: function (state) {
            this.$el.removeClass("mpState-" + this.viewState);
            this.$el.addClass("mpState-" + state);
            this.viewState = state;
            if (this.viewState === ViewState.CRAFT) {
                this.updateJoinState(JoinState.UNJOINED);
            } else if (this.viewState === ViewState.LINK) {
                this.$("#gameLink").val(this.getGameUrl());
                this.$el.addClass("mpCreateGame");
            } else if (this.viewState === ViewState.WAIT) {
                if (!Hover.settings.getLocalGameId()) {
                    this.$("#waitLink").val(this.getGameUrl());
                }
            }
        },

        /** Shareable link to this game ("#mp/<id>" route). */
        getGameUrl: function () {
            var location = window.location,
                url = location.protocol + "//" + location.host + "/#mp/" + this.gameId;
            return url;
        },

        /** Hover highlight on the player-count meter, snapped to quarters. */
        movePlayers: function (event) {
            var x = event.pageX - this.$playerMeter.offset().left,
                percent = 100 * x / this.$playerMeter.width();
            percent = 25 * Math.ceil(percent / 25);
            this.$playerMeterHover.css("width", percent + "%");
        },

        /** Click on the player-count meter: choose 2, 4, 6 or 8 players. */
        clickPlayers: function (event) {
            var x = event.pageX - this.$playerMeter.offset().left,
                count = 8 * x / this.$playerMeter.width();
            count = 2 * Math.ceil(count / 2);
            count = Math.max(count, 2);
            this.updatePlayerCount(count);
        },

        updatePlayerCount: function (count) {
            this.playerCount = count;
            this.$(".mpPlayerCount").text(this.playerCount);
            this.$(".mpPlayersPerTeam").text(playersPerTeamWords[this.playerCount / 2]);
            this.$(".mpPlayerMeterFg").css("width", 12.5 * this.playerCount + "%");
        },

        /** Select the link text so it can be copied. */
        clickLink: function (event) {
            $(event.currentTarget).select();
        },

        createGame: function () {
            var $createButton = this.$(".createButton").hide(),
                playersPerTeam = this.playerCount / 2 || 1;
            Hover.signalr.createGame(playersPerTeam, _.bind(this.onGameCreated, this), function () {
                $createButton.show();
            }, this.classic);
            Hover.analytics.createMultiplayerGame(2 * playersPerTeam);
        },

        onGameCreated: function (gameId) {
            this.gameId = parseInt(gameId, 10);
            this.renderState(ViewState.LINK);
        },

        onConnectError: function () {
        },

        enterGame: function () {
            if (this.gameId) {
                Hover.router.navigate("multiplayer/" + this.gameId, {
                    trigger: false
                });
                this.renderState(ViewState.CRAFT);
            }
        },

        nextCraft: function () {
            if (this.craftSelector) {
                this.craftSelector.nextCraft();
            }
        },

        previousCraft: function () {
            if (this.craftSelector) {
                this.craftSelector.previousCraft();
            }
        },

        joinGame: function () {
            if (this.joinState === JoinState.UNJOINED) {
                var playerName = this.$("#nameTextBox").val().toUpperCase();
                Hover.settings.setPlayerName(playerName);
                this.updateJoinState(JoinState.JOINING);
                this.renderState(ViewState.WAIT);
                var craftProfile = this.craftSelector.getCraftProfile(),
                    self = this;
                Hover.signalr.joinGame(this.gameId, craftProfile.id, playerName, _.bind(this.onGameJoined, this), function () {
                    self.updateJoinState(JoinState.UNJOINED);
                });
                Hover.analytics.joinMultiplayerGame();
            }
        },

        onGameJoined: function () {
            this.updateJoinState(JoinState.JOINED);
        },

        updateJoinState: function (state) {
            this.joinState = state;
            this.$(".enterName").attr("readonly", state !== JoinState.UNJOINED).toggle(state !== JoinState.JOINED);
            this.$(".joinWait").toggle(state === JoinState.JOINED);
            var hasName = !!this.$("#nameTextBox").val();
            this.$("#joinButton").toggle(state !== JoinState.JOINED).toggleClass("disabled", !hasName);
        },

        /**
         * Server lobby update ({WaitingCount, TotalCount, WaitingNames}). When everyone is in,
         * switches to the game; otherwise lists the waiting players.
         */
        onWaitingUpdate: function (waiting) {
            if (waiting.WaitingCount === waiting.TotalCount) {
                var craftProfile = this.craftSelector.getCraftProfile(),
                    playerName = this.$("#nameTextBox").val();
                if (waiting.Classic) {
                    // Added in this edition: a classic game plays in the Windows 95 look with the
                    // 1995 handling (GameView picks Profiles.Classic when no craft is given).
                    Hover.router.setCurrentView(new Hover.views.GameView({
                        retro: true,
                        gameId: this.gameId,
                        playerName: playerName
                    }));
                    return;
                }
                Hover.router.setCurrentView(new Hover.views.GameView({
                    gameId: this.gameId,
                    playerName: playerName,
                    craftProfile: craftProfile
                }));
            } else {
                var nameItems = _.map(waiting.WaitingNames, function (name, index) {
                    name = name || "Player " + (index + 1);
                    return $("<li/>").text(name);
                });
                this.$(".playerNames").empty().append(nameItems);
            }
        },

        onDisconnectWithError: function (message) {
            this.$(".mpError").text(message);
            setTimeout(_.bind(function () {
                Hover.router.navigate("/", {
                    trigger: true
                });
            }, this), 3000);
        },

        remove: function () {
            this.stopListening(Hover.events);
            this.craftSelector.remove();
            Backbone.View.prototype.remove.call(this);
        }
    });
})(jQuery, Hover);
