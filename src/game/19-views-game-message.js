// Original: game.js lines 3616-3697
// GameMessageView: in-game message overlay. "Large" messages (mission intro, level won/lost,
// match results) wait for a button click and then run a callback; "small" messages (pod
// pick-up hints) fade out on their own after 3 seconds.

(function ($, Hover) {
    /** Message type ids; also used as the "msg-<type>" CSS class on the view. */
    var MESSAGE_TYPES = {
        INTRO: "intro",
        LEVEL_WON: "level-won",
        LEVEL_LOST: "level-lost",
        GAME_WON: "game-won",
        MULTIPLAYER_WON: "multiplayer-won",
        MULTIPLAYER_TIED: "multiplayer-tied",
        MULTIPLAYER_LOST: "multiplayer-lost",
        HIT_FASTPOD: "hit-fastpod",
        HIT_SLOWPOD: "hit-slowpod",
        HIT_MAPERASER: "hit-maperaser",
        HIT_SHIELD: "hit-shield",
        HIT_SPRING: "hit-spring",
        HIT_WALL: "hit-wall",
        HIT_CLOAK: "hit-cloak",
        HIT_RANDOM: "hit-random"
    };

    Hover.views.GameMessageView = Backbone.View.extend({
        id: "gameMessageView",
        events: {
            "click .msgButton": "clickLargeButton"
        },
        messageTypes: MESSAGE_TYPES,

        /** @param {jQuery} $messageBackground  the dimmed backdrop element shown behind messages */
        initialize: function ($messageBackground) {
            this.$messageBackground = $messageBackground;
            this.render();
        },

        render: function () {
            this.$el.html(Hover.templates.gameMessage());
            return this;
        },

        /**
         * Show the message for `type` (one of messageTypes). `callback` runs when a large
         * message is dismissed. Returns whether the message was shown.
         */
        showMessage: function (type, callback) {
            if (this.currMessageType) {
                this.$el.removeClass("msg-" + this.currMessageType);
            }
            this.$el.addClass("msg-" + type);
            this.currMessageType = type;
            switch (type) {
                case MESSAGE_TYPES.INTRO:
                    return this.showLargeMessage("Your Mission", "Find and capture the other team's flags<br>before they get yours.", "Got it!", callback);
                case MESSAGE_TYPES.LEVEL_WON:
                    Hover.audio.getSound("WINLEVEL").play();
                    return this.showLargeMessage("You did it!", "Congratulations.<br>You may advance to the next level.", "Next Level", callback);
                case MESSAGE_TYPES.LEVEL_LOST:
                    Hover.audio.getSound("GAMEOVR").play();
                    return this.showLargeMessage("Game Over", "Sorry, you lost.<br>But, don't give up. Practice makes perfect.", "Try Again", callback);
                case MESSAGE_TYPES.GAME_WON:
                    Hover.audio.getSound("WINLEVEL").play();
                    return this.showLargeMessage("You Won!", "Congratulations on a successful mission!<br>Had fun? Don't forget to tell your friends.", "Play Again", callback);
                case MESSAGE_TYPES.MULTIPLAYER_WON:
                    Hover.audio.getSound("WINLEVEL").play();
                    return this.showLargeMessage("You Won!", "Congratulations on your victory!", "Play Again", callback);
                case MESSAGE_TYPES.MULTIPLAYER_TIED:
                    Hover.audio.getSound("GAMEOVR").play();
                    return this.showLargeMessage("Tie Game", "If at first you don't succeed, tie, tie again!", "Play Again", callback);
                case MESSAGE_TYPES.MULTIPLAYER_LOST:
                    Hover.audio.getSound("GAMEOVR").play();
                    return this.showLargeMessage("Game Over", "Sorry, you lost.<br>But, don't give up. Practice makes perfect.", "Play Again", callback);
                case MESSAGE_TYPES.HIT_FASTPOD:
                    return this.showSmallMessage("Green Light", "Green lights give you a speed boost for 20 seconds.");
                case MESSAGE_TYPES.HIT_SLOWPOD:
                    return this.showSmallMessage("Red Light", "Red lights slow you down for 20 seconds.");
                case MESSAGE_TYPES.HIT_MAPERASER:
                    return this.showSmallMessage("Map Eraser", "The map eraser clears your map so you have to rebuild.");
                case MESSAGE_TYPES.HIT_SPRING:
                    return this.showSmallMessage("Bounce", "The spring gives you the power to bounce your craft. (Press the A key.)");
                case MESSAGE_TYPES.HIT_WALL:
                    return this.showSmallMessage("Wall", "The wall lets you place a temporary wall in the game. (Press the S key.)");
                case MESSAGE_TYPES.HIT_CLOAK:
                    return this.showSmallMessage("Cloak", "The cloak makes you invisible to your opponent. (Press the D key.)");
                case MESSAGE_TYPES.HIT_SHIELD:
                    return this.showSmallMessage("Shield", "The shield makes you invincible for 20 seconds.");
                case MESSAGE_TYPES.HIT_RANDOM:
                    return this.showSmallMessage("Question Mark", "Question marks are random. They will become any other pick up item!");
            }
        },

        /** A modal message with a button; returns false if a message is already visible. */
        showLargeMessage: function (title, text, buttonText, callback) {
            if (this.messageVisible) {
                return false;
            }
            this.$(".msgLargeTitle").html(title);
            this.$(".msgLargeText").html(text);
            this.$(".msgButton").html(buttonText).show();
            this.$(".msgLarge").show();
            this.callback = callback;
            this.$messageBackground.removeClass("small").addClass("large");
            this.$messageBackground.fadeIn();
            this.messageVisible = true;
            this.$el.fadeIn();
            return true;
        },

        /**
         * A transient hint that fades out after 3 s; returns false if a message is already
         * visible. In retro mode nothing is shown but true is still returned.
         */
        showSmallMessage: function (title, text) {
            if (this.messageVisible) {
                return false;
            }
            if (!Hover.retro) {
                this.$(".msgSmallTitle").html(title);
                this.$(".msgSmallText").html(text).show();
                this.$(".msgSmall").show();
                this.$messageBackground.removeClass("large").addClass("small");
                this.$messageBackground.fadeIn().delay(3000).fadeOut();
                this.messageVisible = true;
                this.$el.fadeIn().delay(3000).fadeOut($.proxy(function () {
                    this.hideMessage();
                }, this));
            }
            return true;
        },

        /** Hide the message and run the pending callback (if any). */
        hideMessage: function () {
            this.messageVisible = false;
            this.$messageBackground.fadeOut(250);
            this.$el.fadeOut(250, function () {
                $(".msgLarge, .msgSmall, .msgIntro, .msgButton").hide();
            });
            // This edition: run the callback only once. The button stays clickable while the message
            // fades out, and a second click used to start a second copy of the next level, whose
            // clean-up then wiped out the graphics of the one on screen.
            var callback = this.callback;
            this.callback = null;
            if (callback) {
                callback.apply();
            }
        },

        clickLargeButton: function (event) {
            this.hideMessage();
        }
    });
})(jQuery, Hover);
