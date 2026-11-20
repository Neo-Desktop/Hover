// Original: game.js lines 637-717 (constructors Ba..Ia), 2947-3061 (prototypes)
//
// Particle effects and weapons: particle systems double as bullets (a bullet is a
// moving particle system that collides with walls and craft), and guns spawn them.

/**
 * A single particle; it is a THREE.Vector3 (its own position) with life and colour.
 * @param {ParticleSystem} system  owning system
 */
function Particle(system) {
    this.system = system;
    this.life = 0;
    this.color = new THREE.Color();
}

/**
 * A moving cloud of additive-blended particles added to the world's particle scene.
 * @param {World} world
 * @param {THREE.Vector3} position  emitter position (cloned)
 * @param {THREE.Vector3} velocity  emitter velocity (cloned)
 * @param {number} life             emitter lifetime in seconds
 * @param {Object} params           maxLife, minLife, maxVelocity, minVelocity, numParticles,
 *                                  drag, particleSize, colors, staggerSpawn
 */
function ParticleSystem(world, position, velocity, life, params) {
    var scene = world.sceneParticles;
    this.world = world;
    this.scene = scene;
    this.maxLife = params.maxLife || 1;
    this.minLife = params.minLife || 0.5;
    this.maxVelocity = params.maxVelocity || 34;
    this.minVelocity = params.minVelocity || 80;
    this.numParticles = params.numParticles || 500;
    this.drag = params.drag || 0.3;
    this.particleSize = params.particleSize || 20;
    this.colors = params.colors || [new THREE.Color(0x0000ff), new THREE.Color(0x00ff00), new THREE.Color(0xff0000)];
    this.staggerSpawn = "staggerSpawn" in params ? params.staggerSpawn : true;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.life = life;
    this.enableSpawning = true;
    this.particles = new THREE.Geometry();
    this.particles.colors = [];
    for (var i = 0; i < this.numParticles; i++) {
        var particle = new Particle(this);
        this.particles.vertices.push(particle);
        this.particles.colors.push(particle.color);
        particle.spawn(this.staggerSpawn ? Math.random() : 0);
    }
    var material = new THREE.ParticleBasicMaterial({
            color: 0xffffff,
            size: this.particleSize,
            map: Hover.Editor.schemeLoader.getTexture("particle"),
            blending: THREE.AdditiveBlending,
            transparent: true,
            vertexColors: true
        }),
        mesh = new THREE.ParticleSystem(this.particles, material);
    mesh.sortParticles = true;
    scene.add(mesh);
    this.mesh = mesh;
}

/**
 * Base bullet: a particle system owned by a team that explodes on walls and damages /
 * pushes craft it hits. `spawn` is the network description of the bullet.
 */
function Bullet(world, team, position, velocity, life, params) {
    ParticleSystem.call(this, world, position, velocity, life, params);
    this.team = team;
    this.id = parseInt(1000000 * Math.random());
    this.diesAfterHit = true;
    this.spawn = {
        Bullet: "Bullet",
        Position: toNetVector(position),
        Velocity: toNetVector(velocity),
        Id: this.id,
        Team: team
    };
    this.hasHitCraft = {};
}

/** The normal blue/white projectile fired by Gun. */
function StandardBullet(world, team, position, velocity) {
    Bullet.call(this, world, team, position, velocity, 20, {
        maxLife: 0.75,
        minLife: 0.5,
        maxVelocity: 16,
        minVelocity: 64,
        numParticles: 150,
        particleSize: 90,
        drag: 3,
        colors: [new THREE.Color(0xffffff), new THREE.Color(0x0000ff), new THREE.Color(0x00aacc), new THREE.Color(0xaaaaaa)]
    });
    this.spawn.Bullet = "StandardBullet";
}

/**
 * A craft's gun: fires StandardBullets forward while it has ammo, limited by a refire rate.
 * @param {World} world
 * @param {Craft} craft  the craft carrying the gun
 */
function Gun(world, craft) {
    this.world = world;
    this.craft = craft;
    this.ammo = 0;
    this.fireTime = 0;
}

/**
 * Gun that must be held to charge (showing a ShockwaveChargingBullet above the craft)
 * and then releases a ShockwaveBullet.
 */
function ChargingGun(world, craft) {
    Gun.call(this, world, craft);
    this.charge = 0;
    this.reqCharge = 3;
    this.timeSinceFired = 0;
    this.lastTime = 0;
    this.chargingBullet = null;
}

/** Short-lived, flat, fast-expanding ring that damages and pushes away nearby craft. */
function ShockwaveBullet(world, team, position, velocity) {
    Bullet.call(this, world, team, position, velocity, 0.5, {
        maxLife: 0.5,
        minLife: 0.5,
        maxVelocity: 2000,
        minVelocity: 2048,
        numParticles: 200,
        particleSize: 200,
        drag: 0.3,
        colors: [new THREE.Color(0xff0000), new THREE.Color(0xffff00), new THREE.Color(0xffffff)],
        staggerSpawn: false
    });
    this.spawn.Bullet = "ShockwaveBullet";
    this.diesAfterHit = false;
}

/** Harmless visual effect shown above a craft while a ChargingGun charges. */
function ShockwaveChargingBullet(world, team, position, velocity) {
    Bullet.call(this, world, team, position, velocity, 3, {
        maxLife: 1.3,
        minLife: 0.5,
        maxVelocity: 500,
        minVelocity: 500,
        numParticles: 100,
        particleSize: 200,
        drag: 0.3,
        colors: [new THREE.Color(0xffffff), new THREE.Color(0xffff00), new THREE.Color(0xff0000), new THREE.Color(0xffff00), new THREE.Color(0xffffff)],
        staggerSpawn: true
    });
    this.spawn.Bullet = "ShockwaveChargingBullet";
}

// ---------------------------------------------------------------------------
// Particle

Particle.prototype = Object.create(THREE.Vector3.prototype);

/**
 * (Re)spawns the particle at the system's emitter. `progress` (0..1) pretends the particle
 * was spawned that fraction of its life ago (used to stagger the initial spawn).
 */
Particle.prototype.spawn = function (progress) {
    progress = progress || 0;
    this.life = (this.system.maxLife - this.system.minLife) * Math.random() + this.system.minLife;
    this.startLife = this.life;
    this.copy(this.system.getNewPosition());
    this.velocity = this.system.getNewVelocity(this);
    this.add(this.velocity.clone().multiplyScalar(progress * this.life));
    this.velocity.add(this.system.velocity);
    this.life *= 1 - progress;
};

Particle.prototype.update = function (dt) {
    this.add(this.velocity.clone().multiplyScalar(dt));
    this.velocity.multiplyScalar(1 - this.system.drag * dt);
    this.color.copy(this.system.getColor(1 - this.life / this.startLife));
    this.life -= dt;
};

Particle.prototype.isAlive = function () {
    return this.life > 0;
};

// ---------------------------------------------------------------------------
// ParticleSystem

ParticleSystem.prototype.update = function (dt) {
    var self = this;
    _.each(this.particles.vertices, function (particle) {
        particle.update(dt);
        if (!particle.isAlive() && self.enableSpawning) {
            particle.spawn(0);
        }
    });
    this.position.add(this.velocity.clone().multiplyScalar(dt));
    this.life -= dt;
    this.particles.verticesNeedUpdate = true;
    this.particles.colorsNeedUpdate = true;
};

ParticleSystem.prototype.isAlive = function () {
    return this.life > 0;
};

/** Random direction with a speed between minVelocity and maxVelocity. */
ParticleSystem.prototype.getNewVelocity = function () {
    return new THREE.Vector3(2 * Math.random() - 1, 2 * Math.random() - 1, 2 * Math.random() - 1).normalize().multiplyScalar((this.maxVelocity - this.minVelocity) * Math.random() + this.minVelocity);
};

ParticleSystem.prototype.getNewPosition = function () {
    return this.position.clone();
};

/** Colour along the `colors` gradient at `t` (0 = birth, 1 = death). */
ParticleSystem.prototype.getColor = function (t) {
    var index = Math.min(this.colors.length - 2, Math.floor((this.colors.length - 1) * t)),
        from = this.colors[index],
        to = this.colors[index + 1];
    t -= Math.floor((this.colors.length - 1) * t) / (this.colors.length - 1);
    t /= 1 / (this.colors.length - 1);
    return from.interpolate(to, t);
};

ParticleSystem.prototype.remove = function () {
    this.scene.remove(this.mesh);
};

// ---------------------------------------------------------------------------
// Bullet

Bullet.prototype = Object.create(ParticleSystem.prototype);

/** Bullet type name ("StandardBullet", ...) → constructor; used to recreate network bullets. */
Bullet.Constructors = {};

Bullet.prototype.getSpawn = function () {
    return this.spawn;
};

Bullet.prototype.onHitWall = function () {
    this.world.addBullet(this.getExplosion());
};

Bullet.prototype.onHitCraft = function (craft) {
    this.world.addBullet(this.getExplosion());
    craft.applyDamage(this.getDamage(craft), this);
    craft.applyForce(this.getForceDirection(craft).normalize().multiplyScalar(this.getForce(craft)));
};

Bullet.prototype.getForceDirection = function (craft) {
    return this.velocity.clone();
};

Bullet.prototype.onExpired = function () {
};

Bullet.prototype.getExplosion = function () {
    return new ParticleSystem(this.world, this.position, new THREE.Vector3(0, 0, 0), 0.5, this.getExplosionParams());
};

/** Moves the bullet, then handles wall hits, expiry and craft hits (each craft is hit once). */
Bullet.prototype.update = function (dt) {
    var previousPosition = this.position.clone();
    ParticleSystem.prototype.update.call(this, dt);
    if (this.world.getCollision(previousPosition, this.position)) {
        this.position = previousPosition;
        this.life = -1;
        this.onHitWall();
    }
    if (!this.isAlive()) {
        this.world.addExpiredBullet(this);
    }
    var craft = this.world.checkCraftCollisions(this, this.team, true, this.getHitRadius());
    if (craft && !this.hasHitCraft[craft.id]) {
        if (this.diesAfterHit) {
            this.life = -1;
        }
        this.hasHitCraft[craft.id] = true;
        this.onHitCraft(craft);
    }
};

Bullet.prototype.getHitRadius = function () {
    return 128;
};

Bullet.prototype.getExplosionParams = function () {
    return {
        maxLife: 1,
        minLife: 0.5,
        maxVelocity: 256,
        minVelocity: 300,
        numParticles: 25,
        particleSize: 100,
        drag: 0.7,
        colors: [new THREE.Color(0xffffff), new THREE.Color(0x0000ff)],
        staggerSpawn: false
    };
};

Bullet.prototype.getDamage = function (craft) {
    return 30;
};

Bullet.prototype.getForce = function () {
    return 128;
};

// ---------------------------------------------------------------------------
// StandardBullet

StandardBullet.prototype = Object.create(Bullet.prototype);
Bullet.Constructors.StandardBullet = StandardBullet;

// ---------------------------------------------------------------------------
// Gun

/** Fires a bullet in the craft's facing direction if there is ammo and the gun has reloaded. */
Gun.prototype.fire = function () {
    if (this.ammo > 0 && this.fireTime >= this.getRefireRate()) {
        var direction = new THREE.Vector3(-Math.sin(this.craft.angle), 0, -Math.cos(this.craft.angle)),
            bullet = this.constructBullet(this.craft.position.clone(), this.craft.velocity.clone().add(direction.multiplyScalar(this.getBulletVelocity())));
        bullet.local = !!this.craft.player;
        this.world.addBullet(bullet, this.craft.player);
        this.ammo--;
        this.fireTime = -0;
    }
};

Gun.prototype.update = function (dt) {
    this.fireTime += dt;
};

Gun.prototype.addAmmo = function (amount) {
    this.ammo += amount;
};

Gun.prototype.constructBullet = function (position, velocity) {
    var BulletConstructor = this.getBulletConstructor();
    return new BulletConstructor(this.world, this.craft.team, position, velocity);
};

Gun.prototype.getBulletVelocity = function () {
    return 3072;
};

Gun.prototype.getRefireRate = function () {
    return 0.5;
};

Gun.prototype.getBulletConstructor = function () {
    return StandardBullet;
};

// ---------------------------------------------------------------------------
// ChargingGun

ChargingGun.prototype = Object.create(Gun.prototype);

/**
 * Called every frame the fire button is held: accumulates charge (showing the charging
 * effect) until reqCharge is exceeded, then fires a shockwave.
 */
ChargingGun.prototype.fire = function () {
    if (this.ammo <= 0) {
        return;
    }
    this.timeSinceFired = 0;
    if (this.charge <= this.reqCharge) {
        this.charge += this.lastTime;
        // Note: `this.team` is not set on guns (the craft has the team); kept as in the original.
        if (this.fireTime > 1 && (this.chargingBullet == null || !this.chargingBullet.isAlive())) {
            this.chargingBullet = new ShockwaveChargingBullet(this.world, this.team, this.craft.position.clone().add(new THREE.Vector3(0, 600, 0)), this.craft.velocity.clone());
            this.chargingBullet.local = !!this.craft.player;
            this.world.addBullet(this.chargingBullet, this.craft.player);
        }
    } else if (this.ammo > 0) {
        this.killChargingBullet();
        Gun.prototype.fire.call(this);
        this.charge = 0;
    }
};

/** Keeps the charging effect above the craft; drops the charge 1.5 s after fire is released. */
ChargingGun.prototype.update = function (dt) {
    this.lastTime = dt;
    if (this.chargingBullet != null) {
        this.chargingBullet.enableSpawning = 0 == this.timeSinceFired && this.fireTime > 1;
        this.chargingBullet.position.copy(this.craft.position.clone().add(new THREE.Vector3(0, 600, 0)));
        this.chargingBullet.velocity.copy(this.craft.velocity);
    }
    this.timeSinceFired += dt;
    if (this.timeSinceFired > 1.5) {
        this.charge = 0;
        this.killChargingBullet();
    }
    Gun.prototype.update.call(this, dt);
};

ChargingGun.prototype.killChargingBullet = function () {
    if (this.chargingBullet != null && this.chargingBullet.isAlive()) {
        this.chargingBullet.life = -1;
        this.chargingBullet = null;
    }
};

ChargingGun.prototype.getBulletVelocity = function () {
    return 0;
};

ChargingGun.prototype.getBulletConstructor = function () {
    return ShockwaveBullet;
};

// ---------------------------------------------------------------------------
// ShockwaveBullet

ShockwaveBullet.prototype = Object.create(Bullet.prototype);

/** Mostly horizontal directions, so the shockwave is a flat ring. */
ShockwaveBullet.prototype.getNewVelocity = function () {
    return new THREE.Vector3(2 * Math.random() - 1, 0.2 * Math.random() - 0.1, 2 * Math.random() - 1).normalize().multiplyScalar((this.maxVelocity - this.minVelocity) * Math.random() + this.minVelocity);
};

ShockwaveBullet.prototype.getHitRadius = function () {
    return 2000;
};

/** Damage falls off linearly with distance from the centre (max 120). */
ShockwaveBullet.prototype.getDamage = function (craft) {
    var distance = craft.position.clone().sub(this.position).length(),
        falloff = (2000 - distance) / 2000;
    return 120 * Math.min(1, falloff);
};

/** Push force falls off linearly with distance from the centre (max 2000). */
ShockwaveBullet.prototype.getForce = function (craft) {
    var distance = craft.position.clone().sub(this.position).length(),
        falloff = (2000 - distance) / 2000;
    return 2000 * Math.min(1, falloff);
};

/** Pushes craft directly away from the centre. */
ShockwaveBullet.prototype.getForceDirection = function (craft) {
    return craft.position.clone().sub(this.position);
};

Bullet.Constructors.ShockwaveBullet = ShockwaveBullet;

// ---------------------------------------------------------------------------
// ShockwaveChargingBullet

ShockwaveChargingBullet.prototype = Object.create(Bullet.prototype);

/** Particles are drawn inwards towards the emitter (horizontally). */
ShockwaveChargingBullet.prototype.getNewVelocity = function (particle) {
    var target = this.position.clone();
    target.y = 0;
    return target.sub(particle).normalize().multiplyScalar(1000);
};

/** Particles start on a ring of radius 256 around the emitter. */
ShockwaveChargingBullet.prototype.getNewPosition = function () {
    return this.position.clone().add(new THREE.Vector3(2 * Math.random() - 1, 0, 2 * Math.random() - 1).normalize().multiplyScalar(256));
};

ShockwaveChargingBullet.prototype.getDamage = function () {
    return 0;
};

ShockwaveChargingBullet.prototype.getForce = function () {
    return 0;
};

Bullet.Constructors.ShockwaveChargingBullet = ShockwaveChargingBullet;

// Adds THREE.Color#interpolate (used by ParticleSystem#getColor): returns a new colour
// linearly interpolated from this one towards `target` by `t`.
$(document).ready(function () {
    THREE.Color.prototype.interpolate = function (target, t) {
        var result = this.clone();
        result.r = (target.r - this.r) * t + this.r;
        result.g = (target.g - this.g) * t + this.g;
        result.b = (target.b - this.b) * t + this.b;
        return result;
    };
});
