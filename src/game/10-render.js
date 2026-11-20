// Original: game.js lines 441-518, 2137-2324
//
// Rendering helpers:
//   Statistics          - simple per-section frame timing (Hover.Statistics.stat)
//   GeometryBatch       - static maze geometry drawn with raw WebGL and custom shaders
//   GlowPassShader      - shader-only override that renders just the emissive (glow) colour
//   GlowOccluderShader  - shader-only override that renders black (occludes glow behind it)
//   ArmGeometryBatch    - low-end (ARM) variant without normal mapping
//   RetroGeometryBatch  - retro-mode variant
//   createEmissiveMaterial - THREE.ShaderMaterial with a _GLOW map for models
//   SpriteManager / SpriteGroup - animated camera-facing billboards (Hover.sprites)

/**
 * Collects smoothed timings of named code sections. start(name) closes any open section and
 * opens a new one; output() shows a table of share and milliseconds per section.
 * @constructor
 */
function Statistics() {
    this.stats = {};
}

/**
 * A batch of triangles sharing one texture, uploaded to a single WebGL buffer and drawn with a
 * custom shader (normal map + emissive map lighting). Fill vertices/faces/faceVertexUvs like a
 * THREE.Geometry, then call finalize().
 * @constructor
 * @param renderer THREE.WebGLRenderer
 * @param texture  diffuse THREE.Texture (its _NORMAL and _GLOW companions are looked up by name)
 */
function GeometryBatch(renderer, texture) {
    this.renderer = renderer;
    this.gl = renderer.context;
    GeometryBatch.gl = this.gl;
    this.texture = texture;
    this.normalMap = Hover.Editor.schemeLoader.getTexture(texture.name + "_NORMAL");
    if (!(this.normalMap && this.normalMap.image.width)) {
        this.normalMap = Hover.Editor.schemeLoader.getTexture("BlankNormal");
    }
    this.emissiveMap = Hover.Editor.schemeLoader.getTexture(texture.name + "_GLOW");
    if (!(this.emissiveMap && this.emissiveMap.image.width)) {
        this.emissiveMap = Hover.Editor.schemeLoader.getTexture("BlankEmissive");
    }
    this.vertices = [];
    this.faces = [];
    this.faceVertexUvs = [
        []
    ];
    this.buffer = null;
    this.attrs = this.getAttributes();
    this.shader = this.getShader(this.gl);
    this.doubleSided = false;
    this.transparent = false;
    this.normMat = new THREE.Matrix3();
}

/**
 * Shader-only object (shader + attrs, no geometry) passed to GeometryBatch.draw as an override
 * for the glow render pass: outputs the texture colour scaled by the emissive map ("BasicGlow").
 * @constructor
 */
function GlowPassShader(renderer) {
    this.gl = renderer.context;
    this.attrs = this.getAttributes();
    this.shader = this.getShader(this.gl);
}

/**
 * Shader-only override for the glow render pass: outputs black with the texture's alpha, so
 * non-glowing geometry hides glow behind it ("BasicBlackGlow").
 * @constructor
 */
function GlowOccluderShader(renderer) {
    this.gl = renderer.context;
    this.attrs = this.getAttributes();
    this.shader = this.getShader(this.gl);
}

/** GeometryBatch for low-end (ARM) devices: position + uv only, simple emissive shading. */
function ArmGeometryBatch(renderer, texture) {
    GeometryBatch.call(this, renderer, texture);
}

/** GeometryBatch for retro mode (simpler lighting, additive emissive). */
function RetroGeometryBatch(renderer, texture) {
    GeometryBatch.call(this, renderer, texture);
}

/**
 * Builds a THREE.ShaderMaterial for a model texture, using the "<name>_GLOW" texture (name taken
 * from the image file name) as emissive map. ARM devices get a cheaper unlit shader.
 */
function createEmissiveMaterial(texture) {
    var pathParts = texture.image.src.split(".jpg")[0].split("/");
    if (0 == pathParts.length) {
        pathParts = ["oops"];
    }
    var baseName = pathParts[pathParts.length - 1];
    var emissiveMap = Hover.Editor.schemeLoader.getTexture(baseName + "_GLOW");
    if (!(emissiveMap != null && emissiveMap.image.width)) {
        emissiveMap = Hover.Editor.schemeLoader.getTexture("BlankEmissive");
    }
    if (Hover.arm) {
        return new THREE.ShaderMaterial({
            uniforms: {
                texture: {
                    type: "t",
                    value: texture
                },
                emissiveMap: {
                    type: "t",
                    value: emissiveMap
                }
            },
            shading: THREE.SmoothShading,
            vertexShader: [
                "varying vec2 vUv;",
                "void main(void)",
                "{",
                "\tvUv = uv;",
                "\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}"
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D texture;",
                "uniform sampler2D emissiveMap;",
                "varying vec2 vUv;",
                "void main(void)",
                "{",
                "    float emissive = texture2D(emissiveMap, vec2(vUv.s, vUv.t)).r; ",
                "    vec4 fcolor = texture2D(texture, vec2(vUv.s, vUv.t)).rgba;",
                "    gl_FragColor = vec4(fcolor.rgb * clamp(emissive + 0.3, 0.3, 1.5), fcolor.a);",
                "}"
            ].join("\n")
        });
    } else {
        return new THREE.ShaderMaterial({
            uniforms: {
                texture: {
                    type: "t",
                    value: texture
                },
                emissiveMap: {
                    type: "t",
                    value: emissiveMap
                },
                lightWeight: {
                    type: "f",
                    value: 1
                }
            },
            shading: THREE.SmoothShading,
            vertexShader: [
                "varying vec2 vUv;",
                "varying vec3 vNormal;",
                "varying vec4 vWorldPos;",
                "void main(void)",
                "{",
                "\tvUv = uv;",
                "\tvNormal = normalMatrix * normal;",
                "\tvWorldPos = modelViewMatrix * vec4(position, 1.0);",
                "\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}"
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D texture;",
                "uniform sampler2D emissiveMap;",
                "uniform float lightWeight;",
                "varying vec2 vUv;",
                "varying vec3 vNormal;",
                "varying vec4 vWorldPos;",
                "void main(void)",
                "{",
                "    vec3 norm = normalize(vNormal);",
                "    float faceAmount = abs(dot(norm, normalize(vWorldPos.xyz)));",
                "    float distAmount = min(2.5, pow(700.0 / length(vWorldPos.xyz * vec3(4.5, 2.5, 0.35)), 1.8));",
                "    float lightAmount = faceAmount * distAmount * 0.7 + distAmount * 0.3;",
                "    float emissive = texture2D(emissiveMap, vec2(vUv.s, vUv.t)).r; ",
                "    float fog = pow(clamp(length(vWorldPos.xyz) / 17000.0, 0.0, 1.0), 0.5);",
                "    vec4 fcolor = texture2D(texture, vec2(vUv.s, vUv.t)).rgba;",
                "    vec3 color = fcolor.rgb;",
                "    lightAmount = lightAmount * 0.65 + 0.35;",
                "    vec3 lcolor = color * lightAmount + 0.0 * vec3(1.0, 1.0, 1.0) * pow(faceAmount, 5.0) * 0.35;",
                "    gl_FragColor = vec4(((1.0 - fog) * lcolor * (1.0 - emissive) * lightWeight + (1.0 - lightWeight * fog / 3.0) * color * emissive), fcolor.a);",
                "}"
            ].join("\n")
        });
    }
}

/**
 * Holds named SpriteGroups (animated billboard sets) and updates/draws them together.
 * @constructor
 */
function SpriteManager() {
    this.groups = {};
}

/**
 * A set of camera-facing animated billboards sharing one animation. Frames are the textures
 * "<name>_00", "<name>_01", ... ; each location added with addPoint gets one quad of the given
 * radius.
 * @constructor
 */
function SpriteGroup(renderer, name, frameCount, radius) {
    this.textures = [];
    for (var i = 0; i < frameCount; i++) {
        var frameName = name + "_0" + i;
        this.textures.push(Hover.Editor.schemeLoader.getTexture(frameName));
    }
    GeometryBatch.call(this, renderer, this.textures[0]);
    this.frameCount = frameCount;
    this.time = 0;
    this.locations = [];
    this.radius = radius;
    this.doubleSided = true;
    this.transparent = true;
    this.buildGeometry();
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Starts timing section `name` (ending the currently open section, if any). */
Statistics.prototype.start = function (name) {
    if (!this.stats[name]) {
        this.stats[name] = {
            totalTime: 0,
            totalCount: 0,
            started: 0
        };
    }
    if (this.opened) {
        this.end(this.opened);
    }
    this.opened = name;
    this.stats[name].started = Date.now();
};

/** Ends timing section `name` (or the open one) and folds it into the running averages. */
Statistics.prototype.end = function (name) {
    if (!name && this.opened) {
        name = this.opened;
    }
    this.opened = null;
    var stat = this.stats[name];
    var now = Date.now();
    stat.totalTime = 0.9 * stat.totalTime + 0.1 * (now - stat.started);
    stat.started = now;
    stat.totalCount = 0.9 * stat.totalCount + 0.1;
};

/** Renders (creating once) an overlay table of section shares and times; `top` is a CSS top. */
Statistics.prototype.output = function (top) {
    var averages = {};
    var names = [];
    var total = 0;
    for (var name in this.stats) {
        averages[name] = this.stats[name].totalTime / this.stats[name].totalCount;
        total += averages[name];
        names.push(name);
    }
    names.sort(function (nameA, nameB) {
        return averages[nameB] - averages[nameA];
    });
    var html = "<table>";
    for (var i = 0; i < names.length; i++) {
        html += "<tr><td>" + names[i] + "</td><td>" + parseInt(averages[names[i]] / total * 100) + "%</td><td>" + parseInt(100 * averages[names[i]]) / 100 + "ms</td></tr>";
    }
    if (!this.el) {
        this.el = document.createElement("div");
        this.el.style.position = "absolute";
        this.el.style.top = top || "0";
        this.el.style.left = "0";
        this.el.style.zIndex = "1000";
        this.el.style.color = "#FFFFFF";
        document.body.appendChild(this.el);
    }
    this.el.innerHTML = html + "</table>";
};

Hover.Statistics = {};
Hover.Statistics.stat = new Statistics();

// ---------------------------------------------------------------------------
// GeometryBatch statics: shared shader cache and live objects (for cleanup)
// ---------------------------------------------------------------------------

/** Compiled programs by shaderName. */
GeometryBatch.shaders = {};
/** All compiled programs (for cleanShaders). */
GeometryBatch.programs = [];
/** All finalized batches (for cleanObjects). */
GeometryBatch.objects = [];

/** Frees the WebGL buffers and textures of every finalized batch. */
GeometryBatch.cleanObjects = function () {
    _.each(GeometryBatch.objects, function (batch) {
        batch.gl.deleteBuffer(batch.buffer);
        if (batch.texture && batch.texture.dispose) {
            batch.texture.dispose();
        }
        if (batch.emissiveMap && batch.emissiveMap.dispose) {
            batch.emissiveMap.dispose();
        }
        if (batch.normalMap && batch.normalMap.dispose) {
            batch.normalMap.dispose();
        }
    });
    GeometryBatch.objects = [];
};

/** Deletes every compiled program and its shaders and empties the cache. */
GeometryBatch.cleanShaders = function () {
    _.each(GeometryBatch.programs, function (program) {
        GeometryBatch.gl.deleteProgram(program);
        GeometryBatch.gl.deleteShader(program.vs);
        GeometryBatch.gl.deleteShader(program.fs);
    });
    GeometryBatch.programs = [];
    GeometryBatch.shaders = {};
};

// ---------------------------------------------------------------------------
// GeometryBatch
// ---------------------------------------------------------------------------

/** Whether finalize() writes normal/tangent/bitangent per vertex. */
GeometryBatch.prototype.hasTangents = true;

GeometryBatch.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "attribute vec3 normAttribute;",
    "attribute vec3 t1Attribute;",
    "attribute vec3 t2Attribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "uniform mat3 normalMatrixUniform;",
    "varying vec2 vUV;",
    "varying vec3 vNormal;",
    "varying vec4 vWorldPos;",
    "varying vec3 vT1;",
    "varying vec3 vT2;",
    "void main(void) {",
    "   gl_Position = projectionMatrixUniform * worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vWorldPos = worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vUV = uvAttribute;",
    "   vNormal = normalMatrixUniform * normAttribute;",
    "   vT1 = normalMatrixUniform * t1Attribute;",
    "   vT2 = normalMatrixUniform * t2Attribute;",
    "}"
].join("\n");

GeometryBatch.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "varying vec3 vNormal;",
    "varying vec4 vWorldPos;",
    "varying vec3 vT1;",
    "varying vec3 vT2;",
    "uniform sampler2D textureUniform;",
    "uniform sampler2D normalUniform;",
    "uniform sampler2D emissiveUniform;",
    "void main(void) {",
    "    vec3 vNMap = normalize(texture2D(normalUniform, vec2(vUV.s, vUV.t)).xyz - 0.5);",
    "    vec3 fNormal = vNormal * (dot(vNormal, vWorldPos.xyz) > 0.0 ? 1.0 : -1.0);",
    "    vec3 norm = normalize(vT1 * vNMap.x + vT2 * vNMap.y + fNormal * vNMap.z);",
    "    vec3 wp = normalize(vWorldPos.xyz);",
    "    float faceAmount = abs(dot(norm, normalize(vWorldPos.xyz)));",
    "    float distAmount = min(2.5, pow(700.0 / length(vWorldPos.xyz * vec3(4.5, 2.5, 0.35)), 1.8));",
    "    float lightAmount = faceAmount * distAmount * 0.8 + distAmount * 0.2;",
    "    float emissive = texture2D(emissiveUniform, vec2(vUV.s, vUV.t)).r; ",
    "    float fog = pow(clamp(length(vWorldPos.xyz) / 17000.0, 0.0, 1.0), 0.5);",
    "    vec4 fcolor = texture2D(textureUniform, vec2(vUV.s, vUV.t)).rgba;",
    "    vec3 color = fcolor.rgb;",
    "    lightAmount = lightAmount * 0.75 + 0.25;",
    "    vec3 lcolor = color * lightAmount + 1.5 * (color + vec3(0.2, 0.2, 0.2)) * pow(faceAmount, 5.0);",
    "    gl_FragColor = vec4(((1.0 - fog) * lcolor * (1.0 - emissive) + (1.0 - fog / 3.0) * color * emissive), fcolor.a);",
    "}"
].join("\n");

/** Key in the GeometryBatch.shaders cache. */
GeometryBatch.prototype.shaderName = "Basic";

/** Vertex attribute layout (in buffer order) plus any subclass-specific attributes. */
GeometryBatch.prototype.getAttributes = function () {
    var attributes = [{
        name: "vertexPositionAttribute",
        numElements: 3
    }, {
        name: "uvAttribute",
        numElements: 2
    }, {
        name: "normAttribute",
        numElements: 3
    }, {
        name: "t1Attribute",
        numElements: 3
    }, {
        name: "t2Attribute",
        numElements: 3
    }];
    return attributes.concat(this.getCustomAttributes());
};

/**
 * Returns the compiled program for this.shaderName, compiling/linking it (and looking up its
 * attribute and uniform locations) the first time. Stores it in this.shader.
 */
GeometryBatch.prototype.getShader = function (gl) {
    function compileShader(gl, source, type) {
        var shader;
        if (type == "fragment") {
            shader = gl.createShader(gl.FRAGMENT_SHADER);
        } else {
            if (type != "vertex") {
                return null;
            }
            shader = gl.createShader(gl.VERTEX_SHADER);
        }
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            return shader;
        }
        alert(gl.getShaderInfoLog(shader));
        return null;
    }

    if (GeometryBatch.shaders[this.shaderName]) {
        this.shader = GeometryBatch.shaders[this.shaderName];
    } else {
        var vertexShader = compileShader(gl, this.VERTEX_SHADER, "vertex");
        var fragmentShader = compileShader(gl, this.FRAGMENT_SHADER, "fragment");
        var program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        program.vs = vertexShader;
        program.fs = fragmentShader;
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            alert("Could not init StaticGeom shader");
        }
        gl.useProgram(program);
        var attrs = this.attrs;
        _.each(attrs, function (attr) {
            program[attr.name] = gl.getAttribLocation(program, attr.name);
        });
        program.worldMatrixUniform = gl.getUniformLocation(program, "worldMatrixUniform");
        program.projectionMatrixUniform = gl.getUniformLocation(program, "projectionMatrixUniform");
        program.textureUniform = gl.getUniformLocation(program, "textureUniform");
        program.normalUniform = gl.getUniformLocation(program, "normalUniform");
        program.normalMatrixUniform = gl.getUniformLocation(program, "normalMatrixUniform");
        program.emissiveUniform = gl.getUniformLocation(program, "emissiveUniform");
        this.shader = program;
        GeometryBatch.shaders[this.shaderName] = this.shader;
        GeometryBatch.programs.push(this.shader);
    }
    return this.shader;
};

/**
 * Converts vertices/faces/faceVertexUvs into one interleaved Float32 vertex buffer (position,
 * uv, [normal, tangent, bitangent], custom data) and uploads it. Tangents are axis-aligned:
 * floors use (-1,0,0)/(0,0,1), walls use the horizontal edge and (0,-1,0).
 */
GeometryBatch.prototype.finalize = function () {
    var gl = this.gl;
    var vertices = this.vertices;
    var faces = this.faces;
    var uvs = this.faceVertexUvs[0];
    if (this.buffer != null) {
        gl.deleteBuffer(this.buffer);
        this.buffer = null;
    }
    var data = [];
    for (var f = 0; f < faces.length; f++) {
        var face = faces[f];
        var faceUvs = uvs[f];
        var vertexA = vertices[face.a];
        var vertexB = vertices[face.b];
        var vertexC = vertices[face.c];
        var uvA = faceUvs[0];
        var uvB = faceUvs[1];
        var uvC = faceUvs[2];
        var corners = [
            [vertexA, uvA],
            [vertexB, uvB],
            [vertexC, uvC]
        ];
        var tangent;
        var bitangent;
        var edge1 = vertexB.clone().sub(vertexA);
        var edge2 = vertexC.clone().sub(vertexA);
        var normal = edge2.clone().cross(edge1).normalize();
        var uvEdge1 = uvB.clone().sub(uvA);
        var uvEdge2 = uvC.clone().sub(uvA);
        if (edge1.y != 0 || edge2.y != 0) {
            // Wall: tangent along the horizontal edge, bitangent straight down.
            if (edge1.x == 0) {
                var swapUv = uvEdge1;
                uvEdge1 = uvEdge2;
                uvEdge2 = swapUv;
                var swapEdge = edge1;
                edge1 = edge2;
                edge2 = swapEdge;
            }
            bitangent = new THREE.Vector3(0, -1, 0);
            if (uvEdge1.x > 0) {
                edge1.multiplyScalar(-1);
            }
            tangent = edge1.normalize();
            tangent.length() < 0.5; // no-op comparison kept from the original
        } else {
            // Floor/ceiling.
            bitangent = new THREE.Vector3(0, 0, 1);
            tangent = new THREE.Vector3(-1, 0, 0);
        }
        for (var corner = 2; corner >= 0; corner--) {
            var position = corners[corner][0];
            var uv = corners[corner][1];
            data.push(position.x);
            data.push(position.y);
            data.push(position.z);
            data.push(uv.x);
            data.push(uv.y);
            if (this.hasTangents) {
                data.push(normal.x);
                data.push(normal.y);
                data.push(normal.z);
                data.push(tangent.x);
                data.push(tangent.y);
                data.push(tangent.z);
                data.push(bitangent.x);
                data.push(bitangent.y);
                data.push(bitangent.z);
            }
            this.pushCustomVertexData(data, faces[f], position, uv);
        }
    }
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    var stride = 0;
    _.each(this.attrs, function (attr) {
        stride += 4 * attr.numElements;
    });
    this.buffer.itemSize = stride / 4;
    this.buffer.numItems = data.length / (stride / 4);
    GeometryBatch.objects.push(this);
};

/** Hook: append extra per-vertex values (matching getCustomAttributes) to `data`. */
GeometryBatch.prototype.pushCustomVertexData = function (data, face, position, uv) {
};

/** Hook: extra vertex attributes appended after the standard ones. */
GeometryBatch.prototype.getCustomAttributes = function () {
    return [];
};

GeometryBatch.prototype.destroy = function () {
};

/**
 * Draws the batch from `camera`. `override` (a GlowPassShader / GlowOccluderShader) replaces
 * the batch's own shader and attribute layout.
 */
GeometryBatch.prototype.draw = function (camera, override) {
    var gl = this.gl;
    var buffer = this.buffer;
    var shader = override ? override.shader : this.shader;
    var attrs = override ? override.attrs : this.attrs;
    if (buffer == null) {
        console.log("Invalid attempt to draw StaticGeom prior ot initialization");
        console.log(new Error("dummy").stack);
        return;
    }
    gl.useProgram(shader);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    var stride = 0;
    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        if (shader[attr.name] != -1) {
            gl.enableVertexAttribArray(shader[attr.name]);
        }
        stride += 4 * attr.numElements;
    }
    var offset = 0;
    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        if (shader[attr.name] != -1) {
            gl.vertexAttribPointer(shader[attr.name], attr.numElements, gl.FLOAT, false, stride, offset);
        }
        offset += 4 * attr.numElements;
    }
    gl.uniformMatrix4fv(shader.worldMatrixUniform, false, camera.matrixWorldInverse.elements);
    gl.uniformMatrix4fv(shader.projectionMatrixUniform, false, camera.projectionMatrix.elements);
    if (shader.normalMatrixUniform != -1) {
        var normalMatrix = this.normMat.getNormalMatrix(camera.matrixWorld).transpose();
        gl.uniformMatrix3fv(shader.normalMatrixUniform, false, normalMatrix.elements);
    }
    this.renderer.setTexture(this.texture, 0);
    gl.uniform1i(shader.textureUniform, 0);
    if (shader.normalUniform != -1) {
        this.renderer.setTexture(this.normalMap, 1);
        gl.uniform1i(shader.normalUniform, 1);
    }
    if (shader.emissiveUniform != -1) {
        this.renderer.setTexture(this.emissiveMap, 2);
        gl.uniform1i(shader.emissiveUniform, 2);
    }
    if (this.doubleSided) {
        gl.disable(gl.CULL_FACE);
    } else {
        gl.enable(gl.CULL_FACE);
    }
    if (this.transparent) {
        gl.enable(gl.BLEND);
    } else {
        gl.disable(gl.BLEND);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, buffer.numItems);
    if (this.transparent) {
        gl.disable(gl.BLEND);
    }
    for (var i = 0; i < attrs.length; i++) {
        if (shader[attrs[i].name] != -1) {
            gl.disableVertexAttribArray(shader[attrs[i].name]);
        }
    }
};

// ---------------------------------------------------------------------------
// GlowPassShader ("BasicGlow")
// ---------------------------------------------------------------------------

GlowPassShader.prototype = Object.create(GeometryBatch.prototype);

GlowPassShader.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "attribute vec3 normAttribute;",
    "attribute vec3 t1Attribute;",
    "attribute vec3 t2Attribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "uniform mat3 normalMatrixUniform;",
    "varying vec2 vUV;",
    "void main(void) {",
    "   gl_Position = projectionMatrixUniform * worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vUV = uvAttribute;",
    "}"
].join("\n");

GlowPassShader.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D textureUniform;",
    "uniform sampler2D emissiveUniform;",
    "void main(void) {",
    "    float emissive = texture2D(emissiveUniform, vec2(vUV.s, vUV.t)).r; ",
    "    vec4 fcolor = texture2D(textureUniform, vec2(vUV.s, vUV.t)).rgba;",
    "    vec3 color = fcolor.rgb;",
    "    gl_FragColor = vec4(color * emissive, fcolor.a);",
    "}"
].join("\n");

GlowPassShader.prototype.shaderName = "BasicGlow";

// ---------------------------------------------------------------------------
// GlowOccluderShader ("BasicBlackGlow")
// ---------------------------------------------------------------------------

GlowOccluderShader.prototype = Object.create(GeometryBatch.prototype);

GlowOccluderShader.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "attribute vec3 normAttribute;",
    "attribute vec3 t1Attribute;",
    "attribute vec3 t2Attribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "uniform mat3 normalMatrixUniform;",
    "varying vec2 vUV;",
    "void main(void) {",
    "   vUV = uvAttribute;",
    "   gl_Position = projectionMatrixUniform * worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "}"
].join("\n");

GlowOccluderShader.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D textureUniform;",
    "void main(void) {",
    "    vec4 fcolor = texture2D(textureUniform, vec2(vUV.s, vUV.t)).rgba;",
    "    gl_FragColor = vec4(0.0, 0.0, 0.0, fcolor.a);",
    "}"
].join("\n");

GlowOccluderShader.prototype.shaderName = "BasicBlackGlow";

// ---------------------------------------------------------------------------
// ArmGeometryBatch
// ---------------------------------------------------------------------------

ArmGeometryBatch.prototype = Object.create(GeometryBatch.prototype);

ArmGeometryBatch.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "varying vec2 vUV;",
    "void main(void) {",
    "   gl_Position = projectionMatrixUniform * worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vUV = uvAttribute;",
    "}"
].join("\n");

ArmGeometryBatch.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D textureUniform;",
    "uniform sampler2D emissiveUniform;",
    "void main(void) {",
    "    float emissive = texture2D(emissiveUniform, vec2(vUV.s, vUV.t)).r; ",
    "    vec4 fcolor = texture2D(textureUniform, vec2(vUV.s, vUV.t)).rgba;",
    "    gl_FragColor = vec4(fcolor.rgb * clamp(0.3 + emissive, 0.3, 1.0), fcolor.a);",
    "}"
].join("\n");

ArmGeometryBatch.prototype.shaderName = "ArmBasic";

/** Position + uv only (plus custom attributes). */
ArmGeometryBatch.prototype.getAttributes = function () {
    var attributes = [{
        name: "vertexPositionAttribute",
        numElements: 3
    }, {
        name: "uvAttribute",
        numElements: 2
    }];
    return attributes.concat(this.getCustomAttributes());
};

ArmGeometryBatch.prototype.hasTangents = false;

// ---------------------------------------------------------------------------
// RetroGeometryBatch
// ---------------------------------------------------------------------------

RetroGeometryBatch.prototype = Object.create(GeometryBatch.prototype);

RetroGeometryBatch.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "attribute vec3 normAttribute;",
    "attribute vec3 t1Attribute;",
    "attribute vec3 t2Attribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "uniform mat3 normalMatrixUniform;",
    "varying vec2 vUV;",
    "varying vec3 vNormal;",
    "varying vec4 vWorldPos;",
    "varying vec3 vT1;",
    "varying vec3 vT2;",
    "void main(void) {",
    "   gl_Position = projectionMatrixUniform * worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vWorldPos = worldMatrixUniform * vec4(vertexPositionAttribute, 1.0);",
    "   vUV = uvAttribute;",
    "   vNormal = normalMatrixUniform * normAttribute;",
    "   vT1 = normalMatrixUniform * t1Attribute;",
    "   vT2 = normalMatrixUniform * t2Attribute;",
    "}"
].join("\n");

RetroGeometryBatch.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "varying vec3 vNormal;",
    "varying vec4 vWorldPos;",
    "varying vec3 vT1;",
    "varying vec3 vT2;",
    "uniform sampler2D textureUniform;",
    "uniform sampler2D normalUniform;",
    "uniform sampler2D emissiveUniform;",
    "void main(void) {",
    "    vec3 vNMap = normalize(texture2D(normalUniform, vec2(vUV.s, vUV.t)).xyz - 0.5);",
    "    vec3 fNormal = vNormal * (dot(vNormal, vWorldPos.xyz) > 0.0 ? 1.0 : -1.0);",
    "    vec3 norm = normalize(vT1 * vNMap.x + vT2 * vNMap.y + fNormal * vNMap.z);",
    "    vec3 wp = normalize(vWorldPos.xyz);",
    "    float faceAmount = abs(dot(norm, normalize(vWorldPos.xyz)));",
    "    float distAmount = min(2.5, pow(700.0 / length(vWorldPos.xyz), 1.8));",
    "    float lightAmount = faceAmount + distAmount * 0.2;",
    "    float fog = pow(clamp(length(vWorldPos.xyz) / 17000.0, 0.0, 1.0), 0.5);",
    "    vec4 fcolor = texture2D(textureUniform, vec2(vUV.s, vUV.t)).rgba;",
    "    float emissive = texture2D(emissiveUniform, vec2(vUV.s, vUV.t)).r; ",
    "    vec3 color = fcolor.rgb;",
    "    lightAmount = lightAmount * 0.5 + 0.5;",
    "    vec3 lcolor = color * lightAmount;",
    "    gl_FragColor = vec4(lcolor + emissive, fcolor.a);",
    "}"
].join("\n");

RetroGeometryBatch.prototype.shaderName = "RetroBasic";

// ---------------------------------------------------------------------------
// SpriteManager
// ---------------------------------------------------------------------------

/** Creates sprite group `name` (the third argument is unused). */
SpriteManager.prototype.addGroup = function (name, renderer, unused, frameCount, radius) {
    this.groups[name] = new SpriteGroup(renderer, name, frameCount, radius);
};

SpriteManager.prototype.addPoint = function (name, location) {
    if (name in this.groups) {
        this.groups[name].addPoint(location);
        return;
    }
    console.log("Group " + name + " does not exist");
};

SpriteManager.prototype.removePoint = function (name, location) {
    if (name in this.groups) {
        this.groups[name].removePoint(location);
        return;
    }
    console.log("Group " + name + " does not exist");
};

/** Draws every group that has at least one sprite. */
SpriteManager.prototype.draw = function (camera) {
    for (var name in this.groups) {
        if (this.groups[name].vertices.length > 0) {
            this.groups[name].draw(camera);
        }
    }
};

SpriteManager.prototype.update = function (deltaTime) {
    for (var name in this.groups) {
        this.groups[name].update(deltaTime);
    }
};

Hover.sprites = new SpriteManager();

// ---------------------------------------------------------------------------
// SpriteGroup
// ---------------------------------------------------------------------------

SpriteGroup.prototype = Object.create(GeometryBatch.prototype);

SpriteGroup.prototype.addPoint = function (location) {
    this.locations.push(location);
    this.buildGeometry();
};

/** Removes every sprite within 5 units of `location`. */
SpriteGroup.prototype.removePoint = function (location) {
    for (var i = 0; i < this.locations.length; i++) {
        if (this.locations[i].clone().sub(location).length() < 5) {
            this.locations.splice(i, 1);
            i--;
        }
    }
    this.buildGeometry();
};

/**
 * Rebuilds one quad (two triangles) per location. Vertex positions are corner offsets; the
 * location itself goes into each face as the "centerAttribute" (see pushCustomVertexData).
 */
SpriteGroup.prototype.buildGeometry = function () {
    var locations = this.locations;
    this.vertices = [];
    this.faces = [];
    this.faceVertexUvs = [
        []
    ];
    for (var i = 0; i < locations.length; i++) {
        var baseIndex = (locations[i], this.vertices.length); // original's discarded read kept
        this.vertices.push(new THREE.Vector3(-this.radius, -this.radius, 0));
        this.vertices.push(new THREE.Vector3(this.radius, -this.radius, 0));
        this.vertices.push(new THREE.Vector3(this.radius, this.radius, 0));
        this.vertices.push(new THREE.Vector3(-this.radius, this.radius, 0));
        var face1 = new THREE.Face3(baseIndex, baseIndex + 1, baseIndex + 2);
        var face2 = new THREE.Face3(baseIndex + 2, baseIndex + 3, baseIndex);
        face1.location = face2.location = locations[i].clone();
        this.faces.push(face1);
        this.faces.push(face2);
        this.faceVertexUvs[0].push([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1)]);
        this.faceVertexUvs[0].push([new THREE.Vector2(1, 1), new THREE.Vector2(0, 1), new THREE.Vector2(0, 0)]);
    }
    this.finalize();
};

SpriteGroup.prototype.pushCustomVertexData = function (data, face, position, uv) {
    data.push(face.location.x);
    data.push(face.location.y);
    data.push(face.location.z);
};

SpriteGroup.prototype.getCustomAttributes = function () {
    return [{
        name: "centerAttribute",
        numElements: 3
    }];
};

/** Advances the animation (20 frames per second). */
SpriteGroup.prototype.update = function (deltaTime) {
    this.time += deltaTime;
    this.texture = this.textures[Math.floor(20 * this.time) % this.textures.length];
};

SpriteGroup.prototype.VERTEX_SHADER = [
    "attribute vec3 vertexPositionAttribute;",
    "attribute vec2 uvAttribute;",
    "attribute vec3 centerAttribute;",
    "attribute vec3 t1Attribute;",
    "attribute vec3 t2Attribute;",
    "uniform mat4 worldMatrixUniform;",
    "uniform mat4 projectionMatrixUniform;",
    "uniform mat3 normalMatrixUniform;",
    "varying vec2 vUV;",
    "void main(void) {",
    "   vec3 newCenter = (worldMatrixUniform * vec4(centerAttribute, 1.0)).xyz;",
    "   gl_Position = projectionMatrixUniform * vec4(newCenter + vertexPositionAttribute, 1.0);",
    "   vUV = uvAttribute;",
    "}"
].join("\n");

SpriteGroup.prototype.FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D textureUniform;",
    "void main(void) {",
    "    gl_FragColor = texture2D(textureUniform, vec2(vUV.s, vUV.t));",
    "}"
].join("\n");

SpriteGroup.prototype.shaderName = "SpriteBoard";
