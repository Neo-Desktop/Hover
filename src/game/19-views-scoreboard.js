// Original: game.js lines 4233-4286
// ScoreboardView: big-screen scoreboard for a "local game" (an event/kiosk game whose id is stored in
// settings). Polls the game server's scoreboard API (JSONP) and shows per-team flag counts,
// the time left and the high-score list.

(function ($, Hover) {
    Hover.views.ScoreboardView = Backbone.View.extend({
        id: "scoreboardView",

        events: {},

        initialize: function () {
            this.render();
            this.updateScores();
            this.lastUpdate = 0;
        },

        render: function () {
            this.$el.html(Hover.templates.scoreboard());
            this.$redTeamScores = this.$("#redTeamScores");
            this.$blueTeamScores = this.$("#blueTeamScores");
            this.$description = this.$("#sbDescription");
            this.$timeLeft = this.$("#sbTimeLeft");
            this.$highScoreSection = this.$("#highScoreSection");
            this.$highScores = this.$("#highScores");
            return this;
        },

        /**
         * Runs every second: refreshes the time-left text, and fetches the scores at most every
         * 5 seconds (or every tick during the 10 seconds after the game ends).
         */
        updateScores: function () {
            var localGameId = Hover.settings.getLocalGameId();
            if (!localGameId) {
                this.renderScores(null);
                return;
            }
            var timeLeftText = "";
            if (this.gameEnds) {
                var remainingSeconds = Hover.ModernHud.getRemainingSeconds(this.gameEnds);
                if (remainingSeconds > 0) {
                    timeLeftText = Hover.ModernHud.getTimeLeftString(remainingSeconds);
                }
            }
            this.$timeLeft.text(timeLeftText);
            var now = Date.now(),
                justEnded = false;
            if (this.gameEnds) {
                var secondsSinceEnd = (now - this.gameEnds) / 1000;
                justEnded = secondsSinceEnd >= 0 && secondsSinceEnd < 10;
            }
            if (now - this.lastUpdate > 5000 || justEnded) {
                $.ajax({
                    dataType: "jsonp",
                    type: "GET",
                    url: Hover.settings.gameServerUrl + "api/scoreboard/" + localGameId,
                    success: _.bind(this.renderScores, this),
                    error: function (jqXHR, textStatus, errorThrown) {
                        console.log("error fetching scores: " + errorThrown);
                    }
                });
                this.lastUpdate = now;
            }
            this.updateTimeoutId = setTimeout(_.bind(this.updateScores, this), 1000);
        },

        /**
         * data: {scores: [{name, team, capturedFlags}], description, endTime,
         *        highScores: [{name, flags, seconds}]}
         */
        renderScores: function (data) {
            var i, count, entry, $item, scores, flagsWord, timeString, rankPrefix,
                description = "",
                redItems = [],
                blueItems = [],
                highScoreItems = [];
            if (data && data.scores) {
                scores = data.scores || [];
                description = data.description;
                if (data.endTime) {
                    this.gameEnds = new Date(data.endTime).getTime();
                }
                for (i = 0, count = scores.length; i < count; i++) {
                    entry = scores[i];
                    $item = $("<li/>")
                        .append($("<div/>").addClass("sbName").text(entry.name))
                        .append($("<div/>").addClass("sbScore").text(entry.capturedFlags || 0));
                    if ("red" === entry.team.toLowerCase()) {
                        redItems.push($item);
                    } else {
                        blueItems.push($item);
                    }
                }
                if (data.highScores) {
                    for (i = 0, count = data.highScores.length; i < count; i++) {
                        entry = data.highScores[i];
                        flagsWord = 1 === entry.flags ? " FLAG" : " FLAGS";
                        timeString = Hover.ModernHud.getTimeLeftString(entry.seconds || 0);
                        rankPrefix = i + 1 + ". ";
                        $item = $("<li/>")
                            .append($("<div/>").addClass("hsName").text(rankPrefix + entry.name))
                            .append($("<div/>").addClass("hsScore").html(entry.flags + '<span class="hsFlagsIn">' + flagsWord + " IN </span>" + timeString));
                        highScoreItems.push($item);
                    }
                    if (highScoreItems.length > 0) {
                        this.$highScoreSection.show();
                        this.$highScores.html(highScoreItems);
                    }
                }
                this.$description.text(description);
                this.$redTeamScores.html(redItems);
                this.$blueTeamScores.html(blueItems);
            }
        },

        remove: function () {
            if (this.updateTimeoutId) {
                clearTimeout(this.updateTimeoutId);
            }
            Backbone.View.prototype.remove.call(this);
        }
    });
})(jQuery, Hover);
