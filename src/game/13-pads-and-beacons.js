// Original: game.js lines 532-547, 585-636, 2550-2600, 2778-2872
// Wall quad-tree, beacon graph (AI waypoints), temp force-field walls, AI controllers and floor pads.

/**
 * A wall segment (x1,y1)-(x2,y2) stored in the QuadTree; `el` is the wall it stands for.
 */
function QuadTreeElement(x1, y1, x2, y2, element) {
    this.el = element;
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
}

/** Axis-aligned rectangle from a THREE.Vector2 top-left corner and size. */
function Rect(topLeft, size) {
    this.topLeft = topLeft;
    this.size = size;
    this.bottomRight = this.topLeft.clone().add(this.size);
}

/**
 * QuadTree node. Note the original naming: `children` holds the stored elements,
 * `childElements` holds the four sub-nodes once the node is split.
 */
function QuadTreeNode(rect, depth) {
    this.rect = rect;
    this.depth = depth || 0;
    this.children = [];
    this.childElements = [];
}

/** QuadTree of wall segments for fast collision lookups. */
function QuadTree(rect) {
    this.root = new QuadTreeNode(rect);
}

/** Graph of AI waypoints (beacons); drones follow paths through it. */
function BeaconGraph() {
    this.beacons = [];
}

/**
 * Temporary force-field wall (from the wall pod): a double-sided plane that also adds a
 * collision wall to the world, and disappears after 10 seconds.
 */
function TempWall(world, position, angle) {
    var material = new createEmissiveMaterial(Hover.Editor.schemeLoader.getTexture("FORCE_FIELD"));
    material.side = THREE.DoubleSide;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(256, 256, 1, 1), material);
    this.position = position.clone();
    mesh.position.copy(position);
    mesh.position.y += 32;
    world.scene.add(mesh);
    mesh.rotation.y = angle;
    this.mesh = mesh;
    this.life = 10;
    this.scene = world.scene;
    this.world = world;
    this.angle = angle;
    var center = mesh.position;
    var alongWall = angle + Math.PI / 2;
    var wallSegment = [new THREE.Vector3(center.x - 128 * Math.sin(alongWall), center.y - 128, center.z - 128 * Math.cos(alongWall)), new THREE.Vector3(center.x - 128 * Math.sin(alongWall + Math.PI), center.y + 128, center.z - 128 * Math.cos(alongWall + Math.PI))];
    this.world.collisionWalls.push(wallSegment);
    this.tw = wallSegment;
}

/** Drone AI that heads for the nearest reachable enemy flag (and captures it). */
function FlagHunterController(craft, scene, world) {
    DroneController.call(this, craft, scene, world);
    this.craft.addBehavior(new FlagCaptureBehavior());
}

/** Drone AI (green) that chases the target craft whenever it can see it. */
function AttackController(craft, scene, world, target) {
    DroneController.call(this, craft, scene, world);
    this.target = target;
    craft.color = "#00AA00";
    this.didSee = false;
}

/**
 * Special floor tile. `cycle` is the pad's outline (Path); `craft` is the craft currently on it.
 */
function Pad(cycle) {
    this.cycle = cycle;
    this.craft = null;
    this.time = 0;
}

/** HOLD_PAD: freezes a craft that lands on it in place for 5 seconds. */
function HoldPad(cycle) {
    Pad.call(this, cycle);
    this.pos = new THREE.Vector3(0, 0, 0);
}

/** FLAG_PAD: driving onto it releases one of the flags the craft's team has captured. */
function FlagReturnPad(cycle) {
    Pad.call(this, cycle);
}

/**
 * SLED_D/U/L/R pad: turns the craft to the pad's direction and launches it that way
 * (double max speed, low acceleration for 2 seconds).
 */
function SledPad(cycle, texture) {
    Pad.call(this, cycle);
    this.angle = 0;
    switch (texture) {
        case "SLED_D":
            this.angle = 0;
            break;
        case "SLED_U":
            this.angle = Math.PI;
            break;
        case "SLED_L":
            this.angle = Math.PI / 2;
            break;
        case "SLED_R":
            this.angle = -Math.PI / 2;
    }
    this.direction = new THREE.Vector3(-Math.sin(this.angle), 0, -Math.cos(this.angle));
}

/** True if either end of the segment is inside the rect or the segment crosses one of its edges. */
QuadTreeElement.prototype.isInsideRect = function (rect) {
    var topLeft = rect.topLeft;
    var bottomRight = rect.bottomRight;
    if (!rect.parts) {
        rect.parts = [
            [topLeft.x, topLeft.y, bottomRight.x, topLeft.y],
            [bottomRight.x, topLeft.y, bottomRight.x, bottomRight.y],
            [bottomRight.x, bottomRight.y, topLeft.x, bottomRight.y],
            [topLeft.x, bottomRight.y, topLeft.x, topLeft.y]
        ];
    }
    var startInside = this.x1 > topLeft.x && this.x1 < bottomRight.x && this.y1 > topLeft.y && this.y1 < bottomRight.y;
    var endInside = this.x2 > topLeft.x && this.x2 < bottomRight.x && this.y2 > topLeft.y && this.y2 < bottomRight.y;
    var crossesEdge = segmentIntersectsAny(this.x1, this.y1, this.x2, this.y2, rect.parts);
    return startInside || endInside || crossesEdge;
};

Rect.fromXY = function (x, y, width, height) {
    return new Rect(new THREE.Vector2(x, y), new THREE.Vector2(width, height));
};

/** True if either corner of this rect lies strictly inside `other`. */
Rect.prototype.isInsideRect = function (other) {
    var topLeft = this.topLeft;
    var bottomRight = this.bottomRight;
    var otherTopLeft = other.topLeft;
    var otherBottomRight = other.bottomRight;
    var topLeftInside = topLeft.x > otherTopLeft.x && topLeft.x < otherBottomRight.x && topLeft.y > otherTopLeft.y && topLeft.y < otherBottomRight.y;
    var bottomRightInside = bottomRight.x > otherTopLeft.x && bottomRight.x < otherBottomRight.x && bottomRight.y > otherTopLeft.y && bottomRight.y < otherBottomRight.y;
    return topLeftInside || bottomRightInside;
};

QuadTreeNode.prototype.maxChildren = 5;

QuadTreeNode.prototype.maxDepth = 20;

QuadTreeNode.prototype.addElement = function (element) {
    if (element.isInsideRect(this.rect)) {
        this.children.push(element);
    }
};

/** Splits into four quadrants (recursively) while a node holds more than maxChildren elements. */
QuadTreeNode.prototype.splitAsNecessary = function () {
    if (this.children.length > this.maxChildren) {
        if (this.depth > this.maxDepth) {
            return;
        }
        var halfSize = this.rect.size.clone().multiplyScalar(0.5);
        this.childElements = [
            new QuadTreeNode(new Rect(this.rect.topLeft, halfSize), this.depth + 1),
            new QuadTreeNode(new Rect(this.rect.topLeft.clone().add(new THREE.Vector2(halfSize.x, 0)), halfSize), this.depth + 1),
            new QuadTreeNode(new Rect(this.rect.topLeft.clone().add(new THREE.Vector2(0, halfSize.y)), halfSize), this.depth + 1),
            new QuadTreeNode(new Rect(this.rect.topLeft.clone().add(halfSize), halfSize), this.depth + 1)
        ];
        var self = this;
        _.each(this.childElements, function (childNode) {
            _.each(self.children, function (element) {
                childNode.addElement(element);
            });
            childNode.splitAsNecessary();
        });
        this.children = [];
    }
};

/**
 * Collects (into `result`) the walls (`el`) of every leaf that the query (a Rect or a
 * QuadTreeElement) touches.
 */
QuadTreeNode.prototype.getCollisionChildren = function (query, result) {
    if (query.isInsideRect(this.rect) || !query.topLeft || this.rect.isInsideRect(query)) {
        this.wasHit = true;
        if (this.children.length > 0) {
            for (var i = 0; i < this.children.length; i++) {
                result.push(this.children[i].el);
            }
        } else {
            for (var i = 0; i < this.childElements.length; i++) {
                this.childElements[i].getCollisionChildren(query, result);
            }
        }
    }
};

QuadTree.prototype.add = function (element) {
    this.root.addElement(element);
};

QuadTree.prototype.generateBuckets = function () {
    this.root.splitAsNecessary();
};

QuadTree.prototype.getCollisionChildren = function (query, result) {
    return this.root.getCollisionChildren(query, result);
};

BeaconGraph.prototype.addBeacon = function (location) {
    this.beacons.push(new THREE.Vector3(location.X, location.Y, location.Z));
};

/**
 * Links every ground-level beacon to the others it has a safe straight path to (`friends`),
 * drops beacons with no links, and remembers the world.
 */
BeaconGraph.prototype.finalize = function (world) {
    var beacons = this.beacons;
    for (var i = 0; i < beacons.length; i++) {
        var beacon = beacons[i];
        beacon.friends = [];
        beacon.key = beacon.x + "," + beacon.y + "," + beacon.z;
        for (var j = 0; j < beacons.length; j++) {
            if (i != j) {
                var other = beacons[j];
                if (beacon.y == other.y && 0 == beacon.y && world.isSafePath(beacon, other)) {
                    beacon.friends.push(other);
                }
            }
        }
    }
    for (var i = 0; i < beacons.length; i++) {
        if (0 == beacons[i].friends.length) {
            beacons.splice(i, 1);
            i--;
        }
    }
    this.world = world;
};

/**
 * Builds a patrol route from `start` that visits every beacon at least once: starts at the nearest
 * beacon reachable in a straight line, then repeatedly moves to the least-visited (then roughly
 * nearest) neighbour. Throws "WHOOPS" when no beacon is reachable.
 */
BeaconGraph.prototype.getUniquePath = function (start) {
    var path = [];
    var beacons = this.beacons;
    for (var d = 0; d < beacons.length; d++) {
        beacons[d].count = 0;
    }
    var visited = {};
    var visitedCount = 0;
    var total = beacons.length;
    beacons.sort(function (first, second) {
        return first.clone().sub(start).length() - second.clone().sub(start).length();
    });
    var d = 0;
    var groundStart = start.clone();
    groundStart.y = 0;
    while (d < beacons.length && !this.world.isSafePath(groundStart, beacons[d])) {
        d++;
    }
    if (d == beacons.length) {
        throw "WHOOPS";
    }
    // `curr` is an implicit global in the original; kept as such.
    curr = beacons[d];
    for (var iterations = 0; visitedCount < total;) {
        iterations++;
        if (!visited[curr.key]) {
            visited[curr.key] = true;
            visitedCount++;
        }
        curr.count++;
        path.push(curr);
        var friends = curr.friends;
        for (var d = 0; d < friends.length; d++) {
            friends[d].priority = (0.6 + 0.4 * Math.random()) * friends[d].clone().sub(curr).length();
        }
        friends.sort(function (a, b) {
            return a.count - b.count || a.priority - b.priority;
        });
        curr = friends[0];
    }
    return path;
};

/** Counts down the wall's life; removes mesh and collision wall when it expires. Returns false once gone. */
TempWall.prototype.update = function (delta) {
    this.life -= delta;
    if (this.life <= 0) {
        this.scene.remove(this.mesh);
        var walls = this.world.collisionWalls;
        for (var i = 0; i < walls.length; i++) {
            if (walls[i] == this.tw) {
                walls.splice(i, 1);
                i--;
            }
        }
        return false;
    }
    return true;
};

/** Network form of the wall, for the SignalR hub. */
TempWall.prototype.getNET = function () {
    return {
        Position: toNetVector(this.position),
        Angle: this.angle
    };
};

FlagHunterController.prototype = Object.create(DroneController.prototype);

/** Location of the nearest uncaptured enemy flag reachable in a straight line, or null. */
FlagHunterController.prototype.getTargetPos = function () {
    var self = this;
    var targetFlag = _.chain(this.world.flags).filter(function (flag) {
        if (flag.captured || flag.team === self.craft.team) {
            return false;
        }
        var aboveFlag = flag.location.clone();
        aboveFlag.y += 96;
        return self.world.isSafePath(self.craft.position, aboveFlag);
    }).sortBy(function (flag) {
        var distance = Hover.tempVector3.subVectors(flag.location, self.craft.position).length();
        return distance;
    }).find(function () {
        return true;
    }).value();
    return targetFlag ? targetFlag.location : null;
};

AttackController.prototype = Object.create(DroneController.prototype);

AttackController.prototype.alwaysCalculateTarget = function () {
    return true;
};

/** The target craft's position while it is visible with no wall in between (pings once on sighting), else null. */
AttackController.prototype.getTargetPos = function () {
    var self = this;
    var ownPosition = self.craft.position.clone(); // unused
    var targetPosition = self.target.position.clone();
    if (self.target.isVisible() && null == self.world.getCollision(self.craft.position, targetPosition)) {
        if (!this.didSee) {
            Hover.audio.getSound("ATTKPING").play();
            this.didSee = true;
        }
        return targetPosition;
    }
    this.didSee = false;
    return null;
};

AttackController.prototype.slowNearTarget = function () {
    return false;
};

AttackController.prototype.getTargetRadius = function () {
    return 0;
};

/** Called while a craft is over the pad; the first craft to arrive takes the pad. */
Pad.prototype.onAbove = function (craft) {
    if (null == this.craft) {
        this.craft = craft;
        this.time = 0;
    }
};

Pad.prototype.update = function (delta) {
};

/** True if the craft is low enough and inside the pad's outline. */
Pad.prototype.isAbove = function (craft) {
    return craft.position.y < 100 && isPointInsidePath(new Point2D(craft.position.x, craft.position.z), this.cycle, false, true);
};

HoldPad.prototype = Object.create(Pad.prototype);

HoldPad.prototype.onAbove = function (craft) {
    if (null == this.craft) {
        Pad.prototype.onAbove.call(this, craft);
        this.pos.copy(craft.position);
        craft.setHeld(true);
        if (craft.player) {
            Hover.audio.getSound("HOLD_ST").play();
        }
        this.playedEnd = false;
    }
};

/** Pins the craft for 5 s (dropping it to height 60 over the first 0.5 s), then releases it. */
HoldPad.prototype.update = function (delta) {
    if (null != this.craft) {
        this.time += delta;
        if (this.time < 5) {
            this.craft.position.copy(this.pos);
            this.craft.velocity.set(0, 0, 0);
        } else if (this.isAbove(this.craft)) {
            this.craft.setHeld(false);
            if (!this.playedEnd) {
                if (this.craft.player) {
                    Hover.audio.getSound("HOLD_EN").play();
                }
                this.playedEnd = true;
            }
        } else {
            this.craft = null;
        }
        if (this.time < 0.5) {
            this.craft.position.y = 36 * (0.5 - this.time) + 60;
        } else if (this.time < 5) {
            this.craft.position.y = 60;
        }
    }
};

FlagReturnPad.prototype = Object.create(Pad.prototype);

/** On arrival, uncaptures a random enemy-team flag that is currently captured. */
FlagReturnPad.prototype.onAbove = function (craft) {
    if (null == this.craft) {
        var flag = _.chain(craft.world.flags).filter(function (flag) {
            return flag.team != craft.team && flag.captured;
        }).sortBy(function () {
            return Math.random();
        }).first().value();
        if (flag) {
            flag.uncapture(!!craft.player);
        }
    }
    Pad.prototype.onAbove.call(this, craft);
};

FlagReturnPad.prototype.update = function (delta) {
    if (null != this.craft) {
        if (!this.isAbove(this.craft)) {
            this.craft = null;
        }
    }
};

SledPad.prototype = Object.create(Pad.prototype);

SledPad.prototype.onAbove = function (craft) {
    if (null == this.craft) {
        craft.maxSpeed *= 2;
        craft.acceleration /= 10;
        this.craftAngle = craft.angle;
        if (craft.player) {
            Hover.audio.getSound("SKID_ST").play();
        }
    }
    Pad.prototype.onAbove.call(this, craft);
};

/** Turns and pushes the craft along the sled direction, then restores its speed/acceleration after 2 s. */
SledPad.prototype.update = function (delta) {
    if (null != this.craft) {
        this.time += delta;
        if (this.time < 0.5) {
            this.craft.angle = slerpAngle(this.craftAngle, this.angle, 2 * this.time);
            this.craft.velocity.add(this.direction.clone().multiplyScalar(16000 * this.craft.acceleration * delta));
        } else if (this.time < 0.75) {
            this.craft.velocity.add(this.direction.clone().multiplyScalar(32000 * this.craft.acceleration * delta));
        } else if (!(this.time < 2)) {
            this.craft.maxSpeed /= 2;
            this.craft.acceleration *= 10;
            this.craft = null;
        }
    }
};
