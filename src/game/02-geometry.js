// Original: game.js lines 3-8, 27-85, 89-113, 271-310, 323-349, 720-758 (a.prototype), 908-929 (n.prototype,
// scratch vectors, obb* globals), 1569-1611 (F/G/H prototypes, Hover.tempVector3/tempVector2)
// 2D/3D geometry helpers used by maze building, collision and a debug polygon triangulator.
// 2D points live in the x/z (floor) plane.

// ---------------------------------------------------------------------------------------------------------------
// 2D path / polygon helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Returns true-ish when any segment of pathA crosses a segment of pathB (ignoring segments sharing a node).
 * Unless skipReverse is set, the result returned on a crossing is pathsCross(pathB, pathA, true).
 */
function pathsCross(pathA, pathB, skipReverse) {
    var result = true;
    if (!skipReverse) {
        result = pathsCross(pathB, pathA, true);
    }
    var nodesA = pathA.nodes;
    var nodesB = pathB.nodes;
    for (var i = 0; i < nodesA.length - 1; i++) {
        for (var j = 0; j < nodesB.length - 1; j++) {
            var a1 = nodesA[i],
                a2 = nodesA[i + 1],
                b1 = nodesB[j],
                b2 = nodesB[j + 1];
            // NOTE: only six arguments are passed here (b1.z/b2.x/b2.z are missing) - kept as in the original.
            if (segmentsIntersect(a1.x, a1.z, a2.x, a2.z, b1.x, b2.z) && !pathContainsNode(a1, [b1, b2]) && !pathContainsNode(a2, [b1, b2])) {
                return result;
            }
        }
    }
    return false;
}

/** True when a node with the same key as `node` is in `nodes`. */
function pathContainsNode(node, nodes) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].getKey() == node.getKey()) {
            return true;
        }
    }
    return false;
}

/**
 * Winding-number point-in-polygon test for a closed list of Point2D nodes (last node == first node).
 * When the point coincides with a node, returns `onNodeResult` (coerced to boolean) unless skipNodeCheck is set.
 */
function isPointInsidePath(point, nodes, onNodeResult, skipNodeCheck) {
    onNodeResult = !!onNodeResult;
    if (!skipNodeCheck) {
        for (var i = 0; i < nodes.length; i++) {
            if (point.getKey() == nodes[i].getKey()) {
                return onNodeResult;
            }
        }
    }
    for (var winding = 0, i = 0; i < nodes.length - 1; i++) {
        var from = nodes[i],
            to = nodes[i + 1],
            edge = to.minus(from),
            toPoint = point.minus(from),
            side = crossSign(edge, toPoint);
        if (from.z != to.z && from.z > point.z && to.z <= point.z && side == 1) {
            winding++;
        } else if (from.z != to.z && from.z <= point.z && to.z > point.z && side == -1) {
            winding--;
        }
    }
    return winding != 0;
}

/** Winding-number point-in-polygon test for an open (implicitly closed) array of {x, z} points. */
function isPointInPolygonWinding(point, polygon) {
    var i, from, to, edgeX, edgeZ, relX, relZ, side, winding = 0,
        count = polygon.length;
    for (i = 0; i < count; i++) {
        from = polygon[i];
        to = polygon[(i + 1) % count];
        edgeX = to.x - from.x;
        edgeZ = to.z - from.z;
        relX = point.x - from.x;
        relZ = point.z - from.z;
        side = crossSign2D(edgeX, edgeZ, relX, relZ);
        if (side !== 0 && from.z != to.z) {
            if (side === 1 && from.z > point.z && to.z <= point.z) {
                winding++;
            } else if (side === -1 && from.z <= point.z && to.z > point.z) {
                winding--;
            }
        }
    }
    return winding != 0;
}

/** Sign of the 2D cross product of two Point2D: 1 when negative, -1 when positive, 0 when zero. */
function crossSign(pointA, pointB) {
    var cross = pointA.cross(pointB);
    if (cross < 0) {
        return 1;
    }
    if (cross > 0) {
        return -1;
    }
    return 0;
}

/** Sign of (ax * bz - az * bx): 1 when negative, -1 when positive, 0 when zero. */
function crossSign2D(ax, az, bx, bz) {
    var cross = ax * bz - az * bx;
    if (cross < 0) {
        return 1;
    }
    if (cross > 0) {
        return -1;
    }
    return 0;
}

/** Distance (in x/z) from the point (px, pz) to the line through the origin with direction (dx, dz). */
function pointToLineDistance(px, py, pz, dx, dy, dz) {
    var cross = px * dz - pz * dx;
    if (cross === 0) {
        return 0;
    }
    var length = Math.sqrt(dx * dx + dz * dz);
    // Both branches are identical in the original.
    return cross < 0 ? -cross / length : -cross / length;
}

// ---------------------------------------------------------------------------------------------------------------
// Angle / vector interpolation and segment intersection
// ---------------------------------------------------------------------------------------------------------------

/** Spherically interpolates between two angles (radians) by t, going through unit vectors. */
function slerpAngle(fromAngle, toAngle, t) {
    if (t == 0) {
        return fromAngle;
    }
    if (fromAngle == toAngle || t == 1) {
        return toAngle;
    }
    var fromVector = new THREE.Vector2(Math.cos(fromAngle), Math.sin(fromAngle)),
        toVector = new THREE.Vector2(Math.cos(toAngle), Math.sin(toAngle)),
        result = slerpVector2(fromVector, toVector, t);
    return Math.atan2(result.y, result.x);
}

/** Spherical linear interpolation between two unit THREE.Vector2. */
function slerpVector2(from, to, t) {
    if (t == 0) {
        return from;
    }
    if (from.equals(to) || t == 1) {
        return to;
    }
    var omega = Math.acos(from.dot(to));
    if (omega == 0) {
        return to;
    }
    var sinOmega = Math.sin(omega),
        fromPart = from.clone().multiplyScalar(Math.sin((1 - t) * omega) / sinOmega),
        toPart = to.clone().multiplyScalar(Math.sin(t * omega) / sinOmega);
    return fromPart.add(toPart);
}

/** True when (px, pz) lies within the bounding box of the segment (x1, z1)-(x2, z2). */
function isPointInSegmentBounds(x1, z1, x2, z2, px, pz) {
    return (px >= x1 || px >= x2) && (x1 >= px || x2 >= px) && (pz >= z1 || pz >= z2) && (z1 >= pz || z2 >= pz);
}

/** Which side of the line (x1, z1)->(x2, z2) the point (px, pz) is on: 1, -1 or 0 (collinear). */
function orientation2D(x1, z1, x2, z2, px, pz) {
    var lhs = (px - x1) * (z2 - z1),
        rhs = (x2 - x1) * (pz - z1);
    return rhs > lhs ? -1 : lhs > rhs ? 1 : 0;
}

/** True when the segment (x1, z1)-(x2, z2) intersects any [x1, z1, x2, z2] segment in `segments`. */
function segmentIntersectsAny(x1, z1, x2, z2, segments) {
    for (var i = 0; i < segments.length; i++) {
        var segment = segments[i];
        if (segmentsIntersect(x1, z1, x2, z2, segment[0], segment[1], segment[2], segment[3])) {
            return true;
        }
    }
    return false;
}

/**
 * True when segment A (ax1, az1)-(ax2, az2) intersects segment B (bx1, bz1)-(bx2, bz2).
 * Segments that share an endpoint are not considered intersecting.
 */
function segmentsIntersect(ax1, az1, ax2, az2, bx1, bz1, bx2, bz2) {
    ax1 += 0;
    az1 += 0;
    ax2 += 0;
    az2 += 0;
    bx1 += 0;
    bz1 += 0;
    bx2 += 0;
    bz2 += 0;
    var sideA1 = orientation2D(bx1, bz1, bx2, bz2, ax1, az1),
        sideA2 = orientation2D(bx1, bz1, bx2, bz2, ax2, az2),
        sideB1 = orientation2D(ax1, az1, ax2, az2, bx1, bz1),
        sideB2 = orientation2D(ax1, az1, ax2, az2, bx2, bz2);
    return (ax1 != bx1 || az1 != bz1) && (ax1 != bx2 || az1 != bz2) && (ax2 != bx1 || az2 != bz1) && (ax2 != bx2 || az2 != bz2) &&
        ((sideA1 > 0 && sideA2 < 0 || sideA1 < 0 && sideA2 > 0) && (sideB1 > 0 && sideB2 < 0 || sideB1 < 0 && sideB2 > 0) ||
            sideA1 == 0 && isPointInSegmentBounds(bx1, bz1, bx2, bz2, ax1, az1) ||
            sideA2 == 0 && isPointInSegmentBounds(bx1, bz1, bx2, bz2, ax2, az2) ||
            sideB1 == 0 && isPointInSegmentBounds(ax1, az1, ax2, az2, bx1, bz1) ||
            sideB2 == 0 && isPointInSegmentBounds(ax1, az1, ax2, az2, bx2, bz2));
}

// ---------------------------------------------------------------------------------------------------------------
// Point2D, PlaneEdge, Path
// ---------------------------------------------------------------------------------------------------------------

/** A point on the floor plane (x, z). */
function Point2D(x, z) {
    this.x = x;
    this.z = z;
}

/** String key identifying the position ("x,z"). */
Point2D.prototype.getKey = function () {
    return this.x + "," + this.z;
};

Point2D.prototype.clone = function () {
    return new Point2D(this.x, this.z);
};

Point2D.prototype.minus = function (other) {
    return new Point2D(this.x - other.x, this.z - other.z);
};

Point2D.prototype.cross = function (other) {
    return this.x * other.z - this.z * other.x;
};

Point2D.prototype.polarAngle = function () {
    return Math.atan2(this.z, this.x);
};

Point2D.prototype.angleTo = function (other) {
    return other.minus(this).polarAngle();
};

Point2D.prototype.magnitude = function () {
    return Math.sqrt(this.x * this.x + this.z * this.z);
};

Point2D.prototype.distance = function (other) {
    return this.minus(other).magnitude();
};

/**
 * One edge of a floor (y == mapObj.y1) or ceiling (y == mapObj.y2) plane, built from a map wall object,
 * with the textures on its left and right sides.
 */
function PlaneEdge(mapObj, y) {
    this.a = new Point2D(mapObj.x1, mapObj.z1);
    this.b = new Point2D(mapObj.x2, mapObj.z2);
    this.cutsHole = false;
    if (y == mapObj.y2) {
        this.leftTex = mapObj.textures.ceil_left;
        this.rightTex = mapObj.textures.ceil_right;
        if (mapObj.y1 < 0 && this.leftTex == "") {
            this.cutsHole = true;
        }
    } else {
        if (y != mapObj.y1) {
            throw "Invalid plane edge";
        }
        this.leftTex = mapObj.textures.floor_left;
        this.rightTex = mapObj.textures.floor_right;
    }
    this.y = y;
    this.mapObj = mapObj;
    this.marked = {
        left: false,
        right: false
    };
    this.canStart = true;
}

PlaneEdge.prototype.getA = function () {
    return this.a;
};

PlaneEdge.prototype.getB = function () {
    return this.b;
};

/** The same edge running the other way (endpoints and left/right textures swapped). */
PlaneEdge.prototype.inverse = function () {
    var edge = new PlaneEdge(this.mapObj, this.y);
    edge.a = this.b;
    edge.b = this.a;
    edge.leftTex = this.rightTex;
    edge.rightTex = this.leftTex;
    return edge;
};

PlaneEdge.prototype.clone = function () {
    var edge = new PlaneEdge(this.mapObj, this.y);
    return edge;
};

/** A polygon path of Point2D nodes; cyclic when the last node equals the first. */
function Path(nodes, texture, cutsHole) {
    this.cutsHole = cutsHole;
    this.nodes = nodes;
    this.texture = texture;
    this.cyclic = this.nodes[0].getKey() == this.nodes[this.nodes.length - 1].getKey();
    this.canBeChild = true;
}

Path.prototype.isClockwise = function () {
    for (var nodes = this.nodes, sum = 0, i = 0; i < nodes.length - 1; i++) {
        var from = nodes[i],
            to = nodes[i + 1];
        sum += (to.x - from.x) * (to.z * from.z);
    }
    return sum > 0;
};

/** Deep copy of the nodes (note: cutsHole is not carried over). */
Path.prototype.clone = function () {
    for (var nodes = [], i = 0; i < this.nodes.length; i++) {
        nodes.push(this.nodes[i].clone());
    }
    return new Path(nodes, this.texture);
};

Path.prototype.reverse = function () {
    this.nodes.reverse();
};

/** Returns a copy of this path wound in the requested direction ("clockwise" or "counterclockwise"). */
Path.prototype.getDirection = function (direction) {
    if (direction != "clockwise" && direction != "counterclockwise") {
        throw "Invalid direction";
    }
    var copy = this.clone();
    if (this.isClockwise() != (direction == "clockwise")) {
        copy.reverse();
    }
    return copy;
};

// ---------------------------------------------------------------------------------------------------------------
// PolygonTriangulator (debug ear-clipping)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Debug ear-clipping triangulator for a cyclic Path. Each iter() call clips one ear; draw() renders the
 * progress to a 2D canvas context.
 */
function PolygonTriangulator(path) {
    this.cycle = path.clone();
    this.cycle.nodes.splice(this.cycle.nodes.length - 1, 1);
    this.originalNodes = this.cycle.clone();
    for (var nodes = this.cycle.nodes, i = 0; i < nodes.length; i++) {
        if (nodes[i].getKey() == nodes[(i + 1) % nodes.length].getKey()) {
            nodes.splice(i, 1);
            i--;
        }
    }
    this.triangles = [];
    this.triColors = [];
    this.frame = 0;
}

/** Clips one ear off the remaining cycle; returns true when a triangle was produced. */
PolygonTriangulator.prototype.iter = function () {
    for (var nodes = this.cycle.nodes, index = 0; index < nodes.length; index++) {
        var prevIndex = index == 0 ? nodes.length - 1 : index - 1,
            curIndex = index,
            nextIndex = (index + 1) % nodes.length;
        var prev = nodes[prevIndex],
            cur = nodes[curIndex],
            next = nodes[nextIndex];
        for (var triangle = new Path([prev, cur, next, prev], ""),
                 isEar = prev.getKey() != cur.getKey() && cur.getKey() != next.getKey() && next.getKey() != prev.getKey() &&
                     crossSign(cur.minus(prev), next.minus(prev)) == 1 && !pathsCross(triangle, this.cycle),
                 k = 0; k < nodes.length && isEar; k++) {
            if (nodes[k] != prev && nodes[k] != cur && nodes[k] != next && isPointInsidePath(nodes[k], triangle.nodes)) {
                isEar = false;
            }
        }
        for (var k = 0; k < this.triangles.length && isEar; k++) {
            var other = this.triangles[k];
            if ((isPointInsidePath(other.nodes[0], triangle.nodes) || isPointInsidePath(other.nodes[1], triangle.nodes) || isPointInsidePath(other.nodes[2], triangle.nodes)) &&
                (isPointInsidePath(triangle.nodes[0], other.nodes) || isPointInsidePath(triangle.nodes[1], other.nodes) || isPointInsidePath(triangle.nodes[2], other.nodes))) {
                isEar = false;
            }
            for (var m = 0; m < 3; m++) {
                for (var n = 0; n < 3; n++) {
                    var otherFrom = other.nodes[m],
                        otherTo = other.nodes[m + 1],
                        triFrom = triangle.nodes[n],
                        triTo = triangle.nodes[n + 1];
                    if (segmentsIntersect(otherFrom.x, otherFrom.z, otherTo.x, otherTo.z, triFrom.x, triFrom.z, triTo.x, triTo.z)) {
                        isEar = false;
                    }
                }
            }
        }
        if (isEar) {
            nodes.splice(index, 1);
            this.triangles.push(triangle);
            this.triColors.push("rgb(" + parseInt(255 * Math.random()) + "," + parseInt(255 * Math.random()) + "," + parseInt(255 * Math.random()) + ")");
            return true;
        }
    }
    return false;
};

/** Draws the original outline, clipped triangles and remaining cycle onto a canvas 2D context. */
PolygonTriangulator.prototype.draw = function (ctx, scale, offset) {
    this.frame++;
    var nodes = this.originalNodes.nodes;
    ctx.strokeStyle = "#F00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x * scale + offset, nodes[0].z * scale + offset);
    for (var i = 1; i < nodes.length; i++) {
        ctx.lineTo(nodes[i % nodes.length].x * scale + offset, nodes[i % nodes.length].z * scale + offset);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (var i = 0; i < this.triangles.length; i++) {
        var tri = this.triangles[i].nodes;
        ctx.fillStyle = this.triColors[i];
        ctx.beginPath();
        ctx.moveTo(tri[0].x * scale + offset, tri[0].z * scale + offset);
        ctx.lineTo(tri[1].x * scale + offset, tri[1].z * scale + offset);
        ctx.lineTo(tri[2].x * scale + offset, tri[2].z * scale + offset);
        ctx.fill();
    }
    var nodes = this.cycle.nodes;
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x * scale + offset, nodes[0].z * scale + offset);
    for (var i = 1; i < nodes.length; i++) {
        ctx.lineTo(nodes[i % nodes.length].x * scale + offset, nodes[i % nodes.length].z * scale + offset);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    // NOTE: uses the global `frame` (not this.frame), as in the original.
    var marker = this.cycle.nodes[frame % this.cycle.nodes.length];
    ctx.fillStyle = "#F0F";
    ctx.fillRect(marker.x * scale + offset, marker.z * scale + offset, 5, 5);
};

// ---------------------------------------------------------------------------------------------------------------
// Oriented bounding boxes
// ---------------------------------------------------------------------------------------------------------------

/**
 * Oriented bounding box: centre position, half-extents [x, y, z] and three unit axes (THREE.Vector3).
 */
function OrientedBoundingBox(position, extents, axes) {
    this.position = position;
    this.extents = extents;
    this.axes = axes;
}

/**
 * Separating-axis test between two oriented boxes (each given as centre, half-extents array and axes array).
 * Tests the 3 + 3 face axes and the 9 edge-cross-product axes; returns false as soon as one separates them.
 */
function obbOverlapTest(posA, extentsA, axesA, posB, extentsB, axesB) {
    var radiusA, radiusB, distance, i, k,
        dx = posB.x - posA.x,
        dy = posB.y - posA.y,
        dz = posB.z - posA.z,
        // translation from A to B expressed in A's frame
        t = [
            dx * axesA[0].x + dy * axesA[0].y + dz * axesA[0].z,
            dx * axesA[1].x + dy * axesA[1].y + dz * axesA[1].z,
            dx * axesA[2].x + dy * axesA[2].y + dz * axesA[2].z
        ],
        a = extentsA,
        b = extentsB,
        // rotation matrix expressing B's axes in A's frame
        R = [
            [],
            [],
            []
        ];
    for (i = 0; i < 3; i++) {
        for (k = 0; k < 3; k++) {
            R[i][k] = axesA[i].x * axesB[k].x + axesA[i].y * axesB[k].y + axesA[i].z * axesB[k].z;
        }
    }
    // A's face axes
    for (i = 0; i < 3; i++) {
        radiusA = a[i];
        radiusB = b[0] * Math.abs(R[i][0]) + b[1] * Math.abs(R[i][1]) + b[2] * Math.abs(R[i][2]);
        distance = Math.abs(t[i]);
        if (distance > radiusA + radiusB) {
            return false;
        }
    }
    // B's face axes
    for (k = 0; k < 3; k++) {
        radiusA = a[0] * Math.abs(R[0][k]) + a[1] * Math.abs(R[1][k]) + a[2] * Math.abs(R[2][k]);
        radiusB = b[k];
        distance = Math.abs(t[0] * R[0][k] + t[1] * R[1][k] + t[2] * R[2][k]);
        if (distance > radiusA + radiusB) {
            return false;
        }
    }
    // A0 x B0
    radiusA = a[1] * Math.abs(R[2][0]) + a[2] * Math.abs(R[1][0]);
    radiusB = b[1] * Math.abs(R[0][2]) + b[2] * Math.abs(R[0][1]);
    distance = Math.abs(t[2] * R[1][0] - t[1] * R[2][0]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A0 x B1
    radiusA = a[1] * Math.abs(R[2][1]) + a[2] * Math.abs(R[1][1]);
    radiusB = b[0] * Math.abs(R[0][2]) + b[2] * Math.abs(R[0][0]);
    distance = Math.abs(t[2] * R[1][1] - t[1] * R[2][1]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A0 x B2
    radiusA = a[1] * Math.abs(R[2][2]) + a[2] * Math.abs(R[1][2]);
    radiusB = b[0] * Math.abs(R[0][1]) + b[1] * Math.abs(R[0][0]);
    distance = Math.abs(t[2] * R[1][2] - t[1] * R[2][2]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A1 x B0
    radiusA = a[0] * Math.abs(R[2][0]) + a[2] * Math.abs(R[0][0]);
    radiusB = b[1] * Math.abs(R[1][2]) + b[2] * Math.abs(R[1][1]);
    distance = Math.abs(t[0] * R[2][0] - t[2] * R[0][0]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A1 x B1
    radiusA = a[0] * Math.abs(R[2][1]) + a[2] * Math.abs(R[0][1]);
    radiusB = b[0] * Math.abs(R[1][2]) + b[2] * Math.abs(R[1][0]);
    distance = Math.abs(t[0] * R[2][1] - t[2] * R[0][1]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A1 x B2
    radiusA = a[0] * Math.abs(R[2][2]) + a[2] * Math.abs(R[0][2]);
    radiusB = b[0] * Math.abs(R[1][1]) + b[1] * Math.abs(R[1][0]);
    distance = Math.abs(t[0] * R[2][2] - t[2] * R[0][2]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A2 x B0
    radiusA = a[0] * Math.abs(R[1][0]) + a[1] * Math.abs(R[0][0]);
    radiusB = b[1] * Math.abs(R[2][2]) + b[2] * Math.abs(R[2][1]);
    distance = Math.abs(t[1] * R[0][0] - t[0] * R[1][0]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A2 x B1
    radiusA = a[0] * Math.abs(R[1][1]) + a[1] * Math.abs(R[0][1]);
    radiusB = b[0] * Math.abs(R[2][2]) + b[2] * Math.abs(R[2][0]);
    distance = Math.abs(t[1] * R[0][1] - t[0] * R[1][1]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    // A2 x B2
    radiusA = a[0] * Math.abs(R[1][2]) + a[1] * Math.abs(R[0][2]);
    radiusB = b[0] * Math.abs(R[2][1]) + b[1] * Math.abs(R[2][0]);
    distance = Math.abs(t[1] * R[0][2] - t[0] * R[1][2]);
    if (distance > radiusA + radiusB) {
        return false;
    }
    return true;
}

OrientedBoundingBox.prototype.overlaps = function (other) {
    return obbOverlapTest(this.position, this.extents, this.axes, other.position, other.extents, other.axes);
};

// Scratch vectors reused by intersectsWall to avoid allocations.
var obbTempA = new THREE.Vector3(),
    obbTempB = new THREE.Vector3(),
    obbTempC = new THREE.Vector3(),
    obbTempD = new THREE.Vector3(),
    obbTempE = new THREE.Vector3();

// Implicit globals in the original (assigned without var); kept as globals with the same names.
obbYAxis = new THREE.Vector3(0, 1, 0);
obbWallExtents = new Array(3);
obbWallAxes = new Array(3);

/**
 * Tests this box against a vertical wall rectangle given by two opposite corners (cornerA, cornerB),
 * treating the wall as a zero-thickness box.
 */
OrientedBoundingBox.prototype.intersectsWall = function (cornerA, cornerB) {
    var thirdCorner = obbTempA.set(cornerA.x, cornerB.y, cornerA.z);
    // Computed but unused in the original.
    obbTempB.set(cornerB.x, cornerA.y, cornerB.z);
    var center = obbTempC.addVectors(cornerA, cornerB).multiplyScalar(0.5),
        normal = obbTempD.subVectors(cornerA, center).cross(Hover.tempVector3.subVectors(thirdCorner, center)).normalize(),
        widthAxis = obbTempE.set(cornerA.x, center.y, cornerA.z).sub(center),
        halfWidth = widthAxis.length();
    widthAxis.normalize();
    var extents = obbWallExtents;
    extents[0] = halfWidth;
    extents[1] = Math.abs(cornerB.y - center.y);
    extents[2] = 0;
    var axes = obbWallAxes;
    axes[0] = widthAxis;
    axes[1] = obbYAxis;
    axes[2] = normal;
    var result = obbOverlapTest(this.position, this.extents, this.axes, center, extents, axes);
    return result;
};

// Shared scratch vectors used across the game (original line 1611).
Hover.tempVector3 = new THREE.Vector3();
Hover.tempVector2 = new THREE.Vector2();
