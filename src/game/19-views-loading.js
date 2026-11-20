// Original: game.js lines 4077-4096
// LoadingView: the "loading NN%" screen shown while images and sounds preload.

(function ($, Hover) {
    Hover.views.LoadingView = Backbone.View.extend({
        id: "loadingView",

        initialize: function () {
            this.render();
            this.updateProgress(0);
            this.listenTo(Hover.events, "soundLoadProgress", _.bind(function (loaded, total) {
                var percent = Math.round(loaded / total);
                this.updateProgress(percent);
            }, this));
            // This edition: the release build's asset pack (src/pack.js).
            this.listenTo(Hover.events, "packProgress", _.bind(this.updateProgress, this));
            if (!HoverPack.ready) {
                this.updateProgress(Math.floor(100 * HoverPack.loaded / (HoverPack.total || 1)));
            }
        },

        render: function () {
            this.$el.html(Hover.templates.loading());
            return this;
        },

        updateProgress: function (percent) {
            if (Hover.loader.assetsReady) {
                percent = 100;
            }
            this.$("#loadPercent").text(percent + "%");
        },

        remove: function () {
            this.stopListening(Hover.events);
            Backbone.View.prototype.remove.call(this);
        }
    });
})(jQuery, Hover);
