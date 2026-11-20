// Original: game.js lines 520-531, 580-584, 2324 (tail: ka.prototype.getElementById)-2549, 2712-2778
// Game (base game loop), SinglePlayerGame, roundToTenthClamped and the global craft Profiles.

/**
 * Base game: owns the renderer, cameras, scenes, the World, the local player's craft and its
 * input controllers, and runs the per-frame update/draw loop.
 * @param {Object} options - { domElement, dimensions, craftProfile }
 */
function Game(options) {
    GeometryBatch.cleanObjects();
    GeometryBatch.cleanShaders();
    this.onReady = new Signal();
    this.onPlayerCollision = new Signal();
    this.domElement = options.domElement;
    this.dimensions = options.dimensions;
    // Classic mode has no craft choice; this edition gives it the 1995 game's own handling
    // (the original remake used Profiles.Easy here too).
    this.craftProfile = options.craftProfile || (Hover.retro ? Profiles.Classic : Profiles.Easy);
    this.controllersStarted = false;
    this.rvEnabled = false;
}

/**
 * Single-player game: loads a maze by id and populates it with AI drones, flags and pods
 * (the number of drones/flags grows with the level).
 * @param {Object} options - Game options plus { level, mazeId }
 */
function SinglePlayerGame(options) {
    Game.call(this, options);
    this.level = options.level;
    this.mazeId = options.mazeId;
    this.carriedItems = options.carriedItems; // this edition: items kept from the level before
    // This edition: the 1995 start-up room behind the menus. It stays still and silent until
    // "ibmab" is typed (unlockDemo, 23-main-menu-level.js).
    this.demo = !!options.demo;
    this.demoLocked = this.demo;
    var self = this;
    this.onReady.register(function () {
        self.mazeLoadComplete();
    });
}

/**
 * Rounds a 0..1 ratio to one decimal place and clamps it to [0.1, 0.9] (used for profile stat bars).
 */
function roundToTenthClamped(value) {
    var rounded = Math.round(10 * value) / 10;
    return Math.min(0.9, Math.max(0.1, rounded));
}

/** Finds an element by id inside the game's DOM element. */
Game.prototype.getElementById = function (id) {
    return this.domElement.querySelector("#" + id);
};

/**
 * Called once the maze data and its texture scheme are loaded: builds the renderer, cameras,
 * scenes, background cylinder, World, the player's craft and controllers, lights and the
 * glow (HyperColor) post-processing quad.
 */
Game.prototype.mapLoaded = function (mazeData) {
    var renderer = new THREE.WebGLRenderer({
        antialias: false
    });
    renderer.setSize(this.dimensions.WIDTH, this.dimensions.HEIGHT);
    renderer.setClearColor(0, 1);
    renderer.autoClear = false;
    this.renderer = renderer;
    this.fpsElement = this.getElementById("fps");
    var container = this.getElementById("gameContainer");
    $(renderer.domElement).addClass("gameCanvas").prependTo(container);
    renderer.domElement.width = this.dimensions.WIDTH;
    renderer.domElement.height = this.dimensions.HEIGHT;
    var camera = new THREE.PerspectiveCamera(this.dimensions.VIEW_ANGLE, this.dimensions.ASPECT, this.dimensions.NEAR, this.dimensions.FAR);
    this.camera = camera;
    this.shortCamera = new THREE.PerspectiveCamera(this.dimensions.VIEW_ANGLE, this.dimensions.ASPECT, this.dimensions.NEAR, this.dimensions.FAR_SHORT * (Hover.arm ? 0.25 : 1));
    var scene = new THREE.Scene();
    var particleScene = new THREE.Scene();
    this.scene = scene;
    this.sceneParticles = particleScene;
    this.blankScene = new THREE.Scene();
    scene.onBeforeRender = new Signal();
    particleScene.onBeforeRender = new Signal();
    scene.add(camera);
    particleScene.add(camera);
    var spawn = mazeData.Spawns[0];
    this.shortCamera.position = camera.position;
    camera.position.x = spawn.X;
    camera.position.y = spawn.Y;
    camera.position.z = spawn.Z;
    var world = new World(this, renderer, mazeData, scene, particleScene, "red");
    this.world = world;
    var startAngle = -130 * (Math.PI / 180);
    if (typeof mazeData.StartAngle === "number") {
        startAngle = mazeData.StartAngle; // this edition: the start-up room's 1995 facing
    }
    var craft = new PlayerCraft(world, camera.position, startAngle, "red", this.craftProfile);
    craft.addBehavior(new FlagCaptureBehavior());
    craft.player = true;
    this.craft = craft;
    world.player = craft;
    this.craftControllers = [new KeyboardController(container, craft), new TouchController(container, craft), new GamepadController(container, craft)];
    var spotLight = new THREE.SpotLight(16777215);
    this.spotLight = spotLight;
    spotLight.distance = 20000;
    camera.add(spotLight.target);
    spotLight.target.position.set(0, 0, -1);
    spotLight.position = camera.position;
    scene.add(spotLight);
    var ambientLevel = 0.8;
    var ambientLight = new THREE.AmbientLight();
    ambientLight.color.setRGB(1 * ambientLevel, 1 * ambientLevel, 1 * ambientLevel);
    scene.add(ambientLight);
    var bgScene = new THREE.Scene();
    this.bgScene = bgScene;
    bgScene.add(camera);
    // Background: the panorama texture wrapped on the inside of a big open cylinder.
    var bgRadius = 1000;
    var bgCircumference = 2 * bgRadius * Math.PI;
    var bgHeight = 256 * bgCircumference / 3844;
    var bgGeometry = new THREE.CylinderGeometry(bgRadius, bgRadius, bgHeight, 100, 3, true);
    var bgTexture = Hover.Editor.schemeLoader.getTexture("BACKGRND");
    if (bgTexture && bgTexture.image && bgTexture.image.width && bgTexture.image.width < 3844) {
        // This edition: the 1995 Maze 3 sky is a 256-pixel tile, not a 3844-pixel panorama like the
        // others; repeat it around the horizon instead of stretching one copy all the way round.
        bgTexture.wrapS = THREE.RepeatWrapping;
        bgTexture.repeat.set(3844 / bgTexture.image.width, 1);
    }
    var bgMaterial = new THREE.MeshBasicMaterial({
        map: bgTexture
    });
    bgMaterial.side = THREE.BackSide;
    var bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
    this.bg = bgMesh;
    bgMaterial.depthTest = false;
    bgMaterial.depthWrite = false;
    bgMesh.rotation.z = Math.PI;
    bgMesh.rotation.y = Math.PI / 2;
    bgMesh.position.y = bgHeight / 2;
    bgScene.add(bgMesh);
    if (this.rvEnabled) {
        // Rear-view camera.
        var rvCamera = new THREE.PerspectiveCamera(this.dimensions.RV_ANGLE, this.dimensions.RV_ASPECT, this.dimensions.NEAR, this.dimensions.FAR);
        this.rvCamera = rvCamera;
        scene.add(rvCamera);
        particleScene.add(rvCamera);
        bgScene.add(rvCamera);
    }
    var clock = new THREE.Clock();
    this.clock = clock;
    this.timeSinceUpdate = 0;
    this.timeSinceMilliLog = 0;
    this.frames = 0;
    this.leastFps = 1000;
    this.lowCount = 0;
    this.playedStart = false;
    this.onWin = this.world.onWin;
    this.onTie = this.world.onTie;
    this.onLose = this.world.onLose;
    // Glow pass: emissive parts are rendered into a small target, then blurred additively over the screen.
    this.glowTarget = new THREE.WebGLRenderTarget(256, 256, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
    });
    this.sceneScreen = new THREE.Scene();
    this.screenCamera = new THREE.OrthographicCamera(-this.dimensions.WIDTH / 2, this.dimensions.WIDTH / 2, this.dimensions.HEIGHT / 2, -this.dimensions.HEIGHT / 2, -500, 500);
    var screenGeometry = new THREE.PlaneGeometry(this.dimensions.WIDTH, this.dimensions.HEIGHT);
    var glowQuad = new THREE.Mesh(screenGeometry, new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
            texture: {
                type: "t",
                value: this.glowTarget
            }
        },
        vertexShader: [
            "varying vec2 vUv;",
            "void main(void)",
            "{",
            "\tvUv = uv;",
            "\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
            "}"
        ].join("\n"),
        fragmentShader: [
            "varying vec2 vUv;",
            "uniform sampler2D texture;",
            "void main(void)",
            "{",
            "    gl_FragColor = ",
            "                   texture2D(texture, vUv.st + vec2(-3.0 / 256.0, 0.0)) * 0.04 + ",
            "                   texture2D(texture, vUv.st + vec2(-2.0 / 256.0, 0.0)) * 0.1 + ",
            "                   texture2D(texture, vUv.st + vec2(-1.0 / 256.0, 0.0)) * 0.2 + ",
            "                   texture2D(texture, vUv.st) * 1.0 + ",
            "                   texture2D(texture, vUv.st + vec2( 1.0 / 256.0, 0.0)) * 0.2 + ",
            "                   texture2D(texture, vUv.st + vec2( 2.0 / 256.0, 0.0)) * 0.1 + ",
            "                   texture2D(texture, vUv.st + vec2( 3.0 / 256.0, 0.0)) * 0.04 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0, -3.0 / 256.0)) * 0.04 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0, -2.0 / 256.0)) * 0.1 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0, -1.0 / 256.0)) * 0.2 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0,  1.0 / 256.0)) * 0.13595 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0,  2.0 / 256.0)) * 0.2 + ",
            "                   texture2D(texture, vUv.st + vec2(0.0, -3.0 / 256.0)) * 0.04;",
            "}"
        ].join("\n")
    }));
    glowQuad.position.z = 0;
    glowQuad.doubleSided = true;
    glowQuad.frustumCulled = false;
    this.sceneScreen.add(glowQuad);
};

/** One frame: start on the first frame, update physics (skipped on huge deltas) and draw. */
Game.prototype.runFrame = function () {
    if (!this.playedStart) {
        this.start();
    }
    this.delta = this.clock.getDelta();
    this.handleFpsDisplay(this.delta);
    if (this.demoLocked) {
        // the start-up room: a still picture until "ibmab"
    } else if (this.startHold > 0) {
        // This edition (classic single player): nothing moves until the level-start sound has
        // finished, like the 1995 game's countdown before play.
        this.startHold -= Math.min(this.delta, 0.1);
    } else if (this.delta < 1) {
        // This edition (classic): a slow frame moves the game on by at most 1/10 s, as the 1995
        // game's fixed 1/20 s ticks did, instead of one big jump.
        this.updatePhysics(Hover.retro ? Math.min(this.delta, 0.1) : this.delta);
    }
    // This edition: a level can end inside updatePhysics (the last flag taken), which stops the
    // game and deletes its WebGL buffers and shaders; don't draw that frame with them.
    if (this.stopped) {
        return;
    }
    this.draw(this.delta);
};

/** Starts the controllers and the level-start sound, then the music two seconds later. */
Game.prototype.start = function () {
    if (!this.playedStart && this.demoLocked) {
        this.playedStart = true; // no start sound, music or controls in the start-up room
        return;
    }
    if (!this.playedStart) {
        this.startControllers();
        setTimeout(function () {
            Hover.audio.getSound("MUSIC").play();
        }, 2000);
        var startSound = Hover.audio.getSound("LEVLSTRT");
        startSound.play();
        if (Hover.retro && this instanceof SinglePlayerGame) {
            // The 1995 game held everything still for its 40-tick (2 second) start countdown; wait
            // for the level-start sound when it is longer.
            var soundLength = startSound.el && isFinite(startSound.el.duration) ? startSound.el.duration : 0;
            this.startHold = Math.max(2, soundLength);
        }
        this.playedStart = true;
    }
};

/**
 * Added in this edition: "ibmab" typed in the start-up room. As in the 1995 game the craft can now
 * be driven around the room, and its song (MUSIC3) starts.
 */
Game.prototype.unlockDemo = function () {
    if (!this.demoLocked) {
        return;
    }
    this.demoLocked = false;
    this.clock.getDelta(); // don't count the still time as one long frame
    this.startControllers();
    Hover.audio.getSound("MUSIC").play();
};

Game.prototype.startControllers = function () {
    if (!this.controllersStarted) {
        _.each(this.craftControllers, function (controller) {
            controller.start();
        });
        this.controllersStarted = true;
    }
};

Game.prototype.stopControllers = function () {
    if (this.controllersStarted) {
        _.each(this.craftControllers, function (controller) {
            controller.stop();
        });
        this.controllersStarted = false;
    }
};

/** Stops input, empties every scene (disposing geometries, textures and materials) and stops all audio. */
Game.prototype.stop = function () {
    function clearScene(scene) {
        _.each(scene.__objects, function (object) {
            scene.remove(object);
            if (object.geometry && object.geometry.dispose) {
                object.geometry.dispose();
            }
            if (object.material && object.material.map && object.material.map.dispose) {
                object.material.map.dispose();
            }
            if (object.material && object.material.dispose) {
                object.material.dispose();
            }
        });
    }

    this.stopped = true; // this edition: see runFrame
    this.stopControllers();
    clearScene(this.scene);
    clearScene(this.sceneParticles);
    clearScene(this.bgScene);
    clearScene(this.sceneScreen);
    GeometryBatch.cleanObjects();
    GeometryBatch.cleanShaders();
    if (this.rearView) {
        this.rearView.target.dispose();
    }
    Hover.audio.stopAll();
};

Game.prototype.toggleSound = function (enabled) {
    if (this.craft) {
        this.craft.toggleSound(enabled);
    }
};

/** Tracks FPS / lowest FPS / count of sub-50 FPS frames and shows them once a second when stats are on. */
Game.prototype.handleFpsDisplay = function (delta) {
    this.timeSinceUpdate += delta;
    this.timeSinceMilliLog += delta;
    var fps = 1 / delta;
    if (fps < this.leastFps) {
        this.leastFps = fps;
    }
    if (fps < 50) {
        this.lowCount++;
    }
    if (this.timeSinceUpdate > 1) {
        if (this.fpsElement && Hover.showStats) {
            this.fpsElement.innerHTML = " FPS: " + this.frames + " Lowest FPS: " + parseInt(this.leastFps) + " Low Count: " + this.lowCount;
            if (this.world && this.world.drones.length && this.world.drones[0].state) {
                // This edition (debug view only): what each classic robot is doing, and where.
                this.fpsElement.innerHTML += " Robots: " + _.map(this.world.drones, function (drone) {
                    return drone.kind.charAt(0) + ":" + drone.state + "@" + Math.round(drone.craft.position.x) + "," +
                        Math.round(drone.craft.position.z);
                }).join(" ");
            }
        }
        this.leastFps = 1000;
        this.timeSinceUpdate = 0;
        this.frames = 0;
        this.lowCount = 0;
    }
    this.frames++;
};

/**
 * Lets the first controller that reports input drive the craft (the keyboard controller is
 * updated as a fallback), advances the world and fires onPlayerCollision on craft collisions.
 */
Game.prototype.updatePhysics = function (delta) {
    var handled = false;
    _.each(this.craftControllers, function (controller) {
        if (!handled) {
            handled = controller.update(delta, true);
        }
    });
    if (!handled) {
        this.craftControllers[0].update(delta);
    }
    this.world.update(delta);
    // This edition: single player bumps crafts together by the 1995 rules (24-classic-robots.js).
    var collision = this instanceof SinglePlayerGame && this.world.resolveCraftContactsClassic ?
        this.world.resolveCraftContactsClassic(this.craft) : this.world.simulateCollisions(this.craft);
    if (collision) {
        this.onPlayerCollision.call(this, collision);
    }
};

/** Positions light, background and cameras on the craft and renders the frame (with optional glow). */
Game.prototype.draw = function (delta) {
    var bgRadius = 1000;
    var bgCircumference = 2 * bgRadius * Math.PI;
    var bgHeight = 256 * bgCircumference / 3844;
    var shortCamera = this.shortCamera;
    var camera = this.camera;
    var rvCamera = this.rvCamera; // unused
    var craft = this.craft;
    var renderer = this.renderer; // unused
    var scene = this.scene; // unused
    var bgScene = this.bgScene; // unused
    var sceneParticles = this.sceneParticles; // unused
    var glowTarget = this.glowTarget; // unused
    var sceneScreen = this.sceneScreen; // unused
    var screenCamera = this.screenCamera; // unused
    var spotLight = this.spotLight;
    spotLight.position.x = camera.position.x;
    spotLight.position.y = camera.position.y;
    spotLight.position.z = camera.position.z;
    this.bg.position.x = camera.position.x;
    this.bg.position.z = camera.position.z;
    this.bg.position.y = camera.position.y + bgHeight / 2;
    camera.rotation.y = craft.angle;
    shortCamera.rotation.y = craft.angle;
    this.drawPart1(delta);
    shortCamera.updateMatrixWorld();
    if (!Hover.retro && Hover.settings.getHyperColorEnabled()) {
        this.drawGlow1();
    }
    this.drawPart2(delta);
    if (!Hover.retro && Hover.settings.getHyperColorEnabled()) {
        this.drawGlow2();
    }
    if (Hover.retro) {
        this.drawRearView();
    }
    Hover.Statistics.stat.end();
};

/**
 * Added in this edition: the 1995 game's rear-view mirror (Options > Customize Game > Show Rear
 * View), which replaces the "HOVER 950" plate at the top of the classic dashboard with the view
 * behind the craft, mirrored. The remake had the camera and the plate's place in its dashboard
 * (#rear_view) but never drew it. The dashboard picture covers the 3D view there, so the mirror is
 * drawn off screen and copied into a small canvas over the plate.
 */
Game.prototype.drawRearView = function () {
    var enabled = !!(Hover.classicRearView && Hover.classicRearView());
    var holder = this.getElementById("rear_view");
    if (!holder) {
        return;
    }
    if (!enabled) {
        if (this.rearViewShown) {
            holder.style.display = "none";
            this.rearViewShown = false;
        }
        return;
    }
    var width = 290,
        height = 85; // the plate's size in the 800 x 600 view (css/game.css #rear_view)
    if (!this.rearView) {
        // The mirror covers the same width of view as the windscreen.
        var tanHalfWide = Math.tan(this.dimensions.VIEW_ANGLE * Math.PI / 360) * this.dimensions.ASPECT;
        var fov = 2 * Math.atan(tanHalfWide / (width / height)) * 180 / Math.PI;
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.className = "rearViewCanvas";
        this.rearView = {
            camera: new THREE.PerspectiveCamera(fov, width / height, this.dimensions.NEAR, this.dimensions.FAR),
            target: new THREE.WebGLRenderTarget(width, height, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                stencilBuffer: false
            }),
            canvas: canvas,
            context2d: canvas.getContext("2d"),
            pixels: new Uint8Array(width * height * 4),
            image: canvas.getContext("2d").createImageData(width, height)
        };
        this.scene.add(this.rearView.camera);
        this.bgScene.add(this.rearView.camera);
    }
    if (!this.rearViewShown) {
        if (this.rearView.canvas.parentNode !== holder) {
            holder.appendChild(this.rearView.canvas);
        }
        holder.style.display = "block";
        this.rearViewShown = true;
    }
    var rear = this.rearView,
        camera = rear.camera,
        renderer = this.renderer;
    camera.position.copy(this.camera.position);
    camera.rotation.y = this.craft.angle + Math.PI;
    camera.updateMatrixWorld();
    renderer.setClearColor(0, 1);
    renderer.render(this.bgScene, camera, rear.target, true);
    this.world.draw(camera);
    Hover.sprites.draw(camera); // turn the robot and pod pictures to face the mirror
    renderer.render(this.scene, camera, rear.target);
    // Copy the picture out, upside down (WebGL rows start at the bottom) and mirrored left to right.
    var gl = renderer.getContext();
    renderer.setRenderTarget(rear.target);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rear.pixels);
    renderer.setRenderTarget(null);
    var source = rear.pixels,
        data = rear.image.data;
    for (var y = 0; y < height; y++) {
        var from = (height - 1 - y) * width * 4;
        var to = y * width * 4 + (width - 1) * 4;
        for (var x = 0; x < width; x++, from += 4, to -= 4) {
            data[to] = source[from];
            data[to + 1] = source[from + 1];
            data[to + 2] = source[from + 2];
            data[to + 3] = 255;
        }
    }
    rear.context2d.putImageData(rear.image, 0, 0);
};

/** Clears the screen, draws the background, then the world's static geometry. */
Game.prototype.drawPart1 = function (delta) {
    var shortCamera = this.shortCamera; // unused
    var camera = this.camera;
    var rvCamera = this.rvCamera; // unused
    var craft = this.craft; // unused
    var renderer = this.renderer;
    var scene = this.scene;
    var bgScene = this.bgScene;
    var sceneParticles = this.sceneParticles; // unused
    var glowTarget = this.glowTarget; // unused
    var sceneScreen = this.sceneScreen; // unused
    var screenCamera = this.screenCamera; // unused
    renderer.sortObjects = false;
    renderer.enableScissorTest(false);
    renderer.setViewport(0, 0, this.dimensions.WIDTH, this.dimensions.HEIGHT);
    renderer.setClearColor(0, 1);
    renderer.clear();
    renderer.render(bgScene, camera);
    scene.onBeforeRender.call(scene, camera);
    Hover.Statistics.stat.start("drawFront-Statics");
    this.world.draw(camera);
};

/** Draws the sprites and the dynamic scene (clipped against the short-range camera). */
Game.prototype.drawPart2 = function (delta) {
    var shortCamera = this.shortCamera;
    var camera = this.camera;
    var rvCamera = this.rvCamera; // unused
    var craft = this.craft; // unused
    var renderer = this.renderer;
    var scene = this.scene;
    var bgScene = this.bgScene; // unused
    var sceneParticles = this.sceneParticles; // unused
    var glowTarget = this.glowTarget; // unused
    var sceneScreen = this.sceneScreen; // unused
    var screenCamera = this.screenCamera; // unused
    Hover.Statistics.stat.start("drawFront-sprites");
    Hover.sprites.update(delta);
    Hover.sprites.draw(camera);
    camera.clipper = shortCamera;
    renderer.render(scene, camera);
    camera.clipper = null;
};

/**
 * Glow pass 1: renders only the glowing parts (light weight 0, non-glowing objects hidden)
 * into glowTarget.
 */
Game.prototype.drawGlow1 = function () {
    function setLightWeight(scene, weight) {
        _.each(scene.children, function (child) {
            if (child.material && child.material.uniforms && child.material.uniforms.lightWeight) {
                child.material.uniforms.lightWeight.value = weight;
            }
        });
    }

    function hideNonGlowing(scene, hide) {
        _.each(scene.children, function (child) {
            if (child.disableGlow) {
                if (hide) {
                    child.wasVisible = child.visible;
                    child.visible = false;
                } else {
                    child.visible = child.wasVisible;
                }
            }
        });
    }

    var shortCamera = this.shortCamera;
    var camera = this.camera;
    var rvCamera = this.rvCamera; // unused
    var craft = this.craft; // unused
    var renderer = this.renderer;
    var scene = this.scene;
    var bgScene = this.bgScene; // unused
    var sceneParticles = this.sceneParticles; // unused
    var blankScene = this.blankScene;
    var glowTarget = this.glowTarget;
    var sceneScreen = this.sceneScreen; // unused
    var screenCamera = this.screenCamera; // unused
    setLightWeight(scene, 0);
    hideNonGlowing(scene, true);
    renderer.setClearColor(0, 0);
    renderer.render(blankScene, camera, glowTarget, true);
    this.world.draw(camera, true);
    camera.clipper = shortCamera;
    renderer.render(scene, camera, glowTarget);
    camera.clipper = null;
    setLightWeight(scene, 1);
    hideNonGlowing(scene, false);
};

/** Glow pass 2: blends the blurred glow target over the screen. */
Game.prototype.drawGlow2 = function () {
    var shortCamera = this.shortCamera; // unused
    var camera = this.camera; // unused
    var rvCamera = this.rvCamera; // unused
    var craft = this.craft; // unused
    var renderer = this.renderer;
    var scene = this.scene; // unused
    var bgScene = this.bgScene; // unused
    var sceneParticles = this.sceneParticles; // unused
    var glowTarget = this.glowTarget; // unused
    var sceneScreen = this.sceneScreen;
    var screenCamera = this.screenCamera;
    renderer.render(sceneScreen, screenCamera);
};

/**
 * Fetches the maze, queues the extra textures (flags, particles, retro drone frames, blank maps,
 * glow textures), loads the maze's texture scheme, then calls mapLoaded and fires onReady.
 */
Game.prototype.loadMaze = function (mazeId) {
    var self = this;
    Hover.Editor.dataAccess.getMazeById(mazeId, function (mazeData) {
        var cdnFilenames = Hover.cdn.filenames; // unused
        Hover.Editor.schemeLoader.extras.push({
            Path: "/Images/flags.png", // original: "/images/flags.png" (case fixed to match the folder on disk)
            Name: "flags"
        });
        Hover.Editor.schemeLoader.extras.push({
            Path: "/Images/particle.png", // original: "/images/particle.png"
            Name: "particle"
        });
        if (Hover.retro) {
            for (var frameIndex = 0; frameIndex <= 32; frameIndex++) {
                var frameNumber = "" + frameIndex;
                if (frameIndex < 10) {
                    frameNumber = "0" + frameNumber;
                }
                Hover.Editor.schemeLoader.extras.push({
                    Path: "/Images/Schemes/MAZE1/DRONE_" + frameNumber + "_RED.png", // original: ".../Maze1/..."
                    Name: "DRONE_" + frameNumber + "_RED"
                });
            }
        }
        Hover.Editor.schemeLoader.extras.push({
            Path: "Images/BlankNormal.png",
            Name: "BlankNormal"
        });
        Hover.Editor.schemeLoader.extras.push({
            Path: "Images/BlankEmissive.png",
            Name: "BlankEmissive"
        });
        if (!Hover.retro) {
            var glowTextures = ["Flag_B_Blue", "Flag_B_Red", "Hover_A_BLUE", "Hover_A_BOT", "Hover_A_RED", "Hover_A_YELLOW", "Hover_B_BLUE", "Hover_B_RED", "Hover_C_BLUE", "Hover_C_RED", "Hover_C_YELLOW", "Question_Mark_A", "Radar_A", "Shield_A", "Shield_B", "Shield_C", "Shield_D", "Signa_B_GREEN", "Signal_B_RED", "Spring", "Wall_B"];
            for (var glowName in glowTextures) {
                glowName = glowTextures[glowName] + "_GLOW";
                Hover.Editor.schemeLoader.extras.push({
                    Path: "3d/Textures/" + glowName + "_QUARTER.png",
                    Name: glowName
                });
            }
        }
        Hover.Editor.schemeLoader.loadSchemeByName(mazeData.Scheme, function () {
            self.mapLoaded(mazeData);
            self.onReady.call(self, mazeData);
        });
    });
};

SinglePlayerGame.prototype = Object.create(Game.prototype);

SinglePlayerGame.prototype.load = function () {
    this.loadMaze(this.mazeId);
};

SinglePlayerGame.prototype.mazeLoadComplete = function () {
    if (this.carriedItems) {
        // This edition: start with the springs, walls and cloaks left unused on the level before.
        this.craft.springCount = Math.min(9, this.carriedItems.springs || 0);
        this.craft.wallCount = Math.min(9, this.carriedItems.walls || 0);
        this.craft.cloakCount = Math.min(9, this.carriedItems.cloaks || 0);
    }
    if (this.demo) {
        return; // the start-up room has no robots, flags or pods
    }
    if (Hover.retro) {
        this.spawnClassicLevel();
        return;
    }
    this.spawnDrones();
    this.spawnFlags();
    this.world.spawnPods();
};

/**
 * Spawns flag-hunting drones and drones that attack the player, at random robot start spots (more
 * with higher levels, at most 6 of each).
 *
 * This edition: the drones think and bump by the 1995 robot rules, like classic mode's robots
 * (24-classic-robots.js), keeping the modern drone models and handling; how far an attacker can see
 * and how far ahead drones plan follow the craft the player chose (Easy, Normal, Hard). The remake
 * gave all drones of one kind a single shared craft and followed a fixed tour of every beacon.
 */
SinglePlayerGame.prototype.spawnDrones = function () {
    var world = this.world,
        scene = this.scene,
        player = this.craft,
        difficulty = Profiles.modernDifficultyOf(this.craftProfile);
    var spots = _.shuffle(world.droneLocations);
    var flagHunterCount = Math.min(6, Math.floor(this.level / 3 + 1));
    var attackerCount = Math.min(6, Math.floor(this.level / 3 + 0.5));
    function spawn(count, kind) {
        for (var i = 0; i < count && spots.length; i++) {
            var spot = spots.shift();
            var craft = new ModelCraft(scene, world, new THREE.Vector3(spot.X, spot.Y, spot.Z), Math.random() * 2 * Math.PI,
                "blue", Profiles.Drone);
            world.addDrone(new Hover.ClassicRobotController(craft, world, player, kind, difficulty));
        }
    }
    spawn(flagHunterCount, "hunter");
    spawn(attackerCount, "attacker");
};

/**
 * Added in this edition: how the 1995 game set up each level, read from the original HOVER.EXE
 * (level table at 0x4c4000, level start code 0x415d08-0x417506, placement 0x412250). The remake's
 * own formulas made classic mode easier than the original: no attacking robot on levels 1 and 2,
 * robots always starting at the same spots, and a pod at every pod spot.
 *
 * Per level: [attacker robots, flag-hunter robots, flags per team]. From level 17 on, the last three
 * rows repeat.
 */
var CLASSIC_LEVELS = [
    [1, 1, 3], [1, 1, 3], [1, 1, 3], [2, 1, 4], [2, 2, 4], [2, 2, 5], [3, 2, 5], [3, 2, 6], [3, 3, 6],
    [4, 3, 6], [4, 3, 6], [4, 3, 6], [5, 4, 6], [5, 4, 6], [5, 4, 6], [6, 4, 6], [6, 4, 6], [6, 4, 6]
];

/** The 1995 "spot taken" distance: nothing is placed within 80 units of something already placed. */
var CLASSIC_SPOT_CLEARANCE = 80;

/**
 * Classic mode: sets up the level as the 1995 game did, in its order (the player is already placed):
 * attacking robots, then flag hunters, each at a random free robot spot; 4 pods of each of the 7
 * kinds at random free pod spots, a quarter of them disguised as "?"; then the player's flags and
 * the robots' flags, each at a random free spot of its team's own list.
 */
SinglePlayerGame.prototype.spawnClassicLevel = function () {
    var world = this.world,
        scene = this.scene;
    var index = Math.max(0, (this.level || 1) - 1);
    if (index >= 16) {
        index = 15 + index % 3;
    }
    var row = CLASSIC_LEVELS[index];
    var taken = [{
        X: this.camera.position.x,
        Z: this.camera.position.z
    }];

    function pickFreeSpot(spots) {
        for (var tries = 0; tries < 200 && spots.length; tries++) {
            var spot = spots[Math.floor(Math.random() * spots.length)];
            var isFree = !_.some(taken, function (other) {
                var dx = other.X - spot.X,
                    dz = other.Z - spot.Z;
                return dx * dx + dz * dz < CLASSIC_SPOT_CLEARANCE * CLASSIC_SPOT_CLEARANCE;
            });
            if (isFree) {
                taken.push(spot);
                return spot;
            }
        }
        return null; // the maze is full (the 1995 game would have kept trying forever)
    }

    // Each robot has its own craft (the remake gave all robots of one kind a single shared craft, so
    // two attackers were really one, moved twice a frame) with the 1995 robot handling for the
    // difficulty, and the 1995 robot behaviour (24-classic-robots.js).
    var robotProfile = Profiles.classicRobotFor(this.craftProfile),
        difficulty = Profiles.classicDifficultyOf(this.craftProfile),
        player = this.craft;

    function spawnRobots(count, kind) {
        for (var i = 0; i < count; i++) {
            var spot = pickFreeSpot(world.droneLocations);
            if (!spot) {
                return;
            }
            var robotCraft = new SpriteCraft(scene, world, new THREE.Vector3(spot.X, spot.Y, spot.Z),
                Math.random() * 2 * Math.PI, "blue", robotProfile);
            world.addDrone(new Hover.ClassicRobotController(robotCraft, world, player, kind, difficulty));
        }
    }

    // When the server keeps the high scores, it decides where the flags go (so it can check the
    // captures it is told about; see server/highscores.go). They are placed first here so the
    // robots and pods keep clear of them.
    var flagPlan = Hover.classicFlagPlan ? Hover.classicFlagPlan(this.mazeId) : null;
    if (flagPlan) {
        var flagSpots = world.getFlagLocations();
        _.each(flagPlan.red.concat(flagPlan.blue), function (index) {
            if (flagSpots[index]) {
                taken.push(flagSpots[index]);
                world.spawnFlag(flagSpots[index]);
            }
        });
    }

    spawnRobots(row[0], "attacker");
    spawnRobots(row[1], "hunter");

    // World.spawnPod kinds: 1 speed, 2 slow, 3 map eraser (radar), 4 invincible (shield), 5 jump
    // (spring), 6 smoke bomb (cloak), 7 temporary wall; 8 is the "?" pod.
    for (var kind = 1; kind <= 7; kind++) {
        for (var n = 0; n < 4; n++) {
            var podSpot = pickFreeSpot(world.podLocations);
            if (podSpot) {
                world.spawnPod(podSpot, Math.random() < 0.25 ? 8 : kind);
            }
        }
    }

    _.each(flagPlan ? [] : ["RED", "BLUE"], function (team) {
        var teamSpots = _.filter(world.getFlagLocations(), function (location) {
            return location.Team == team;
        });
        for (var i = 0; i < row[2]; i++) {
            var flagSpot = pickFreeSpot(teamSpots);
            if (flagSpot) {
                world.spawnFlag(flagSpot);
            }
        }
    });
};

/** Spawns a random selection of RED and BLUE flags (3..6 per team, growing with the level). */
SinglePlayerGame.prototype.spawnFlags = function () {
    function pickFlags(team) {
        return _.chain(flagLocations).filter(function (location) {
            return location.Team == team;
        }).sortBy(function () {
            return Math.random();
        }).take(flagsPerTeam).value();
    }

    var self = this;
    var flagsPerTeam = Math.min(6, Math.floor(this.level / 3 + 3));
    var flagLocations = self.world.getFlagLocations();
    _.each(_.union(pickFlags("RED"), pickFlags("BLUE")), function (location) {
        self.world.spawnFlag(location);
    });
};

/**
 * Craft handling profiles (implicit global in the original, also exposed as Hover.Profiles).
 * Values are the original game's fixed-point constants converted to floats.
 */
Profiles = {
    Easy: {
        id: 0,
        turnSpeed: 393216 * Math.PI / 16777215,
        turnDrag: 13107,
        acceleration: 90112 / 65535,
        drag: 3275,
        maxSpeed: 3276800 / 65535,
        modelName: "Drone_Model_1"
    },
    Normal: {
        id: 1,
        turnSpeed: 458752 * Math.PI / 16777215,
        turnDrag: 19660,
        acceleration: 196608 / 65535,
        drag: 654,
        maxSpeed: 4259840 / 65535,
        modelName: "Drone_Model_2"
    },
    Hard: {
        id: 2,
        turnSpeed: 983040 * Math.PI / 16777215,
        turnDrag: 26214,
        acceleration: 327680 / 65535,
        drag: 64,
        maxSpeed: 4915200 / 65535,
        modelName: "Drone_Model_3"
    },
    Drone: {
        id: 3,
        turnSpeed: 327680 * Math.PI / 16777215,
        turnDrag: 13107,
        acceleration: 65536 / 65535,
        drag: 3275,
        maxSpeed: 3276800 / 65535,
        modelName: "Drone_Model_3"
    },
    // Added in this edition: the 1995 game's own handling, used in classic (retro) mode. Read from
    // HOVER.EXE's parameter tables (Beginner difficulty player, "HBegParams"), all 16.16 fixed point at 20 ticks per second like the profiles above.
    // `classic` switches on the 1995 movement rules in Craft (03-craft.js): turn drag every tick,
    // sideways grip ("traction"), the stop snap, and the 1995 speed-pod multipliers.
    Classic: {
        id: 4,
        classic: true,
        turnSpeed: 327680 * Math.PI / 16777215, // 5.0 of 512 per circle per tick
        turnDrag: 13107,                        // 0.2: turn rate loses 20% every tick
        acceleration: 65536 / 65535,            // 1.0 per tick per tick
        drag: 3276,                             // 0.05 while coasting
        maxSpeed: 3276800 / 65535,              // 50 per tick
        traction: 0.1,                          // velocity pulled 10% toward the nose every tick
        fastPodMultiplier: 1.33,
        slowPodMultiplier: 0.66,
        modelName: "Drone_Model_1"
    },
    // The 1995 game's other two difficulty levels ("HIntParams", "HExpParams"); classic mode uses
    // them from the #retro/intermediate and #retro/expert addresses (added in this edition).
    ClassicIntermediate: {
        id: 6,
        classic: true,
        turnSpeed: 458752 * Math.PI / 16777215, // 7.0
        turnDrag: 19660,                        // 0.3
        acceleration: 196608 / 65535,           // 3.0
        drag: 655,                              // 0.01
        maxSpeed: 4259840 / 65535,              // 65
        traction: 0.025,
        fastPodMultiplier: 1.33,
        slowPodMultiplier: 0.5,
        modelName: "Drone_Model_2"
    },
    ClassicExpert: {
        id: 7,
        classic: true,
        turnSpeed: 983040 * Math.PI / 16777215, // 15.0
        turnDrag: 26214,                        // 0.4
        acceleration: 327680 / 65535,           // 5.0
        drag: 65,                               // 0.001
        maxSpeed: 4915200 / 65535,              // 75
        traction: 0.01,
        fastPodMultiplier: 1.33,
        slowPodMultiplier: 0.4,
        modelName: "Drone_Model_3"
    },
    /** Classic-mode profile for a 1995 difficulty name (added in this edition; Beginner by default). */
    classicFor: function (difficulty) {
        switch ((difficulty || "").toLowerCase()) {
            case "intermediate":
                return Profiles.ClassicIntermediate;
            case "expert":
                return Profiles.ClassicExpert;
            default:
                return Profiles.Classic;
        }
    },
    StatsMax: {
        turnSpeed: Math.PI,
        turnDrag: 28672,
        acceleration: 393216 / 65535,
        drag: 4000,
        maxSpeed: 5242880 / 65535
    },
    /** Returns [speed, acceleration, drag, turnDrag] as 0.1..0.9 ratios of StatsMax (for stat bars). */
    getStats: function (profile) {
        var max = Profiles.StatsMax;
        var speedRatio = profile.maxSpeed / max.maxSpeed;
        var accelerationRatio = profile.acceleration / max.acceleration;
        var dragRatio = profile.drag / max.drag;
        var turnDragRatio = profile.turnDrag / max.turnDrag;
        return [roundToTenthClamped(speedRatio), roundToTenthClamped(accelerationRatio), roundToTenthClamped(dragRatio), roundToTenthClamped(turnDragRatio)];
    },
    /** Profile by numeric id (falls back to Easy). */
    fromId: function (id) {
        switch (id) {
            case Profiles.Easy.id:
                return Profiles.Easy;
            case Profiles.Normal.id:
                return Profiles.Normal;
            case Profiles.Hard.id:
                return Profiles.Hard;
            case Profiles.Drone.id:
                return Profiles.Drone;
            case Profiles.Classic.id: // added in this edition
                return Profiles.Classic;
            case Profiles.ClassicIntermediate.id:
                return Profiles.ClassicIntermediate;
            case Profiles.ClassicExpert.id:
                return Profiles.ClassicExpert;
            default:
                return Profiles.Easy;
        }
    }
};
Hover.Profiles = Profiles;
