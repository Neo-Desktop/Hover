// Original: game.js lines 433-439, 1643-1873
//
// World: everything in a running maze except the crafts' own physics — the
// static maze geometry (rendering + collision), pods, flags, drones, pads,
// bullets and temporary walls, plus the collision queries crafts use.

/**
 * @param {Object} game           the owning Game
 * @param {Object} renderer       THREE renderer
 * @param {Object} mapData        maze data (Walls, Floors, Pods, Spawns, Flags, Beacons...)
 * @param {Object} scene          main THREE scene
 * @param {Object} sceneParticles particle scene
 * @param {string} team           the local player's team
 */
function World(game, renderer, mapData, scene, sceneParticles, team) {
    this.game = game;
    this.renderer = renderer;
    this.map = mapData;
    this.scene = scene;
    this.sceneParticles = sceneParticles;
    this.pads = [];
    this.team = team;
    if (Hover.retro) {
        // Sprite groups for the retro pod and flag billboards.
        Hover.sprites.addGroup("POD00", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_00"), 8, 32);
        Hover.sprites.addGroup("POD01", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_01"), 8, 32);
        Hover.sprites.addGroup("POD02", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_02"), 8, 32);
        Hover.sprites.addGroup("POD03", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_03"), 8, 32);
        Hover.sprites.addGroup("POD04", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_04"), 8, 32);
        Hover.sprites.addGroup("POD05", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_05"), 8, 32);
        Hover.sprites.addGroup("POD06", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_06"), 8, 32);
        Hover.sprites.addGroup("POD07", this.renderer, Hover.Editor.schemeLoader.getTexture("POD00_07"), 8, 32);
        Hover.sprites.addGroup("FLG00", this.renderer, Hover.Editor.schemeLoader.getTexture("FLG00_00"), 10, 128);
        Hover.sprites.addGroup("FLG01", this.renderer, Hover.Editor.schemeLoader.getTexture("FLG01_00"), 10, 128);
    }
    // Note: `new` applied to Rect.fromXY, exactly as in the original.
    this.wallQuad = new QuadTree(new Rect.fromXY(-10000, -10000, 40000, 40000));
    this.loadLocations();
    this.loadGeometry();
    var self = this;
    this.beaconGraph = new BeaconGraph();
    this.beaconLocations.map(function (beacon) {
        self.beaconGraph.addBeacon(beacon);
    });
    this.beaconGraph.finalize(this);
    this.pods = [];
    this.flags = [];
    this.drones = [];
    this.tempWalls = [];
    this.bullets = [];
    this.expiredBullets = [];
    this.onWin = new Signal();
    this.onTie = new Signal();
    this.onLose = new Signal();
    this.onTempWallCreated = new Signal();
    this.onPlayerFiredBullet = new Signal();
    this.resultWalls = [];
    this.resultWalls2 = [];
}

World.prototype.addBullet = function (bullet, firedByPlayer) {
    this.bullets.push(bullet);
    if (firedByPlayer) {
        this.onPlayerFiredBullet.call(this, bullet.getSpawn());
    }
};

/** Keeps a dead bullet around for half a second (see update) so it can still be looked up by id. */
World.prototype.addExpiredBullet = function (bullet) {
    bullet.expiredTime = 0;
    this.expiredBullets.push(bullet);
};

World.prototype.getBulletById = function (id) {
    return _.chain(this.bullets).where(function (bullet) {
        return bullet.id == id;
    }).first().value();
};

World.prototype.getExpiredBulletById = function (id) {
    return _.chain(this.expiredBullets).where(function (bullet) {
        return bullet.id == id;
    }).first().value();
};

World.prototype.addDrone = function (drone) {
    this.drones.push(drone);
};

World.prototype.removeDrone = function (drone) {
    this.drones = _.filter(this.drones, function (other) {
        return other != drone;
    });
};

/**
 * Builds the maze geometry and takes its render batches (statics1 = solids,
 * statics2 = decals, skipped on ARM) and its collision / pad / radar data.
 * Collision walls are indexed in the wall quad tree.
 */
World.prototype.loadGeometry = function () {
    this.statics1 = [];
    this.statics2 = [];
    for (var maze = new MazeGeometry(this.map, this.renderer), solids = maze.getMeshSolids(), i = 0; i < solids.length; i++) {
        this.statics1.push(solids[i]);
    }
    if (!Hover.arm) {
        for (var decals = maze.getMeshDecals(), i = 0; i < decals.length; i++) {
            this.statics2.push(decals[i]);
        }
    }
    this.collisionWalls = maze.collisionWalls;
    this.padWalls = maze.padWalls;
    this.collisionFloors = maze.collisionFloors;
    this.radarWalls = maze.radarWalls;
    this.pads = maze.pads;
    for (var i = 0; i < this.collisionWalls.length; i++) {
        var wall = this.collisionWalls[i];
        this.wallQuad.add(new QuadTreeElement(wall[0].x, wall[0].z, wall[1].x, wall[1].z, wall));
    }
    this.wallQuad.generateBuckets();
};

/**
 * Draws the static geometry. In the glow pass, solids are drawn with the
 * black-glow shader and decals with the glow shader.
 */
World.prototype.draw = function (camera, glowPass) {
    var glowShader = undefined;
    var blackGlowShader = undefined;
    if (glowPass) {
        glowShader = new GlowPassShader(this.renderer);
        blackGlowShader = new GlowOccluderShader(this.renderer);
    }
    for (var i = 0; i < this.statics1.length; i++) {
        this.statics1[i].draw(camera, blackGlowShader);
    }
    for (var i = 0; i < this.statics2.length; i++) {
        this.statics2[i].draw(camera, glowShader);
    }
};

/** Splits the map's spawns into player (RED team) and drone locations; reads pods, beacons and flags. */
World.prototype.loadLocations = function () {
    this.playerLocations = [];
    this.podLocations = this.map.Pods;
    this.droneLocations = [];
    this.beaconLocations = this.map.Beacons;
    for (var spawns = this.map.Spawns, i = 0; i < spawns.length; i++) {
        var spawn = spawns[i];
        if ("RED" == spawn.Team) {
            this.playerLocations.push(spawn);
        } else {
            this.droneLocations.push(spawn);
        }
    }
    this.flagLocations = _.map(this.map.Flags, function (flag) {
        return flag;
    });
};

// (Defined twice in the original.)
World.prototype.addDrone = function (drone) {
    this.drones.push(drone);
};

/** Spawns a random pod at every pod location. */
World.prototype.spawnPods = function () {
    for (var i = 0; i < this.podLocations.length; i++) {
        var podLocation = this.podLocations[i];
        this.spawnPod(podLocation, 8 * Math.random() + 1);
    }
};

/**
 * Spawns one pod. podType in [1, 9): 1 fast, 2 slow, 3 radar, 4 shield,
 * 5 spring, 6 cloak, 7 wall, 8 question mark.
 */
World.prototype.spawnPod = function (podLocation, podType) {
    var pod;
    podLocation = new THREE.Vector3(podLocation.X, podLocation.Y, podLocation.Z);
    var options = {
        map: this.map,
        location: podLocation,
        scene: this.scene
    };
    if (podType < 2) {
        pod = new FastSignalPod(options);
    } else if (podType < 3) {
        pod = new SlowSignalPod(options);
    } else if (podType < 4) {
        pod = new RadarPod(options);
    } else if (podType < 5) {
        pod = new ShieldPod(options);
    } else if (podType < 6) {
        pod = new SpringPod(options);
    } else if (podType < 7) {
        pod = new CloakPod(options);
    } else if (podType < 8) {
        pod = new WallPod(options);
    } else if (podType < 9) {
        pod = new QuestionMarkPod(options);
    }
    this.pods.push(pod);
    return pod;
};

World.prototype.getFlagLocations = function () {
    return this.flagLocations;
};

World.prototype.spawnFlag = function (flagLocation) {
    flagLocation = new Flag(this, this.map, this.scene, flagLocation, flagLocation.Team.toLowerCase());
    this.flags.push(flagLocation);
    return flagLocation;
};

/** Per-frame update of pods, flags, drones, pads, bullets and temporary walls. */
World.prototype.update = function (dt) {
    _.each(this.pods, function (pod) {
        pod.update(dt);
    });
    _.each(this.flags, function (flag) {
        flag.update(dt);
    });
    _.each(this.drones, function (drone) {
        drone.update(dt);
    });
    _.each(this.pads, function (pad) {
        pad.update(dt);
    });
    _.each(this.bullets, function (bullet) {
        bullet.update(dt);
        if (!bullet.isAlive()) {
            bullet.remove();
        }
    });
    this.bullets = _.filter(this.bullets, function (bullet) {
        return bullet.isAlive();
    });
    this.expiredBullets = _.filter(this.expiredBullets, function (bullet) {
        bullet.expiredTime += dt;
        return bullet.expiredTime < .5;
    });
    // A temp wall's update returns false once it has expired.
    this.tempWalls = _.filter(this.tempWalls, function (tempWall) {
        return tempWall.update(dt);
    });
};

/**
 * Returns the first other craft (drones, plus this.player when includePlayer)
 * whose oriented bounding box overlaps `craft`'s, or null.
 */
World.prototype.checkCraftCollisions = function (craft, unused, includePlayer, radius) {
    radius = radius || 128;
    var crafts = this.drones.map(function (drone) {
        return drone.craft;
    });
    if (includePlayer) {
        crafts = _.union(crafts, this.player);
    }
    for (var box = craft.getOrientedBoundingBox(), i = 0; i < crafts.length; i++) {
        var other = crafts[i];
        if (other != craft) {
            var otherBox = other.getOrientedBoundingBox();
            if (box.overlaps(otherBox)) {
                return other;
            }
        }
    }
    return null;
};

/**
 * Resolves a craft-vs-craft collision as an equal-mass elastic bounce plus a
 * push apart. Returns { craft, position, velocity } of the other craft, or
 * null when there was no collision.
 */
/**
 * Added in this edition: after a bump, makes sure the two crafts no longer overlap. Stepping both
 * back to their last positions (above) only works when they weren't already overlapping there; when
 * a robot drove into a craft that stood still, the step back left them overlapping, every following
 * frame stepped the player back again, and the player was stuck inside the robot. This moves the
 * craft out along the line between them in small steps (or the other craft, if a wall is in the
 * way), and pauses classic-mode grip briefly so the bounce isn't steered back into the robot.
 */
World.prototype.separateCrafts = function (craft, other) {
    var world = this;
    function overlapping() {
        return craft.getOrientedBoundingBox().overlaps(other.getOrientedBoundingBox());
    }
    function pushOut(mover, direction) {
        for (var step = 0; step < 48 && overlapping(); step++) {
            var next = mover.position.clone().add(direction);
            var probe = next.clone();
            probe.y += 25;
            if (world.checkCraftAgainstStaticGeometry(mover, probe).length > 0) {
                return false;
            }
            mover.position.copy(next);
            mover.lastPosition.copy(next);
        }
        return !overlapping();
    }
    if (overlapping()) {
        var away = new THREE.Vector3(craft.position.x - other.position.x, 0, craft.position.z - other.position.z);
        if (away.lengthSq() < 1) {
            // Exactly on top of each other: back the craft out the way it came.
            away.set(Math.sin(craft.angle), 0, Math.cos(craft.angle));
        }
        away.normalize().multiplyScalar(16);
        if (!pushOut(craft, away)) {
            pushOut(other, away.clone().negate());
        }
    }
    craft.collisionGripPause = 0.3;
    other.collisionGripPause = 0.3;
};

World.prototype.simulateCollisions = function (craft) {
    this.drones.map(function (drone) {
        return drone.craft;
    });
    var other = this.checkCraftCollisions(craft);
    if (other) {
        craft.revertPosition();
        other.revertPosition();
        var separation = other.position.clone().sub(craft.position);
        var angleA = Math.atan2(-craft.velocity.x, craft.velocity.z);
        var angleB = Math.atan2(-other.velocity.x, other.velocity.z);
        var contactAngle = Math.atan2(craft.position.x - other.position.x, other.position.z - craft.position.z);
        var speedA = craft.velocity.length();
        var speedB = other.velocity.length();
        var normalA = speedA * Math.cos(angleA - contactAngle);
        var tangentA = speedA * Math.sin(angleA - contactAngle);
        var normalB = speedB * Math.cos(angleB - contactAngle);
        var tangentB = speedB * Math.sin(angleB - contactAngle);
        var massA = 1;
        var massB = 1;
        var newNormalA = ((massA - massB) * normalA + (massB + massB) * normalB) / (massA + massB);
        var newNormalB = ((massA + massA) * normalA + (massB - massA) * normalB) / (massA + massB);
        var newTangentA = tangentA;
        var newTangentB = tangentB;
        var velocityAZ = Math.cos(contactAngle) * newNormalA + Math.cos(contactAngle + contactAngle / 2) * newTangentA;
        var velocityAX = Math.sin(contactAngle) * newNormalA + Math.sin(contactAngle + contactAngle / 2) * newTangentA;
        var velocityBZ = Math.cos(contactAngle) * newNormalB + Math.cos(contactAngle + contactAngle / 2) * newTangentB;
        var velocityBX = Math.sin(contactAngle) * newNormalB + Math.sin(contactAngle + contactAngle / 2) * newTangentB;
        craft.velocity.z = velocityAZ;
        craft.velocity.x = -velocityAX;
        other.velocity.z = velocityBZ;
        other.velocity.x = -velocityBX;
        separation = craft.position.clone().sub(other.position).normalize().multiplyScalar(256);
        craft.velocity.add(separation);
        other.velocity.add(separation.multiplyScalar(-1));
        this.separateCrafts(craft, other);
        Hover.audio.getSound("HIT_ROBT").play();
        return {
            craft: other,
            position: other.position.clone(),
            velocity: other.velocity.clone()
        };
    }
    return other;
};

/** Removes every pod within 128 units of the craft, applying its effect unless skipEffect. */
World.prototype.checkForPodHits = function (craft, skipEffect) {
    for (var i = 0; i < this.pods.length; i++) {
        var distance = Hover.tempVector3.subVectors(this.pods[i].location, craft.position).length();
        if (distance < 128) {
            if (!skipEffect) {
                this.pods[i].onHit(craft);
            }
            this.pods[i].remove();
            this.pods.splice(i, 1);
            i--;
        }
    }
};

/**
 * Captures an own-team flag the craft touches; an enemy flag the craft drives
 * head-on into bounces it back.
 */
World.prototype.checkForFlagCaptures = function (craft, team) {
    var flag = this.findFlag(craft.position, 192, false, team);
    if (flag) {
        flag.capture(!!craft.player);
    }
    if (Hover.retro) {
        // This edition: in classic mode a flag you can't take is no obstacle (the 1995 game lets
        // you drive through your own flags); the remake bounced you off it.
        return;
    }
    flag = this.findFlag(craft.position, 192, false, "red" == team ? "blue" : "red");
    if (flag) {
        var facing = Hover.tempVector3.subVectors(flag.location, craft.position).normalize().dot(craft.velocity.clone().normalize());
        if (facing > .5) {
            craft.velocity.multiplyScalar(-.6);
        }
    }
};

/**
 * First flag with the given captured state (and team, if given) within 192
 * units of position, or null. (The radius argument is defaulted but unused.)
 */
World.prototype.findFlag = function (position, radius, captured, team) {
    radius = radius || 10;
    captured = captured || false;
    return _.chain(this.flags).filter(function (flag) {
        if (flag.captured !== captured || team && flag.team !== team) {
            return false;
        }
        var dx = position.x - flag.location.x;
        var dy = position.y - flag.location.y;
        var dz = position.z - flag.location.z;
        var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return distance < 192;
    }).first().value() || null;
};

World.prototype.getCollision = function (from, to) {
    return this.getCollisionXYZ(from.x, from.y, from.z, to.x, to.y, to.z);
};

/**
 * First collision wall crossed by the segment from (x1, z1) to (x2, z2) at
 * height y2, as { intersectNormal (along the wall), wall }, or null. Short
 * segments only test the walls found in the quad tree.
 */
World.prototype.getCollisionXYZ = function (x1, y1, z1, x2, y2, z2) {
    var delta = Hover.tempVector3;
    delta.set(x2 - x1, y2 - y1, z2 - z1);
    var walls = this.collisionWalls;
    if (delta.length() < 5000) {
        var query = new QuadTreeElement(x1, z1, x2, z2, null);
        this.resultWalls.length = 0;
        this.wallQuad.getCollisionChildren(query, this.resultWalls);
        walls = this.resultWalls;
    }
    for (var i = 0; i < walls.length; i++) {
        var wall = walls[i];
        if (y2 >= wall[0].y && y2 <= wall[1].y && segmentsIntersect(x1, z1, x2, z2, wall[0].x, wall[0].z, wall[1].x, wall[1].z)) {
            var hitWall = wall;
            wall = wall[1].clone().sub(wall[0]).normalize();
            wall.y = 0;
            return {
                intersectNormal: wall,
                wall: hitWall
            };
        }
    }
    return null;
};

/**
 * Tests the craft's bounding box (at `position`) against nearby walls and all
 * temporary walls. Returns a list of { intersectNormal, wall } hits, the
 * normal pointing along the craft's velocity. With debugRadar, the craft's
 * radarWalls are coloured: grey = far, green = near, red = hit.
 */
World.prototype.checkCraftAgainstStaticGeometry = function (craft, position, debugRadar) {
    var i;
    var tempWallCount;
    var halfSize = 220;
    var area = Rect.fromXY(position.x - halfSize, position.z - halfSize, 2 * halfSize, 2 * halfSize);
    // Temp walls are always candidates; the quad tree appends nearby walls.
    for (i = 0, tempWallCount = this.tempWalls.length; i < tempWallCount; i++) {
        this.resultWalls2[i] = this.tempWalls[i].tw;
    }
    this.resultWalls2.length = tempWallCount;
    this.wallQuad.getCollisionChildren(area, this.resultWalls2);
    var candidates = this.resultWalls2;
    var hits = [];
    if (debugRadar) {
        _.each(craft.radarWalls, function (radarWall) {
            radarWall.color = "#AAA";
        });
    }
    if (candidates.length > 0) {
        for (var box = craft.getOrientedBoundingBox(position), i = 0; i < candidates.length; i++) {
            var wall = candidates[i];
            var radarIndex = -1;
            if (debugRadar) {
                for (var j = 0; j < craft.radarWalls.length; j++) {
                    if (craft.radarWalls[j].wall == wall) {
                        radarIndex = j;
                    }
                }
                if (-1 == radarIndex) {
                    craft.radarWalls.push({
                        wall: wall,
                        color: "#F00",
                        found: true
                    });
                    radarIndex = craft.radarWalls.length - 1;
                }
            }
            if (box.intersectsWall(wall[0], wall[1])) {
                if (debugRadar) {
                    craft.radarWalls[radarIndex].color = "#F00";
                }
                var normal = wall[1].clone().sub(wall[0]);
                normal.y = 0;
                normal.normalize();
                normal.set(-normal.z, 0, normal.x);
                // Near a wall end, use the perpendicular of the craft's velocity instead.
                if (Hover.tempVector3.subVectors(wall[1], position).length() < 150 || Hover.tempVector3.subVectors(wall[0], position).length() < 150) {
                    normal.set(-craft.velocity.z, 0, craft.velocity.x);
                    normal.normalize();
                }
                if (normal.dot(craft.velocity) < 0) {
                    normal.multiplyScalar(-1);
                }
                hits.push({
                    intersectNormal: normal,
                    wall: wall
                });
            } else if (debugRadar) {
                craft.radarWalls[radarIndex].color = "#0F0";
            }
        }
    }
    return hits;
};

/**
 * Whether a craft-sized body can travel from `from` to `to` without crossing
 * a collision or pad wall (tested with 5 offsets around each end).
 */
World.prototype.isSafePath = function (from, to) {
    for (var walls = [].concat(this.collisionWalls, this.padWalls), offsets = [], i = 0; i < 5; i++) {
        var angle = 2 * Math.PI * i / 5;
        // Note: THREE.Vector2 ignores the third argument, so y is always 0.
        var offset = new THREE.Vector2(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(150);
        offsets.push(offset);
    }
    for (var i = 0; i < walls.length; i++) {
        for (var wall = walls[i], j = 0; j < offsets.length; j++) {
            for (var fromOffset = offsets[j], k = 0; k < offsets.length; k++) {
                var toOffset = offsets[k];
                if (to.y >= wall[0].y && to.y <= wall[1].y && segmentsIntersect(from.x + fromOffset.x, from.z + fromOffset.y, to.x + toOffset.x, to.z + toOffset.y, wall[0].x, wall[0].z, wall[1].x, wall[1].z)) {
                    return false;
                }
            }
        }
    }
    return true;
};

/** Height of the highest collision floor below the point (-1000 if none). */
World.prototype.getGroundHeightBelowPoint = function (point) {
    for (var groundY = -1000, i = 0; i < this.collisionFloors.length; i++) {
        var triangle = this.collisionFloors[i];
        if (triangle[0].y < point.y && triangle[0].y > groundY && isPointInPolygonWinding(point, triangle)) {
            groundY = triangle[0].y;
        }
    }
    return groundY;
};

/** Triggers the first pad the (unprotected) craft is above. */
World.prototype.interactWithPads = function (craft) {
    if (Hover.retro) {
        this.interactWithPadsClassic(craft);
        return;
    }
    if (!craft.isProtected()) {
        for (var i = 0; i < this.pads.length; i++) {
            var pad = this.pads[i];
            if (pad.isAbove(craft)) {
                pad.onAbove(craft);
                return;
            }
        }
    }
};

/**
 * Added in this edition: the 1995 rules for the hold and flag pads in classic mode (read from
 * HOVER.EXE: pad test 0x40c620, hold pad 0x42c1b0 / 0x40ace0, flag pad 0x422920). The state belongs
 * to the craft, not the pad, so a robot on a pad doesn't block the player from it:
 *  - a craft is on a pad when both its nose and its tail (50 units ahead and behind) are on it;
 *  - the shield ignores every pad;
 *  - a hold pad grips the craft for 4.5 seconds (Craft.applyClassicHold); once it lets go it can't
 *    grip that craft again until the craft has left every hold pad;
 *  - a flag pad gives a flag back once each time the craft drives onto it.
 * Sled pads keep the remake's behaviour.
 */
World.prototype.interactWithPadsClassic = function (craft) {
    var wasOnFlagPad = craft.onFlagPad;
    craft.onFlagPad = false;
    var onHoldPad = false;
    if (!craft.isProtected()) {
        var forward = new THREE.Vector3(-Math.sin(craft.angle) * 50, 0, -Math.cos(craft.angle) * 50);
        var nose = {
            position: craft.position.clone().add(forward)
        };
        var tail = {
            position: craft.position.clone().sub(forward)
        };
        var sledDone = false;
        for (var i = 0; i < this.pads.length; i++) {
            var pad = this.pads[i];
            if (pad instanceof SledPad) {
                if (!sledDone && pad.isAbove(craft)) {
                    pad.onAbove(craft);
                    sledDone = true;
                    craft.sledTouched = true; // a robot drops its goal (24-classic-robots.js)
                }
            } else if (pad.isAbove(nose) && pad.isAbove(tail) && craft.position.y < 100) {
                if (pad instanceof HoldPad) {
                    onHoldPad = true;
                } else if (pad instanceof FlagReturnPad) {
                    craft.onFlagPad = true;
                }
            }
        }
    }
    if (craft.onFlagPad && !wasOnFlagPad) {
        var flag = _.chain(this.flags).filter(function (flag) {
            return flag.team != craft.team && flag.captured;
        }).sortBy(function () {
            return Math.random();
        }).first().value();
        if (flag) {
            flag.uncapture(!!craft.player);
        }
    }
    if (!onHoldPad) {
        craft.holdTimer = -1; // free to be held again
    } else if (craft.holdTimer < 0) {
        craft.holdTimer = 4.5;
        if (craft.player) {
            Hover.audio.getSound("HOLD_ST").play();
        }
    }
};

World.prototype.addTempWall = function (tempWall) {
    this.tempWalls.push(tempWall);
};
