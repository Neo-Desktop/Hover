// Original: game.js lines 3294-3440 (Viewer3D, Scene, Craft), 3530-3614 (Names, StatsGraph*;
// these were defined inside the CustomizeView module in the original, right after CustomizeView)
// Viewer3D: a small three.js preview used by the "customize" screen. It shows one hovercraft at
// a time (fly-in/fly-out animations, idle hover and shake, drag-to-rotate) and draws a 2D
// canvas chart of the selected craft's stats.

var Viewer3D = {};

/** Height (Y) a preview craft is parked at, and flies in from, before it is shown. */
var VIEWER_CRAFT_START_Y = 300;

/** Fixed pixel width of the preview's WebGL renderer (height follows the container/window). */
var VIEWER_RENDER_WIDTH = 1000;

/**
 * The preview scene: renderer, camera, lights and the three selectable crafts.
 * Dispatches a "craftsLoaded" event once every craft model has loaded.
 * @param {Object} options  { container: DOM element, width?, height? }
 */
Viewer3D.Scene = function (options) {
    var container = options.container;
    options = jQuery.extend({
        width: container.offsetWidth,
        height: container.offsetHeight
    }, options);
    var renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.setClearColor(0, 0);
    renderer.setSize(VIEWER_RENDER_WIDTH, options.height);
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene;
    var fov = 45 / (VIEWER_RENDER_WIDTH / options.height);
    var camera = new THREE.PerspectiveCamera(fov, VIEWER_RENDER_WIDTH / options.height, 0.2, 10000);
    camera.position = new THREE.Vector3(0, 144, 504);
    camera.lookAt(new THREE.Vector3(0, 50, 0));
    scene.add(camera);
    var light = new THREE.PointLight(16777215, 0.9);
    light.position = camera.position;
    camera.add(light);
    var ambientIntensity = 0.7;
    var ambient = new THREE.AmbientLight;
    ambient.color.setRGB(1 * ambientIntensity, 1 * ambientIntensity, 1 * ambientIntensity);
    scene.add(ambient);
    this.loadedCrafts = 0;
    this.crafts = [
        new Viewer3D.Craft(this, "/3d/Models/hover_a.json", "/3d/Textures/HOVER_A_YELLOW.jpg"),
        new Viewer3D.Craft(this, "/3d/Models/hover_c.json", "/3d/Textures/HOVER_C_YELLOW.jpg"),
        new Viewer3D.Craft(this, "/3d/Models/hover_b.json", "/3d/Textures/Hover_B_RED.jpg") // original: "HOVER_B_RED.jpg" (case fixed to match the file on disk)
    ];
    this.currentCraft = null;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.children = [];
    this.lastFrameTime = Date.now();
    this.animations = [];
    this.isRotatingCraft = false;
    this.previousRotatePosition = null;
    this.rotationSetup = false;
};

Viewer3D.Scene.prototype = Object.create(THREE.EventDispatcher.prototype);

/** Start a drag-rotation of the shown craft at pointer position (x, y). */
Viewer3D.Scene.prototype.beginRotateCurrentCraft = function (x, y) {
    this.isRotatingCraft = true;
    this.previousRotatePosition = new THREE.Vector2(x, y);
};

/** Continue a drag-rotation: yaw freely, pitch clamped to [-0.2, 0.3] radians. */
Viewer3D.Scene.prototype.rotateCurrentCraft = function (x, y) {
    if (this.isRotatingCraft) {
        var position = new THREE.Vector2(x, y);
        var delta = position.clone().sub(this.previousRotatePosition);
        this.currentCraft.mesh.rotation.y += THREE.Math.degToRad(delta.x / 4);
        var pitch = this.currentCraft.mesh.rotation.x + THREE.Math.degToRad(delta.y / 4);
        if (pitch >= -0.2 && pitch <= 0.3) {
            this.currentCraft.mesh.rotation.x = pitch;
        }
        this.previousRotatePosition = position;
    }
};

Viewer3D.Scene.prototype.endRotateCurrentCraft = function () {
    this.isRotatingCraft = false;
};

/** Match the camera and renderer to the window height (width stays VIEWER_RENDER_WIDTH). */
Viewer3D.Scene.prototype.resize = function () {
    var height = window.innerHeight;
    var width = VIEWER_RENDER_WIDTH;
    var fov = 45 / (width / height);
    this.camera.fov = fov;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
};

/** Update and draw, then schedule the next frame (runs forever). */
Viewer3D.Scene.prototype.render = function () {
    this.update();
    this.renderer.render(this.scene, this.camera);
    var self = this;
    this.animationFrameHandler = window.requestAnimationFrame(function () {
        self.render();
    });
};

/** Fly the current craft out and, 200 ms later, fly the craft at `index` in. */
Viewer3D.Scene.prototype.gotoCraft = function (index) {
    if (!this.currentCraft) {
        this.startIndex = index; // shown first once the models have loaded (addChild)
    }
    if (this.currentCraft) {
        var nextCraft = this.crafts[index];
        this.currentCraft.animateOut();
        var self = this;
        setTimeout(function () {
            nextCraft.mesh.rotation.y = Math.PI / 6;
            nextCraft.mesh.rotation.x = 0;
            nextCraft.animateIn();
            self.currentCraft = nextCraft;
        }, 200);
        $(".customizeCraftShadow").fadeOut().delay(100).fadeIn();
    }
};

/** Update every child craft with (now, elapsed ms since last frame). */
Viewer3D.Scene.prototype.update = function () {
    for (var now = Date.now(), elapsed = now - this.lastFrameTime, count = this.children.length, i = count - 1; i >= 0; i--) {
        this.children[i].update(now, elapsed);
    }
    this.lastFrameTime = now;
};

/** Called by each Craft once its model and texture have loaded. */
Viewer3D.Scene.prototype.addChild = function (craft) {
    this.loadedCrafts++;
    if (this.loadedCrafts >= this.crafts.length) {
        var loadedEvent = {
            type: "craftsLoaded"
        };
        this.dispatchEvent(loadedEvent);
    }
    this.scene.add(craft.mesh);
    this.children.push(craft);
    if (!this.currentCraft) {
        // This edition: the craft asked for before the models loaded (the one chosen last time).
        if (craft === this.crafts[this.startIndex || 0]) {
            this.currentCraft = craft;
            this.currentCraft.animateIn();
        }
    }
};

/**
 * One previewable craft: loads a JSON model and a diffuse texture, then adds itself to the scene.
 * `mesh` is the outer pivot (position/rotation), `craftMesh` the inner model (hover bob/shake).
 */
Viewer3D.Craft = function (scene, modelUrl, textureUrl, chartAttributes) {
    this.scene = scene;
    this.geometry = null;
    this.diffuseTexture = null;
    this.mesh = null;
    this.hoverDirection = 1;
    this.shakeDirection = 1;
    this.shakeAngle = 0;
    this.craftMesh = null;
    this.animationInfo = null;
    var loader = new THREE.JSONLoader;
    var self = this;
    loader.load(modelUrl, function (geometry) {
        self.geometry = geometry;
        THREE.ImageUtils.loadTexture(textureUrl, null, function (texture) {
            self.diffuseTexture = texture;
            self.addToScene();
        });
    });
    this.chartAttributes = chartAttributes;
};

Viewer3D.Craft.prototype.addToScene = function () {
    var model = new THREE.Mesh(this.geometry, new THREE.MeshPhongMaterial({
        map: this.diffuseTexture,
        shading: THREE.SmoothShading
    }));
    model.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI);
    var pivot = new THREE.Object3D;
    pivot.add(model);
    pivot.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 6);
    pivot.position.x = -80;
    pivot.position.y = VIEWER_CRAFT_START_Y;
    this.craftMesh = model;
    this.craftMesh.visible = false;
    this.mesh = pivot;
    this.scene.addChild(this);
};

/** Fly in from above/behind, then drop into place with an elastic bounce. */
Viewer3D.Craft.prototype.animateIn = function () {
    this.craftMesh.visible = true;
    this.animationInfo = {
        animationType: "fly_in",
        startTime: Date.now(),
        elapsed: 0,
        currentSegment: 0,
        segments: [{
            duration: 300,
            start: new THREE.Vector3(-150, VIEWER_CRAFT_START_Y, -200),
            end: new THREE.Vector3(this.mesh.position.x, 60, 0),
            easing: jQuery.easing.easeInQuad,
            startTime: null
        }, {
            duration: 600,
            start: new THREE.Vector3(this.mesh.position.x, 60, 0),
            end: new THREE.Vector3(this.mesh.position.x, 0, 0),
            easing: jQuery.easing.easeOutElastic,
            startTime: null
        }],
        complete: null
    };
};

/** Fly down and out of view, then hide the model. */
Viewer3D.Craft.prototype.animateOut = function () {
    var self = this;
    this.animationInfo = {
        animationType: "fly_out",
        startTime: Date.now(),
        elapsed: 0,
        currentSegment: 0,
        segments: [{
            duration: 500,
            start: new THREE.Vector3(this.mesh.position.x, 0, 0),
            end: new THREE.Vector3(this.mesh.position.x, -300, 150),
            easing: jQuery.easing.easeInQuad,
            startTime: null
        }],
        complete: function () {
            self.craftMesh.visible = false;
        }
    };
};

/**
 * Per-frame update: random hover bob and side-to-side shake, then advance the current
 * fly-in/fly-out animation segment (if any).
 * @param {number} now      Date.now() of this frame
 * @param {number} elapsed  ms since the previous frame
 */
Viewer3D.Craft.prototype.update = function (now, elapsed) {
    var maxElapsed = 50;
    if (elapsed > maxElapsed) {
        elapsed = maxElapsed;
    }
    var hoverOn = Math.random() > 0.95 ? 0 : 1;
    var hoverStep = 3 * Math.random() * (elapsed / 1000) * hoverOn;
    if (this.craftMesh.position.y > 1 && this.hoverDirection === 1) {
        this.hoverDirection = -1;
    } else if (this.craftMesh.position.y < -1 && this.hoverDirection === -1) {
        this.hoverDirection = 1;
    }
    this.craftMesh.position.y += hoverStep * this.hoverDirection;
    var shakeStep = 2 * Math.random() * (elapsed / 1200);
    if (this.shakeAngle > 0.75 && this.shakeDirection === 1) {
        this.shakeDirection = -1;
    } else if (this.shakeAngle < -0.75 && this.shakeDirection === -1) {
        this.shakeDirection = 1;
    }
    shakeStep *= this.shakeDirection;
    this.craftMesh.rotateOnAxis(new THREE.Vector3(0, 0, 1), THREE.Math.degToRad(shakeStep));
    this.shakeAngle += shakeStep;
    if (this.animationInfo) {
        var segment = this.animationInfo.segments[this.animationInfo.currentSegment];
        if (!segment.startTime) {
            segment.startTime = this.animationInfo.startTime;
        }
        var segmentStart = segment.startTime;
        var duration = segment.duration;
        var progress = (now - segmentStart) / duration;
        var eased = segment.easing(null, now - segmentStart, 0, 1, duration);
        var from = segment.start.clone();
        var offset = segment.end.clone();
        offset.sub(from).multiplyScalar(eased);
        this.mesh.position = from.add(offset);
        this.animationInfo.elapsed += elapsed;
        if (progress >= 1) {
            if (this.animationInfo.currentSegment === this.animationInfo.segments.length - 1) {
                if (this.animationInfo.complete) {
                    this.animationInfo.complete();
                }
                this.animationInfo = null;
            } else {
                this.animationInfo.currentSegment++;
                var nextSegment = this.animationInfo.segments[this.animationInfo.currentSegment];
                nextSegment.startTime = Date.now();
            }
        }
    }
};

/** Display names of the three crafts (same order as Scene.crafts and the Easy/Normal/Hard profiles). */
Viewer3D.Names = ["Chicago", "Wizard", "Bambi"];

Viewer3D.StatsGraphLabels = ["power", "speed", "stability", "agility"];

Viewer3D.StatsGraphValues = [
    Hover.Profiles.getStats(Hover.Profiles.Easy),
    Hover.Profiles.getStats(Hover.Profiles.Normal),
    Hover.Profiles.getStats(Hover.Profiles.Hard)
];

/**
 * Smooth-curve area chart of craft stats on a 2D canvas, with animated transitions.
 * @param {HTMLCanvasElement} canvas
 */
Viewer3D.StatsGraph = function (canvas) {
    this.canvas = canvas;
    if (this.canvas) {
        this.ctx = canvas.getContext("2d");
        this.canvasWidth = canvas.width;
        this.canvasHeight = canvas.height;
        var strokeGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvasHeight);
        var fillGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvasHeight);
        var verticalGridGradient = this.ctx.createLinearGradient(0, this.canvasHeight - 550, 0, this.canvasHeight);
        var horizontalGridGradient = this.ctx.createLinearGradient(0, 0, this.canvasWidth, 0);
        strokeGradient.addColorStop(0.75, "rgba(189,30,70,1)");
        strokeGradient.addColorStop(1, "rgba(189,30,70,0)");
        fillGradient.addColorStop(0.75, "rgba(189,30,70,0.25)");
        fillGradient.addColorStop(1, "rgba(189,30,70,0)");
        verticalGridGradient.addColorStop(0, "rgba(189,30,70,0)");
        verticalGridGradient.addColorStop(0.25, "rgba(189,30,70,0.25)");
        verticalGridGradient.addColorStop(0.75, "rgba(189,30,70,0.25)");
        verticalGridGradient.addColorStop(1, "rgba(189,30,70,0)");
        horizontalGridGradient.addColorStop(0, "rgba(189,30,70,0)");
        horizontalGridGradient.addColorStop(0.25, "rgba(189,30,70,0.25)");
        horizontalGridGradient.addColorStop(0.75, "rgba(189,30,70,0.25)");
        horizontalGridGradient.addColorStop(1, "rgba(189,30,70,0)");
        this.options = {
            chartHeight: 550,
            animatationFrames: 40,
            fillStyle: fillGradient,
            strokeStyle: strokeGradient,
            strokeWidth: 5,
            verticalGridLineStyle: verticalGridGradient,
            horizontalGridLineStyle: horizontalGridGradient,
            gridLineWidth: 3
        };
    }
};

/**
 * Set the chart values (each 0..1). When `animate` is true and the point count is unchanged,
 * eases from the old values over options.animatationFrames frames; otherwise draws at once.
 */
Viewer3D.StatsGraph.prototype.setPoints = function (values, labels, animate) {
    if (this.interval) {
        clearInterval(this.interval);
    }
    if (labels) {
        this.labels = labels;
    }
    this.lastValues = this.values ? this.values : null;
    this.nextValues = values;
    var spacing = this.canvasWidth / (values.length + 1);
    var x = 0;
    var bottom = this.canvasHeight;
    // jQuery.proxy without a context: the callback runs with _.map's context (`this`).
    this.nextPoints = _.map(values, jQuery.proxy(function (value) {
        x += Math.round(spacing);
        var point = {
            x: x,
            y: bottom - this.options.chartHeight * value
        };
        return point;
    }), this);
    this.nextPoints.splice(0, 0, {
        x: 0,
        y: this.canvasHeight
    });
    this.nextPoints.push({
        x: this.canvasWidth,
        y: this.canvasHeight
    });
    if (!(this.points && this.points.length === this.nextPoints.length && this.values.length === this.nextValues.length)) {
        animate = false;
    }
    if (animate) {
        this.lastPoints = _.map(this.points, function (point) {
            return {
                x: point.x,
                y: point.y
            };
        });
        this.lastValues = _.map(this.values, function (value) {
            return value;
        });
        this.currFrame = 0;
        this.interval = setInterval(jQuery.proxy(function () {
            for (var p = 1; p < this.points.length; p++) {
                this.points[p].y = jQuery.easing.easeInOutCirc(null, this.currFrame, this.lastPoints[p].y, this.nextPoints[p].y - this.lastPoints[p].y, this.options.animatationFrames);
            }
            for (var v = 0; v < this.values.length; v++) {
                this.values[v] = jQuery.easing.easeInOutCirc(null, this.currFrame, this.lastValues[v], this.nextValues[v] - this.lastValues[v], this.options.animatationFrames);
            }
            this.draw();
            this.currFrame++;
            if (this.currFrame > this.options.animatationFrames) {
                clearInterval(this.interval);
            }
        }, this), 1000 / 60);
    } else {
        this.points = _.map(this.nextPoints, function (point) {
            return {
                x: point.x,
                y: point.y
            };
        });
        this.values = _.map(this.nextValues, function (value) {
            return value;
        });
        this.draw();
    }
};

/** Draw grid lines, the smooth stat curve, a dot per stat, and the value/label text. */
Viewer3D.StatsGraph.prototype.draw = function () {
    function drawCircle(x, y, radius, fillStyle, lineWidth, strokeStyle) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }

    var points = this.points;
    var ctx = this.ctx;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Vertical grid lines at each point.
    for (var i = 0; i < this.points.length - 1; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.points[i].x, this.canvasHeight);
        this.ctx.lineTo(this.points[i].x, this.canvasHeight - this.options.chartHeight);
        this.ctx.strokeStyle = this.options.verticalGridLineStyle;
        this.ctx.lineWidth = this.options.gridLineWidth;
        this.ctx.stroke();
    }
    // Horizontal grid lines every 100 px.
    for (var y = 100 + (this.canvasHeight - this.options.chartHeight); y < this.canvasHeight; y += 100) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.canvasWidth, y);
        this.ctx.strokeStyle = this.options.horizontalGridLineStyle;
        this.ctx.lineWidth = this.options.gridLineWidth;
        this.ctx.stroke();
    }
    // The curve: a cubic bezier between consecutive points with horizontal tangents.
    this.ctx.beginPath();
    this.ctx.moveTo(this.points[0].x, this.points[0].y);
    for (i = 1; i < points.length; i++) {
        var previous = this.points[i - 1];
        var current = this.points[i];
        var control1 = {
            x: (previous.x + current.x) / 2,
            y: previous.y
        };
        var control2 = {
            x: (previous.x + current.x) / 2,
            y: current.y
        };
        this.ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, current.x, current.y);
    }
    this.ctx.lineWidth = this.options.strokeWidth;
    this.ctx.strokeStyle = this.options.strokeStyle;
    this.ctx.stroke();
    this.ctx.fillStyle = this.options.fillStyle;
    this.ctx.fill();
    for (i = 1; i < points.length - 1; i++) {
        var dotX = points[i].x;
        var dotY = points[i].y;
        drawCircle(dotX, dotY, 10, "#200F3F", 5, "#BD1E46");
    }
    for (i = 1; i < points.length - 1; i++) {
        ctx.fillStyle = "#9868CF";
        ctx.textAlign = "center";
        ctx.font = "bold 50px proxima-nova, arial";
        ctx.fillText(Math.round(10 * this.values[i - 1]) / 10, points[i].x, points[i].y - 30);
        ctx.font = "bold 20px proxima-nova, arial";
        ctx.fillText(this.labels[i - 1].toUpperCase(), points[i].x, points[i].y - 75);
    }
};
