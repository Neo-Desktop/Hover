// Original: game.js lines 9-26, 86-88, 114-177, 191-222, 758-910, 929-961, 1030-1043
// Hovercraft classes (physics base, the local player's craft, drone/remote crafts), the retro billboard
// sprite, the flag-capture behavior, a debug line helper and the capture-the-flag Flag.
// Uses: Signal, toNetVector (01-util.js), OrientedBoundingBox (02-geometry.js); at runtime also Gun,
// TempWall, createEmissiveMaterial, Hover.RetroHud/ModernHud, Hover.audio, Hover.sprites (later files).

// ---------------------------------------------------------------------------------------------------------------
// RetroSprite
// ---------------------------------------------------------------------------------------------------------------

/**
 * 2D billboard sprite used in retro mode. Registers its image at `location` with the global sprite manager.
 * (The `size` argument is not used.)
 */
function RetroSprite(map, location, size, img) {
    this.img = img;
    this.location = location;
    this.map = map;
    this.time = 0;
    Hover.sprites.addPoint(this.img, this.location);
}

RetroSprite.prototype.update = function (dt) {
};

/** Name of the current animation frame texture (8 frames at 20 fps). */
RetroSprite.prototype.getTexture = function () {
    var frameIndex = parseInt(20 * this.time) % 8;
    return this.img + "_0" + frameIndex;
};

RetroSprite.prototype.remove = function () {
    Hover.sprites.removePoint(this.img, this.location);
};

// ---------------------------------------------------------------------------------------------------------------
// BehaviorHost
// ---------------------------------------------------------------------------------------------------------------

/** Base class for objects that can be extended with behaviors (init/update/getExtensions). */
function BehaviorHost() {
    this.behaviors = [];
}

BehaviorHost.prototype.addBehavior = function (behavior) {
    var self = this;
    // NOTE: iterates the getExtensions function itself (not its result), as in the original.
    _.each(behavior.getExtensions, function (extension) {
        self[extension.name] = extension.method;
    });
    behavior.init.call(this);
    this.behaviors.push(behavior);
};

// ---------------------------------------------------------------------------------------------------------------
// Craft
// ---------------------------------------------------------------------------------------------------------------

/**
 * Hovercraft physics base: turning, acceleration, wall bouncing, hovering altitude, jumps (springs),
 * cloaking, temporary walls, speed modifiers, protection, health/damage and its gun.
 * `profile` supplies the handling values (turnSpeed, turnDrag, acceleration, drag, maxSpeed...).
 */
function Craft(world, position, angle, team, profile) {
    BehaviorHost.call(this);
    this.id = "ID" + Math.random();
    this.player = false;
    this.team = team;
    this.profile = profile;
    this.health = 100;
    this.turnSpeed = profile.turnSpeed;
    this.turnDrag = profile.turnDrag;
    this.acceleration = profile.acceleration;
    this.drag = profile.drag;
    this.maxSpeed = profile.maxSpeed;
    this.maxSpeedModifier = 1;
    this.maxSpeedModifierTime = 0;
    this.disabledTime = 0;
    this.protectionTime = 0;
    this.position = position;
    this.lastPosition = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.angle = angle;
    this.turnRate = 0;
    this.onHit = new Signal();
    this.world = world;
    this.color = "#FFFFFF";
    this.lastEngine = 0;
    this.lastTurn = 0;
    this.springCount = 0;
    this.wallCount = 0;
    this.cloakCount = 0;
    this.onGround = false;
    this.cloakTime = 0;
    this.isHeld = false;
    this.holdTimer = -1; // classic hold pad (this edition): -1 free, > 0 held, 0 let go but still on it
    this.onFlagPad = false;
    this.engineNormal = Hover.audio.getSound("ENG_NORM");
    this.engineLow = Hover.audio.getSound("ENG_LOW");
    this.engineHigh = Hover.audio.getSound("ENG_HIGH");
    this.engineIdle = Hover.audio.getSound("ENG_IDLE");
    this.enginePlaying = null;
    this.gun = new Gun(this.world, this);
    this.onDamaged = new Signal();
    this.capturedFlags = 0;
}

Craft.prototype = Object.create(BehaviorHost.prototype);

/** Per-frame update. `turn` and `engine` are the control inputs (-1..1); disabled crafts get no engine input. */
Craft.prototype.update = function (dt, turn, engine) {
    var self = this;
    if (this.isDisabled()) {
        engine = "";
        this.disabledTime -= dt;
    }
    if (this.health < 100) {
        this.health += 5 * dt;
    }
    _.each(this.behaviors, function (behavior) {
        behavior.update.call(self, dt, turn, engine);
    });
    this.manageProtection(dt);
    this.manageMaxSpeed(dt);
    this.manageCloak(dt);
    this.applyTurn(dt, turn);
    if (this.holdTimer > 0) {
        engine = 0; // classic hold pad: no thrust (see applyClassicHold)
    }
    if (!this.isHeld) {
        this.maintainAltitude(dt);
        this.applyAccel(dt, engine);
    }
    this.applyClassicHold(dt);
    this.world.interactWithPads(this);
    if (this.gun != null) {
        this.gun.update(dt);
    }
};

/**
 * Added in this edition: a classic-mode hold pad (World.interactWithPadsClassic sets holdTimer to
 * 4.5 s). As in the 1995 game the engine is cut and the craft loses a third of its speed every
 * 1/20 s, so it slides to a stop and can still turn. When the time is up holdTimer stays at 0 until
 * the craft leaves the pad, so it can't be held again straight away.
 */
Craft.prototype.applyClassicHold = function (dt) {
    if (!(this.holdTimer > 0)) {
        return;
    }
    this.velocity.x *= Math.pow(2 / 3, dt * 20);
    this.velocity.z *= Math.pow(2 / 3, dt * 20);
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) {
        this.holdTimer = 0;
        if (this.player) {
            Hover.audio.getSound("HOLD_EN").play();
        }
    }
};

Craft.prototype.manageProtection = function (dt) {
    if (this.protectionTime > 0) {
        this.protectionTime -= dt;
        if (this.protectionTime <= 0 && this.player) {
            Hover.audio.getSound("INVIN_EN").play();
        }
    }
};

Craft.prototype.manageCloak = function (dt) {
    if (this.cloakTime > 0) {
        this.cloakTime -= dt;
        if (this.cloakTime <= 0 && this.player) {
            Hover.audio.getSound("CLOAK_EN").play();
        }
    }
};

/** Counts down a temporary speed modifier and resets it to 1 when it expires. */
Craft.prototype.manageMaxSpeed = function (dt) {
    if (this.maxSpeedModifier != 1) {
        this.maxSpeedModifierTime -= dt;
        if (this.maxSpeedModifierTime <= 0) {
            this.applySpeedModifier(1, 0);
        }
    }
};

Craft.prototype.applyTurn = function (dt, turn) {
    if (this.profile && this.profile.classic) {
        this.applyClassicTurn(dt, turn);
        return;
    }
    var turnDelta = 0;
    if (turn != 0) {
        turnDelta = -turn * this.turnSpeed;
        this.lastTurn = turn;
    } else {
        turnDelta = -this.turnRate * this.turnDrag / 65536;
        this.lastTurn = 0;
    }
    this.turnRate += turnDelta * dt * 20;
    turn = Math.abs(turn);
    turn = turn > 0 ? turn : 1;
    if (this.turnRate < -this.turnSpeed * turn) {
        this.turnRate = -this.turnSpeed * turn;
    } else if (this.turnRate > this.turnSpeed * turn) {
        this.turnRate = this.turnSpeed * turn;
    }
    this.angle += this.turnRate * dt * 20;
};

/*
 * Added in this edition: the 1995 game's movement rules, used by crafts with a `classic` profile
 * (Profiles.Classic, classic mode). Read from HOVER.EXE (turning at 0x40a9f0, movement at 0x40b0b0);
 * the original ran exactly 20 ticks per second, so per-tick rules are scaled by `ticks = dt * 20`.
 */

/** 1995 turning: input builds the turn rate up to turnSpeed, then turnDrag slows it every tick. */
Craft.prototype.applyClassicTurn = function (dt, turn) {
    var limit = this.turnSpeed;
    this.lastTurn = turn;
    // The turn rate changes in whole 1/20 s ticks, as in 1995 (so a held key turns at exactly
    // (1 - turnDrag) x turnSpeed per tick at any frame rate); the angle moves smoothly between ticks.
    this.classicTurnClock = Math.min((this.classicTurnClock || 0) + dt, 1);
    while (this.classicTurnClock >= 1 / 20) {
        this.classicTurnClock -= 1 / 20;
        if (turn < 0 && this.turnRate < limit) {
            this.turnRate = Math.min(this.turnRate - turn * limit, limit);
        } else if (turn > 0 && this.turnRate > -limit) {
            this.turnRate = Math.max(this.turnRate - turn * limit, -limit);
        }
        this.turnRate *= 1 - this.turnDrag / 65536;
    }
    this.angle += this.turnRate * dt * 20;
};

/**
 * 1995 "traction": above 4 units per tick the velocity is pulled 10% (profile.traction) of the way
 * toward the direction the nose points, every tick, keeping the speed. Sideways sliding dies away and
 * becomes forward speed. When the craft is moving backwards it is pulled toward the tail instead.
 */
Craft.prototype.applyClassicTraction = function (dt) {
    if (this.collisionGripPause > 0) {
        // Just bumped into another craft (World.separateCrafts): let the bounce play out.
        this.collisionGripPause -= dt;
        return;
    }
    var velocity = this.velocity,
        speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (speed <= 4 * 20) {
        return;
    }
    var noseX = -Math.sin(this.angle),
        noseZ = -Math.cos(this.angle);
    if (noseX * velocity.x + noseZ * velocity.z < -Math.SQRT1_2 * speed) {
        noseX = -noseX;
        noseZ = -noseZ;
    }
    var pull = 1 - Math.pow(1 - this.profile.traction, dt * 20);
    velocity.x += (noseX * speed - velocity.x) * pull;
    velocity.z += (noseZ * speed - velocity.z) * pull;
};

/**
 * Applies engine thrust (or drag), switches the engine sound for the player, clamps the speed, bounces off
 * static geometry and finally moves the craft.
 */
Craft.prototype.applyAccel = function (dt, engine) {
    var accelX, accelZ, self = this;
    this.lastEngine = engine;
    if (engine !== 0) {
        accelX = -Math.sin(this.angle) * (400 * this.acceleration * engine);
        accelZ = -Math.cos(this.angle) * (400 * this.acceleration * engine);
        this.lastEngine = engine;
    } else {
        accelX = -this.velocity.x * this.drag / 65536 * 20;
        accelZ = -this.velocity.z * this.drag / 65536 * 20;
        this.lastEngine = 0;
    }
    if (this.player) {
        var sound = this.engineIdle;
        if (engine !== 0) {
            sound = this.maxSpeedModifier < 1 ? this.engineLow : this.maxSpeedModifier > 1 ? this.engineHigh : this.engineNormal;
        }
        if (sound != this.enginePlaying) {
            if (this.enginePlaying) {
                this.enginePlaying.stop();
            }
            if (sound != null) {
                sound.play();
                this.enginePlaying = sound;
            }
        }
    }
    this.velocity.x += accelX * dt;
    this.velocity.z += accelZ * dt;
    var speed = this.velocity.length(),
        maxSpeed = this.maxSpeed * this.maxSpeedModifier * 20;
    if (speed > maxSpeed) {
        this.velocity.multiplyScalar(maxSpeed / speed);
    }
    if (this.profile && this.profile.classic) {
        // 1995 rules (this edition): a coasting craft that is almost still stops dead (the drag
        // would change its speed by less than 0.01 per tick on both axes), and traction grips.
        if (engine === 0 &&
                Math.abs(this.velocity.x / 20 * this.drag / 65536) < 0.01 &&
                Math.abs(this.velocity.z / 20 * this.drag / 65536) < 0.01) {
            this.velocity.x = 0;
            this.velocity.z = 0;
        }
        this.applyClassicTraction(dt);
    }
    var step = this.velocity.clone().multiplyScalar(dt),
        probeHeight = 25,
        probe = this.position.clone().add(step);
    probe.y += probeHeight;
    // This edition: check the whole path, not only where the move ends. A long frame or a push from a
    // robot could make one move longer than a wall is thick, and the craft passed straight through
    // the wall (and could end up under a floor).
    var hits = this.sweptWallHits(step, probeHeight);
    var classic = this.profile && this.profile.classic;
    if (hits.length > 0 && classic) {
        if (this.player) {
            Hover.audio.getSound("HIT_WALL").play();
        }
        this.classicWallResponse(hits, step, probeHeight, dt);
    } else if (hits.length > 0) {
        if (this.player) {
            Hover.audio.getSound("HIT_WALL").play();
        }
        var normal = new THREE.Vector3(0, 0, 0);
        _.each(hits, function (hit) {
            var into = Math.abs(self.velocity.dot(hit.intersectNormal));
            if (into > 20) {
                self.hitWall = true; // bounced off a wall: a drone backs off (24-classic-robots.js)
            }
            normal.add(hit.intersectNormal.multiplyScalar(into));
        });
        normal.normalize();
        var oldVelocityX = this.velocity.x,
            oldVelocityZ = this.velocity.z;
        // reflect the velocity about the combined wall normal
        this.velocity = normal.multiplyScalar(-2 * this.velocity.dot(normal)).add(this.velocity);
        step.copy(this.velocity).multiplyScalar(dt);
        probe = this.position.clone().add(step);
        probe.y += probeHeight;
        if (this.world.checkCraftAgainstStaticGeometry(this, probe).length > 0 && this.velocity.y < 0) {
            this.velocity.set(oldVelocityX, 0, oldVelocityZ);
            step.copy(this.velocity).multiplyScalar(dt);
        }
        this.keepOutOfWalls(step, probeHeight);
    }
    if (this.velocity.y > 0) {
        var groundHere = this.world.getGroundHeightBelowPoint(this.position),
            above = this.position.clone();
        above.y += step.y + 32;
        var groundAbove = this.world.getGroundHeightBelowPoint(above);
        // hitting a ceiling: bounce back down
        if (groundAbove != groundHere) {
            step.y *= -1;
            this.velocity.y *= -1;
        }
    }
    if (classic && (step.x || step.z)) {
        // This edition: never move off the edge of the maze. Past the outer walls there is no floor,
        // and a craft pushed there used to fall out of the map.
        var next = this.position.clone().add(step);
        if (this.world.getGroundHeightBelowPoint(next) === -1000 && this.world.getGroundHeightBelowPoint(this.position) !== -1000) {
            step.x = 0;
            step.z = 0;
            this.velocity.x = 0;
            this.velocity.z = 0;
        }
    }
    this.lastPosition.copy(this.position);
    this.position.add(step);
};

/** Distance in the ground plane from (x, z) to a wall's segment. */
function distanceToWall(x, z, wall) {
    var ax = wall[0].x,
        az = wall[0].z,
        dx = wall[1].x - ax,
        dz = wall[1].z - az,
        lengthSq = dx * dx + dz * dz,
        t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0,
        px = ax + t * dx - x,
        pz = az + t * dz - z;
    return Math.sqrt(px * px + pz * pz);
}

/**
 * Added in this edition: wall hits in classic mode. Each wall's normal is taken pointing from the
 * wall toward the craft (the remake pointed it along the craft's velocity, and near a wall's end
 * replaced it with a sideways one, which in corners made the bounce do nothing); the craft bounces
 * off only the walls it is moving into, as the 1995 game mirrors the velocity. The move that
 * results must not go into a wall: it slides along one, or stops; a craft already touching a wall
 * may only move away from it, and is eased out of it.
 */
Craft.prototype.classicWallResponse = function (hits, step, probeHeight, dt) {
    var self = this,
        x = this.position.x,
        z = this.position.z;
    var normals = _.map(hits, function (hit) {
        var wall = hit.wall,
            wx = wall[1].x - wall[0].x,
            wz = wall[1].z - wall[0].z,
            length = Math.sqrt(wx * wx + wz * wz) || 1,
            nx = -wz / length,
            nz = wx / length;
        if ((x - wall[0].x) * nx + (z - wall[0].z) * nz < 0) {
            nx = -nx;
            nz = -nz;
        }
        return { x: nx, z: nz, wall: wall };
    });
    _.each(normals, function (n) {
        var into = self.velocity.x * n.x + self.velocity.z * n.z;
        if (into < 0) {
            self.velocity.x -= 2 * into * n.x;
            self.velocity.z -= 2 * into * n.z;
            if (into < -20) {
                self.hitWall = true; // bounced off a wall: a robot backs off (24-classic-robots.js)
            }
        }
    });
    step.x = this.velocity.x * dt;
    step.z = this.velocity.z * dt;
    if (!this.sweptWallHits(step, probeHeight).length) {
        return;
    }
    if (!this.sweptWallHits(new THREE.Vector3(0, 0, 0), probeHeight).length) {
        this.keepOutOfWalls(step, probeHeight);
        return;
    }
    // Already touching a wall: allow only a move that gets no closer to any wall it touches, else
    // ease it out along the walls' normals.
    var gettingCloser = _.some(normals, function (n) {
        return distanceToWall(x + step.x, z + step.z, n.wall) < distanceToWall(x, z, n.wall);
    });
    if (gettingCloser) {
        var outX = 0,
            outZ = 0;
        _.each(normals, function (n) {
            outX += n.x;
            outZ += n.z;
        });
        var outLength = Math.sqrt(outX * outX + outZ * outZ) || 1;
        step.x = outX / outLength * 8;
        step.z = outZ / outLength * 8;
        _.each(normals, function (n) {
            var into = self.velocity.x * n.x + self.velocity.z * n.z;
            if (into < 0) {
                self.velocity.x -= into * n.x;
                self.velocity.z -= into * n.z;
            }
        });
    }
};

/**
 * Added in this edition: after bouncing off a wall, makes sure the move doesn't still go into one.
 * In corners the bounce (the velocity reflected about the walls' combined normal) can point into the
 * other wall, which let the player and the robots drive into walls and get stuck there. Such a move
 * now slides along one axis, or stops. A craft that is already inside a wall is left free to leave.
 */
Craft.prototype.keepOutOfWalls = function (step, probeHeight) {
    var world = this.world,
        self = this;
    function blocked(move) {
        return self.sweptWallHits(move, probeHeight).length > 0;
    }
    if (!blocked(step) || blocked(new THREE.Vector3(0, 0, 0))) {
        return;
    }
    var alongX = new THREE.Vector3(step.x, step.y, 0),
        alongZ = new THREE.Vector3(0, step.y, step.z);
    if (Math.abs(step.x) >= Math.abs(step.z) && !blocked(alongX) || !blocked(alongX) && blocked(alongZ)) {
        step.copy(alongX);
        this.velocity.z = 0;
    } else if (!blocked(alongZ)) {
        step.copy(alongZ);
        this.velocity.x = 0;
    } else {
        step.x = 0;
        step.z = 0;
        this.velocity.x = 0;
        this.velocity.z = 0;
    }
};

/**
 * Added in this edition: the walls the craft would touch anywhere along `move`, tested every 24
 * units of the way (the first place it touches one), or [] when the path is clear.
 */
Craft.prototype.sweptWallHits = function (move, probeHeight) {
    var length = Math.sqrt(move.x * move.x + move.z * move.z),
        parts = Math.max(1, Math.ceil(length / 24));
    for (var i = 1; i <= parts; i++) {
        var probe = this.position.clone().add(move.clone().multiplyScalar(i / parts));
        probe.y += probeHeight;
        var hits = this.world.checkCraftAgainstStaticGeometry(this, probe);
        if (hits.length > 0) {
            return hits;
        }
    }
    return [];
};

Craft.prototype.revertPosition = function () {
    this.position.copy(this.lastPosition);
};

Craft.prototype.toggleSound = function (on) {
    if (this.enginePlaying) {
        if (on) {
            this.enginePlaying.play();
            Hover.audio.getSound("MUSIC").play();
        } else {
            this.enginePlaying.stop();
            Hover.audio.getSound("MUSIC").stop();
        }
    }
};

/** Keeps the craft hovering 96 units above the ground, applying gravity when it is higher. */
Craft.prototype.maintainAltitude = function (dt) {
    var hoverHeight = 96,
        ground = this.world.getGroundHeightBelowPoint(this.position);
    this.onGround = true;
    if (this.position.y - ground < hoverHeight) {
        this.position.y = ground + hoverHeight;
        if (this.velocity.y < 0) {
            this.velocity.y = 0;
            if (this.player) {
                Hover.audio.getSound("JUMP_EN").play();
            }
        }
    } else if (this.position.y - ground > hoverHeight) {
        this.velocity.y -= 2 * dt * 16 * 20;
        this.onGround = false;
    }
};

/** Jumps using one spring, when on the ground. */
Craft.prototype.jump = function () {
    if (this.onGround && this.springCount > 0) {
        this.springCount--;
        this.velocity.y = 800;
        if (this.player) {
            Hover.audio.getSound("JUMP_ST").play();
        }
    }
};

/** State snapshot sent to the server in multiplayer. */
Craft.prototype.getStateUpdate = function () {
    return {
        Position: toNetVector(this.position),
        Velocity: toNetVector(this.velocity),
        AngleY: this.angle,
        EngineState: this.lastEngine,
        TurnState: this.lastTurn,
        ProtectionTime: this.protectionTime,
        MaxSpeedModifier: this.maxSpeedModifier,
        MaxSpeedModifierTime: this.maxSpeedModifierTime,
        CloakTime: this.cloakTime,
        DisabledTime: this.disabledTime,
        Health: this.health,
        CapturedFlags: this.capturedFlags
    };
};

/** Sets a temporary max-speed multiplier (slow-downs are ignored while protected). */
Craft.prototype.applySpeedModifier = function (modifier, duration) {
    if (!this.isProtected() || modifier >= 1) {
        if (modifier < this.maxSpeedModifier && this.player) {
            Hover.audio.getSound("SPEED_RE").play();
        } else if (modifier > this.maxSpeedModifier && this.player) {
            Hover.audio.getSound("SPEED_EN").play();
        }
        this.maxSpeedModifier = modifier;
        this.maxSpeedModifierTime = duration;
    }
};

/** Makes the craft invulnerable for `duration`, cancelling any current slow-down. */
Craft.prototype.applyProtection = function (duration) {
    this.protectionTime = duration;
    if (this.isProtected() && this.maxSpeedModifier < 1) {
        this.applySpeedModifier(1, 0);
    }
};

Craft.prototype.isProtected = function () {
    return this.protectionTime > 0;
};

Craft.prototype.addSpring = function () {
    if (this.springCount < 9) {
        this.springCount++;
    }
};

Craft.prototype.getSpringCount = function () {
    return this.springCount;
};

Craft.prototype.getWallCount = function () {
    return this.wallCount;
};

/** Uses one cloak: invisible for 10 seconds. */
Craft.prototype.cloak = function () {
    if (this.cloakCount > 0) {
        if (this.player) {
            Hover.audio.getSound("CLOAK_ST").play();
        }
        this.cloakCount--;
        this.cloakTime = 10;
    }
};

Craft.prototype.isVisible = function () {
    return this.cloakTime <= 0;
};

Craft.prototype.getCloakTime = function () {
    return this.cloakTime;
};

Craft.prototype.addCloak = function () {
    if (this.cloakCount < 9) {
        this.cloakCount++;
    }
};

Craft.prototype.getCloakCount = function () {
    return this.cloakCount;
};

Craft.prototype.addWall = function () {
    if (this.wallCount < 9) {
        this.wallCount++;
    }
};

/** Places a temporary force-field wall 150 units in front of the craft. */
Craft.prototype.placeWall = function () {
    if (this.wallCount > 0) {
        this.wallCount--;
        var offset = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle)).multiplyScalar(150),
            wall = new TempWall(this.world, this.position.clone().add(offset), this.angle);
        this.world.addTempWall(wall);
        this.world.onTempWallCreated.call(this.world, wall);
        if (this.player) {
            Hover.audio.getSound("SHIELD").play();
        }
    }
};

Craft.prototype.setHeld = function (held) {
    this.isHeld = held;
};

Craft.prototype.fire = function () {
    if (this.gun != null) {
        this.gun.fire();
    }
};

/** Takes damage (unless disabled/protected); at 0 health the craft is disabled for 20 seconds. */
Craft.prototype.applyDamage = function (amount, source) {
    if (!this.isDisabled() && !this.isProtected() && this.health > 0) {
        this.health -= amount;
        if (this.health <= 0) {
            this.disabledTime = 20;
            this.health = 0;
        }
    }
    this.onDamaged.call(this, source);
};

/** Collision box of the craft, optionally at another position. */
Craft.prototype.getOrientedBoundingBox = function (position) {
    var center = position || this.position,
        rotation = (new THREE.Matrix4()).makeRotationAxis(new THREE.Vector3(0, 1, 0), this.angle),
        axes = [new THREE.Vector3(1, 0, 0).applyMatrix4(rotation), new THREE.Vector3(0, 1, 0).applyMatrix4(rotation), new THREE.Vector3(0, 0, 1).applyMatrix4(rotation)];
    return new OrientedBoundingBox(center, [128, 64, 128], axes);
};

Craft.prototype.isDisabled = function () {
    return this.disabledTime > 0;
};

Craft.prototype.applyForce = function (force) {
    if (!this.isProtected()) {
        this.velocity.add(force);
    }
};

// ---------------------------------------------------------------------------------------------------------------
// PlayerCraft
// ---------------------------------------------------------------------------------------------------------------

/** The local player's craft: discovers radar walls by line of sight and owns the HUD. */
function PlayerCraft(world, position, angle, team, profile) {
    Craft.call(this, world, position, angle, team, profile);
    this.color = "#FF0000";
    this.unfoundWalls = world.radarWalls.slice();
    this.radarWalls = [];
    this.radarIndex = 0;
    this.player = true;
    var HudClass = Hover.retro ? Hover.RetroHud : Hover.ModernHud;
    this.hud = new HudClass(world, this);
}

PlayerCraft.prototype = Object.create(Craft.prototype);

/**
 * Checks a slice of the not-yet-seen walls for line of sight (adding visible ones to the radar), checks pod
 * hits, runs the physics and updates the HUD.
 */
PlayerCraft.prototype.update = function (dt, turn, engine) {
    Hover.Statistics.stat.start("craft-findVisibleWalls");
    if (!Hover.arm) {
        // NOTE: function-scoped var; stays undefined when Hover.arm is set (radarIndex then becomes NaN).
        var wallsToCheck = parseInt(this.unfoundWalls.length * dt / 3) + 1;
        wallsToCheck = Math.min(wallsToCheck, this.unfoundWalls.length);
        for (var fromX, fromY, fromZ, toX, toY, toZ, wallStart, wallEnd, n = 0; n < wallsToCheck; n++) {
            var index = (n + this.radarIndex) % this.unfoundWalls.length,
                entry = this.unfoundWalls[index];
            if (!entry.found) {
                fromX = this.position.x;
                fromY = this.position.y;
                fromZ = this.position.z;
                wallStart = entry.wall[0];
                wallEnd = entry.wall[1];
                toX = wallStart.x / 2 + wallEnd.x / 2;
                toY = wallStart.y / 2 + wallEnd.y / 2;
                toZ = wallStart.z / 2 + wallEnd.z / 2;
                fromY = toY;
                toX = fromX + 0.95 * (toX - fromX);
                toZ = fromZ + 0.95 * (toZ - fromZ);
                if (!this.world.getCollisionXYZ(fromX, fromY, fromZ, toX, toY, toZ)) {
                    entry.found = true;
                    this.radarWalls.push(entry);
                    this.unfoundWalls.splice(index, 1);
                }
            }
        }
    }
    Hover.Statistics.stat.start("craft-checkForPodHits");
    this.world.checkForPodHits(this);
    Hover.Statistics.stat.start("craft-runPhysics");
    Craft.prototype.update.call(this, dt, turn, engine);
    this.hud.update(dt);
    Hover.Statistics.stat.end();
    this.radarIndex += wallsToCheck;
};

/** Forgets every discovered radar wall (unless protected). */
PlayerCraft.prototype.resetRadarWalls = function () {
    if (!this.isProtected()) {
        for (var i = 0; i < this.radarWalls.length; i++) {
            this.radarWalls[i].found = false;
            this.unfoundWalls.push(this.radarWalls[i]);
        }
        this.radarWalls = [];
    }
};

// ---------------------------------------------------------------------------------------------------------------
// FlagCaptureBehavior
// ---------------------------------------------------------------------------------------------------------------

/** Craft behavior: each update, checks whether the craft (this) captures an enemy flag. */
function FlagCaptureBehavior() {
}

FlagCaptureBehavior.prototype.init = function () {
};

FlagCaptureBehavior.prototype.getExtensions = function () {
    return [];
};

// Called with `this` = the craft.
FlagCaptureBehavior.prototype.update = function (dt) {
    this.world.checkForFlagCaptures(this, this.team == "red" ? "blue" : "red");
};

// ---------------------------------------------------------------------------------------------------------------
// LabeledCraft, ModelCraft, SpriteCraft
// ---------------------------------------------------------------------------------------------------------------

/** Craft with a floating name label (canvas texture) that faces the camera. */
function LabeledCraft(scene, world, position, angle, team, profile) {
    this.currentText = "";
    this.currentKey = "";
    this.textMesh = null;
    this.scene = scene;
    Craft.call(this, world, position, angle, team, profile);
    var self = this;
    this.onBeforeRenderTextHandler = this.scene.onBeforeRender.register(function (renderArg, camera) {
        if (self.textMesh != null) {
            self.setText(self.currentText);
            var lookTarget = Hover.tempVector3.copy(camera.position);
            lookTarget.y = self.textMesh.position.y;
            self.textMesh.position.copy(self.position);
            self.textMesh.lookAt(lookTarget);
            self.textMesh.position.y += 64;
            self.textMesh.visible = self.isVisible();
        }
    });
    this.setText("");
}

LabeledCraft.prototype = Object.create(Craft.prototype);

/** Re-renders the label texture when the text, rounded health or disabled state changed. */
LabeledCraft.prototype.setText = function (text) {
    text = text.toUpperCase();
    var roundedHealth = 5 * Math.round(this.health / 5),
        key = text + ":" + roundedHealth + ":" + this.isDisabled();
    if (key != this.currentKey) {
        this.currentText = text;
        this.currentKey = key;
        var canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d"),
            size = 256;
        canvas.width = canvas.height = size;
        ctx.font = "bold 12pt astronaut-regular";
        ctx.fillStyle = "#FCB649";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 128, 128);
        ctx.fillStyle = "#FFAAAA";
        ctx.fillStyle = this.isDisabled() ? "#FF0000" : "#AAFFAA";
        var texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        var material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false
            }),
            mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), material);
        if (this.textMesh != null) {
            this.scene.remove(this.textMesh);
        }
        mesh.scale.x = 2;
        mesh.scale.y = 2;
        material.side = THREE.DoubleSide;
        this.textMesh = mesh;
        this.scene.add(mesh);
        mesh.disableGlow = true;
    }
};

LabeledCraft.prototype.removeFromScene = function () {
    if (this.textMesh !== null) {
        this.scene.remove(this.textMesh);
    }
};

/** Drone/remote craft drawn with the 3D model named by profile.modelName in the team's texture. */
function ModelCraft(scene, world, position, angle, team, profile) {
    LabeledCraft.call(this, scene, world, position, angle, team, profile);
    this.color = "#FF00FF";
    this.scene = scene;
    var model = Hover.Editor.schemeLoader.models[profile.modelName],
        material = createEmissiveMaterial(team === "red" ? model.redDiffuseTexture : model.blueDiffuseTexture),
        mesh = new THREE.Mesh(model.geometry, material);
    this.mesh = mesh;
    this.scene.add(mesh);
    var self = this;
    this.onBeforeRenderHandler = self.scene.onBeforeRender.register(function (renderArg, camera) {
        self.mesh.position.copy(self.position);
        mesh.position.y -= 60;
        self.mesh.rotation.y = self.angle;
        self.mesh.visible = self.isVisible();
    });
}

ModelCraft.prototype = Object.create(LabeledCraft.prototype);

ModelCraft.prototype.removeFromScene = function () {
    this.scene.onBeforeRender.remove(this.onBeforeRenderHandler);
    this.scene.remove(this.mesh);
    LabeledCraft.prototype.removeFromScene.call(this);
};

/** Uses the model's boundingBoxExtent when available, otherwise the default craft box. */
ModelCraft.prototype.getOrientedBoundingBox = function (position) {
    if (!this.boundingBoxExtent || !this.mesh) {
        return Craft.prototype.getOrientedBoundingBox.call(this, position);
    }
    // The original evaluates (and discards) `position || this.position`; the box always uses this.position.
    position || this.position;
    var rotation = (new THREE.Matrix4()).makeRotationAxis(this.mesh.up, this.angle),
        axes = [];
    axes[0] = new THREE.Vector3(1, 0, 0).applyMatrix4(rotation);
    axes[1] = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation);
    axes[2] = new THREE.Vector3(0, 0, 1).applyMatrix4(rotation);
    return new OrientedBoundingBox(this.position, [this.boundingBoxExtent.x, this.boundingBoxExtent.y, this.boundingBoxExtent.z], axes);
};

/**
 * Retro-mode drone craft: a camera-facing plane whose DRONE_xx texture is picked from the viewing angle
 * (mirrored for the other half circle).
 */
function SpriteCraft(scene, world, position, angle, team, profile) {
    LabeledCraft.call(this, scene, world, position, angle, team, profile);
    this.color = "#FF00FF";
    this.scene = scene;
    var geometry = new THREE.PlaneGeometry(256, 256, 1, 1),
        material = new THREE.MeshBasicMaterial({
            size: 256,
            sizeAttenuation: true,
            map: Hover.Editor.schemeLoader.getTexture("DRONE_00"),
            transparent: true,
            alphaTest: 0.5
        });
    material.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.x = position.x;
    this.mesh.position.y = position.y;
    this.mesh.position.z = position.z;
    this.scene.add(this.mesh);
    var self = this;
    this.onBeforeRenderHandler = this.scene.onBeforeRender.register(function (renderArg, camera) {
        var relativeAngle = self.angle - camera.rotation.y;
        while (relativeAngle < 0) {
            relativeAngle += 2 * Math.PI;
        }
        while (relativeAngle > 2 * Math.PI) {
            relativeAngle -= 2 * Math.PI;
        }
        if (relativeAngle > Math.PI) {
            relativeAngle = -(2 * Math.PI - relativeAngle);
        }
        var mirrored = false;
        if (relativeAngle < 0) {
            mirrored = true;
            relativeAngle = -relativeAngle;
        }
        var frameIndex = 32 - parseInt(32 * relativeAngle / Math.PI);
        if (frameIndex < 10) {
            frameIndex = "0" + frameIndex;
        }
        material.map = Hover.Editor.schemeLoader.getTexture(self.team == "blue" ? "DRONE_" + frameIndex : "DRONE_" + frameIndex + "_RED");
        var lookTarget = camera.position.clone();
        lookTarget.y = self.mesh.position.y;
        self.mesh.lookAt(lookTarget);
        if (mirrored) {
            self.mesh.rotation.y += Math.PI;
        }
        self.mesh.position = self.position.clone();
        self.mesh.position.y -= 96;
        // This edition: draw the picture a little in front of the robot, towards the camera. It is a
        // flat 256-unit square, so next to a wall half of it went into the wall and was cut off; the
        // 1995 game drew a robot whole whenever its centre could be seen.
        var toCamera = camera.position.clone().sub(self.position);
        toCamera.y = 0;
        var distance = toCamera.length();
        if (distance > 1) {
            self.mesh.position.add(toCamera.multiplyScalar(Math.min(96, distance / 2) / distance));
        }
        self.mesh.visible = self.isVisible();
    });
}

SpriteCraft.prototype = Object.create(LabeledCraft.prototype);

SpriteCraft.prototype.removeFromScene = function () {
    this.scene.onBeforeRender.remove(this.onBeforeRenderHandler);
    this.scene.remove(this.mesh);
};

// ---------------------------------------------------------------------------------------------------------------
// DebugLine
// ---------------------------------------------------------------------------------------------------------------

/**
 * Debug line from the controller's craft (getPosSrc) to its current path target (getPos); both can be
 * overridden through `options`.
 */
function DebugLine(controller, options) {
    this.color = options.color;
    this.getPos = options.getPos || function () {
        return controller.path[controller.pathPos].clone();
    };
    this.getPosSrc = options.getPosSrc || function () {
        return controller.craft.position.clone();
    };
    var material = new THREE.LineBasicMaterial({
            color: this.color
        }),
        geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3(0, 0, 0));
    geometry.vertices.push(new THREE.Vector3(0, 0, 0));
    var line = new THREE.Line(geometry, material);
    this.line = line;
    this.geom = geometry;
}

DebugLine.prototype.update = function () {
    this.geom.verticesNeedUpdate = true;
    this.geom.vertices[0].copy(this.getPosSrc());
    this.geom.vertices[1].copy(this.getPos());
};

// ---------------------------------------------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------------------------------------------

/**
 * Capture-the-flag flag at a map `location` ({X, Y, Z}). In retro mode it borrows RetroSprite's behaviour;
 * otherwise it is an animated (morph-target) 3D flag mesh. Re-running the constructor (uncapture) resets it.
 */
function Flag(world, map, scene, location, team) {
    this.initialArgs = {
        map: map,
        scene: scene,
        location: location,
        team: team
    };
    this.team = team;
    this.captured = false;
    if (!this.onCaptured) {
        this.onCaptured = new Signal();
        this.onUncaptured = new Signal();
    }
    this.world = world;
    if (Hover.retro) {
        var spritePosition = new THREE.Vector3(location.X, 128 + location.Y, location.Z);
        this.update = RetroSprite.prototype.update;
        this.getTexture = function () {
            var frameIndex = parseInt(20 * this.time) % 10,
                textureName = this.img + "_0" + frameIndex;
            console.log(textureName);
        };
        this.remove = RetroSprite.prototype.remove;
        RetroSprite.call(this, map, spritePosition, 256, team == "red" ? "FLG01" : "FLG00");
    } else {
        this.location = new THREE.Vector3(location.X, location.Y, location.Z);
        this.scene = scene;
        this.map = map;
        this.time = 0;
        var model = Hover.Editor.schemeLoader.models.Flag_Blue,
            material = new THREE.MeshLambertMaterial({
                map: team == "red" ? model.redDiffuseTexture : model.blueDiffuseTexture,
                morphTargets: true,
                shading: THREE.SmoothShading
            });
        material.index0AttributeName = "position";
        var mesh = new THREE.Mesh(model.geometry, material);
        mesh.position = this.location;
        mesh.scale.set(1.5, 1.5, 1.5);
        this.mesh = mesh;
        this.scene.add(mesh);
        // Waving animation: blends through four morph targets over a 0.75 s cycle.
        this.update = function (dt) {
            this.time += dt;
            var blend, phase = this.time / 0.75 % 1;
            if (phase <= 0.25) {
                this.mesh.morphTargetInfluences[0] = phase / 0.25;
                this.mesh.morphTargetInfluences[1] = 0;
                this.mesh.morphTargetInfluences[2] = 0;
                this.mesh.morphTargetInfluences[3] = 0;
            } else if (phase <= 0.5) {
                blend = (phase - 0.25) / 0.25;
                this.mesh.morphTargetInfluences[0] = 1 - blend;
                this.mesh.morphTargetInfluences[1] = blend;
                this.mesh.morphTargetInfluences[2] = 0;
                this.mesh.morphTargetInfluences[3] = 0;
            } else if (phase <= 0.75) {
                blend = (phase - 0.5) / 0.25;
                this.mesh.morphTargetInfluences[0] = 0;
                this.mesh.morphTargetInfluences[1] = 1 - blend;
                this.mesh.morphTargetInfluences[2] = blend;
                this.mesh.morphTargetInfluences[3] = 0;
            } else {
                blend = (phase - 0.75) / 0.25;
                this.mesh.morphTargetInfluences[0] = 0;
                this.mesh.morphTargetInfluences[1] = 0;
                this.mesh.morphTargetInfluences[2] = 1 - blend;
                this.mesh.morphTargetInfluences[3] = blend;
            }
        };
        this.remove = function () {
            this.scene.remove(this.mesh);
            this.scene.onBeforeRender.remove(this.onBeforeRenderHandler);
        };
    }
}

/**
 * Captures the flag for `craft`. When either team has no uncaptured flags left the game ends: a loss if it
 * was the local team's flags, otherwise a win.
 */
Flag.prototype.capture = function (craft) {
    function allFlagsCaptured(team) {
        return _.chain(self.world.flags).filter(function (flag) {
            return flag.team == team && !flag.captured;
        }).first().value() === undefined;
    }

    if (!this.captured) {
        this.captured = true;
        this.remove();
        Hover.audio.getSound(this.team == this.world.team ? "OBT_HFLG" : "OBT_RFLG").play();
        this.onCaptured.call(this, craft);
        if (Hover.retro && craft === true && this.team != this.world.team && Hover.classicFlagCaptured) {
            Hover.classicFlagCaptured(this); // this edition: the 1995 points for a robot flag
        }
        var self = this;
        if (allFlagsCaptured("red") || allFlagsCaptured("blue")) {
            Hover.audio.getSound("OBT_HFLG").stop();
            if (allFlagsCaptured(self.world.team)) {
                self.world.onLose.call();
            } else {
                self.world.onWin.call();
            }
        }
    }
};

/** Returns a captured flag to its starting place (re-runs the constructor with the initial arguments). */
Flag.prototype.uncapture = function (craft) {
    if (this.captured) {
        Flag.call(this, this.world, this.initialArgs.map, this.initialArgs.scene, this.initialArgs.location, this.initialArgs.team);
        Hover.audio.getSound(this.team == "red" ? "FLAGR_DR" : "FLAGR_ST").play();
        this.onUncaptured.call(this, craft);
    }
};
