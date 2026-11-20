// Original: game.js lines 4307-4342
// SinglePlayerView: choose a craft, then start a single-player game.

(function ($, Hover) {
    Hover.views.SinglePlayerView = Backbone.View.extend({
        id: "singlePlayerView",

        events: {
            "click .playButton": "play",
            "click .leftChooserButton": "previousCraft",
            "click .rightChooserButton": "nextCraft"
        },

        initialize: function () {
            this.render();
            this.craftSelector = new Hover.views.CustomizeView;
            this.$(".craft").append(this.craftSelector.$el);
        },

        render: function () {
            this.$el.html(Hover.templates.singlePlayer());
            return this;
        },

        onLoaded: function () {
            this.craftSelector.onLoaded();
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

        play: function () {
            var craftProfile = this.craftSelector.getCraftProfile();
            Hover.router.navigate("single-player/play", {
                trigger: false
            });
            Hover.router.setCurrentView(new Hover.views.GameView({
                craftProfile: craftProfile
            }));
        },

        remove: function () {
            this.craftSelector.remove();
            Backbone.View.prototype.remove.call(this);
        }
    });
})(jQuery, Hover);
