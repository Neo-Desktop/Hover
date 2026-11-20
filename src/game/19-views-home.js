// Original: game.js lines 3878-3930
// HomeView: the title screen (single player / multiplayer / local game, social links).
// Typing the secret word "bambi" switches to retro mode.

(function ($, Hover) {
    Hover.views.HomeView = Backbone.View.extend({
        id: "homeView",
        retroPassword: "bambi",
        events: {
            "click #singlePlayer": "singlePlayer",
            "click #multiplayer": "multiplayer",
            "click #localGame": "localGame",
            "click #homeModern": "chooseModern",
            "click #homeClassic": "chooseClassic",
            "click #homeLookBack": "chooseBack",
            "click #homeTwitter": "clickTwitter",
            "click #homeFacebook": "clickFacebook"
        },

        initialize: function () {
            this.retroKeyHistory = "";
            $(document).on("keyup.homeview", _.bind(this.onKeyUp, this));
            this.render();
        },

        /** Track typed letters; a wrong letter resets, the full password enters retro mode. */
        onKeyUp: function (event) {
            var key = String.fromCharCode(event.which).toLowerCase();
            if (key) {
                var expected = this.retroPassword[this.retroKeyHistory.length];
                if (key !== expected) {
                    this.retroKeyHistory = "";
                } else {
                    this.retroKeyHistory += key;
                    if (this.retroKeyHistory === this.retroPassword) {
                        Hover.router.retro();
                        return;
                    }
                }
            }
        },

        render: function () {
            this.$el.html(Hover.templates.home({
                showLocalGame: !!Hover.settings.getLocalGameId()
            }));
            return this;
        },

        /**
         * This edition: Single Player and Multiplayer first ask which Hover! to play, the modern 3D
         * look (the 2013 remake) or the classic Windows 95 look, then go to that flow.
         */
        singlePlayer: function () {
            this.chooseLook("single");
        },

        multiplayer: function () {
            this.chooseLook("multi");
        },

        chooseLook: function (mode) {
            Hover.analytics.atlasAction("SMG_MRTINX_Hover_Play");
            this.lookFor = mode;
            this.swapButtons(
                '<li class="homeLookPrompt">' + (mode === "single" ? "Single Player" : "Multiplayer") + ": choose your Hover!</li>" +
                '<li id="homeModern" class="homeButton">Modern</li>' +
                '<li id="homeClassic" class="win32Button"><u>C</u>lassic (Windows 95)</li>' +
                '<li id="homeLookBack" class="homeLookBack">Back</li>', true);
        },

        chooseBack: function () {
            this.swapButtons(this.homeButtonsHtml, false);
        },

        /**
         * Swaps the buttons under the logo with a short fade and slide. Only the buttons change: the
         * list also holds the Tweet and Share links (an unclosed <ul> in the 2013 template nests them
         * in it), which stay.
         */
        swapButtons: function (html, choosing) {
            var $list = this.$("#homeButtons");
            if (!this.homeButtonsHtml) {
                this.homeButtonsHtml = _.map($list.children("li").get(), function (item) {
                    return item.outerHTML;
                }).join("");
            }
            clearTimeout(this.swapTimer);
            $list.removeClass("homeButtonsIn").addClass("homeButtonsOut");
            this.swapTimer = setTimeout(function () {
                $list.children("li").remove();
                $list.prepend(html).toggleClass("homeLookChoice", choosing).removeClass("homeButtonsOut");
                $list.get(0).offsetWidth; // restart the animation
                $list.addClass("homeButtonsIn");
            }, 180);
        },

        chooseModern: function () {
            Hover.router.navigate(this.lookFor === "single" ? "single-player" : "multiplayer", {
                trigger: true
            });
        },

        chooseClassic: function () {
            // Classic single player opens on its start-up room; classic multiplayer on the create
            // screen, making a classic-look game.
            Hover.router.navigate(this.lookFor === "single" ? "retro" : "classic-multiplayer", {
                trigger: true
            });
        },

        localGame: function () {
            Hover.analytics.atlasAction("SMG_MRTINX_Hover_Play");
            Hover.router.navigate("local-game", {
                trigger: true
            });
        },

        remove: function () {
            $(document).off("keyup.homeview");
            Backbone.View.prototype.remove.call(this);
        },

        clickTwitter: function () {
            Hover.social.tweet();
            Hover.analytics.buttonClick("twitter");
        },

        clickFacebook: function () {
            Hover.social.share();
            Hover.analytics.buttonClick("facebook");
        }
    });
})(jQuery, Hover);
