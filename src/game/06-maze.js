// Original: game.js lines 267-269, 1499-1568
//
// MazeGeometry: turns a maze description (walls and floors from the map data)
// into renderable geometry batches plus the collision / radar / pad data the
// World uses for gameplay.

/**
 * Builds wall and floor meshes from maze data.
 * @param {Object} mapData   the maze description (Walls, Floors, path...)
 * @param {Object} renderer  the THREE renderer (its GL context is used by the batches)
 */
function MazeGeometry(mapData, renderer) {
    this.renderer = renderer;
    this.map = mapData;
    this.walls = [];
    this.collisionWalls = [];
    this.padWalls = [];
    this.radarWalls = [];
    this.floors = [];
    this.collisionFloors = [];
    this.pads = [];
    this.meshSolids = [];
    this.meshDecals = [];
    this.mulFac = 1;
    // MAZE2 and MAZE3 use textures at half scale. (Note: the maze data has no `path` field, so this
    // never applies and mulFac is always 1.)
    if ("MAZE2" == mapData.path || "MAZE3" == mapData.path) {
        this.mulFac = .5;
    }
    // Pick the geometry batch type for the current rendering mode.
    if (Hover.retro) {
        this.geomType = RetroGeometryBatch;
    } else if (Hover.arm) {
        this.geomType = ArmGeometryBatch;
    } else {
        this.geomType = GeometryBatch;
    }
    this.computeWalls();
    this.computeFloors();
}

/**
 * Builds one geometry batch per wall texture, and collects collision walls
 * (non-decal walls with height) and radar walls (everything except decals and
 * FBASE walls).
 */
MazeGeometry.prototype.computeWalls = function () {
    var self = this;
    var mapData = this.map;
    var walls = mapData.Walls;
    var batchesByTexture = {};
    // Adds one wall quad (two triangles) to the batch for its texture.
    var addWallQuad = (function (wall, textureName, flipped) {
        var texture = Hover.Editor.schemeLoader.getTexture(textureName);
        if (texture && texture.image.width) {
            if (!(textureName in batchesByTexture)) {
                batchesByTexture[textureName] = new self.geomType(self.renderer, texture);
            }
            var batch = batchesByTexture[textureName];
            var baseIndex = batch.vertices.length;
            if (flipped) {
                batch.vertices.push(new THREE.Vector3(wall.A.X, wall.A.Y, wall.A.Z));
                batch.vertices.push(new THREE.Vector3(wall.A.X, wall.B.Y, wall.A.Z));
                batch.vertices.push(new THREE.Vector3(wall.B.X, wall.B.Y, wall.B.Z));
                batch.vertices.push(new THREE.Vector3(wall.B.X, wall.A.Y, wall.B.Z));
            } else {
                batch.vertices.push(new THREE.Vector3(wall.B.X, wall.A.Y, wall.B.Z));
                batch.vertices.push(new THREE.Vector3(wall.B.X, wall.B.Y, wall.B.Z));
                batch.vertices.push(new THREE.Vector3(wall.A.X, wall.B.Y, wall.A.Z));
                batch.vertices.push(new THREE.Vector3(wall.A.X, wall.A.Y, wall.A.Z));
            }
            batch.faces.push(new THREE.Face3(baseIndex, baseIndex + 1, baseIndex + 2));
            batch.faces.push(new THREE.Face3(baseIndex + 2, baseIndex + 3, baseIndex + 0));
            var u0 = 0;
            var u1 = Math.sqrt(Math.pow(wall.B.X - wall.A.X, 2) + Math.pow(wall.B.Z - wall.A.Z, 2)) / texture.originalWidth + u0;
            var v0 = 0;
            var v1 = (wall.B.Y - wall.A.Y) / texture.originalHeight + v0;
            var textureDivisor = 1;
            if (Hover.arm) {
                textureDivisor = 4;
            }
            u1 *= texture.originalWidth / (texture.image.width * textureDivisor);
            v1 *= texture.originalHeight / (texture.image.height * textureDivisor);
            u1 *= self.mulFac;
            v1 *= self.mulFac;
            if (wall.DecalMode) {
                u1 = texture.originalWidth / (texture.image.width / (Hover.retro ? 1 : 2));
                v1 = texture.originalHeight / (texture.image.height / (Hover.retro ? 1 : 2));
            } else {
                v0 = 1 - v1;
                v1 = 1;
            }
            u0 += wall.UOff;
            u1 += wall.UOff;
            v0 += wall.VOff;
            v1 += wall.VOff;
            batch.faceVertexUvs[0].push([new THREE.Vector2(u1, v0), new THREE.Vector2(u1, v1), new THREE.Vector2(u0, v1)]);
            batch.faceVertexUvs[0].push([new THREE.Vector2(u0, v1), new THREE.Vector2(u0, v0), new THREE.Vector2(u1, v0)]);
            batch.isDecal = wall.DecalMode;
            batch.transparent = batch.isDecal;
            if (!wall.DecalMode && v1 - v0 > 0) {
                self.collisionWalls.push([new THREE.Vector3(wall.A.X, wall.A.Y, wall.A.Z), new THREE.Vector3(wall.B.X, wall.B.Y, wall.B.Z)]);
            }
        }
    });
    for (var wallIndex = 0; wallIndex < walls.length; wallIndex++) {
        var wall = walls[wallIndex];
        if (wall.A.Y < wall.B.Y) {
            addWallQuad(wall, wall.Texture);
            if (wall.DoubleSided) {
                addWallQuad(wall, wall.Texture, true);
            }
        }
        if (!wall.DecalMode && -1 == wall.Texture.indexOf("FBASE")) {
            self.radarWalls.push({
                wall: [new THREE.Vector3(wall.A.X, wall.A.Y, wall.A.Z), new THREE.Vector3(wall.B.X, wall.B.Y, wall.B.Z)],
                found: false
            });
        }
    }
    for (var key in batchesByTexture) {
        var wallBatch = batchesByTexture[key];
        wallBatch.finalize();
        if (wallBatch.isDecal) {
            this.meshDecals.push(wallBatch);
        } else {
            this.meshSolids.push(wallBatch);
            this.walls.push(wallBatch);
        }
    }
};

/** Builds every floor, then finalizes one geometry batch per floor texture. */
MazeGeometry.prototype.computeFloors = function () {
    var mapData = this.map;
    var floors = mapData.Floors;
    this.floorGeometries = {};
    for (var i = 0; i < floors.length; i++) {
        var floor = floors[i];
        this.computeFloor(floor);
    }
    for (var key in this.floorGeometries) {
        var floorBatch = this.floorGeometries[key];
        floorBatch.finalize();
        this.meshSolids.push(floorBatch);
        this.floors.push(floorBatch);
    }
};

/**
 * Triangulates one floor polygon into its texture's batch. Floors textured as
 * HOLD_PAD / SLED / FLAG_PAD also become pads (special floor tiles) with
 * invisible pad walls along their outline, and are not collision floors.
 */
MazeGeometry.prototype.computeFloor = function (floor) {
    for (var outline = [], padOutline = [], index = 0; index < floor.Points.length; index++) {
        outline.push(new Point2D(floor.Points[index].X, floor.Points[index].Z));
        padOutline.push(new Point2D(floor.Points[index].X, floor.Points[index].Z));
    }
    var floorY = floor.Points[0].Y;
    var isPad = false;
    if (-1 != floor.Texture.indexOf("HOLD_PAD") || -1 != floor.Texture.indexOf("SLED") || -1 != floor.Texture.indexOf("FLAG_PAD")) {
        for (var index = 0; index < floor.Points.length - 1; index++) {
            var padWall = [new THREE.Vector3(floor.Points[index].X, -1000, floor.Points[index].Z), new THREE.Vector3(floor.Points[index + 1].X, 1000, floor.Points[index + 1].Z)];
            this.padWalls.push(padWall);
        }
        isPad = true;
        if (-1 != floor.Texture.indexOf("HOLD_PAD")) {
            this.pads.push(new HoldPad(padOutline));
        } else if (-1 != floor.Texture.indexOf("FLAG_PAD")) {
            this.pads.push(new FlagReturnPad(padOutline));
        } else {
            this.pads.push(new SledPad(padOutline, floor.Texture));
        }
    }
    for (var triangulator = new PolygonTriangulator(new Path(outline, floor.Texture, false)); triangulator.iter();) ;
    var triangles = triangulator.triangles;
    if (!this.floorGeometries[floor.Texture]) {
        this.floorGeometries[floor.Texture] = new this.geomType(this.renderer, Hover.Editor.schemeLoader.getTexture(floor.Texture));
        this.floorGeometries[floor.Texture].doubleSided = true;
    }
    for (var batch = this.floorGeometries[floor.Texture], index = 0; index < triangles.length; index++) {
        var triangle = triangles[index];
        var nodeA = triangle.nodes[0];
        var nodeB = triangle.nodes[1];
        var nodeC = triangle.nodes[2];
        var baseIndex = batch.vertices.length;
        var vertexA = new THREE.Vector3(nodeA.x, floorY, nodeA.z);
        var vertexB = new THREE.Vector3(nodeB.x, floorY, nodeB.z);
        var vertexC = new THREE.Vector3(nodeC.x, floorY, nodeC.z);
        batch.vertices.push(vertexA.clone());
        batch.vertices.push(vertexB.clone());
        batch.vertices.push(vertexC.clone());
        if (!isPad) {
            this.collisionFloors.push([vertexA, vertexB, vertexC]);
        }
        vertexA.y = vertexB.y = vertexC.y = floorY;
        batch.faces.push(new THREE.Face3(baseIndex, baseIndex + 1, baseIndex + 2));
        var uvScale = 1 / 256;
        batch.faceVertexUvs[0].push([new THREE.Vector2(nodeA.x * uvScale, nodeA.z * uvScale), new THREE.Vector2(nodeB.x * uvScale, nodeB.z * uvScale), new THREE.Vector2(nodeC.x * uvScale, nodeC.z * uvScale)]);
    }
};

MazeGeometry.prototype.getMeshSolids = function () {
    return this.meshSolids;
};

MazeGeometry.prototype.getMeshDecals = function () {
    return this.meshDecals;
};
