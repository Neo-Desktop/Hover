// Original: game.js lines 3441-3530 (the Viewer3D.Names / StatsGraph* definitions that followed
// CustomizeView in the same module, lines 3530-3614, live in 18-viewer3d.js)
// CustomizeView: the craft selection screen. Shows a rotating 3D preview of each hovercraft
// (Viewer3D.Scene), a stats chart (Viewer3D.StatsGraph) and an animated craft name.

(function ($, Hover) {
    Hover.views.CustomizeView = Backbone.View.extend({
        id: "customizeView",
        craftCount: 3,

        initialize: function () {
            this.render();
            this.changingCraft = false;
            $(window).on("resize.CustomizeView", _.bind(this.resize, this));
        },

        /** The craft handling profile matching the selected craft. */
        getCraftProfile: function () {
            switch (this.currentCraftIndex) {
                case 0:
                    return Hover.Profiles.Easy;
                case 1:
                    return Hover.Profiles.Normal;
                case 2:
                    return Hover.Profiles.Hard;
                default:
                    return Hover.Profiles.Easy;
            }
        },

        /** Hook up drag-to-rotate on the craft drag area. */
        onLoaded: function () {
            $(".craftDrag").on({
                pxpointerstart: _.bind(this.rotateBegin, this),
                pxpointermove: _.bind(this.rotateMove, this),
                pxpointerend: _.bind(this.rotateEnd, this)
            });
        },

        /** Unused: builds a points list from a craft's chart attributes but doesn't return it. */
        craftAttributesToPoints: function (craft) {
            var points = [];
            points.push(craft.chartAttributes.power);
            points.push(craft.chartAttributes.speed);
            points.push(craft.chartAttributes.agility);
            points.push(craft.chartAttributes.stability);
        },

        /** Switch preview, chart, name and dot indicator to the craft at `index`. */
        gotoCraft: function (index) {
            if (!this.changingCraft) {
                this.changingCraft = true;
                this.scene.gotoCraft(index);
                this.graph.setPoints(Viewer3D.StatsGraphValues[index], Viewer3D.StatsGraphLabels, true);
                this.changeCraftText(Viewer3D.Names[index]);
                var dots = this.$(".customizeCraftDot");
                dots.removeClass("selected");
                $(dots[index]).addClass("selected");
                this.currentCraftIndex = index;
                Hover.settings.setLastCraft(index); // this edition: remembered for next time
            }
        },

        nextCraft: function () {
            var index = this.currentCraftIndex >= this.craftCount - 1 ? 0 : this.currentCraftIndex + 1;
            this.gotoCraft(index);
        },

        previousCraft: function () {
            var index = this.currentCraftIndex <= 0 ? this.craftCount - 1 : this.currentCraftIndex - 1;
            this.gotoCraft(index);
        },

        rotateBegin: function (event) {
            this.scene.beginRotateCurrentCraft(event.pointer.x, event.pointer.y);
        },

        rotateMove: function (event) {
            this.scene.rotateCurrentCraft(event.pointer.x, event.pointer.y);
        },

        rotateEnd: function (event) {
            this.scene.endRotateCurrentCraft();
        },

        render: function () {
            this.$el.html(Hover.templates.customize());
            this.$webGLContainer = this.$("#webglContainer");
            this.$("#nextTest").on("click", _.bind(function (event) {
                this.nextCraft();
            }, this));
            var $window = $(window);
            var scene = new Viewer3D.Scene({
                container: this.$webGLContainer.get(0),
                width: $window.width(),
                height: $window.height() + 180
            });
            var graph = new Viewer3D.StatsGraph(this.$("#customizeStatsCanvas").get(0));
            scene.addEventListener("craftsLoaded", _.bind(this.craftsLoaded, this));
            scene.render();
            this.scene = scene;
            this.graph = graph;
            // This edition: start on the craft chosen last time (the remake always showed the first).
            this.gotoCraft(Hover.settings.getLastCraft());
            return this;
        },

        craftsLoaded: function () {
        },

        resize: function () {
            this.scene.resize();
        },

        /**
         * Animate the craft name: after 650 ms, hide the old name's letters one by one (last
         * first, 30 ms apart), then reveal the new name's letters one by one. Clears
         * changingCraft when done.
         */
        changeCraftText: function (name) {
            clearTimeout(this.titleTextTimeout);
            clearInterval(this.titleTextInterval);
            this.titleTextTimeout = setTimeout($.proxy(function () {
                var html = "";
                $.map(name.split(""), function (letter) {
                    html += '<span class="customizeTitleHidden">' + letter + "</span>";
                });
                this.titleTextInterval = setInterval($.proxy(function () {
                    var lastVisible = this.$(".customizeTitleVisible").last();
                    if (lastVisible.length > 0) {
                        lastVisible.addClass("customizeTitleHidden");
                        lastVisible.removeClass("customizeTitleVisible");
                    } else {
                        clearInterval(this.titleTextInterval);
                        this.$(".customizeCraftName").html(html);
                        this.titleTextInterval = setInterval($.proxy(function () {
                            var firstHidden = this.$(".customizeTitleHidden").first();
                            if (firstHidden.length > 0) {
                                firstHidden.removeClass("customizeTitleHidden");
                                firstHidden.addClass("customizeTitleVisible");
                            } else {
                                clearInterval(this.titleTextInterval);
                                this.changingCraft = false;
                            }
                        }, this), 30);
                    }
                }, this), 30);
            }, this), 650);
        },

        remove: function () {
            $(window).off("resize.CustomizeView");
            $(".craftDrag").off("pxpointerstart pxpointermove pxpointerend");
            Backbone.View.prototype.remove.call(this);
        }
    });
})(jQuery, Hover);
