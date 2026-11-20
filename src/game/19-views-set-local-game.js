// Original: game.js lines 4287-4306
// SetLocalGameView: small form ("local-game/set" route) that stores the id of the local
// (event/kiosk) multiplayer game in settings, then goes to the "local-game" route.

(function ($, Hover) {
    Hover.views.SetLocalGameView = Backbone.View.extend({
        id: "setLocalGameView",

        events: {
            "click .simpleFormButton": "updateGameId"
        },

        initialize: function () {
            this.render();
        },

        render: function () {
            this.$el.html(Hover.templates.setLocalGame());
            return this;
        },

        updateGameId: function () {
            var gameId = parseInt(this.$("#gameIdTextBox").val(), 10) || null;
            Hover.settings.setLocalGameId(gameId);
            Hover.router.navigate("local-game", {
                trigger: true
            });
        }
    });
})(jQuery, Hover);
