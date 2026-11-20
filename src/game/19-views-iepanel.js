// Original: game.js lines 3943-4076
// IEPanelView: the slide-out "Internet Explorer" promo panel (#iepanel) with About/Technology tabs
// and an embedded YouTube video player.

(function ($, Hover) {
    // Set once the YouTube iframe API has loaded (it calls window.onYouTubeIframeAPIReady).
    var youTubeApiReady = false;

    window.onYouTubeIframeAPIReady = function () {
        youTubeApiReady = true;
        if (Hover.events) {
            Hover.events.trigger("youTubeReady");
        }
    };

    // Text and links rendered into the panel template.
    var panelContent = {
        videoId: "HKj4afxzANg",
        videoWidth: 1280,
        videoHeight: 720,
        headerMessage1: "We’re building world-class sites",
        headerMessage2: "to move the web forward.",
        aboutMessage: "Hover is a classic capture-the-flag game, originally created as a multimedia showcase game for Windows 95. Now, its available on the web—with touch-friendly features, multiplayer gameplay, and brand new 3D graphics—thanks to Internet Explorer!",
        aboutDan1: 'But we couldn\'t have done it alone. We partnered with <a href="http://www.geekwire.com/2013/windows-95-game-hover-reborn-indie-developer-happen/">Dan Church</a>, an independent developer, who first approached the IE team with the idea of recreating Hover. ',
        aboutDan2: "Dan's interest in becoming a developer was first sparked by Hover back in the 90's—so his passion for this project was unmatched! Dan played a pivotal role in the development of the gameplay and graphics for the project.",
        techMessage: 'Hover was created using technology including <a href="http://www.modern.ie/category/hover-ie">WebGL</a>, <a href="http://msdn.microsoft.com/library/ie/hh673567.aspx">WebSockets</a>, and <a href="http://msdn.microsoft.com/en-us/library/ie/dn433244(v=vs.85).aspx">PointerEvents</a>. Get the story on the tools that went into bringing Hover back to life.',
        headerMoreLink: "http://windows.microsoft.com/en-us/internet-explorer/go-explore-ie",
        techMoreLink: " http://www.modern.ie/category/hover-ie"
    };

    Hover.views.IEPanelView = Backbone.View.extend({
        el: "#iepanel",

        events: {
            "click #ieTab": "showPanel",
            "click #iePanelOverlay": "hidePanel",
            "click #iePanelClose": "hidePanel",
            "click #iePanelContentVideo": "showVideo",
            "click #ieVideoClose": "hideVideo",
            "click #iePanelTabAbout": "showAbout",
            "click #iePanelTabTechnology": "showTech",
            "click #iePanelContentMore": "clickSeeMore",
            "click #iePanelHeaderButton": "clickLearnMore",
            "click #iePanelBehindScenes": "clickBehindScenes"
        },

        initialize: function () {
            this.render();
            var attentionIntervalSeconds = 12;
            // Wiggle the tab shortly after load, then periodically.
            setTimeout($.proxy(function () {
                this.getAttention();
            }, this), 2000);
            setInterval($.proxy(function () {
                this.getAttention();
            }, this), 1000 * attentionIntervalSeconds);
            if (youTubeApiReady) {
                this.initVideo();
            } else {
                this.listenTo(Hover.events, "youTubeReady", _.bind(function () {
                    this.initVideo();
                }, this));
            }
        },

        render: function () {
            this.$el.html(Hover.templates.iepanel(panelContent));
            this.$panel = this.$("#iePanel");
            this.$overlay = this.$("#iePanelOverlay");
            this.$tablogo = this.$("#ieTabLogo");
            this.$video = this.$("#ieVideo");
            this.$videoPanelThumb = this.$("#iePanelContentVideoThumb");
            this.$videoContent = this.$("#ieVideoContent");
            this.$videoThumb = this.$("#ieVideoThumb");
            return this;
        },

        initVideo: function () {
            this.youtubeReady = true;
            this.youtubePlayer = new YT.Player("ieVideoFrame", {
                videoId: panelContent.videoId,
                playerVars: {
                    autoplay: 0,
                    controls: 1,
                    color: "white",
                    modestbranding: 1,
                    showinfo: 0,
                    html5: 1
                }
            });
            this.$videoFrame = this.$("#ieVideoFrame");
        },

        /** Briefly adds the "attention" class (CSS animation) to the panel tab. */
        getAttention: function () {
            this.$el.addClass("attention");
            setTimeout($.proxy(function () {
                this.$el.removeClass("attention");
            }, this), 1000);
        },

        showPanel: function () {
            Hover.analytics.buttonClick("iePanel");
            Hover.events.trigger("panelShowing");
            this.showAbout();
            setTimeout($.proxy(function () {
                this.$overlay.show();
                this.$panel.addClass("showing");
            }, this), 0);
        },

        hidePanel: function () {
            Hover.events.trigger("panelHiding");
            setTimeout($.proxy(function () {
                this.$overlay.hide();
                this.$panel.removeClass("showing");
            }, this), 0);
        },

        /**
         * Grows the video box from the thumbnail's position to a large, aspect-correct size
         * centred in the window, then starts playback.
         */
        showVideo: function () {
            if (this.youtubeReady) {
                var margin = 40,
                    chromeHeight = 28,
                    videoWidth = panelContent.videoWidth,
                    videoHeight = panelContent.videoHeight,
                    thumbOffset = this.$videoPanelThumb.offset();
                this.$videoContent.css({
                    left: thumbOffset.left + "px",
                    top: thumbOffset.top + "px",
                    width: this.$videoPanelThumb.width(),
                    height: this.$videoPanelThumb.height()
                });
                var availableWidth = $(window).width() - 2 * margin,
                    availableHeight = $(window).height() - 2 * margin,
                    size = this.getAspectAwareSize(availableWidth, availableHeight, videoWidth, videoHeight);
                this.$video.show();
                setTimeout($.proxy(function () {
                    this.$videoContent.css({
                        width: size.width,
                        height: size.height + chromeHeight,
                        left: margin + (availableWidth / 2 - size.width / 2),
                        top: margin + (availableHeight / 2 - size.height / 2)
                    });
                }, this), 0);
                setTimeout($.proxy(function () {
                    this.$videoFrame.show();
                    this.$videoThumb.hide();
                    if (this.youtubePlayer) {
                        this.youtubePlayer.playVideo();
                    }
                }, this), 650);
                Hover.analytics.videoPlay("IE - Hover Destiny");
            }
        },

        hideVideo: function () {
            this.$video.fadeOut(500, $.proxy(function () {
                if (this.youtubePlayer) {
                    this.youtubePlayer.stopVideo();
                }
                this.$videoFrame.hide();
                this.$videoThumb.show();
            }, this));
        },

        /** Largest size with the content's aspect ratio that fits inside maxWidth x maxHeight. */
        getAspectAwareSize: function (maxWidth, maxHeight, contentWidth, contentHeight) {
            var boxRatio = maxWidth / maxHeight,
                contentRatio = contentWidth / contentHeight,
                width = maxWidth,
                height = maxHeight;
            if (contentRatio > boxRatio) {
                width = maxWidth;
                height = maxWidth / contentRatio;
            } else {
                width = maxHeight * contentRatio;
                height = maxHeight;
            }
            return {
                width: width,
                height: height
            };
        },

        showAbout: function () {
            this.$("#iePanelTabAbout").addClass("selected");
            this.$("#iePanelContentAbout").fadeIn(200);
            this.$("#iePanelTabTechnology").removeClass("selected");
            this.$("#iePanelContentTechnology").fadeOut(200);
            Hover.analytics.buttonClick("IE- About Site");
        },

        showTech: function () {
            this.$("#iePanelTabAbout").removeClass("selected");
            this.$("#iePanelContentAbout").fadeOut(200);
            this.$("#iePanelTabTechnology").addClass("selected");
            this.$("#iePanelContentTechnology").fadeIn(200);
            Hover.analytics.buttonClick("IE - Technology");
        },

        clickSeeMore: function () {
            Hover.analytics.buttonClick("IE - See More");
        },

        clickLearnMore: function () {
            Hover.analytics.buttonClick("IE - Learn More");
        },

        clickBehindScenes: function () {
            Hover.analytics.buttonClick("IE - Behind the Scenes");
        }
    });
})(jQuery, Hover);
