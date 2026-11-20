// Original: game.js lines 548-579, 2601-2711
// PlayerList and MultiplayerGame (SignalR "hoverHub" networked game).

/**
 * Keeps the remote players' latest network state, keyed by SignalR ConnectionId, and fires
 * onPlayerJoined / onPlayerUpdated / onPlayerLeft as server snapshots arrive.
 */
function PlayerList() {
    this.players = {};
    this.onPlayerJoined = new Signal();
    this.onPlayerLeft = new Signal();
    this.onPlayerUpdated = new Signal();
}

/**
 * Networked game: sends the local craft's state to the SignalR hub ~15 times a second and mirrors
 * the other players (as remote-controlled crafts), bullets, flags, pods and temp walls.
 * The hub calls back into the methods below via Hover.signalr.attachGameInstance.
 * @param {Object} options - Game options plus { gameId, playerName }
 */
function MultiplayerGame(options) {
    Game.call(this, options);
    this.gameId = options.gameId;
    this.connected = false;
    this.players = new PlayerList();
    this.playerName = options.playerName || "";
    var self = this;
    this.onCraftAdded = new Signal();
    this.onPlayerCraftCreated = new Signal();
    this.players.onPlayerJoined.register(function (sender, player) {
        self.onPlayerJoined(player);
    });
    this.players.onPlayerUpdated.register(function (sender, player) {
        self.onPlayerUpdated(player);
    });
    this.players.onPlayerLeft.register(function (sender, player) {
        self.onPlayerLeft(player);
    });
    this.onDisconnectedWithError = new Signal();
    this.onShowMessage = new Signal();
    this.updateReceived = false;
    this.lastSentTime = 0;
    this.clock2 = new THREE.Clock();
    this.lastHit = null;
    // Tell the server when the local craft bumps into another player's craft.
    this.onPlayerCollision.register(function (game, collision) {
        var collisionMessage = {
            Target: collision.craft.parent.ConnectionId,
            Position: toNetVector(collision.position),
            Velocity: toNetVector(collision.velocity)
        };
        game.hub.server.sendCollision(collisionMessage);
        collisionMessage.Timing = Date.now();
        // Original bug kept: assigns the implicit global `lastHit`, not this.lastHit.
        lastHit = collisionMessage;
    });
    this.onPlayerCraftCreated.register(function () {
        self.world.onPlayerFiredBullet.register(function (sender, bullet) {
            self.hub.server.fireBullet(bullet);
        });
        self.craft.onDamaged.register(function (craft, bullet) {
            if (!bullet.isAlive()) {
                self.hub.server.sendBulletDestroyed(bullet.id);
            }
        });
    });
    // When one of our bullets hits a remote craft, report the hit.
    this.onCraftAdded.register(function (sender, craft) {
        craft.onDamaged.register(function (damagedCraft, bullet) {
            if (bullet.local) {
                self.hub.server.sendMyBulletHitCraft(bullet.id, damagedCraft.parent.ConnectionId);
            }
        });
    });
    this.hub = $.connection.hoverHub;
    Hover.signalr.attachGameInstance(this, this.gameId);
}

/**
 * Applies a server snapshot (array of player states). New players (with a Position) join,
 * known players are updated, and players missing from the snapshot leave.
 */
PlayerList.prototype.update = function (playerStates) {
    var missing = {};
    for (var connectionId in this.players) {
        missing[connectionId] = true;
    }
    for (var i = 0; i < playerStates.length; i++) {
        var state = playerStates[i];
        var isNew = false;
        if (!this.players[state.ConnectionId] && state.Position != null) {
            this.players[state.ConnectionId] = state;
            isNew = true;
        }
        var player = this.players[state.ConnectionId];
        missing[state.ConnectionId] = false;
        if (state.Position != null) {
            player.Name = state.Name;
            player.Position = fromNetVector(state.Position);
            player.Velocity = fromNetVector(state.Velocity);
            player.AngleY = state.AngleY;
            player.EngineState = state.EngineState;
            player.TurnState = state.TurnState;
            player.ProtectionTime = state.ProtectionTime;
            player.MaxSpeedModifier = state.MaxSpeedModifier;
            player.MaxSpeedModifierTime = state.MaxSpeedModifierTime;
            player.CloakTime = state.CloakTime;
            player.DisabledTime = state.DisabledTime;
            player.Health = state.Health;
            if (isNew) {
                this.onPlayerJoined.call(this, player);
            }
            this.onPlayerUpdated.call(this, player);
        }
    }
    for (var connectionId in missing) {
        if (missing[connectionId]) {
            this.onPlayerLeft.call(this, this.players[connectionId]);
            delete this.players[connectionId];
        }
    }
};

MultiplayerGame.prototype = Object.create(Game.prototype);

/** Server: another craft bumped us. Applies the bounce velocity (ignoring repeats within 500 ms). */
MultiplayerGame.prototype.onHit = function (hit) {
    var now = Date.now();
    if (this.lastHit == null || this.lastHit.Target !== hit.Target || now - this.lastHit.Timing > 500) {
        var velocity = fromNetVector(hit.Velocity);
        this.craft.velocity.copy(velocity);
        this.craft.position.add(velocity.clone().multiplyScalar(0.02));
        Hover.audio.getSound("HIT_ROBT").play();
    }
    this.lastHit = hit;
    this.lastHit.Timing = now;
};

/** Server: a remote player fired; creates the bullet by its constructor name. */
MultiplayerGame.prototype.onBulletFired = function (data) {
    var bullet = new Bullet.Constructors[data.Bullet](this.world, data.Team, fromNetVector(data.Position), fromNetVector(data.Velocity));
    bullet.id = data.Id;
    this.world.addBullet(bullet);
};

MultiplayerGame.prototype.onFlagCaptured = function (location) {
    var flag = this.world.findFlag(fromNetVector(location), 10, false, "");
    if (flag) {
        flag.capture();
    }
};

MultiplayerGame.prototype.onFlagUncaptured = function (location) {
    var flag = this.world.findFlag(fromNetVector(location), 10, true, "");
    if (flag) {
        flag.uncapture();
    }
};

MultiplayerGame.prototype.onTempWallCreated = function (data) {
    var wall = new TempWall(this.world, fromNetVector(data.Position), data.Angle);
    this.world.addTempWall(wall);
};

/** Server: a remote bullet hit the local craft. */
MultiplayerGame.prototype.hitByBullet = function (bulletId) {
    var bullet = this.world.getBulletById(bulletId) || this.world.getExpiredBulletById(bulletId);
    if (bullet != null && bullet.isAlive()) {
        bullet.onHitCraft(this.craft);
        bullet.life = -1;
    }
};

MultiplayerGame.prototype.bulletDestroyed = function (bulletId) {
    var bullet = this.world.getBulletById(bulletId);
    if (bullet != null) {
        bullet.life = -1;
    }
};

MultiplayerGame.prototype.disconnectWithError = function (error) {
    this.connected = false;
    this.onDisconnectedWithError.call(this, error);
};

MultiplayerGame.prototype.showMessage = function (message) {
    this.onShowMessage.call(this, message);
};

/** Server: the game started; gameEndTime (if any) is when the match ends. */
MultiplayerGame.prototype.startGame = function (gameEndTime) {
    this.gameEnds = gameEndTime ? new Date(gameEndTime).getTime() : 0;
    this.connected = true;
    this.sendUpdate();
};

/** Server: load this maze; once ready, ask to be spawned and forward our temp walls to the hub. */
MultiplayerGame.prototype.useMazeId = function (mazeId) {
    var self = this;
    self.onReady.register(function () {
        self.onMazeLoaded();
        self.world.onTempWallCreated.register(function (sender, wall) {
            self.hub.server.createTempWall(wall.getNET());
        });
    });
    this.loadMaze(mazeId);
};

/** Server: places the local craft at its spawn point and assigns its team. */
MultiplayerGame.prototype.spawnAt = function (spawn) {
    this.craft.position.copy(new THREE.Vector3(spawn.X, spawn.Y, spawn.Z));
    this.craft.team = spawn.Team.toLowerCase();
    this.world.team = this.craft.team;
    this.craft.color = "red" === this.craft.team ? "#FF0000" : "#0000FF";
    this.craft.hud.onTeamUpdate();
};

/** Server: spawns a flag; local captures/uncaptures of it are reported back to the hub. */
MultiplayerGame.prototype.placeFlagAt = function (location) {
    var self = this;
    var flag = this.world.spawnFlag(location);
    flag.onCaptured.register(function (sender, byLocalPlayer) {
        if (byLocalPlayer) {
            self.craft.capturedFlags++;
            self.hub.server.capturedFlag(toNetVector(flag.location));
        }
    });
    flag.onUncaptured.register(function (sender, byLocalPlayer) {
        if (byLocalPlayer) {
            self.craft.capturedFlags--;
            self.hub.server.uncapturedFlag(toNetVector(flag.location));
        }
    });
};

/** Server: spawns a pod; when the local craft picks it up the hub is told. */
MultiplayerGame.prototype.spawnPod = function (podData) {
    var self = this;
    var pod = this.world.spawnPod(podData, podData.PodType);
    pod.afterHit.register(function () {
        self.hub.server.hitPod(toNetVector(pod.location));
    });
};

/** Server: someone else picked up the pod at this location. */
MultiplayerGame.prototype.removePod = function (location) {
    this.world.checkForPodHits({
        position: fromNetVector(location)
    }, true);
};

MultiplayerGame.prototype.onMazeLoaded = function () {
    this.onPlayerCraftCreated.call(this, this.craft);
    $.connection.hoverHub.server.spawnMe();
};

/** Sends state at most 15 times a second (after the previous reply) and only simulates while connected. */
MultiplayerGame.prototype.runFrame = function () {
    this.lastSentTime += this.clock2.getDelta();
    if (this.connected) {
        if (this.updateReceived && this.lastSentTime >= 1 / 15) {
            this.sendUpdate();
            this.lastSentTime = 0;
        }
        Game.prototype.runFrame.call(this);
    }
    this.checkGameExpiration();
};

/**
 * Updates the HUD timer; when time runs out, the team with the most uncaptured flags left wins
 * (equal counts, or no flags, is a tie).
 */
MultiplayerGame.prototype.checkGameExpiration = function () {
    if (this.gameEnds && this.craft && !this.gameEnded) {
        var secondsLeft = Hover.ModernHud.getRemainingSeconds(this.gameEnds);
        this.craft.hud.updateTimeLeft(secondsLeft);
        if (!(secondsLeft > 0)) {
            var standings = _.chain(this.world.flags).filter(function (flag) {
                return !flag.captured;
            }).countBy(function (flag) {
                return flag.team;
            }).pairs().sortBy(_.last).reverse().map(function (pair) {
                return {
                    name: pair[0],
                    flagsLeft: pair[1]
                };
            }).value();
            this.gameEnded = true;
            var leader, runnerUp;
            if (standings && standings.length > 0) {
                leader = standings[0];
                runnerUp = standings.length > 1 ? standings[1] : null;
                if (!runnerUp || leader.flagsLeft !== runnerUp.flagsLeft) {
                    if (leader.name === this.world.team) {
                        this.world.onWin.call();
                    } else {
                        this.world.onLose.call();
                    }
                    return;
                }
            }
            this.world.onTie.call();
            return;
        }
    }
};

/** Sends the local craft state; the reply is the full player snapshot. */
MultiplayerGame.prototype.sendUpdate = function () {
    if (this.craft) {
        this.updateReceived = false;
        var state = this.craft.getStateUpdate();
        state.Name = this.playerName;
        var self = this;
        this.hub.server.setCraftState(state).done(function (playerStates) {
            self.updateReceived = true;
            self.players.update(playerStates);
        }).fail(function () {
            self.connected = false;
            $(".loading_indicator").show();
            $("#please_wait_text").html("Disconnected").addClass("error");
        });
    }
};

/** Creates a network-driven model craft for a newly joined player. */
MultiplayerGame.prototype.onPlayerJoined = function (player) {
    // This edition: classic (retro) games draw other players as the 1995 sprite drones, as single
    // player does for its robots; the original remake always used 3D models here.
    var CraftType = Hover.retro ? SpriteCraft : ModelCraft;
    var craft = new CraftType(this.scene, this.world, player.Position.clone(), player.AngleY, player.Team.toLowerCase(), Profiles.fromId(player.Profile));
    craft.id = player.ConnectionId;
    var controller = new RemoteCraftController(craft);
    craft.parent = player;
    craft.color = "red" === player.Team.toLowerCase() ? "#FF0000" : "#0000FF";
    this.world.addDrone(controller);
    player.craftObj = craft;
    player.controller = controller;
    this.onCraftAdded.call(this, craft);
};

MultiplayerGame.prototype.onPlayerLeft = function (player) {
    if (player.controller && player.craftObj) {
        this.world.removeDrone(player.controller);
        player.craftObj.removeFromScene();
    }
};

MultiplayerGame.prototype.onPlayerUpdated = function (player) {
    player.controller.captureState(player);
    player.craftObj.setText(player.Name);
};
