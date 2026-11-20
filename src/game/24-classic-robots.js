// Added in this edition (not in the 2013 remake).
//
// The 1995 game's robots, for classic mode, as HOVER.EXE runs them (class CRobotPlayer; notes on
// every address are in the comments below). The remake's robots followed a fixed tour of every
// beacon, steered full left or full right, chased the player at any range and from any floor, never
// backed off, and robots of one kind shared a single craft. In 1995 each robot:
//
//   - drives with the robot handling for the difficulty (top speed 40, 50 or 60 a tick, slower than
//     the player's 50, 65 or 75), the same physics as the player;
//   - thinks 20 times a second with seven states: idle (stop, look around), back off, go to a beacon,
//     plan the next beacon, flag hunter at a beacon, go for a flag, chase the player;
//   - looks for its goal from where it is: an attacker sees the player within 5,000 / 7,000 / 10,000
//     units on the same floor unless cloaked; a flag hunter sees one of the player's flags on the
//     ground within 5,000; otherwise it heads for the nearest free beacon it can see, and at each
//     beacon plans up to 3 or 4 beacons ahead toward a place its goal can be seen from, or wanders;
//   - claims the beacon it heads for, so robots spread out;
//   - steers in proportion to how far off it points, thrusts only when within 10.5 degrees of where
//     it wants to go, aims a little past its goal to cancel sliding, and brakes by reverse thrust;
//   - after any wall hit or after ramming a craft, reverses at 40% speed for 3 seconds while turning
//     away, stops and thinks again (so it doesn't pin the player);
//   - takes the player's flags (both kinds do), never takes pods, and gives up its goal on a sled pad.
//
// The modern look's drones use the same rules (SinglePlayerGame.spawnDrones), with their own models
// and handling.
//
// Crafts bump into each other by the 1995 rule too (World.resolveCraftContactsClassic): each is two
// circles at nose and tail; only the speed with which they move toward each other passes between
// them, they are pushed apart only when deep in each other, and never into a wall.

(function (Hover) {
    var U = 2 * Math.PI / 512; // the 1995 angle unit (512 to a full turn)
    var HOVER_HEIGHT = 96;     // how far above its floor a craft floats in this edition

    // The 1995 robot handling ("R" tables at ds:0x4606c0): the same for every difficulty except the
    // top speed. Classic crafts use the 1995 movement rules (03-craft.js).
    function robotProfile(id, maxSpeedPerTick) {
        return {
            id: id,
            classic: true,
            turnSpeed: 327680 * Math.PI / 16777215, // 5.0 of 512 per tick
            turnDrag: 19661,                        // 0.3
            acceleration: 65536 / 65535,            // 1.0 per tick per tick
            drag: 655,                              // 0.01 while coasting
            maxSpeed: maxSpeedPerTick * 65536 / 65535,
            traction: 0.025,
            fastPodMultiplier: 1.33,
            slowPodMultiplier: 0.66,
            modelName: "Drone_Model_3"
        };
    }

    Profiles.ClassicRobot = robotProfile(8, 40);
    Profiles.ClassicRobotIntermediate = robotProfile(9, 50);
    Profiles.ClassicRobotExpert = robotProfile(10, 60);

    /** The robots' handling for the player's classic difficulty. */
    Profiles.classicRobotFor = function (playerProfile) {
        return playerProfile === Profiles.ClassicExpert ? Profiles.ClassicRobotExpert :
            playerProfile === Profiles.ClassicIntermediate ? Profiles.ClassicRobotIntermediate : Profiles.ClassicRobot;
    };

    /** 0 Easy, 1 Intermediate, 2 Difficult, from the player's classic profile. */
    Profiles.classicDifficultyOf = function (playerProfile) {
        return playerProfile === Profiles.ClassicExpert ? 2 : playerProfile === Profiles.ClassicIntermediate ? 1 : 0;
    };

    /** The same for the modern look's crafts: 0 Easy, 1 Normal, 2 Hard (the modern drones use these rules too). */
    Profiles.modernDifficultyOf = function (playerProfile) {
        return playerProfile === Profiles.Hard ? 2 : playerProfile === Profiles.Normal ? 1 : 0;
    };

    // The robot AI parameters ("RobotAI{Beg,Int,Exp}Params", 0x4335e4) that change with difficulty.
    var AI = [
        { playerSight: 5000, depth: 3 },
        { playerSight: 7000, depth: 4 },
        { playerSight: 10000, depth: 4 }
    ];
    var FLAG_SIGHT = 5000,
        BEACON_SIGHT = 5000,
        BACK_OFF_TICKS = 60,         // 3 s
        BACK_OFF_SPEED = 0.4,
        BACK_OFF_TURN = 1.5 * U,     // per tick
        FLAG_TICKS = 200,            // 10 s
        ARRIVED = 50,
        DRIFT_WINDOW = 30 * U,
        AIM_TOLERANCE = 15 * U,
        HISTORY = 10;

    function wrap(angle) {
        while (angle > Math.PI) {
            angle -= 2 * Math.PI;
        }
        while (angle <= -Math.PI) {
            angle += 2 * Math.PI;
        }
        return angle;
    }

    function clamp(value, low, high) {
        return value < low ? low : value > high ? high : value;
    }

    /** The heading (craft angle) that points along (dx, dz): crafts face (-sin a, -cos a). */
    function bearing(dx, dz) {
        return Math.atan2(-dx, -dz);
    }

    function floorOf(craft) {
        return craft.position.y - HOVER_HEIGHT;
    }

    /** No wall between the two points at the height band [floor + 64, floor + 128] (0x40c2b0). */
    function clearLine(world, x1, z1, x2, z2, floor) {
        return !world.getCollisionXYZ(x1, floor + 64, z1, x2, floor + 64, z2) &&
            !world.getCollisionXYZ(x1, floor + 128, z1, x2, floor + 128, z2);
    }

    function sees(world, from, to, floor, range) {
        var dx = to.x - from.x,
            dz = to.z - from.z;
        return dx * dx + dz * dz <= range * range && clearLine(world, from.x, from.z, to.x, to.z, floor);
    }

    /** Whether the line crosses the outline of a pad for which `test(pad)` is true. */
    function crossesPad(world, from, to, test) {
        for (var i = 0; i < world.pads.length; i++) {
            var pad = world.pads[i];
            if (!test(pad)) {
                continue;
            }
            var points = pad.cycle;
            for (var j = 0; j < points.length; j++) {
                var a = points[j],
                    b = points[(j + 1) % points.length];
                if (segmentsIntersect(from.x, from.z, to.x, to.z, a.x, a.y, b.x, b.y)) {
                    return true;
                }
            }
        }
        return false;
    }

    function anyPad() {
        return true;
    }

    /**
     * The beacon graph as HOVER.EXE builds it (0x423cd0): every beacon, linked to each other beacon
     * less than 100 units higher or lower, within 5,000, with no wall between them in the band they
     * share and no pad on the way. Built once per world.
     */
    function classicBeacons(world) {
        if (world.classicBeacons) {
            return world.classicBeacons;
        }
        var beacons = _.map(world.beaconLocations || [], function (location) {
            // One Maze 2 beacon is stored as 65440, which is -96 read as a 16-bit number.
            var y = location.Y >= 32768 ? location.Y - 65536 : location.Y;
            return { pos: new THREE.Vector3(location.X, y, location.Z), links: [], claimedBy: null };
        });
        for (var i = 0; i < beacons.length; i++) {
            for (var j = i + 1; j < beacons.length; j++) {
                var a = beacons[i].pos,
                    b = beacons[j].pos;
                if (Math.abs(a.y - b.y) >= 100) {
                    continue;
                }
                var dx = b.x - a.x,
                    dz = b.z - a.z;
                if (dx * dx + dz * dz > BEACON_SIGHT * BEACON_SIGHT) {
                    continue;
                }
                var low = Math.max(a.y, b.y) + 1,
                    high = Math.min(a.y, b.y) + 99;
                if (world.getCollisionXYZ(a.x, low, a.z, b.x, low, b.z) || world.getCollisionXYZ(a.x, high, a.z, b.x, high, b.z) ||
                        crossesPad(world, a, b, anyPad)) {
                    continue;
                }
                beacons[i].links.push(beacons[j]);
                beacons[j].links.push(beacons[i]);
            }
        }
        world.classicBeacons = beacons;
        return beacons;
    }

    /**
     * A 1995 robot. `kind` is "attacker" or "hunter" (flag hunter); `difficulty` 0..2. The craft is
     * the robot's own; the controller is updated every frame by World.update.
     */
    function ClassicRobotController(craft, world, player, kind, difficulty) {
        this.craft = craft;
        this.world = world;
        this.player = player;
        this.kind = kind;
        this.ai = AI[difficulty] || AI[0];
        this.beacons = classicBeacons(world);
        this.history = [];
        this.claimed = null;
        this.target = null;      // { pos: Vector3, beacon?, flag?, craft? }
        this.clock = 0;
        this.turn = 0;
        this.engine = 0;
        this.baseSpeed = craft.maxSpeed; // per tick
        this.maxNow = this.baseSpeed;
        this.wantHeading = craft.angle;
        this.stopFirst = false;
        this.seekBrake = false;
        this.braking = false;
        this.reverseDrive = false;
        // Any robot takes the player's flags (0x41ae40).
        craft.addBehavior(new FlagCaptureBehavior());
        // The first state is idle, without its stop (the 1995 constructor doesn't enter it).
        this.state = "idle";
    }

    Hover.ClassicRobotController = ClassicRobotController;

    ClassicRobotController.prototype.update = function (delta) {
        this.clock += delta;
        var ticks = 0;
        while (this.clock >= 1 / 20 && ticks < 3) {
            this.clock -= 1 / 20;
            ticks++;
            this.tick();
        }
        if (this.clock > 1 / 20) {
            this.clock = 0;
        }
        this.craft.update(delta, this.turn, this.engine);
    };

    ClassicRobotController.prototype.speedPerTick = function () {
        var v = this.craft.velocity;
        return Math.sqrt(v.x * v.x + v.z * v.z) / 20;
    };

    // --- States (enter / tick / exit), 0x414d70 ... 0x42ef40 ----------------------------------

    ClassicRobotController.prototype.go = function (state, target) {
        var exit = this["exit_" + this.state];
        if (exit) {
            exit.call(this);
        }
        if (target !== undefined) {
            this.setTarget(target);
        }
        this.state = state;
        var enter = this["enter_" + state];
        if (enter) {
            enter.call(this);
        }
    };

    ClassicRobotController.prototype.setTarget = function (target) {
        if (this.claimed && (!target || target.beacon !== this.claimed)) {
            if (this.claimed.claimedBy === this) {
                this.claimed.claimedBy = null;
            }
            this.claimed = null;
        }
        this.target = target;
        if (target && target.beacon) {
            target.beacon.claimedBy = this;
            this.claimed = target.beacon;
        }
    };

    ClassicRobotController.prototype.tick = function () {
        var craft = this.craft;
        // Bumps (0x4144d0): a wall hit or a ram makes it back off; a second one while backing off
        // makes it stop and think again. A sled pad makes it drop its goal.
        if (craft.hitWall || craft.bumped) {
            craft.hitWall = false;
            craft.bumped = false;
            this.go(this.state === "backOff" ? "idle" : "backOff", null);
        }
        if (craft.sledTouched) {
            craft.sledTouched = false;
            this.go("idle", null);
        }
        if (this.target && this.target.flag && this.target.flag.captured) {
            this.go("idle", null); // the flag it went for is gone
        }
        this["tick_" + this.state]();
        this.steer();
    };

    // Idle (S0): stop, then look around; with nothing in sight, creep ahead at a third of top speed.
    ClassicRobotController.prototype.enter_idle = function () {
        this.setTarget(null);
        this.wantHeading = this.craft.angle;
        this.stopFirst = true;
        this.maxNow = this.baseSpeed / 3;
    };

    ClassicRobotController.prototype.exit_idle = function () {
        this.maxNow = this.baseSpeed;
        this.stopFirst = false;
    };

    ClassicRobotController.prototype.tick_idle = function () {
        if (this.stopFirst) {
            if (this.speedPerTick() >= 1) {
                return;
            }
            this.stopFirst = false;
        }
        var pos = this.craft.position;
        if (this.kind === "attacker" && this.playerVisible(pos, floorOf(this.craft), true)) {
            this.go("chase", { pos: this.player.position, craft: this.player });
            return;
        }
        if (this.kind === "hunter") {
            var flag = this.flagVisible(pos, floorOf(this.craft));
            if (flag) {
                this.go("toFlag", { pos: flag.location, flag: flag });
                return;
            }
        }
        var beacon = this.nearestFreeBeacon();
        if (beacon) {
            this.go("toBeacon", { pos: beacon.pos, beacon: beacon });
        }
    };

    ClassicRobotController.prototype.nearestFreeBeacon = function () {
        var craft = this.craft,
            world = this.world,
            floor = floorOf(craft),
            pos = craft.position,
            self = this,
            best = null,
            bestDistance = Infinity;
        _.each(this.beacons, function (beacon) {
            if (beacon.claimedBy && beacon.claimedBy !== self || beacon.pos.y < floor - 75 || beacon.pos.y > floor + 114) {
                return;
            }
            var dx = beacon.pos.x - pos.x,
                dz = beacon.pos.z - pos.z,
                distance = dx * dx + dz * dz;
            if (distance < bestDistance && sees(world, pos, beacon.pos, floor, BEACON_SIGHT) && self.pathAllowed(pos, beacon.pos)) {
                best = beacon;
                bestDistance = distance;
            }
        });
        return best;
    };

    /** Attackers keep off hold pads and flag hunters off flag pads (0x41bf20). */
    ClassicRobotController.prototype.pathAllowed = function (from, to) {
        var avoid = this.kind === "attacker" ? HoldPad : FlagReturnPad;
        return !crossesPad(this.world, from, to, function (pad) {
            return pad instanceof avoid;
        });
    };

    // Back off (S1): reverse at 40% of top speed for 3 s, turning away, then stop and think.
    ClassicRobotController.prototype.enter_backOff = function () {
        var oldWant = this.wantHeading;
        this.setTarget(null);
        this.backTicks = BACK_OFF_TICKS;
        this.backSide = wrap(oldWant - this.craft.angle) > 0 ? -1 : 1;
        this.wantHeading = this.craft.angle;
        this.maxNow = this.baseSpeed * BACK_OFF_SPEED;
    };

    ClassicRobotController.prototype.exit_backOff = function () {
        this.maxNow = this.baseSpeed;
    };

    ClassicRobotController.prototype.tick_backOff = function () {
        this.wantHeading = wrap(this.wantHeading + this.backSide * BACK_OFF_TURN);
        if (--this.backTicks <= 0) {
            this.go("idle", null);
        }
    };

    // Go to a beacon (S2), braking to stop on it.
    ClassicRobotController.prototype.enter_toBeacon = function () {
        this.seekBrake = true;
    };

    ClassicRobotController.prototype.exit_toBeacon = function () {
        this.seekBrake = false;
        this.braking = false;
        this.stopFirst = false;
    };

    ClassicRobotController.prototype.tick_toBeacon = function () {
        var pos = this.craft.position;
        if (this.kind === "attacker" && this.playerVisible(pos, floorOf(this.craft), true)) {
            this.atBeacon = null;
            this.go("chase", { pos: this.player.position, craft: this.player });
            return;
        }
        var beacon = this.target && this.target.beacon;
        if (!beacon) {
            this.go("idle", null);
            return;
        }
        var dx = beacon.pos.x - pos.x,
            dz = beacon.pos.z - pos.z,
            arrived = dx * dx + dz * dz < ARRIVED * ARRIVED;
        this.stopFirst = arrived;
        if (arrived && this.speedPerTick() < 1) {
            this.atBeacon = beacon;
            this.go(this.kind === "attacker" ? "plan" : "hunterAtBeacon");
        }
    };

    // Flag hunter at a beacon (S4): a flag in sight, or plan on.
    ClassicRobotController.prototype.tick_hunterAtBeacon = function () {
        var flag = this.flagVisible(this.craft.position, floorOf(this.craft));
        if (flag) {
            this.go("toFlag", { pos: flag.location, flag: flag });
        } else {
            this.go("plan");
        }
    };

    // Plan (S5): look up to 3 or 4 beacons ahead, nearest first, for one the goal can be seen from,
    // one route a tick; failing that, wander to a neighbour not visited lately.
    ClassicRobotController.prototype.enter_plan = function () {
        this.routes = [];
        var start = this.atBeacon,
            routes = this.routes,
            depth = this.ai.depth;
        if (!start) {
            return;
        }
        for (var hops = 1; hops <= depth; hops++) {
            (function walk(beacon, path) {
                if (path.length === hops) {
                    routes.push({ first: path[0], end: beacon });
                    return;
                }
                _.each(beacon.links, function (next) {
                    if (next !== start && _.indexOf(path, next) === -1) {
                        walk(next, path.concat([next]));
                    }
                });
            })(start, []);
        }
    };

    ClassicRobotController.prototype.tick_plan = function () {
        var route = this.routes && this.routes.shift();
        if (!route) {
            this.wander();
            return;
        }
        if (route.first.claimedBy && route.first.claimedBy !== this) {
            return;
        }
        var floor = floorOf(this.craft);
        var goalSeen = this.kind === "attacker" ? this.playerVisible(route.end.pos, floor, true) :
            !!this.flagVisible(route.end.pos, floor);
        if (goalSeen) {
            this.remember(route.first);
            this.go("toBeacon", { pos: route.first.pos, beacon: route.first });
        }
    };

    ClassicRobotController.prototype.remember = function (beacon) {
        this.history.push(beacon);
        if (this.history.length > HISTORY) {
            this.history.shift();
        }
    };

    ClassicRobotController.prototype.wander = function () {
        var links = this.atBeacon ? this.atBeacon.links : [],
            history = this.history,
            choice = null;
        if (links.length === 1) {
            choice = links[0];
        } else if (links.length > 1) {
            var fresh = _.filter(links, function (beacon) {
                return _.indexOf(history, beacon) === -1;
            });
            if (!fresh.length) {
                var latest = history[history.length - 1];
                fresh = _.filter(links, function (beacon) {
                    return beacon !== latest;
                });
            }
            choice = fresh[Math.floor(Math.random() * fresh.length)] || null;
        }
        if (!choice || choice.claimedBy && choice.claimedBy !== this) {
            this.go("idle", null);
            return;
        }
        this.remember(choice);
        this.go("toBeacon", { pos: choice.pos, beacon: choice });
    };

    // Go for a flag (S3): full speed at it, for at most 10 s or while it stays in sight.
    ClassicRobotController.prototype.enter_toFlag = function () {
        this.flagTicks = FLAG_TICKS;
    };

    ClassicRobotController.prototype.tick_toFlag = function () {
        var flag = this.target && this.target.flag;
        if (!flag || --this.flagTicks <= 0 ||
                !sees(this.world, this.craft.position, flag.location, floorOf(this.craft), FLAG_SIGHT)) {
            this.go("idle", null);
        }
    };

    // Chase the player (S6): at full speed with no braking, until the player cloaks or is out of sight.
    ClassicRobotController.prototype.enter_chase = function () {
        var now = Date.now();
        if (!this.lastPing || now - this.lastPing > 500) {
            this.lastPing = now;
            Hover.audio.getSound("ATTKPING").play();
        }
    };

    ClassicRobotController.prototype.tick_chase = function () {
        if (!this.playerVisible(this.craft.position, floorOf(this.craft), false)) {
            this.go("idle", null);
        }
    };

    // --- What a robot sees ------------------------------------------------------------------------

    /** The player, if not cloaked, in sight within the attacker's range (and on this floor). */
    ClassicRobotController.prototype.playerVisible = function (from, floor, sameFloor) {
        var player = this.player;
        if (!player || !player.isVisible() || sameFloor && Math.abs(floorOf(player) - floor) > 64) {
            return false;
        }
        return sees(this.world, from, player.position, floor, this.ai.playerSight);
    };

    /** The first of the player's flags lying in sight within 5,000 (0x40ba10), or null. */
    ClassicRobotController.prototype.flagVisible = function (from, floor) {
        var self = this,
            craft = this.craft;
        return _.find(this.world.flags, function (flag) {
            // The flag's floor: a classic flag's location is its picture's centre, 128 above it
            // (comparing that with the floor hid every classic flag from the robots).
            var flagFloor = flag.location.y - (Hover.retro ? 128 : 0);
            return !flag.captured && flag.team !== craft.team && Math.abs(flagFloor - floor) <= 64 &&
                sees(self.world, from, flag.location, floor, FLAG_SIGHT) && self.pathAllowed(from, flag.location);
        }) || null;
    };

    // --- Steering every tick (0x409350) -----------------------------------------------------------

    ClassicRobotController.prototype.steer = function () {
        var craft = this.craft,
            pos = craft.position,
            velocity = craft.velocity,
            acceleration = craft.acceleration || 1,
            v = this.speedPerTick(),
            angle = craft.angle,
            fullBrake = this.stopFirst,
            heading = this.wantHeading,
            reverse = false,
            velocityHeading = v > 0.001 ? bearing(velocity.x, velocity.z) : angle;
        if (this.target) {
            var dx = this.target.pos.x - pos.x,
                dz = this.target.pos.z - pos.z;
            heading = this.wantHeading = bearing(dx, dz);
            if (this.seekBrake) {
                var stop = v * v / (2 * acceleration),
                    look = v + stop,
                    distance = Math.sqrt(dx * dx + dz * dz);
                if (2 * look > distance) {
                    var ux = v > 0.001 ? velocity.x / (v * 20) : 0,
                        uz = v > 0.001 ? velocity.z / (v * 20) : 0,
                        along = dx * ux + dz * uz,
                        across = Math.abs(dx * uz - dz * ux);
                    if (this.braking) {
                        if (along > 0) {
                            fullBrake = true;
                        }
                    } else if (look > across) {
                        this.braking = true;
                        fullBrake = true;
                    }
                } else {
                    this.braking = false;
                    fullBrake = false;
                }
            }
        }
        if (fullBrake || this.braking) {
            // Brake along the way it is going, without turning round.
            heading = velocityHeading;
            if (Math.abs(wrap(angle - heading)) > Math.PI / 2) {
                heading = wrap(heading + Math.PI);
                reverse = true;
            }
        }
        var want = fullBrake ? 0 : this.maxNow;
        if (v > 1) {
            // Aim up to 21 degrees past the goal to cancel sideways sliding.
            var moving = this.state === "backOff" ? wrap(velocityHeading + Math.PI) : velocityHeading;
            var slip = wrap(moving - heading);
            if (!fullBrake && !this.braking && Math.abs(slip) < DRIFT_WINDOW) {
                heading = wrap(heading + clamp(-5 * slip, -DRIFT_WINDOW, DRIFT_WINDOW));
            }
        } else {
            this.braking = false;
        }
        var error = wrap(heading - angle);
        // A negative turn input turns toward a larger angle (Craft.applyClassicTurn).
        this.turn = -clamp(error / (5 * U), -1, 1);
        if (this.braking && !fullBrake) {
            this.engine = 0;
        } else if (Math.abs(error) < AIM_TOLERANCE) {
            this.engine = clamp((want - v) / acceleration, -1, 1) * (this.state === "backOff" || reverse ? -1 : 1);
        } else {
            this.engine = 0;
        }
    };

    // --- Crafts bumping into each other (0x42b8e0, 0x42be50, 0x408550) ----------------------------

    /** The touching nose/tail points of two crafts (circles of radius max(50, 1.5 x speed)), or null. */
    function contactPoints(a, b) {
        if (Math.abs(a.position.y - b.position.y) > 64) {
            return null;
        }
        function ends(craft) {
            var fx = -Math.sin(craft.angle) * 50,
                fz = -Math.cos(craft.angle) * 50;
            return [{ x: craft.position.x + fx, z: craft.position.z + fz }, { x: craft.position.x - fx, z: craft.position.z - fz }];
        }
        function radius(craft) {
            return Math.max(50, 1.5 * Math.sqrt(craft.velocity.x * craft.velocity.x + craft.velocity.z * craft.velocity.z) / 20);
        }
        var endsA = ends(a),
            endsB = ends(b),
            reach = radius(a) + radius(b),
            pairs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (var i = 0; i < pairs.length; i++) {
            var p = endsA[pairs[i][0]],
                q = endsB[pairs[i][1]];
            if (Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z)) < reach) {
                return { a: p, b: q };
            }
        }
        return null;
    }

    /** Moves a craft by (dx, dz) only if it touches no wall there; returns whether it moved. */
    World.prototype.moveCraftIfClear = function (craft, dx, dz) {
        var probe = craft.position.clone();
        probe.x += dx;
        probe.z += dz;
        probe.y += 25;
        if (this.checkCraftAgainstStaticGeometry(craft, probe).length) {
            return false;
        }
        craft.position.x += dx;
        craft.position.z += dz;
        return true;
    };

    /**
     * Classic mode's craft contacts, for the player and every robot (in place of simulateCollisions):
     * the approaching part of each craft's velocity passes to the other, and the craft that was
     * moving toward the other is marked as having rammed it (`bumped`, so a robot backs off). Crafts
     * are pushed apart only when less than 40 units apart, half each, never into a wall. Returns the
     * robot the player touched, if any.
     */
    World.prototype.resolveCraftContactsClassic = function (player) {
        var crafts = [player].concat(_.map(this.drones, function (drone) {
            return drone.craft;
        }));
        var touched = null;
        for (var i = 0; i < crafts.length; i++) {
            for (var j = i + 1; j < crafts.length; j++) {
                var a = crafts[i],
                    b = crafts[j];
                if (!a || !b || a === b) {
                    continue;
                }
                var contact = contactPoints(a, b);
                if (!contact) {
                    continue;
                }
                var nx = contact.b.x - contact.a.x,
                    nz = contact.b.z - contact.a.z,
                    distance = Math.sqrt(nx * nx + nz * nz);
                if (distance < 0.001) {
                    nx = b.position.x - a.position.x;
                    nz = b.position.z - a.position.z;
                    distance = Math.sqrt(nx * nx + nz * nz) || 1;
                }
                nx /= distance;
                nz /= distance;
                if (distance < 40) {
                    var push = (40 - distance) / 2;
                    var aMoved = this.moveCraftIfClear(a, -nx * push, -nz * push),
                        bMoved = this.moveCraftIfClear(b, nx * push, nz * push);
                    // One against a wall: the other takes the whole push.
                    if (!aMoved && bMoved) {
                        this.moveCraftIfClear(b, nx * push, nz * push);
                    } else if (aMoved && !bMoved) {
                        this.moveCraftIfClear(a, -nx * push, -nz * push);
                    }
                }
                var aToward = a.velocity.x * nx + a.velocity.z * nz,  // > 0: a moving toward b
                    bToward = b.velocity.x * nx + b.velocity.z * nz;  // < 0: b moving toward a
                var aApproaches = aToward > 0,
                    bApproaches = bToward < 0;
                if (aApproaches) {
                    a.velocity.x -= aToward * nx;
                    a.velocity.z -= aToward * nz;
                    b.velocity.x += aToward * nx;
                    b.velocity.z += aToward * nz;
                }
                if (bApproaches) {
                    b.velocity.x -= bToward * nx;
                    b.velocity.z -= bToward * nz;
                    a.velocity.x += bToward * nx;
                    a.velocity.z += bToward * nz;
                }
                a.bumped = a.bumped || aApproaches;
                b.bumped = b.bumped || bApproaches;
                if (a === player || b === player) {
                    var robot = a === player ? b : a;
                    var now = Date.now();
                    if (!robot.lastHitSound || now - robot.lastHitSound > 500) {
                        robot.lastHitSound = now;
                        Hover.audio.getSound("HIT_ROBT").play();
                    }
                    touched = robot;
                }
            }
        }
        player.bumped = false; // only robots react to bumps
        return touched;
    };
})(Hover);
