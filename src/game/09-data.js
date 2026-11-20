// Original: game.js lines 1874-2136
//
// Editor data layer:
//   Hover.Editor.dataAccess   - fetches mazes and schemes (from the preloaded Hover.json cache when
//                               available, otherwise from the api/MazeAPI and api/SchemeAPI endpoints).
//   Hover.Editor.schemeLoader - loads a scheme's textures (plus derived _NORMAL/_GLOW maps) and
//                               its 3D models (drones, flags, pods) into memory.

(function () {
    /**
     * Thin wrapper around the maze/scheme web API. All methods are asynchronous and report
     * their result through a callback.
     * @constructor
     */
    function DataAccess() {
    }

    /** Asks the server for a brand-new empty maze. */
    DataAccess.prototype.getNewMaze = function (callback) {
        $.ajax({
            type: "post",
            url: "api/MazeAPI/New",
            dataType: "json",
            success: function (maze) {
                callback(maze);
            }
        });
    };

    /** Gets one maze by id; uses a deep copy of the preloaded Hover.json.mazes entry when present. */
    DataAccess.prototype.getMazeById = function (mazeId, callback) {
        if (Hover.json && Hover.json.mazes) {
            var maze = Hover.json.mazes[mazeId];
            if (maze) {
                maze = jQuery.extend(true, {}, maze);
                callback(maze);
                return;
            }
            console.log("cache miss for maze: " + mazeId);
        }
        $.ajax({
            type: "get",
            url: "api/MazeAPI/Maze/" + mazeId,
            dataType: "json",
            success: function (loadedMaze) {
                callback(loadedMaze);
            }
        });
    };

    /** Lists all mazes. */
    DataAccess.prototype.getMazes = function (callback) {
        $.ajax({
            type: "get",
            url: "api/MazeAPI/Maze",
            dataType: "json",
            success: function (mazes) {
                callback(mazes);
            }
        });
    };

    /** Saves a maze (posted as JSON). */
    DataAccess.prototype.saveMaze = function (maze, callback) {
        $.ajax({
            type: "post",
            url: "api/MazeAPI/SaveMaze",
            dataType: "json",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(maze),
            success: function (result) {
                callback(result);
            }
        });
    };

    /** Lists all schemes (visual themes). */
    DataAccess.prototype.getSchemes = function (callback) {
        $.ajax({
            type: "get",
            url: "api/SchemeAPI/All",
            dataType: "json",
            success: function (schemes) {
                callback(schemes);
            }
        });
    };

    /** Gets one scheme by id. Schemes fetched this way get an empty Models list. */
    DataAccess.prototype.getScheme = function (schemeId, callback) {
        $.ajax({
            type: "get",
            url: "api/SchemeAPI/One/" + schemeId,
            dataType: "json",
            success: function (scheme) {
                scheme.Models = [];
                callback(scheme);
            }
        });
    };

    /**
     * Gets one scheme by name (from the Hover.json cache when possible) and attaches the
     * built-in list of 3D models (drones, flag, pods).
     */
    DataAccess.prototype.getSchemeByName = function (schemeName, callback) {
        var addBuiltInModels = function (scheme) {
            scheme.Models = [{
                MazeModelId: 1,
                Name: "Drone_Model_1",
                ModelPath: "/3d/Models/hover_a.json",
                RedDiffuseTexturePath: "/3d/Textures/Hover_A_RED.jpg",
                BlueDiffuseTexturePath: "/3d/Textures/Hover_A_BLUE.jpg"
            }, {
                MazeModelId: 1,
                Name: "Drone_Model_2",
                ModelPath: "/3d/Models/hover_c.json",
                RedDiffuseTexturePath: "/3d/Textures/Hover_C_RED.jpg",
                BlueDiffuseTexturePath: "/3d/Textures/Hover_C_BLUE.jpg"
            }, {
                MazeModelId: 1,
                Name: "Drone_Model_3",
                ModelPath: "/3d/Models/hover_b.json",
                RedDiffuseTexturePath: "/3d/Textures/Hover_B_RED.jpg",
                BlueDiffuseTexturePath: "/3d/Textures/Hover_B_BLUE.jpg"
            }, {
                MazeModelId: 1,
                Name: "Flag_Blue",
                ModelPath: "/3d/Models/flag_b_frame_1.json",
                RedDiffuseTexturePath: "/3d/Textures/Flag_B_Red.jpg",
                BlueDiffuseTexturePath: "/3d/Textures/Flag_B_Blue.jpg",
                MorphTargets: ["/3d/Models/flag_b_frame_2.json", "/3d/Models/flag_b_frame_3.json", "/3d/Models/flag_b_frame_4.json", "/3d/Models/flag_b_frame_1.json"]
            }, {
                MazeModelId: 1,
                Name: "ShieldPod",
                ModelPath: "/3d/Models/shield_a.json",
                DiffuseTexturePath: "/3d/Textures/Shield_A.jpg"
            }, {
                MazeModelId: 1,
                Name: "QuestionMarkPod",
                ModelPath: "/3d/Models/question_mark_a.json",
                DiffuseTexturePath: "/3d/Textures/Question_Mark_A.jpg"
            }, {
                MazeModelId: 1,
                Name: "FastSignalPod",
                ModelPath: "/3d/Models/signal_b.json",
                DiffuseTexturePath: "/3d/Textures/Signa_B_GREEN.jpg"
            }, {
                MazeModelId: 1,
                Name: "SlowSignalPod",
                ModelPath: "/3d/Models/signal_b.json",
                DiffuseTexturePath: "/3d/Textures/Signal_B_RED.jpg"
            }, {
                MazeModelId: 1,
                Name: "RadarPod",
                ModelPath: "/3d/Models/radar_a.json",
                DiffuseTexturePath: "/3d/Textures/Radar_A.jpg"
            }, {
                MazeModelId: 1,
                Name: "SpringPod",
                ModelPath: "/3d/Models/spring_c.json",
                DiffuseTexturePath: "/3d/Textures/Spring.jpg"
            }, {
                MazeModelId: 1,
                Name: "CloakPod",
                ModelPath: "/3d/Models/hover_a.json",
                DiffuseTexturePath: "/3d/Textures/Hover_A_BOT.jpg"
            }, {
                MazeModelId: 1,
                Name: "WallPod",
                ModelPath: "/3d/Models/wall_b.json",
                DiffuseTexturePath: "/3d/Textures/Wall_B.jpg"
            }];
            return scheme;
        };
        if (Hover.json && Hover.json.schemes) {
            var cachedScheme = Hover.json.schemes[schemeName];
            if (cachedScheme) {
                cachedScheme = jQuery.extend(true, {}, cachedScheme);
                callback(addBuiltInModels(cachedScheme));
                return;
            }
            console.log("cache miss for scheme: " + schemeName);
        }
        $.ajax({
            type: "get",
            url: "api/SchemeAPI/Name/" + schemeName,
            dataType: "json",
            success: function (scheme) {
                callback(addBuiltInModels(scheme));
            }
        });
    };

    Hover.Editor.dataAccess = new DataAccess();
})();

(function () {
    /**
     * Loads all textures and models of a scheme and keeps them by name.
     *   textures - name -> THREE.Texture (including derived "<name>_NORMAL" / "<name>_GLOW" maps)
     *   models   - name -> model record (with .geometry and diffuse textures once loaded)
     *   extras   - additional texture records loaded along with every scheme
     * @constructor
     */
    function SchemeLoader() {
        this.textures = {};
        this.models = {};
        this.extras = [];
    }

    SchemeLoader.prototype.loadSchemeByName = function (schemeName, callback) {
        this.loadSchemeByFunc("getSchemeByName", schemeName, callback);
    };

    SchemeLoader.prototype.loadScheme = function (schemeId, callback) {
        this.loadSchemeByFunc("getScheme", schemeId, callback);
    };

    /**
     * Fetches a scheme with the named dataAccess method, then loads every texture and model it
     * lists. callback(loader, textures) is called once everything has finished (or failed) loading.
     * Outside retro mode, drone/pod/flag textures are dropped, and each texture gets a _NORMAL
     * (half size) and _GLOW (quarter size) companion map.
     */
    SchemeLoader.prototype.loadSchemeByFunc = function (funcName, arg, callback) {
        var self = this;
        var loadedTextures = [];
        Hover.Editor.dataAccess[funcName](arg, function (scheme) {
            var textureRecords = [];
            var modelRecords = [];
            var loadedCount = 0;
            if (!Hover.retro) {
                if (!scheme.OriginalTextures) {
                    scheme.OriginalTextures = scheme.Textures;
                }
                scheme.Textures = _.filter(scheme.OriginalTextures, function (textureRecord) {
                    var name = textureRecord.Name;
                    return name.indexOf("DRONE") == -1 && name.indexOf("POD") == -1 && name.indexOf("FLG") == -1;
                });
                scheme.Textures = _.map(scheme.Textures, function (textureRecord) {
                    return JSON.parse(JSON.stringify(textureRecord));
                });
            }
            var textureCount = scheme.Textures.length;
            if (!Hover.retro) {
                for (var i = 0; i < textureCount; i++) {
                    var record = scheme.Textures[i];
                    record.Path = record.Path.replace("/Retro", "");
                    var normalRecord = {
                        HasTransparency: record.HasTransparency,
                        Height: record.Height,
                        MazeSchemeId: record.MazeSchemeId,
                        Name: record.Name + "_NORMAL",
                        OriginalHeight: record.OriginalHeight,
                        OriginalWidth: record.OriginalWidth,
                        Quality: record.Quality,
                        ThumbPath: record.ThumbPath,
                        Width: record.Width
                    };
                    normalRecord.Path = record.Path.replace(record.Name + ".png", normalRecord.Name + "_HALF.png");
                    scheme.Textures.push(normalRecord);
                    var glowRecord = {
                        HasTransparency: record.HasTransparency,
                        Height: record.Height,
                        MazeSchemeId: record.MazeSchemeId,
                        Name: record.Name + "_GLOW",
                        OriginalHeight: record.OriginalHeight,
                        OriginalWidth: record.OriginalWidth,
                        Quality: record.Quality,
                        ThumbPath: record.ThumbPath,
                        Width: record.Width
                    };
                    glowRecord.Path = record.Path.replace(record.Name + ".png", glowRecord.Name + "_QUARTER.png");
                    scheme.Textures.push(glowRecord);
                    if (record.Name.indexOf("DECAL") == -1) {
                        if (Hover.arm) {
                            record.Path = record.Path.replace(".png", "_QUARTER.png");
                        } else {
                            record.Path = record.Path.replace(".png", ".jpg");
                        }
                    }
                }
            }
            for (var i = 0; i < scheme.Textures.length; i++) {
                textureRecords.push(scheme.Textures[i]);
            }
            for (var i = 0; i < scheme.Models.length; i++) {
                modelRecords.push(scheme.Models[i]);
            }
            for (var i = 0; i < self.extras.length; i++) {
                textureRecords.push(self.extras[i]);
            }

            // Counts one finished (or failed) load; fires the callback when all are done.
            var onItemLoaded = function () {
                loadedCount++;
                if (loadedCount == textureRecords.length + modelRecords.length) {
                    callback(self, loadedTextures);
                }
            };
            // Creates a texture immediately and fills in its image once loaded; onDone fires
            // exactly once, on success or error.
            var loadTexture = function (url, onDone) {
                var image = new Image();
                var texture = new THREE.Texture(image, new THREE.UVMapping());
                var pendingCallback = onDone;
                var loader = new THREE.ImageLoader();
                loader.load(url, function (loadedImage) {
                    texture.image = loadedImage;
                    texture.needsUpdate = true;
                    if (pendingCallback) {
                        pendingCallback(texture);
                        pendingCallback = null;
                    }
                }, undefined, function () {
                    if (pendingCallback) {
                        pendingCallback(texture);
                        pendingCallback = null;
                    }
                });
                texture.sourceFile = url;
                return texture;
            };
            for (i = 0; i < textureRecords.length; i++) {
                var textureRecord = textureRecords[i];
                if (Hover.retro) {
                    // Retro mode: scheme textures live in a "Retro" sub-folder.
                    var pathParts = textureRecord.Path.split("/");
                    if (pathParts[2] === "Schemes") {
                        var parentFolder = pathParts[pathParts.length - 2];
                        if (parentFolder !== "Retro") {
                            pathParts.splice(pathParts.length - 1, 0, "Retro");
                            textureRecord.Path = pathParts.join("/");
                        }
                    }
                }
                var texture = loadTexture(textureRecord.Path, onItemLoaded);
                self.textures[textureRecord.Name] = texture;
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.generateMipmaps = true;
                texture.magFilter = THREE.LinearFilter;
                texture.minFilter = THREE.LinearMipMapLinearFilter;
                if (Hover.retro) {
                    // This edition: draw the 1995 textures as square pixels up close, as the 1995
                    // software renderer did, instead of smoothing them into a blur.
                    texture.magFilter = THREE.NearestFilter;
                    if (/DECAL|DRONE|POD|FLG|FORCE_FIELD/.test(textureRecord.Name)) {
                        // See-through textures (coral, signs, sprites): no shrunken copies, whose
                        // averaged edges made fine details fade out at a distance.
                        texture.generateMipmaps = false;
                        texture.minFilter = THREE.NearestFilter;
                    }
                }
                texture.originalWidth = textureRecord.OriginalWidth;
                texture.originalHeight = textureRecord.OriginalHeight;
                texture.name = textureRecord.Name;
                loadedTextures.push(texture);
            }

            // Loads a model's diffuse texture(s): a single one, or a red/blue team pair.
            var loadModelTextures = function (model) {
                if (model.DiffuseTexturePath) {
                    THREE.ImageUtils.loadTexture(model.DiffuseTexturePath, null, function (diffuse) {
                        model.diffuseTexture = diffuse;
                        onItemLoaded();
                    }, function () {
                        model.diffuseTexture = new THREE.Texture();
                        onItemLoaded();
                    });
                } else if (model.RedDiffuseTexturePath) {
                    THREE.ImageUtils.loadTexture(model.RedDiffuseTexturePath, null, function (redDiffuse) {
                        model.redDiffuseTexture = redDiffuse;
                        THREE.ImageUtils.loadTexture(model.BlueDiffuseTexturePath, null, function (blueDiffuse) {
                            model.blueDiffuseTexture = blueDiffuse;
                            onItemLoaded();
                        }, function () {
                            model.blueDiffuseTexture = new THREE.Texture();
                            onItemLoaded();
                        });
                    }, function () {
                        model.blueDiffuseTexture = new THREE.Texture();
                        model.redDiffuseTexture = new THREE.Texture();
                        onItemLoaded();
                        onItemLoaded();
                    });
                } else {
                    onItemLoaded();
                }
            };
            // Loads the model's morph-target frames one by one (consuming model.MorphTargets),
            // then its textures.
            var loadMorphTargets = function (model) {
                var loader = new THREE.JSONLoader();
                if (model.MorphTargets.length > 0) {
                    loader.load(model.MorphTargets[0], function (frameGeometry) {
                        model.geometry.morphTargets.push({
                            name: "target" + frameGeometry.id,
                            vertices: frameGeometry.vertices
                        });
                        model.MorphTargets.splice(0, 1);
                        loadMorphTargets(model);
                    });
                } else {
                    loadModelTextures(model);
                }
            };
            // Loads the model's geometry, then morph targets (if any), then textures.
            var loadModel = function (model) {
                var loader = new THREE.JSONLoader();
                loader.load(model.ModelPath, function (geometry) {
                    model.geometry = geometry;
                    if (model.MorphTargets) {
                        loadMorphTargets(model);
                    } else {
                        loadModelTextures(model);
                    }
                });
            };
            for (i = 0; i < modelRecords.length; i++) {
                var model = modelRecords[i];
                self.models[model.Name] = model;
                loadModel(model);
            }
        });
    };

    /** Returns the loaded texture with this name, or null. */
    SchemeLoader.prototype.getTexture = function (name) {
        return this.textures[name] ? this.textures[name] : null;
    };

    Hover.Editor.schemeLoader = new SchemeLoader();
})();
