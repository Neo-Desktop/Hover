// Original: game.js lines 4343-4371
// UpgradeView: shown instead of the game when the browser is unsupported (Hover.upgrade);
// the buttons are links in the template and only report analytics here.

(function ($, Hover) {
    Hover.views.UpgradeView = Backbone.View.extend({
        id: "upgradeView",

        events: {
            "click #upgradeWin8Button": "upgradeWin8Button",
            "click #upgradeWin7Button": "upgradeWin7Button",
            "click #upgradeWinPrevButton": "upgradeWinPrevButton",
            "click #upgradeNonWinButton": "upgradeNonWinButton"
        },

        initialize: function () {
            this.render();
        },

        render: function () {
            this.$el.html(Hover.templates.upgrade());
            return this;
        },

        upgradeWin8Button: function () {
            Hover.analytics.buttonClick("Win8 Upgrade");
        },

        upgradeWin7Button: function () {
            Hover.analytics.buttonClick("Win7 Upgrade");
        },

        upgradeWinPrevButton: function () {
            Hover.analytics.buttonClick("WinPrevious Upgrade");
        },

        upgradeNonWinButton: function () {
            Hover.analytics.buttonClick("NonWin Upgrade");
        }
    });
})(jQuery, Hover);
