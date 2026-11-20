// Hover! — heads-up display: base Hud (radar), RetroHud (1997-style canvas bars) and ModernHud (DOM dashboard).
// Original: game.js lines 1084-1375 (three nested `function (a, b) { ... }(jQuery, Ja)` modules)

/**
 * Hover.Hud — base HUD. Draws the radar (walls, pods, flags, crafts, bullets) onto the
 * "radar" canvas and asks subclasses to draw the gauges via the draw* hooks
 * (drawFlags, drawAltitudeStats, drawWallStats, drawCloakStats, drawSpeed, drawShieldTime,
 * drawVelocityAndShields).
 */
(function ($, Hover) {
    function Hud(world, craft) {
        this.world = world;
        this.craft = craft;
        this.time = 0;
        this.cloakCover = document.getElementById("cloakOverlay") || document.createElement("div");
        this.colors = {
            wall1: "#FFFF00",
            wall2: "#FFFFFF",
            wall3: "#AAAAAA",
            pods: "#FFFF00",
            redFlags: "#FF0000",
            redBullets: "#FF0000",
            blueFlags: "#0000FF",
            blueBullets: "#0000FF"
        };
        this.radarMaxScale = 22 / 147 / 256;
        this.radarMinScale = 18 / 147 / 2304;
        this.radarScale = 1.2 * this.radarMinScale;
        this.radarOverlay = this.world.game.getElementById("radar");
    }

    Hover.Hud = Hud;

    Hud.prototype.update = function (delta) {
        this.time += delta;
        this.updateVelocityOverlay();
        this.updateRadarOverlay();
        this.updateSpeedOverlay();
        this.updateShieldOverlay();
        this.updateItemCounts();
        this.updateFlagCounts();
    };

    /** Calls drawFlags(team, capturedCount, totalCount) for each team present. */
    Hud.prototype.updateFlagCounts = function () {
        var flagsByTeam = _.groupBy(this.world.flags, function (flag) {
            return flag.team;
        });
        _.each(flagsByTeam, function (teamFlags, team) {
            var capturedFlags = _.filter(teamFlags, function (flag) {
                return flag.captured;
            });
            this.drawFlags(team, capturedFlags.length, teamFlags.length);
        }, this);
    };

    /** Spring (jump), wall and cloak counts and their bars; also shows the cloak overlay while cloaked. */
    Hud.prototype.updateItemCounts = function () {
        var craft = this.craft;
        this.drawAltitudeStats(craft.getSpringCount(), craft.position.y, 768);
        var wallLife = 0;
        if (craft.world.tempWalls.length > 0) {
            wallLife = craft.world.tempWalls[craft.world.tempWalls.length - 1].life;
        }
        this.drawWallStats(craft.getWallCount(), wallLife, 10);
        if (craft.isVisible()) {
            this.cloakCover.style.display = "none";
        } else {
            this.cloakCover.style.display = "block";
        }
        this.drawCloakStats(craft.getCloakCount(), 11 * craft.cloakTime / 10, 10, craft.isVisible());
    };

    Hud.prototype.updateSpeedOverlay = function () {
        var craft = this.craft;
        this.drawSpeed(craft.maxSpeedModifierTime, 20, this.craft.maxSpeedModifier);
    };

    Hud.prototype.updateShieldOverlay = function () {
        var craft = this.craft;
        this.drawShieldTime(craft.protectionTime, 20);
    };

    /** Speed and the direction of travel relative to the craft's heading. */
    Hud.prototype.updateVelocityOverlay = function () {
        var craft = this.craft,
            driftAngle = Math.atan2(-craft.velocity.x, -craft.velocity.z) - craft.angle,
            speedScale = craft.maxSpeed / 20;
        this.drawVelocityAndShields(craft.velocity.length(), driftAngle, speedScale, craft.health, this.craft.isDisabled());
    };

    /** Draws the radar, centred on and rotated with the player's craft (skipped on ARM devices). */
    Hud.prototype.updateRadarOverlay = function () {
        if (!Hover.arm) {
            var craft = this.craft,
                ctx = this.radarOverlay.getContext("2d");
            this.clearCanvas(ctx);
            ctx.save();
            if (!Hover.retro) {
                // Clip to the modern dashboard's radar shape (rounded top edge).
                ctx.strokeStyle = "transparent";
                ctx.fillStyle = "transparent";
                ctx.beginPath();
                ctx.moveTo(0, 38);
                ctx.lineTo(0.0130606946, 38);
                ctx.bezierCurveTo(0.00436327183, 37.8336202, 0, 37.6669375, 0, 37.5);
                ctx.bezierCurveTo(0, 16.7893209, 67.1572834, 0, 150, 0);
                ctx.bezierCurveTo(232.842717, 0, 300, 16.7893209, 300, 37.5);
                ctx.bezierCurveTo(300, 37.6669375, 299.995637, 37.8336202, 299.986939, 38);
                ctx.lineTo(300, 38);
                ctx.lineTo(300, 174);
                ctx.lineTo(0, 174);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.clip();
            }
            ctx.translate(this.radarOverlay.width / 2, this.radarOverlay.height / 2);
            var scale = this.radarScale * this.radarOverlay.width;
            if (1 !== scale) {
                ctx.scale(scale, scale);
            }
            ctx.rotate(craft.angle);
            ctx.translate(-craft.position.x, -craft.position.z);
            ctx.lineWidth = 1 / scale;
            var spotRadius = 1.5 / scale,
                craftPixelSize = 320 * scale,
                craftScale = Math.max(1, 7 / craftPixelSize);
            this.drawWalls(ctx, craft.radarWalls);
            this.drawSpots(ctx, this.colors.pods, spotRadius, this.world.pods);
            // Flags blink.
            if (this.time % 0.5 < 0.25) {
                this.drawSpots(ctx, this.colors.redFlags, spotRadius, _.filter(this.world.flags, function (flag) {
                    return "red" == flag.team && !flag.captured;
                }));
                this.drawSpots(ctx, this.colors.blueFlags, spotRadius, _.filter(this.world.flags, function (flag) {
                    return "blue" == flag.team && !flag.captured;
                }));
            }
            ctx.lineWidth /= craftScale;
            this.drawCraft(ctx, this.craft, craftScale);
            for (var drones = this.world.drones, i = 0; i < drones.length; i++) {
                this.drawCraft(ctx, drones[i].craft, craftScale);
            }
            this.drawBullets(ctx);
            ctx.restore();
        }
    };

    /** Each bullet as a short trail behind it. */
    Hud.prototype.drawBullets = function (ctx) {
        _.each(this.world.bullets, function (bullet) {
            ctx.strokeStyle = "red" == bullet.team ? this.colors.redBullets : this.colors.blueBullets;
            ctx.beginPath();
            ctx.moveTo(bullet.position.x, bullet.position.z);
            var tail = bullet.position.clone().add(bullet.velocity.clone().normalize().multiplyScalar(-512));
            ctx.lineTo(tail.x, tail.z);
            ctx.stroke();
        }, this);
    };

    /**
     * Draws the walls the craft has discovered (`found`), batched by colour. The colour comes
     * from the wall itself or from its height profile (floor-level, rising from ground, raised).
     */
    Hud.prototype.drawWalls = function (ctx, walls) {
        var i, count, radarWall, startY, endY, color, start, end, bucket, wallsByColor = {};
        for (i = 0, count = walls.length; i < count; i++) {
            radarWall = walls[i];
            if (radarWall.found) {
                color = null;
                if (radarWall.color) {
                    color = radarWall.color;
                } else {
                    start = radarWall.wall[0];
                    end = radarWall.wall[1];
                    startY = start.y;
                    endY = end.y;
                    if (startY == endY && 0 == startY) {
                        color = this.colors.wall1;
                    } else if (endY > startY && startY <= 0) {
                        color = this.colors.wall2;
                    } else if (endY > startY && startY > 0) {
                        color = this.colors.wall3;
                    }
                }
                if (color) {
                    bucket = wallsByColor[color];
                    if (!bucket) {
                        bucket = wallsByColor[color] = [];
                    }
                    bucket.push(radarWall);
                }
            }
        }
        // Note: the loop variables are shared with the outer function, as in the original.
        _.each(wallsByColor, function (colorWalls, strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.beginPath();
            for (i = 0, count = colorWalls.length; i < count; i++) {
                radarWall = colorWalls[i];
                start = radarWall.wall[0];
                end = radarWall.wall[1];
                ctx.moveTo(start.x, start.z);
                ctx.lineTo(end.x, end.z);
            }
            ctx.stroke();
        });
    };

    /** Filled dots at each item's `location`. */
    Hud.prototype.drawSpots = function (ctx, color, radius, items) {
        ctx.fillStyle = color;
        ctx.beginPath();
        var i, count, location;
        for (i = 0, count = items.length; i < count; i++) {
            location = items[i].location;
            ctx.moveTo(location.x, location.z);
            ctx.arc(location.x, location.z, radius, 0, 2 * Math.PI, true);
        }
        ctx.fill();
    };

    /** A craft as a triangle pointing in its heading. */
    Hud.prototype.drawCraft = function (ctx, craft, scale) {
        ctx.strokeStyle = craft.color;
        ctx.save();
        ctx.translate(craft.position.x, craft.position.z);
        if (craft.angle) {
            ctx.rotate(-craft.angle);
        }
        if (1 !== craft.Scale) {
            ctx.scale(scale, scale);
        }
        ctx.beginPath();
        ctx.moveTo(0, -160);
        ctx.lineTo(128, 160);
        ctx.lineTo(-128, 160);
        ctx.lineTo(0, -160);
        ctx.stroke();
        ctx.restore();
    };

    /** Debug: draws the wall quad tree, then the nodes (and their walls) hit by a collision check. */
    Hud.prototype.debugQuadTree = function (ctx) {
        var queue = [this.world.wallQuad.root];
        ctx.strokeStyle = "#FFFF00";
        while (queue.length > 0) {
            var node = queue[0];
            node.wasHit = false;
            queue.splice(0, 1);
            for (var i = 0; i < node.childElements.length; i++) {
                queue.push(node.childElements[i]);
            }
            ctx.strokeRect(node.rect.topLeft.x, node.rect.topLeft.y, node.rect.size.x, node.rect.size.y);
        }
        this.world.checkCraftAgainstStaticGeometry(this.craft, this.craft.position.clone());
        ctx.strokeStyle = "#FF0000";
        queue = [this.world.wallQuad.root];
        while (queue.length > 0) {
            var node = queue[0];
            queue.splice(0, 1);
            for (var i = 0; i < node.childElements.length; i++) {
                queue.push(node.childElements[i]);
            }
            if (node.wasHit) {
                ctx.strokeRect(node.rect.topLeft.x, node.rect.topLeft.y, node.rect.size.x, node.rect.size.y);
                var elements = node.children;
                ctx.strokeStyle = "#FFFFFF";
                ctx.beginPath();
                for (var i = 0; i < elements.length; i++) {
                    var segment = elements[i].el;
                    ctx.moveTo(segment[0].x, segment[0].z);
                    ctx.lineTo(segment[1].x, segment[1].z);
                }
                ctx.stroke();
                ctx.strokeStyle = "#FF0000";
            }
        }
    };

    /** Matches the canvas backing size to its CSS size (times `ratio`). */
    Hud.prototype.sizeCanvas = function (canvas, ratio) {
        ratio = ratio || 1;
        var width = Math.floor(canvas.clientWidth * ratio),
            height = Math.floor(canvas.clientHeight * ratio);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
    };

    Hud.prototype.clearCanvas = function (ctx) {
        var canvas = ctx.canvas;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    Hud.prototype.zoomOut = function (delta) {
        var range = this.radarMaxScale - this.radarMinScale;
        this.radarScale -= 0.5 * range * delta;
        this.radarScale = Math.max(this.radarMinScale, this.radarScale);
    };

    Hud.prototype.zoomIn = function (delta) {
        var range = this.radarMaxScale - this.radarMinScale;
        this.radarScale += 0.5 * range * delta;
        this.radarScale = Math.min(this.radarMaxScale, this.radarScale);
    };
})(jQuery, Hover);

/**
 * Hover.RetroHud — HUD for retro mode: segmented canvas bars, sprite digit counters, flag
 * sprites, plus the fake "desktop" header with the Twitter/Facebook share wizard.
 */
(function ($, Hover) {
    function RetroHud(world, craft) {
        Hud.call(this, world, craft);
        var game = this.world.game;
        this.velocityOverlay = game.getElementById("velocity_overlay");
        this.speedOverlay = game.getElementById("engine_bar");
        this.shieldOverlay = game.getElementById("shield_bar");
        this.aCount = game.getElementById("a_count");
        this.sCount = game.getElementById("s_count");
        this.dCount = game.getElementById("d_count");
        this.altitudeBar = game.getElementById("a_bar");
        this.wallBar = game.getElementById("s_bar");
        this.cloakBar = game.getElementById("d_bar");
        this.flagCounts = game.getElementById("flag_counts");
        this.setupHeader();
    }

    var Hud = Hover.Hud;

    Hover.RetroHud = RetroHud;

    RetroHud.prototype = Object.create(Hud.prototype);

    // Added in this edition for classic-mode multiplayer, which calls these on the player's HUD.
    // The 1995 dashboard has no team colours and no clock, so there is nothing to update.
    RetroHud.prototype.onTeamUpdate = function () {
    };

    RetroHud.prototype.updateTimeLeft = function (seconds) {
    };

    RetroHud.prototype.updateRadarOverlay = function () {
        this.sizeCanvas(this.radarOverlay, 1);
        Hud.prototype.updateRadarOverlay.call(this);
    };

    RetroHud.prototype.updateFlagCounts = function () {
        this.clearCanvas(this.flagCounts.getContext("2d"));
        Hud.prototype.updateFlagCounts.call(this);
    };

    /** Draws a row of flag sprites per team (blue on top), captured ones in a different frame. */
    RetroHud.prototype.drawFlags = function (team, capturedCount, totalCount) {
        var i,
            isCaptured,
            flagsImage = Hover.Editor.schemeLoader.getTexture("flags").image,
            canvas = this.flagCounts,
            ctx = canvas.getContext("2d"),
            cellWidth = canvas.width / 6,
            cellHeight = canvas.height / 2,
            spriteOffsets = {
                redfalse: 0.75,
                redtrue: 0,
                bluefalse: 0.5,
                bluetrue: 0.25
            },
            row = "blue" === team ? 0 : 1;
        for (i = 0; i < totalCount; i++) {
            isCaptured = capturedCount > i;
            ctx.drawImage(flagsImage, spriteOffsets[team + isCaptured] * flagsImage.width, 0, 0.25 * flagsImage.width, flagsImage.height, cellWidth * i, cellHeight * row, cellWidth, cellHeight);
        }
    };

    RetroHud.prototype.drawAltitudeStats = function (count, value, max) {
        this.setDigitPosition(this.aCount, count);
        this.updateVBar(this.altitudeBar, value, max, "#FFFF00");
    };

    RetroHud.prototype.drawWallStats = function (count, value, max) {
        this.setDigitPosition(this.sCount, count);
        this.updateVBar(this.wallBar, value, max, "#FFFF00");
    };

    RetroHud.prototype.drawCloakStats = function (count, value, max, isVisible) {
        this.setDigitPosition(this.dCount, count);
        this.updateVBar(this.cloakBar, value, max, "#FFFF00");
    };

    /**
     * Shows a digit by shifting a sprite-strip background. This edition: numbers_small.png is
     * ten digits 15 pixels apart (152 wide); the counter shows exactly one 15.2-pixel cell (the
     * strip is drawn at 10 counter widths, game.css), centred on the digit. The original's
     * 900% and 10.5% steps showed slivers of the neighbouring digits.
     */
    RetroHud.prototype.setDigitPosition = function (element, digit) {
        var left = 15 * Math.max(0, Math.min(9, digit)) - 0.5; // pixels into the strip
        element.style.backgroundPosition = (100 * left / (152 - 15.2)) + "% 0";
    };

    RetroHud.prototype.drawSpeed = function (time, maxTime, modifier) {
        // This edition: red for a slow-down, green for a speed-up. The remake chose the colour by the
        // time left, so a slow-down showed green until its last second.
        var color = modifier < 1 ? "#FF0000" : "#00FF00";
        this.updateHBar(this.speedOverlay, time, maxTime, color);
    };

    RetroHud.prototype.drawShieldTime = function (time, maxTime) {
        this.updateHBar(this.shieldOverlay, time, maxTime, "#FFFF00");
    };

    /** Horizontal segmented bar with `value` (of `max`) segments lit. */
    RetroHud.prototype.updateHBar = function (canvas, value, max, color) {
        var ctx = canvas.getContext("2d");
        this.clearCanvas(ctx);
        if (!(value <= 0)) {
            value = Math.round(value);
            if (value > max) {
                value = max;
            }
            ctx.fillStyle = color;
            for (var segment = canvas.width / (2 * max), i = 0; i < value; i++) {
                ctx.fillRect(segment * i * 2 + segment, 2, segment, canvas.height - 4);
            }
        }
    };

    /** Vertical segmented bar (10 segments, filled from the bottom). */
    RetroHud.prototype.updateVBar = function (canvas, value, max, color) {
        var ctx = canvas.getContext("2d");
        this.clearCanvas(ctx);
        value = value / max * 10;
        max = 10;
        value--;
        if (!(value <= 0)) {
            value = Math.round(value);
            if (value > max) {
                value = max;
            }
            ctx.fillStyle = color;
            for (var segment = canvas.height / (2 * max), i = 0; i < value; i++) {
                ctx.fillRect(2, canvas.height - (segment * i * 2 + segment), canvas.width - 4, segment);
            }
        }
    };

    /** A line from the centre showing the direction and magnitude of travel. */
    RetroHud.prototype.drawVelocityAndShields = function (speed, driftAngle, speedScale, health, isDisabled) {
        var ctx = this.velocityOverlay.getContext("2d");
        this.clearCanvas(ctx);
        var pixelsPerUnit = 0.37 * this.velocityOverlay.height / (400 * speedScale),
            centerX = this.velocityOverlay.width / 2,
            centerY = this.velocityOverlay.height / 2,
            length = speed * pixelsPerUnit;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#FFFF00";
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX - Math.sin(driftAngle) * length, centerY - Math.cos(driftAngle) * length);
        ctx.stroke();
    };

    /** Wires up the retro desktop icons and the social share wizard. */
    RetroHud.prototype.setupHeader = function () {
        this.desktop = this.world.game.getElementById("retroDesktop");
        this.$desktop = $(this.desktop);
        this.$sound = this.$desktop.find("#sound");
        this.$twitter = this.$desktop.find("#twitter");
        this.$facebook = this.$desktop.find("#facebook");
        this.$funstuff = this.$desktop.find("#funstuff");
        this.$wizard = this.$desktop.find("#socialWizard");
        this.$wizardBack = this.$desktop.find("#socialWizardButtonBack");
        this.$wizardNext = this.$desktop.find("#socialWizardButtonNext");
        this.$wizardFinish = this.$desktop.find("#socialWizardButtonFinish");
        this.$wizardCancel = this.$desktop.find("#socialWizardButtonCancel");
        this.$wizardSending = this.$desktop.find("#socialSending");
        this.$wizardProgress = this.$desktop.find("#socialProgress");
        this.$wizardInput = this.$desktop.find("#socialWizardInput");
        this.$twitter.dblclick(_.bind(function () {
            this.showWizard("twitter");
        }, this));
        this.$facebook.dblclick(_.bind(function () {
            this.showWizard("fb");
        }, this));
        this.$wizardCancel.click(_.bind(function () {
            this.hideWizard();
        }, this));
        this.$wizardBack.click(_.bind(function () {
            if (this.$wizard.hasClass("step1")) {
                this.hideWizard();
            } else {
                this.$wizard.removeClass("step2");
                this.$wizard.addClass("step1");
            }
        }, this));
        this.$wizardNext.click(_.bind(function () {
            this.$wizard.removeClass("step1");
            this.$wizard.addClass("step2");
        }, this));
        this.$wizardFinish.click(_.bind(function () {
            this.$wizardSending.show();
            var progressUrl = Hover.cdn.filenames.retroProgress;
            // Cache-busting query restarts the animated progress GIF. (This edition: in the release
            // build the GIF comes from the asset pack, src/pack.js, whose addresses take no query.)
            var packedUrl = HoverPack.url(progressUrl);
            this.$wizardProgress.css({
                background: "url(" + (packedUrl !== progressUrl ? packedUrl : progressUrl + "?ver=" + Math.random()) + ")"
            });
            if ("twitter" === this.currentService) {
                Hover.social.tweet(this.$wizardInput.val());
            } else if ("fb" === this.currentService) {
                Hover.social.share(this.$wizardInput.val());
            }
            setTimeout(_.bind(function () {
                this.hideWizard();
            }, this), 1800);
        }, this));
    };

    /** Opens the share wizard for "twitter" or "fb" (pauses the game controls). */
    RetroHud.prototype.showWizard = function (service) {
        this.$wizardInput.val("");
        this.world.game.stopControllers();
        this.currentService = service;
        this.$wizard.addClass(service);
        this.$wizard.removeClass("step2").addClass("step1");
        this.$wizardSending.hide();
        this.$wizard.show();
    };

    RetroHud.prototype.hideWizard = function (unused) {
        this.$wizard.hide();
        this.$wizard.removeClass(this.currentService);
        this.currentService = null;
        this.world.game.startControllers();
    };
})(jQuery, Hover);

/**
 * Hover.ModernHud — HUD for the modern (2013) look: a DOM dashboard ("#hud") with dial canvases
 * for speed, boost and shields, item counters and flag indicators.
 */
(function ($, Hover) {
    function ModernHud(world, craft) {
        Hud.call(this, world, craft);
        this.$hud = $(this.world.game.getElementById("hud"));
        this.$timeLeft = this.$hud.find("#dash-time").text("");
        this.onTeamUpdate();
        this.lastBoostAngle = {};
        this.colors = {
            wall1: "#F0BA38",
            wall2: "#837AEE",
            wall3: "#3E387A",
            pods: "#F0BA38",
            redFlags: "#B81E45",
            redBullets: "#B81E45",
            blueFlags: "#1CA4FC",
            blueBullets: "#1CA4FC"
        };
        this.lastSpeed = -1;
        this.lastFlags = {
            redCaptured: 0,
            redTotal: 0,
            blueCaptured: 0,
            blueTotal: 0
        };
    }

    var Hud = Hover.Hud;

    Hover.ModernHud = ModernHud;

    ModernHud.prototype = Object.create(Hud.prototype);

    ModernHud.prototype.onTeamUpdate = function () {
        var team = this.craft.team;
        this.$hud.toggleClass("team-red", "red" === team).toggleClass("team-blue", "blue" === team);
    };

    /** Redraws a team's flag indicators only when its counts change. */
    ModernHud.prototype.drawFlags = function (team, capturedCount, totalCount) {
        if (!(this.$dashFlagsBlue && this.$dashFlagsRed)) {
            this.$dashFlagsBlue = $("#dash-flags-blue", this.$hud);
            this.$dashFlagsRed = $("#dash-flags-red", this.$hud);
        }
        if ("red" === team && !(this.lastFlags.redCaptured === capturedCount && this.lastFlags.redTotal === totalCount)) {
            this.lastFlags.redCaptured = capturedCount;
            this.lastFlags.redTotal = totalCount;
            this.drawFlagSet(this.$dashFlagsRed, capturedCount, totalCount);
        }
        if ("blue" === team && !(this.lastFlags.blueCaptured === capturedCount && this.lastFlags.blueTotal === totalCount)) {
            this.lastFlags.blueCaptured = capturedCount;
            this.lastFlags.blueTotal = totalCount;
            this.drawFlagSet(this.$dashFlagsBlue, capturedCount, totalCount);
        }
    };

    ModernHud.prototype.drawFlagSet = function ($container, capturedCount, totalCount) {
        $container.empty();
        for (var i = 0; i < totalCount; i++) {
            var onClass = capturedCount > i ? " on" : "";
            $container.append('<div class="dash-flag' + onClass + '"></div>');
        }
    };

    /** Spring (jump) counter; the first call only looks up the element. */
    ModernHud.prototype.drawAltitudeStats = function (count, altitude, maxAltitude) {
        if (this.$dashBounceNumber) {
            if (count !== this.lastSpringCount) {
                this.$dashBounceNumber.text(ModernHud.padNumber(count));
            }
        } else {
            this.$dashBounceNumber = $("#dash-bounce-number", this.$hud);
        }
        if (1 === count && 1 !== this.lastSpringCount) {
            $("#dash-bounce", this.$hud).addClass("on");
        } else if (0 === count && this.lastSpringCount > 0) {
            $("#dash-bounce", this.$hud).removeClass("on");
        }
        this.lastSpringCount = count;
    };

    /** Wall counter; the first call only looks up the element. */
    ModernHud.prototype.drawWallStats = function (count, wallLife, maxLife) {
        if (this.$dashWallNumber) {
            if (this.lastWallCount !== count) {
                this.$dashWallNumber.text(ModernHud.padNumber(count));
            }
        } else {
            this.$dashWallNumber = $("#dash-wall-number", this.$hud);
        }
        if (1 === count && 1 !== this.lastWallCount) {
            $("#dash-wall", this.$hud).addClass("on");
        } else if (0 === count && this.lastWallCount > 0) {
            $("#dash-wall", this.$hud).removeClass("on");
        }
        this.lastWallCount = count;
    };

    /** Cloak counter; the first call only looks up the element. */
    ModernHud.prototype.drawCloakStats = function (count, cloakTime, maxTime, isVisible) {
        if (this.$dashCloakNumber) {
            if (this.lastCloakCount !== count) {
                this.$dashCloakNumber.text(ModernHud.padNumber(count));
            }
        } else {
            this.$dashCloakNumber = $("#dash-cloak-number", this.$hud);
        }
        if (1 === count && 1 !== this.lastCloakCount) {
            $("#dash-cloak", this.$hud).addClass("on");
        } else if (0 === count && this.lastCloakCount > 0) {
            $("#dash-cloak", this.$hud).removeClass("on");
        }
        this.lastCloakCount = count;
    };

    /** Speed-modifier (boost/slow pod) dial: green light for faster, red for slower. */
    ModernHud.prototype.drawSpeed = function (time, maxTime, speedModifier) {
        if (!this.boostCanvas) {
            this.boostCanvas = this.world.game.getElementById("dash-boostcanvas");
            this.boostCanvas.width = $(this.boostCanvas).width();
            this.boostCanvas.height = $(this.boostCanvas).height();
            this.boostCanvasCtx = this.boostCanvas.getContext("2d");
            this.$boost = $("#dash-boost", this.$hud);
            this.$boostNumBig = $("#dash-boost-number-big", this.$hud);
            this.$boostNumSmall = $("#dash-boost-number-small", this.$hud);
            this.$boostIcon = $("#dash-boost-icon", this.$hud);
        }
        if (time > 0) {
            if (!this.boostOn || (this.lastSpeedModifier && this.lastSpeedModifier !== speedModifier)) {
                this.boostOn = true;
                this.$boost.addClass("on");
                this.lastSpeedModifier = speedModifier;
                if (speedModifier < 1) {
                    this.$boostIcon.removeClass("greenlight").addClass("redlight");
                } else {
                    this.$boostIcon.removeClass("redlight").addClass("greenlight");
                }
            }
            this.updateBoost(time, maxTime, this.boostCanvas, this.boostCanvasCtx, this.$boost, this.$boostNumBig, this.$boostNumSmall, "speed");
        } else if (this.boostOn) {
            this.boostOn = false;
            this.$boost.removeClass("on");
            this.$boostIcon.removeClass("greenlight redlight");
            this.updateBoost(0, 0, this.boostCanvas, this.boostCanvasCtx, this.$boost, this.$boostNumBig, this.$boostNumSmall, "speed");
            this.boostCanvasCtx.clearRect(0, 0, this.boostCanvas.width, this.boostCanvas.height);
        }
    };

    /** Shield (protection) time dial. */
    ModernHud.prototype.drawShieldTime = function (time, maxTime) {
        if (!this.shieldCanvas) {
            this.shieldCanvas = this.world.game.getElementById("dash-shieldscanvas");
            this.shieldCanvas.width = $(this.shieldCanvas).width();
            this.shieldCanvas.height = $(this.shieldCanvas).height();
            this.shieldCanvasCtx = this.shieldCanvas.getContext("2d");
            this.$shields = $("#dash-shields", this.$hud);
            this.$shieldsNumBig = $("#dash-shields-number-big", this.$hud);
            this.$shieldsNumSmall = $("#dash-shields-number-small", this.$hud);
        }
        if (time > 0) {
            if (!this.shieldsOn) {
                this.shieldsOn = true;
                this.$shields.addClass("on");
            }
            this.updateBoost(time, maxTime, this.shieldCanvas, this.shieldCanvasCtx, this.$shields, this.$shieldsNumBig, this.$shieldsNumSmall, "shield");
        } else {
            if (this.shieldsOn) {
                this.shieldsOn = false;
                this.$shields.removeClass("on");
                this.updateBoost(0, 0, this.shieldCanvas, this.shieldCanvasCtx, this.$shields, this.$shieldsNumBig, this.$shieldsNumSmall, "shield");
            }
            this.shieldCanvasCtx.clearRect(0, 0, this.shieldCanvas.width, this.shieldCanvas.height);
        }
    };

    /**
     * Updates a countdown dial: whole/tenths digits and an arc snapped to 18-degree steps,
     * redrawn only when the angle changes (cached per `key` in lastBoostAngle).
     */
    ModernHud.prototype.updateBoost = function (value, max, canvas, ctx, $container, $numberBig, $numberSmall, key) {
        var angle = value / max * 360,
            tenths = Math.round(10 * (value % 1)),
            whole = Math.floor(value);
        angle = 180 + (18 * Math.round(angle / 18) - 2);
        angle = angle <= 180 ? 180 : angle;
        tenths = 10 === tenths ? 0 : tenths;
        $numberBig.text(whole);
        $numberSmall.text(tenths);
        if (this.lastBoostAngle[key] !== angle) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            this.drawDialArc(canvas, ctx, 0, 360, "#2F2B63");
            this.drawDialArc(canvas, ctx, 180, angle, "#837AEE");
            this.lastBoostAngle[key] = angle;
        }
    };

    /** Speedometer dial + number, and the momentum needle (direction of travel). */
    ModernHud.prototype.drawVelocityAndShields = function (speed, driftAngle, speedScale, health, isDisabled) {
        if (!(this.speedCanvas && this.momentumCanvas)) {
            this.$speedNumber = $("#dash-speed-number", this.$hud);
            this.speedCanvas = this.world.game.getElementById("dash-speedcanvas");
            this.speedCanvas.width = $(this.speedCanvas).width();
            this.speedCanvas.height = $(this.speedCanvas).height();
            this.speedCanvasCtx = this.speedCanvas.getContext("2d");
            this.momentumCanvas = this.world.game.getElementById("dash-momentumcanvas");
            this.momentumCanvas.width = $(this.momentumCanvas).width();
            this.momentumCanvas.height = $(this.momentumCanvas).height();
            this.momentumCanvasCtx = this.momentumCanvas.getContext("2d");
        }
        var speedFraction = speed / (400 * speedScale),
            dialEndAngle = 145 + 10 * Math.round(250 * speedFraction / 10),
            displaySpeed = 5 * Math.round(20 * speedFraction);
        if (displaySpeed !== this.lastSpeedV) {
            this.$speedNumber.text(displaySpeed);
            if (this.speedCanvas) {
                this.drawDialArc(this.speedCanvas, this.speedCanvasCtx, 145, 395, "#483D84");
                this.drawDialArc(this.speedCanvas, this.speedCanvasCtx, 145, dialEndAngle, "#837AEE");
            }
            this.lastSpeedV = displaySpeed;
        }
        var ctx = this.momentumCanvasCtx;
        ctx.clearRect(0, 0, this.momentumCanvas.width, this.momentumCanvas.height);
        var pixelsPerUnit = 0.001 * this.momentumCanvas.height / speedScale,
            centerX = this.momentumCanvas.width / 2,
            centerY = this.momentumCanvas.height / 2,
            length = Math.min(speed * pixelsPerUnit, centerX);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#FEC52E";
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX - Math.sin(driftAngle) * length, centerY - Math.cos(driftAngle) * length);
        ctx.stroke();
    };

    /** Fills a pie slice from `startDegrees` to `endDegrees` centred in the canvas. */
    ModernHud.prototype.drawDialArc = function (canvas, ctx, startDegrees, endDegrees, color) {
        function toRadians(degrees) {
            return degrees * Math.PI / 180;
        }

        ctx.save();
        var centerX = Math.floor(canvas.width / 2),
            centerY = Math.floor(canvas.height / 2),
            radius = Math.floor(canvas.width / 2),
            startAngle = toRadians(startDegrees),
            endAngle = toRadians(endDegrees);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    };

    /** Two-digit zero padding (returns the number itself when >= 10). */
    ModernHud.padNumber = function (value) {
        return value < 10 ? "0" + value : value;
    };

    ModernHud.prototype.updateTimeLeft = function (seconds) {
        var text = ModernHud.getTimeLeftString(seconds);
        this.$timeLeft.text(text);
    };

    /** Formats seconds as "m:ss". */
    ModernHud.getTimeLeftString = function (seconds) {
        var minutes = Math.floor(seconds / 60),
            remainder = Math.floor(seconds % 60),
            text = minutes + ":" + ModernHud.padNumber(remainder);
        return text;
    };

    /** Seconds until `endTime` (ms timestamp), clamped to 0..1200 (20 minutes). */
    ModernHud.getRemainingSeconds = function (endTime) {
        var maxMilliseconds = 1200000,
            remainingMilliseconds = Math.min(maxMilliseconds, Math.max(0, endTime - Date.now())),
            seconds = remainingMilliseconds / 1000;
        return seconds;
    };
})(jQuery, Hover);
