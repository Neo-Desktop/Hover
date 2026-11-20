// Original: game.js lines 187-190, 311-322, 1022-1029
// Small shared utilities: a minimal observer (Signal) and conversions between THREE.Vector3 and the
// server's {X, Y, Z} vector objects.

/**
 * Tiny observer. Listeners are registered with register() and invoked with up to two arguments by call().
 * alwaysFire() remembers its arguments so that listeners registered later are invoked immediately with them.
 */
function Signal() {
    this.children = [];
    this.alwaysFireV = null;
}

/** Adds a listener (calling it immediately if alwaysFire() was used) and returns it, for later remove(). */
Signal.prototype.register = function (listener) {
    if (this.alwaysFireV) {
        listener(this.alwaysFireV[0], this.alwaysFireV[1]);
    }
    this.children.push(listener);
    return listener;
};

/** Removes every registration of the given listener. */
Signal.prototype.remove = function (listener) {
    for (var i = 0; i < this.children.length; i++) {
        if (this.children[i] == listener) {
            this.children.splice(i, 1);
            i--;
        }
    }
};

/** Invokes every listener with the two arguments. */
Signal.prototype.call = function (arg1, arg2) {
    for (var i = 0; i < this.children.length; i++) {
        this.children[i](arg1, arg2);
    }
};

/** Fires now and remembers the arguments so late registrations also receive them. */
Signal.prototype.alwaysFire = function (arg1, arg2) {
    this.alwaysFireV = [arg1, arg2];
    this.call(arg1, arg2);
};

/** Converts a network vector {X, Y, Z} to a THREE.Vector3. */
function fromNetVector(netVector) {
    return new THREE.Vector3(netVector.X, netVector.Y, netVector.Z);
}

/** Converts a THREE.Vector3 to a network vector {X, Y, Z}. */
function toNetVector(vector) {
    return {
        X: vector.x,
        Y: vector.y,
        Z: vector.z
    };
}
