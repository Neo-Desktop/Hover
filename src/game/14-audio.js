// Original: game.js lines 2874-2946
//
// Audio module: wraps HTML5 <audio> elements, loads the modern or retro sound set
// from the CDN and exposes the shared manager as `Hover.audio`.

(function () {
    /**
     * One sound effect / music track backed by an HTML5 Audio element.
     * A Sound created without a file is a silent no-op ("nonsound").
     * @param {AudioManager} parent  owning manager (supplies the volume)
     * @param {string} [file]        sound URL
     */
    function Sound(parent, file) {
        this.parent = parent;
        this.file = file;
        if (file) {
            this.el = new Audio(file);
            this.el.load();
        }
        this.playing = false;
    }

    /** Factory that creates Sound objects. */
    function SoundLoader() {
    }

    function createSoundLoader() {
        return new SoundLoader();
    }

    /** Owns every loaded sound; global volume and on/off switch. */
    function AudioManager() {
        this.nonsound = new Sound();
        this.enabled = true;
        this.volume = 1;
        this.sounds = {};
        this.modernSounds = null;
        this.retroSounds = null;
    }

    /** Plain looping via the element's own `loop` flag. */
    Sound.prototype.setBasicLoop = function (loop) {
        if (this.file && loop && this.el) {
            this.el.loop = true;
        }
    };

    /**
     * Gapless looping: a second Audio element plays the same file offset in time, and
     * `playingLoop` (polled every 10 ms while playing) cross-fades between the two
     * elements near the end of the buffered data so the loop seam is not audible.
     * The second argument is unused.
     */
    Sound.prototype.setLoop = function (loop, unused) {
        if (this.file && loop) {
            var first = this.el,
                second = new Audio(this.file);
            this.el2 = second;
            first.loop = true;
            second.loop = true;
            var self = this;
            this.playingLoop = function () {
                var bufferedEnd = first.buffered.end(0),
                    margin = 0.2;
                if (first.volume == self.parent.volume && first.currentTime > bufferedEnd - margin) {
                    first.volume = 0.01 * self.parent.volume;
                    second.volume = self.parent.volume;
                }
                if (second.volume == self.parent.volume && second.currentTime > bufferedEnd - margin) {
                    first.volume = self.parent.volume;
                    second.volume = 0.01 * self.parent.volume;
                }
            };
        }
    };

    Sound.prototype.play = function () {
        if (Hover.audio.enabled) {
            // Nothing to do without a file, or if an already-playing looping sound.
            if (this.file && !(this.playing && this.el.loop)) {
                if (this.el2) {
                    this.el2.volume = 0;
                    this.el.currentTime = 0.1;
                    this.el2.currentTime = 0.75;
                    this.el2.play();
                    this.pl = setInterval(this.playingLoop, 10);
                }
                if (this.parent) {
                    this.el.volume = this.parent.volume;
                }
                this.el.play();
                this.playing = true;
            }
        }
    };

    Sound.prototype.fadeIn = function () {
        if (Hover.audio.enabled && this.file) {
            var self = this;
            this.play();
            this.volume = 0;
            var timer = setInterval(function () {
                self.volume += 0.05;
                if (self.volume >= 1) {
                    clearInterval(timer);
                }
            }, 100);
        }
    };

    Sound.prototype.stop = function () {
        if (this.file && this.playing) {
            this.el.pause();
            if (this.el2) {
                this.el2.pause();
                clearInterval(this.pl);
            }
        }
        this.playing = false;
    };

    /** True once the element has enough data (readyState 4 = HAVE_ENOUGH_DATA). */
    Sound.prototype.isLoaded = function () {
        return this.file ? 4 === this.el.readyState : true;
    };

    SoundLoader.prototype.loadSound = function (parent, file) {
        return new Sound(parent, file);
    };

    /**
     * Loads the sound set for the current mode (retro or modern), reporting progress via
     * the "soundLoadProgress" event, then calls `callback` asynchronously when all are
     * loaded. Each set is only loaded once and cached.
     */
    AudioManager.prototype.loadSounds = function (callback) {
        this.sounds = Hover.retro ? this.retroSounds : this.modernSounds;
        if (this.sounds) {
            this.applyRetroMusic();
            setTimeout(callback, 0);
            return;
        }
        var files;
        // Format choice: m4a is used whenever the browser can play it (Modernizr.audio.m4a is
        // "" when unsupported, "maybe"/"probably" otherwise), ogg only as a fallback.
        // This already prefers m4a, so it is unchanged from the original.
        if (Hover.retro) {
            this.sounds = this.retroSounds = {};
            files = Modernizr.audio.m4a ? Hover.retroSoundFiles.m4a : Hover.retroSoundFiles.ogg;
        } else {
            this.sounds = this.modernSounds = {};
            files = Modernizr.audio.m4a ? Hover.modernSoundFiles.m4a : Hover.modernSoundFiles.ogg;
        }
        var self = this,
            loader = createSoundLoader(),
            total = 0;
        _.each(files, function (fileName, soundName) {
            var url = Hover.cdn.getSoundUrl(fileName);
            self.sounds[soundName] = loader.loadSound(self, url);
            total++;
        });
        // (this.sounds directly, not getSound: the classic Sound Options may hide a sound from
        // getSound, but it must still be set up to loop for when it's switched back on.)
        _.each(["ENG_HIGH", "ENG_IDLE", "ENG_LOW", "ENG_NORM"], function (name) {
            (self.sounds[name] || self.nonsound).setLoop(true, 0.174);
        });
        (this.sounds.MUSIC || this.nonsound).setBasicLoop(true);
        this.applyRetroMusic();
        var timer = setInterval(function () {
            var loaded = _.filter(self.sounds, function (sound) {
                return sound.isLoaded();
            }).length;
            Hover.events.trigger("soundLoadProgress", loaded, total);
            if (loaded === total) {
                clearInterval(timer);
                setTimeout(callback, 0);
            }
        }, 100);
    };

    /**
     * Added in this edition: in classic mode, makes "MUSIC" the song chosen for the current maze
     * (this.retroMusic, set by GameView), replacing the loaded one when the maze changes.
     */
    AudioManager.prototype.applyRetroMusic = function () {
        if (!Hover.retro || !this.retroMusic || !this.retroSounds) {
            return;
        }
        var url = Hover.cdn.getSoundUrl(this.retroMusic);
        var current = this.retroSounds.MUSIC;
        if (current && current.file === url) {
            return;
        }
        if (current) {
            current.stop();
        }
        var music = createSoundLoader().loadSound(this, url);
        music.setBasicLoop(true);
        this.retroSounds.MUSIC = music;
    };

    /** Returns the named sound, or a silent placeholder if it does not exist. */
    AudioManager.prototype.getSound = function (name) {
        var sound = this.sounds[name];
        return sound ? sound : this.nonsound;
    };

    AudioManager.prototype.stopAll = function () {
        $.each(this.sounds, function (name, sound) {
            sound.stop();
        });
    };

    AudioManager.prototype.setEnabled = function (enabled) {
        if (this.enabled !== enabled) {
            this.enabled = enabled;
            if (!this.enabled) {
                this.stopAll();
            }
        }
    };

    Hover.audio = new AudioManager();
})();
