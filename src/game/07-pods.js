// Original: game.js lines 350-431, 1611-1642
//
// Pods are the power-ups lying around the maze. Driving through one calls
// onHit(craft) and the pod is removed. In retro mode a pod is a RetroSprite
// billboard; otherwise it is a spinning 3D model.

/**
 * Power-up base class.
 * @param {Object} options  { map, location, scene, tex (retro sprite group), modelName (3D model) }
 */
function Pod(options) {
    var mapData = options.map;
    var location = options.location;
    this.afterHit = new Signal();
    if (Hover.retro) {
        var spriteName = options.tex;
        // Borrow the sprite methods and initialise as a RetroSprite.
        this.update = RetroSprite.prototype.update;
        this.getTexture = RetroSprite.prototype.getTexture;
        this.remove = RetroSprite.prototype.remove;
        if (!spriteName) {
            spriteName = "POD06";
        }
        RetroSprite.call(this, mapData, new THREE.Vector3(location.x, location.y, location.z), 64, spriteName);
    } else {
        this.scene = options.scene;
        this.location = new THREE.Vector3(location.x, 20, location.z);
        var model = Hover.Editor.schemeLoader.models[options.modelName];
        var material = createEmissiveMaterial(model.diffuseTexture);
        var mesh = new THREE.Mesh(model.geometry, material);
        mesh.position = this.location;
        this.mesh = mesh;
        this.scene.add(mesh);
        this.update = function (dt) {
            this.mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), 5 * dt);
        };
        this.remove = function () {
            this.scene.remove(this.mesh);
        };
    }
}

/** Speed-modifier pod: multiplies the craft's speed by `multiplier` for 20 seconds. */
function SignalPod(options) {
    Pod.call(this, options);
    this.multiplier = options.multiplier;
}

/** Speed-up pod (x1.5). */
function FastSignalPod(options) {
    _.extend(options, {
        multiplier: 1.5,
        tex: "POD02",
        modelName: "FastSignalPod"
    });
    SignalPod.call(this, options);
}

/** Slow-down pod (x0.5). */
function SlowSignalPod(options) {
    _.extend(options, {
        multiplier: .5,
        tex: "POD03",
        modelName: "SlowSignalPod"
    });
    SignalPod.call(this, options);
}

/** Map-eraser pod: clears the craft's radar walls. */
function RadarPod(options) {
    _.extend(options, {
        tex: "POD05",
        modelName: "RadarPod"
    });
    Pod.call(this, options);
}

/** Shield pod: makes the craft invulnerable for 20 seconds. */
function ShieldPod(options) {
    _.extend(options, {
        tex: "POD04",
        modelName: "ShieldPod"
    });
    Pod.call(this, options);
}

/** Spring pod: gives the craft a jump. */
function SpringPod(options) {
    _.extend(options, {
        tex: "POD01",
        modelName: "SpringPod"
    });
    Pod.call(this, options);
}

/** Cloak pod: gives the craft a cloak. Its model is smaller and spins slower. */
function CloakPod(options) {
    _.extend(options, {
        tex: "POD00",
        modelName: "CloakPod"
    });
    Pod.call(this, options);
    if (!Hover.retro) {
        this.mesh.scale.set(.6, .6, .6);
        this.update = function (dt) {
            this.mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), 2.5 * dt);
        };
    }
}

/** Wall pod: gives the craft a placeable wall. */
function WallPod(options) {
    _.extend(options, {
        tex: "POD07",
        modelName: "WallPod"
    });
    Pod.call(this, options);
}

/** Question-mark pod: applies a random other pod's effect. */
function QuestionMarkPod(options) {
    _.extend(options, {
        tex: "POD06",
        modelName: "QuestionMarkPod"
    });
    Pod.call(this, options);
}

// Shared scratch vectors (set in the original right before the pod prototypes).
Hover.tempVector3 = new THREE.Vector3();
Hover.tempVector2 = new THREE.Vector2();

/** Plays the pod's sound and fires afterHit. */
Pod.prototype.onHit = function (craft) {
    Hover.audio.getSound(this.sound).play();
    this.afterHit.call(this);
};

Pod.prototype.sound = "HIT_POD";

/**
 * Added in this edition: a harmful pod (slow-down, map eraser) driven through while the shield is
 * on does nothing, so it is taken without its sound or message (the remake played them anyway).
 */
function pickUpSilently(pod) {
    pod.afterHit.call(pod);
}

SignalPod.prototype = Object.create(Pod.prototype);

SignalPod.prototype.onHit = function (craft) {
    if (this.multiplier < 1 && craft.isProtected()) {
        pickUpSilently(this);
        return;
    }
    if (Hover.messageView) {
        if (this.multiplier > 1) {
            var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_FASTPOD);
            if (!shown) {
                if (Hover.messageView.showMessage(Hover.messageTypes.HIT_FASTPOD)) {
                    Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_FASTPOD, true);
                }
            }
        } else {
            var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_SLOWPOD);
            if (!shown) {
                if (Hover.messageView.showMessage(Hover.messageTypes.HIT_SLOWPOD)) {
                    Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_SLOWPOD, true);
                }
            }
        }
    }
    var multiplier = this.multiplier;
    if (craft.profile && craft.profile.classic) {
        // This edition: classic mode uses the 1995 game's speed-pod strengths (x1.33 / x0.66).
        multiplier = multiplier > 1 ? craft.profile.fastPodMultiplier : craft.profile.slowPodMultiplier;
    }
    craft.applySpeedModifier(multiplier, 20);
    Pod.prototype.onHit.call(this);
};

FastSignalPod.prototype = Object.create(SignalPod.prototype);
SlowSignalPod.prototype = Object.create(SignalPod.prototype);
FastSignalPod.prototype = Object.create(SignalPod.prototype);
SlowSignalPod.prototype.sound = "SPEED_RE";
FastSignalPod.prototype.sound = "SPEED_EN";

RadarPod.prototype = Object.create(Pod.prototype);
RadarPod.prototype.sound = "HIT_MAPE";

RadarPod.prototype.onHit = function (craft) {
    if (craft.isProtected()) {
        pickUpSilently(this);
        return;
    }
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_MAPERASER);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_MAPERASER)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_MAPERASER, true);
    }
    craft.resetRadarWalls();
    Pod.prototype.onHit.call(this);
};

ShieldPod.prototype = Object.create(Pod.prototype);
ShieldPod.prototype.sound = "INVIN_ST";

ShieldPod.prototype.onHit = function (craft) {
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_SHIELD);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_SHIELD)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_SHIELD, true);
    }
    craft.applyProtection(20);
    Hover.audio.getSound(this.sound).play();
    this.afterHit.call(this);
};

SpringPod.prototype = Object.create(Pod.prototype);
SpringPod.prototype.sound = "OBT_JUMP";

SpringPod.prototype.onHit = function (craft) {
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_SPRING);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_SPRING)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_SPRING, true);
    }
    craft.addSpring();
    Pod.prototype.onHit.call(this);
};

CloakPod.prototype = Object.create(Pod.prototype);
CloakPod.prototype.sound = "OBT_CLOA";

CloakPod.prototype.onHit = function (craft) {
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_CLOAK);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_CLOAK)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_CLOAK, true);
    }
    craft.addCloak();
    Pod.prototype.onHit.call(this);
};

WallPod.prototype = Object.create(Pod.prototype);
WallPod.prototype.sound = "OBT_WALL";

WallPod.prototype.onHit = function (craft) {
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_WALL);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_WALL)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_WALL, true);
    }
    craft.addWall();
    Pod.prototype.onHit.call(this);
};

QuestionMarkPod.prototype = Object.create(Pod.prototype);

/** Picks one of the seven other pod effects at random (borrowing its sound). */
QuestionMarkPod.prototype.onHit = function (craft) {
    var shown = Hover.settings.getPickupMessageShown(Hover.messageTypes.HIT_RANDOM);
    if (Hover.messageView && !shown && Hover.messageView.showMessage(Hover.messageTypes.HIT_RANDOM)) {
        Hover.settings.setPickupMessageShown(Hover.messageTypes.HIT_RANDOM, true);
    }
    var roll = Math.random();
    if (roll < 1 / 7) {
        this.sound = CloakPod.prototype.sound;
        CloakPod.prototype.onHit.call(this, craft);
    } else if (roll < 2 / 7) {
        this.sound = SpringPod.prototype.sound;
        SpringPod.prototype.onHit.call(this, craft);
    } else if (roll < 3 / 7) {
        this.multiplier = 1.5;
        this.sound = FastSignalPod.prototype.sound;
        SignalPod.prototype.onHit.call(this, craft);
    } else if (roll < 4 / 7) {
        this.multiplier = .5;
        this.sound = SlowSignalPod.prototype.sound;
        SignalPod.prototype.onHit.call(this, craft);
    } else if (roll < 5 / 7) {
        this.sound = ShieldPod.prototype.sound;
        ShieldPod.prototype.onHit.call(this, craft);
    } else if (roll < 6 / 7) {
        this.sound = RadarPod.prototype.sound;
        RadarPod.prototype.onHit.call(this, craft);
    } else {
        this.sound = WallPod.prototype.sound;
        WallPod.prototype.onHit.call(this, craft);
    }
};
