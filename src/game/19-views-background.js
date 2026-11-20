// Original: game.js lines 3233-3293
// BackgroundView: the animated starfield drawn on #starsCanvas behind every screen.
// Stars fly outward from a (movable) centre point; their speed and centre can be eased
// to new values with setStarSpeed / setStarCenter.

(function ($, Hover) {
    Hover.views.BackgroundView = Backbone.View.extend({
        el: "#background",

        initialize: function () {
            this.stars = [];
            this.starMinSpeed = 10;
            this.starSpeedDelta = 0.02;
            this.starSpeedRange = {
                min: 0.001,
                max: 0.25
            };
            this.starCount = 500;
            this.starCenterX = 0.5;
            this.starCenterY = 0.25;
            this.starImg = Hover.images.star;
            this.starsCanvas = document.getElementById("starsCanvas");
            this.render();
            // Empty handlers kept from the original.
            $(window).resize($.proxy(function () {
            }, this));
            Hover.router.on("route", $.proxy(function (route, params) {
            }, this));
            // Pre-advance the starfield (without drawing) so it starts out spread across the screen.
            for (var i = 0; i < 500; i++) {
                this.updateStars(true);
            }
            this.listenTo(Hover.events, "loaderReady", _.bind(function () {
                this.updateStars(false);
            }, this));
        },

        render: function () {
            return this;
        },

        /** One animation frame; keeps requesting frames while animationOn is set. */
        renderFrame: function () {
            if (!this.frame) {
                this.frame = 0;
            }
            this.frame++;
            this.updateStars();
            if (this.animationOn) {
                window.requestAnimationFrame($.proxy(this.renderFrame, this));
            }
        },

        /** (Re)spawn a star at a random position with the starting speed. (Name typo is original.) */
        intializeStar: function (star) {
            star.x = (Math.random() * this.starsCanvas.width - 0.5 * this.starsCanvas.width) * this.starMinSpeed;
            star.y = (Math.random() * this.starsCanvas.height - 0.5 * this.starsCanvas.height) * this.starMinSpeed;
            star.speed = this.starMinSpeed;
            star.lastX = 0;
            star.lastY = 0;
            star.alpha = 0.9 * Math.random() + 0.1;
            star.fade = 0;
        },

        /**
         * Advance all stars one step and redraw them.
         * @param {boolean} skipDraw  when true, only moves the stars (used to pre-warm the field).
         */
        updateStars: function (skipDraw) {
            if (this.starsCanvas) {
                // Ease the star speed toward its target.
                if (this.starSpeedTo) {
                    this.starSpeedDelta = $.easing.easeInOutQuad(null, this.frame - this.starSpeedStartFrame, this.starSpeedFrom, this.starSpeedTo - this.starSpeedFrom, this.starSpeedDuration);
                    if (this.frame >= this.starSpeedStartFrame + this.starSpeedDuration) {
                        this.starSpeedTo = null;
                    }
                }
                // Ease the starfield centre toward its target.
                if (this.starCenterTo) {
                    this.starCenterX = $.easing.easeInOutQuad(null, this.frame - this.starCenterStartFrame, this.starCenterFrom.x, this.starCenterTo.x - this.starCenterFrom.x, this.starCenterDuration);
                    this.starCenterY = $.easing.easeInOutQuad(null, this.frame - this.starCenterStartFrame, this.starCenterFrom.y, this.starCenterTo.y - this.starCenterFrom.y, this.starCenterDuration);
                    if (this.frame >= this.starCenterStartFrame + this.starCenterDuration) {
                        this.starCenterTo = null;
                    }
                }
                // Lazily set up the canvas and the star list.
                if (!this.starsContext) {
                    this.starsContext = this.starsCanvas.getContext("2d");
                    this.starsCanvas.width = $(this.starsCanvas).width();
                    this.starsCanvas.height = $(this.starsCanvas).height();
                    for (var s = 0; s < this.starCount; s++) {
                        var newStar = {};
                        this.intializeStar(newStar);
                        this.stars.push(newStar);
                    }
                }
                var alpha;
                var width = this.starsCanvas.width;
                var height = this.starsCanvas.height;
                var centerX = Math.floor(this.starCenterX * width - width / 2 + width / 2);
                var centerY = Math.floor(this.starCenterY * height - height / 2 + height / 2);
                this.starsContext.clearRect(0, 0, width, height);
                for (var j = 0; j < this.starCount; j++) {
                    var drawX;
                    var drawY;
                    var star = this.stars[j];
                    // Perspective: stars grow and move outward as their "speed" (depth) shrinks.
                    var size = Math.floor(50 / star.speed) + 1;
                    var projX = Math.floor(star.x / star.speed);
                    var projY = Math.floor(star.y / star.speed);
                    if (star.lastX !== 0) {
                        if (star.fade < 1) {
                            alpha = star.alpha * star.fade;
                            star.fade = star.fade + this.starSpeedDelta / 5;
                        } else {
                            alpha = star.alpha;
                        }
                        if (!skipDraw && this.starImg.complete) {
                            drawX = projX + centerX;
                            drawY = projY + centerY;
                            if (drawX + size > 0 || drawY + size > 0) {
                                if (this.starsContext.globalAlpha !== alpha) {
                                    this.starsContext.globalAlpha = alpha;
                                }
                                this.starsContext.drawImage(this.starImg, drawX, drawY, size, size);
                            }
                        }
                    }
                    star.lastX = projX;
                    star.lastY = projY;
                    star.speed -= this.starSpeedDelta;
                    if (star.speed < this.starSpeedDelta || star.lastX > width || star.lastY > height) {
                        this.intializeStar(star);
                    }
                }
            }
        },

        /**
         * Ease the star speed to a fraction (0..1) of starSpeedRange over `duration` frames
         * and start animating; a speed of 0 (or less) stops the animation.
         */
        setStarSpeed: function (speed, duration) {
            if (speed > 0) {
                this.starSpeedFrom = this.starSpeedDelta;
                this.starSpeedTo = this.starSpeedRange.min + speed * (this.starSpeedRange.max - this.starSpeedRange.min);
                this.starSpeedStartFrame = this.frame || 0;
                this.starSpeedDuration = duration || 30;
                this.animationOn = true;
                this.renderFrame();
            } else {
                this.animationOn = false;
            }
        },

        /** Ease the starfield centre (fractions of the canvas size) to (x, y) over `duration` frames. */
        setStarCenter: function (x, y, duration) {
            this.starCenterFrom = {
                x: this.starCenterX,
                y: this.starCenterY
            };
            this.starCenterTo = {
                x: x,
                y: y
            };
            this.starCenterStartFrame = this.frame || 0;
            this.starCenterDuration = duration || 30;
        }
    });
})(jQuery, Hover);
