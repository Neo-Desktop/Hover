// Hover! — AI drone / network craft controllers, generic graph, player input controllers, view dimensions.
// Original: game.js lines 178-186, 224-265, 962-1021, 1044-1083, 1375-1498

/**
 * AI controller for a drone craft: steers the craft along a path of beacons taken from
 * the world's beacon graph, optionally diverting to an "attack point" supplied by subclasses
 * (see getTargetPos / alwaysCalculateTarget, overridden by FlagHunterController and AttackController).
 */
function DroneController(craft, scene, world) {
    this.craft = craft;
    this.craft.color = "#0000FF";
    this.scene = scene;
    this.world = world;
    this.map = world.map;
    this.path = world.beaconGraph.getUniquePath(craft.position);
    this.pathPos = 0;
    this.findBeaconT = 1000;
    this.debugs = [];
    this.attackPoint = null;
    this.addDebugs();
}

/**
 * Drives a craft from network state updates. A hidden "actual" craft is simulated with the
 * latest server state and the visible craft is blended towards it while `error` decays.
 */
function RemoteCraftController(craft) {
    this.craft = craft;
    this.turn = 0;
    this.accel = 0;
    this.error = 0;
    this.actualCraft = new Craft(craft.world, craft.position.clone(), craft.angle, craft.team, craft.profile);
}

/** A node in a Graph, holding its outgoing edges keyed by the target node's key. */
function GraphNode(node) {
    this.node = node;
    this.edges = {};
}

/** A directed graph of nodes (anything with getKey()) and edges (anything with getA()/getB()). */
function Graph() {
    this.nodes = {};
}

/**
 * Base class for player input: holds the current button/axis state and applies it to the craft
 * on update.
 */
function InputController(craft) {
    this.craft = craft;
    this.forward = false;
    this.reverse = false;
    this.left = false;
    this.right = false;
    this.hudZoomIn = false;
    this.hudZoomOut = false;
    this.jump = false;
    this.placeWall = false;
    this.cloak = false;
    this.fire = false;
}

/** Keyboard input: arrow keys steer, A/S/D = jump/wall/cloak, space fires, +/- zoom the radar. */
function KeyboardController(element, craft) {
    InputController.call(this, craft);
    this.listeners = {
        keydown: _.bind(function (event) {
            this.onKey(event, true);
            event.preventDefault();
        }, this),
        keyup: _.bind(function (event) {
            this.onKey(event, false);
            event.preventDefault();
        }, this)
    };
}

/** Touch input: an on-screen d-pad (analog stick) plus jump/wall/cloak and radar zoom buttons. */
function TouchController(container, craft) {
    InputController.call(this, craft);
    var $container = $(container);
    this.$dpad = $container.find("#dpad");
    this.$dpadInput = $container.find("#dpadInput");
    this.$dpadStick = $container.find("#dpadStick");
    this.dpadPointers = 0;
    this.centerX = 0;
    this.centerY = 0;
    this.dpadListeners = {
        pxpointerstart: _.bind(this.dpadStart, this),
        pxpointermove: _.bind(this.dpadMove, this),
        pxpointerend: _.bind(this.dpadEnd, this)
    };
    this.$gameButtons = $container.find("#gameButtons");
    this.$jumpButton = $container.find("#jumpButton");
    this.$wallButton = $container.find("#wallButton");
    this.$cloakButton = $container.find("#cloakButton");
    this.$hudButtons = $container.find("#hudButtons");
    this.$zoomInButton = $container.find("#zoomInButton");
    this.$zoomOutButton = $container.find("#zoomOutButton");
}

/** Gamepad input (Gamepad API, with the old webkit-prefixed fallback). */
function GamepadController(element, craft) {
    InputController.call(this, craft);
    this.downButtons = [];
    this.connectedGamepad = null;
}

/** Whether button `buttonIndex` of `gamepad` is pressed (handles both object and numeric button states). */
function isGamepadButtonPressed(gamepad, buttonIndex) {
    if (!gamepad || !gamepad.buttons || buttonIndex >= gamepad.buttons.length) {
        return false;
    }
    var button = gamepad.buttons[buttonIndex];
    return button ? (typeof button == "object" ? button.pressed : 1 === button) : false;
}

// ---------------------------------------------------------------------------------------------
// DroneController
// ---------------------------------------------------------------------------------------------

/** Adds debug lines: one for the craft, and one per segment of the beacon path. */
DroneController.prototype.addDebugs = function () {
    this.debugs.push(new DebugLine(this, {
        color: 16711680
    }));
    var self = this;
    for (var i = 0; i < this.path.length - 1; i++) {
        (function () {
            var index = i;
            self.debugs.push(new DebugLine(self, {
                color: 16776960,
                getPosSrc: function () {
                    return self.path[index].clone().add(new THREE.Vector3(0, 25, 0));
                },
                getPos: function () {
                    return self.path[index + 1].clone().add(new THREE.Vector3(0, 25, 0));
                }
            }));
        })();
    }
};

/** Position to divert to instead of the next beacon (none for a plain drone). */
DroneController.prototype.getTargetPos = function () {
    return null;
};

/** Whether the target position is recomputed every update. */
DroneController.prototype.alwaysCalculateTarget = function () {
    return false;
};

/** Distance within which the attack point counts as reached. */
DroneController.prototype.getTargetRadius = function () {
    return 192;
};

/** Whether the drone eases off the engine when close to its target. */
DroneController.prototype.slowNearTarget = function () {
    return true;
};

/** Picks a target (attack point or next beacon) and steers the craft towards it. */
DroneController.prototype.update = function (delta) {
    var target = null;
    var slowDown = true;
    if (this.alwaysCalculateTarget()) {
        this.attackPoint = this.getTargetPos();
    }
    if (this.attackPoint != null) {
        target = this.attackPoint;
        if (this.attackPoint.clone().sub(this.craft.position).length() < this.getTargetRadius()) {
            this.attackPoint = null;
        }
        slowDown = this.slowNearTarget();
    }
    if (this.attackPoint == null) {
        if (this.nextBeaconDistance() < 500) {
            this.attackPoint = this.getTargetPos();
            if (this.attackPoint == null) {
                this.pathPos++;
                if (this.pathPos == this.path.length - 1) {
                    this.path = this.world.beaconGraph.getUniquePath(this.craft.position);
                    this.pathPos = 0;
                }
            }
        }
        target = this.path[this.pathPos];
    }
    target = target.clone();
    target.y = this.craft.position.y;

    var forwardX = -Math.sin(this.craft.angle),
        forwardY = 0,
        forwardZ = -Math.cos(this.craft.angle),
        toTarget = Hover.tempVector3.subVectors(target, this.craft.position),
        dx = toTarget.x,
        dz = toTarget.z,
        distance = toTarget.length();
    Math.atan2(-dx, dz) + Math.PI / 2; // unused (left over in the original)
    // Aim relative to where the craft will be shortly (position + 0.35 s of velocity).
    target.sub(toTarget.copy(this.craft.velocity).multiplyScalar(0.35).add(this.craft.position));
    var side = pointToLineDistance(forwardX, forwardY, forwardZ, target.x, target.y, target.z),
        accel = 0;
    if (Math.abs(side) < 0.1) {
        accel = 1;
    }
    this.craft.velocity.length();
    if (slowDown && side < 0.1 && distance / this.craft.velocity.length() < 1.5) {
        accel = "";
    }
    var turn = "";
    if (side < -0.01) {
        turn = 1;
    } else if (side > 0.01) {
        turn = -1;
    }
    this.craft.update(delta, turn, accel);
};

/** Distance from the craft to the current beacon on its path. */
DroneController.prototype.nextBeaconDistance = function () {
    var beacon = this.path[this.pathPos];
    return this.craft.position.clone().sub(beacon).length();
};

// ---------------------------------------------------------------------------------------------
// RemoteCraftController
// ---------------------------------------------------------------------------------------------

/** Simulates the actual craft and moves the visible craft, blending out any position error. */
RemoteCraftController.prototype.update = function (delta) {
    this.actualCraft.update(delta, this.turn, this.accel);
    if (this.error > 0) {
        var originalPosition = this.craft.position.clone();
        this.craft.position = this.craft.position.clone().multiplyScalar(1 - this.error).add(this.actualCraft.position.clone().multiplyScalar(this.error));
        var blendedPosition = this.craft.position.clone();
        this.craft.update(delta, this.turn, this.accel);
        var movement = this.craft.position.clone().sub(blendedPosition);
        this.craft.position = originalPosition;
        this.craft.position.add(movement);
        this.error -= delta;
    } else {
        this.craft.update(delta, this.turn, this.accel);
    }
};

/** Applies a craft state received from the server. Snaps if more than 512 units off. */
RemoteCraftController.prototype.captureState = function (state) {
    this.turn = state.TurnState;
    this.accel = state.EngineState;
    this.actualCraft.angle = state.AngleY;
    this.actualCraft.position.copy(state.Position);
    this.actualCraft.velocity.copy(state.Velocity);
    this.actualCraft.protectionTime = this.craft.protectionTime = state.ProtectionTime;
    this.actualCraft.maxSpeedModifier = this.craft.maxSpeedModifier = state.MaxSpeedModifier;
    this.actualCraft.maxSpeedModifierTime = this.craft.maxSpeedModifierTime = state.MaxSpeedModifierTime;
    this.actualCraft.cloakTime = this.craft.cloakTime = state.CloakTime;
    this.actualCraft.disabledTime = this.craft.disabledTime = state.DisabledTime;
    this.actualCraft.health = this.craft.health = state.Health;
    this.craft.velocity.copy(state.Velocity);
    this.craft.angle = state.AngleY;
    var drift = this.actualCraft.position.clone().sub(this.craft.position).length();
    if (drift > 512) {
        this.error = 0;
        this.craft.position.copy(this.actualCraft.position);
    } else {
        this.error = drift / 512;
    }
};

// ---------------------------------------------------------------------------------------------
// GraphNode / Graph
// ---------------------------------------------------------------------------------------------

GraphNode.prototype.getNode = function () {
    return this.node;
};

GraphNode.prototype.addEdge = function (targetNode, edge) {
    this.edges[targetNode.getKey()] = edge;
};

GraphNode.prototype.getEdges = function () {
    var edges = [];
    for (var key in this.edges) {
        edges.push(this.edges[key]);
    }
    return edges;
};

GraphNode.prototype.clone = function () {
    var copy = new GraphNode(this.node.clone());
    for (var key in this.edges) {
        copy.edges[key] = this.edges[key].clone();
    }
    return copy;
};

Graph.prototype.clone = function () {
    var copy = new Graph();
    for (var key in this.nodes) {
        copy.nodes[key] = this.nodes[key].clone();
    }
    return copy;
};

Graph.prototype.addNode = function (node) {
    var key = node.getKey();
    if (this.nodes[key]) {
        throw "Node '" + key + "' already exists";
    }
    this.nodes[key] = new GraphNode(node);
};

/** Only validates that the node exists; does not actually remove it (as in the original). */
Graph.prototype.removeNode = function (node) {
    var key = node.getKey();
    if (!this.nodes[key]) {
        throw "Node '" + key + "' does not exist";
    }
};

Graph.prototype.hasNode = function (node) {
    var key = node.getKey();
    return !!this.nodes[key];
};

Graph.prototype.getNodeInternal = function (node) {
    var key = node.getKey();
    return this.nodes[key];
};

Graph.prototype.getNode = function (node) {
    return this.getNodeInternal(node).node;
};

Graph.prototype.addEdge = function (edge) {
    this.getNodeInternal(edge.getA()).addEdge(edge.getB(), edge);
};

Graph.prototype.getNodes = function () {
    var nodes = [];
    for (var key in this.nodes) {
        nodes.push(this.nodes[key].node);
    }
    return nodes;
};

Graph.prototype.getEdges = function (node) {
    return this.getNodeInternal(node).getEdges();
};

// (Original lines 1084-1375: the HUD modules — see 05-hud.js.)

// ---------------------------------------------------------------------------------------------
// InputController
// ---------------------------------------------------------------------------------------------

/**
 * Applies the input state to the craft. Analog `engine`/`turn` values (touch/gamepad) are
 * overridden by the digital direction flags. When `skipWhenIdle` is set and there is no
 * steering input, the craft is not updated. Returns whether there was any steering input.
 */
InputController.prototype.update = function (delta, skipWhenIdle) {
    var engine = this.engine || 0;
    var turn = this.turn || 0;
    if (this.forward) {
        engine = 1;
    } else if (this.reverse) {
        engine = -1;
    }
    if (this.left) {
        turn = -1;
    } else if (this.right) {
        turn = 1;
    }
    if (this.hudZoomIn) {
        this.craft.hud.zoomIn(delta);
    } else if (this.hudZoomOut) {
        this.craft.hud.zoomOut(delta);
    }
    if (this.jump) {
        this.craft.jump();
        this.jump = false;
    }
    if (this.placeWall) {
        this.craft.placeWall();
        this.placeWall = false;
    }
    if (this.cloak) {
        this.craft.cloak();
        this.cloak = false;
    }
    if (!(skipWhenIdle && 0 === engine && 0 === turn)) {
        this.craft.update(delta, turn, engine);
    }
    if (this.fire) {
        this.craft.fire();
    }
    return 0 !== engine || 0 !== turn;
};

// ---------------------------------------------------------------------------------------------
// KeyboardController
// ---------------------------------------------------------------------------------------------

KeyboardController.prototype = Object.create(InputController.prototype);

KeyboardController.prototype.start = function () {
    $(window).on(this.listeners);
};

KeyboardController.prototype.stop = function () {
    $(window).off(this.listeners);
};

KeyboardController.prototype.onKey = function (event, isDown) {
    switch (event.keyCode) {
        case 38: // up
            this.forward = isDown;
            break;
        case 40: // down
            this.reverse = isDown;
            break;
        case 37: // left
            this.left = isDown;
            break;
        case 39: // right
            this.right = isDown;
            break;
        case 187: // = / +
            this.hudZoomIn = isDown;
            break;
        case 189: // -
            this.hudZoomOut = isDown;
            break;
        case 32: // space
            this.fire = isDown;
            break;
        case 65: // A
            this.jump = isDown;
            break;
        case 83: // S
            this.placeWall = isDown;
            break;
        case 68: // D
            this.cloak = isDown;
    }
};

// ---------------------------------------------------------------------------------------------
// TouchController
// ---------------------------------------------------------------------------------------------

TouchController.prototype = Object.create(InputController.prototype);

TouchController.prototype.start = function () {
    this.$dpadInput.on(this.dpadListeners);
    Hover.events.on("toggleTouchControls", this.toggle, this);
    var self = this;
    this.$jumpButton.on("click", function () {
        self.jump = true;
    });
    this.$wallButton.on("click", function () {
        self.placeWall = true;
    });
    this.$cloakButton.on("click", function () {
        self.cloak = true;
    });
    this.$zoomInButton.on({
        pxpointerstart: function () {
            self.hudZoomIn = true;
        },
        pxpointerend: function () {
            self.hudZoomIn = false;
        }
    });
    this.$zoomOutButton.on({
        pxpointerstart: function () {
            self.hudZoomOut = true;
        },
        pxpointerend: function () {
            self.hudZoomOut = false;
        }
    });
};

TouchController.prototype.stop = function () {
    this.$dpadInput.off(this.dpadListeners);
    Hover.events.off("toggleTouchControls", this.toggle);
    this.$jumpButton.off("click");
    this.$wallButton.off("click");
    this.$cloakButton.off("click");
    this.$zoomInButton.off("pxpointerstart pxpointerend");
    this.$zoomOutButton.off("pxpointerstart pxpointerend");
};

/** Shows or hides the on-screen touch controls. */
TouchController.prototype.toggle = function (visible) {
    var allowHide = true;
    if (visible) {
        this.$dpad.fadeIn();
        this.$hudButtons.fadeIn();
        this.$gameButtons.fadeIn();
    } else if (allowHide) {
        this.$dpad.fadeOut();
        this.$hudButtons.fadeOut();
        this.$gameButtons.fadeOut();
    }
};

TouchController.prototype.dpadStart = function (event) {
    if ("touch" === event.pointer.type) {
        var offset = this.$dpadInput.offset(),
            width = this.$dpadInput.width(),
            height = this.$dpadInput.height();
        this.centerX = offset.left + width / 2;
        this.centerY = offset.top + height / 2;
        this.dpadPointers++;
        this.dpadMove(event);
    }
};

/** Converts the touch position relative to the d-pad centre into engine/turn values and a stick direction class. */
TouchController.prototype.dpadMove = function (event) {
    if ("touch" === event.pointer.type && this.dpadPointers > 0) {
        var pointer = event.pointer,
            angle = Math.atan2(pointer.y - this.centerY, pointer.x - this.centerX),
            degrees = angle / Math.PI * 180 + 180;
        this.resetDpad();
        var direction = "";
        if (degrees >= 20 && degrees < 160) {
            direction = "N";
        } else if (degrees >= 200 && degrees < 340) {
            direction = "S";
        }
        if (degrees >= 110 && degrees < 250) {
            direction += "E";
        } else if (degrees >= 290 || degrees < 70) {
            direction += "W";
        }
        this.engine = Math.max(-1, Math.min(1, (this.centerY - pointer.y) / 80));
        this.turn = Math.max(-1, Math.min(1, (pointer.x - this.centerX) / 80));
        this.$dpadStick.addClass(direction);
    }
};

TouchController.prototype.resetDpad = function () {
    this.engine = 0;
    this.turn = 0;
    this.$dpadStick.removeClass("N NE E SE S SW W NW");
};

TouchController.prototype.dpadEnd = function (event) {
    if ("touch" === event.pointer.type) {
        this.dpadPointers--;
        if (0 === this.dpadPointers) {
            this.resetDpad();
        }
    }
};

// ---------------------------------------------------------------------------------------------
// GamepadController
// ---------------------------------------------------------------------------------------------

GamepadController.prototype = Object.create(InputController.prototype);

GamepadController.prototype.start = function () {
    this.downButtons = [];
    $(window).on("gamepadconnected", $.proxy(function (event) {
        this.connectedGamepad = event.originalEvent.gamepad;
    }, this));
};

GamepadController.prototype.stop = function () {
    $(window).off("gamepadconnected");
    this.connectedGamepad = null;
};

/** Returns true once when button `index` is released (tracks pressed state in downButtons). */
GamepadController.prototype.checkButtonUp = function (gamepad, index) {
    var wasDown = this.downButtons[index],
        isDown = isGamepadButtonPressed(gamepad, index);
    if (wasDown) {
        if (isDown) {
            return false;
        }
        this.downButtons[index] = false;
        return true;
    }
    this.downButtons[index] = isDown;
    return false;
};

GamepadController.prototype.update = function (delta, skipWhenIdle) {
    var gamepads;
    if (navigator.getGamepads) {
        gamepads = navigator.getGamepads();
    } else if (navigator.webkitGetGamepads) {
        gamepads = navigator.webkitGetGamepads();
    } else if (!this.connectedGamepad) {
        return;
    }
    var gamepad = gamepads && gamepads.length > 0 ? gamepads[0] : this.connectedGamepad;
    if (gamepad) {
        if (this.checkButtonUp(gamepad, 0)) {
            this.jump = true;
        }
        this.placeWall |= this.checkButtonUp(gamepad, 2);
        this.placeWall |= this.checkButtonUp(gamepad, 4);
        this.placeWall |= this.checkButtonUp(gamepad, 6);
        this.cloak |= this.checkButtonUp(gamepad, 1);
        this.cloak |= this.checkButtonUp(gamepad, 5);
        this.cloak |= this.checkButtonUp(gamepad, 7);
        this.hudZoomIn = gamepad.axes[3] < 0;
        this.hudZoomOut = gamepad.axes[3] > 0;
        this.forward = isGamepadButtonPressed(gamepad, 12);
        this.reverse = isGamepadButtonPressed(gamepad, 13);
        this.left = isGamepadButtonPressed(gamepad, 14);
        this.right = isGamepadButtonPressed(gamepad, 15);
        this.turn = gamepad.axes[0];
        this.engine = -1 * gamepad.axes[1];
        InputController.prototype.update.call(this, delta, skipWhenIdle);
    }
};

GamepadController.prototype.reset = function () {
    this.engine = 0;
    this.turn = 0;
};

// ---------------------------------------------------------------------------------------------
// Viewport / camera dimensions for the two visual modes
// ---------------------------------------------------------------------------------------------

Hover.dimensions = {};
Hover.dimensions.retro = {
    WIDTH: 800,
    HEIGHT: 600,
    ASPECT: 800 / 600,
    VIEW_ANGLE: 45,
    NEAR: 45,
    FAR: 25000,
    FAR_SHORT: 10000
};
Hover.dimensions.modern = {
    WIDTH: 1080,
    HEIGHT: 575,
    ASPECT: 1080 / 575,
    VIEW_ANGLE: 45,
    NEAR: 45,
    FAR: 25000,
    FAR_SHORT: 10000
};
