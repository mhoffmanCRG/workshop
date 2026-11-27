import HTD from './htd.js';

/*
 * WebGL preview of the finished pulley with the cutter and one groove's
 * toolpath. World frame matches the machine with the rotary along X:
 * X along the pulley axis, Y away from the operator, Z up.
 */
const HTDView3D = (function () {
  'use strict';

  var VS = 'attribute vec3 aPos; attribute vec3 aNor; uniform mat4 uMVP; uniform mat3 uRot; varying vec3 vN;' +
    'void main(){ vN = uRot * aNor; gl_Position = uMVP * vec4(aPos, 1.0); }';
  var FS = 'precision mediump float; uniform vec3 uColor; uniform float uLit; varying vec3 vN;' +
    'void main(){ vec3 c = uColor; if (uLit > 0.5) { vec3 n = normalize(vN);' +
    ' float key = max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0);' +
    ' float fill = max(dot(n, normalize(vec3(-0.6, 0.1, 0.5))), 0.0);' +
    ' float spec = pow(key, 24.0) * 0.25;' +
    ' c = uColor * (0.30 + 0.62 * key + 0.20 * fill) + vec3(spec); }' +
    ' gl_FragColor = vec4(c, 1.0); }';

  // ---- 4x4 matrices, column-major
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
  function scale(sx) { return new Float32Array([sx, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  // ---- 2D polygon triangulation (ear clipping); pts are {y, z}
  function earClip(pts) {
    function cross(a, b, c) { return (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y); }
    var n = pts.length, idx = [], tris = [], i, area = 0;
    for (i = 0; i < n; i++) { idx.push(i); var q = pts[(i + 1) % n]; area += pts[i].y * q.z - q.y * pts[i].z; }
    var sign = area > 0 ? 1 : -1, progress = true;
    while (idx.length > 3 && progress) {
      progress = false;
      for (i = 0; i < idx.length; i++) {
        var m = idx.length, a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
        var cr = cross(pts[a], pts[b], pts[c]) * sign;
        if (cr < -1e-12) continue;                       // reflex corner
        var ear = true;
        if (cr > 1e-12) {
          for (var j = 0; j < m && ear; j++) {
            var v = idx[j];
            if (v === a || v === b || v === c) continue;
            if (cross(pts[a], pts[b], pts[v]) * sign > 1e-12 && cross(pts[b], pts[c], pts[v]) * sign > 1e-12 &&
                cross(pts[c], pts[a], pts[v]) * sign > 1e-12) ear = false;
          }
          if (ear) tris.push(a, b, c);
        }
        if (ear) { idx.splice(i, 1); progress = true; break; }
      }
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }

  // ---- meshes: { pos: [], nor: [], idx: [] }
  // pitch: outline of one tooth pitch. Every tooth uses the same number of
  // indices, so single teeth can be drawn on their own.
  function pulleyMesh(r, pitch) {
    var g = r.geom, p = r.params, N = g.teeth;
    var x0 = Math.min(p.faceStart, p.faceStart + p.stockDir * p.faceWidth);
    var x1 = Math.max(p.faceStart, p.faceStart + p.stockDir * p.faceWidth);
    var m = pitch.length, i, k;

    var nor2 = pitch.map(function (q, j) {
      if (j === 0 || j === m - 1) return { y: q.y / g.Ro, z: q.z / g.Ro };
      var ty = pitch[j + 1].y - pitch[j - 1].y, tz = pitch[j + 1].z - pitch[j - 1].z, l = Math.hypot(ty, tz) || 1;
      return { y: -tz / l, z: ty / l };
    });

    var half = Math.PI / N, Rin = g.Rr * 0.9;
    var capPoly = pitch.concat([
      { y: Rin * Math.sin(half), z: Rin * Math.cos(half) },
      { y: -Rin * Math.sin(half), z: Rin * Math.cos(half) }
    ]);
    var capTris = earClip(capPoly), cm = capPoly.length;

    var pos = [], nor = [], idx = [];
    function vert(x, y, z, nx, ny, nz) { pos.push(x, y, z); nor.push(nx, ny, nz); return pos.length / 3 - 1; }
    var centres = [vert(x0, 0, 0, -1, 0, 0), vert(x1, 0, 0, 1, 0, 0)];

    for (k = 0; k < N; k++) {
      var a = k * 2 * Math.PI / N, ca = Math.cos(a), sa = Math.sin(a);
      var base = pos.length / 3;
      for (i = 0; i < m; i++) {
        var y = pitch[i].y * ca + pitch[i].z * sa, z = -pitch[i].y * sa + pitch[i].z * ca;
        var ny = nor2[i].y * ca + nor2[i].z * sa, nz = -nor2[i].y * sa + nor2[i].z * ca;
        vert(x0, y, z, 0, ny, nz); vert(x1, y, z, 0, ny, nz);
      }
      for (i = 0; i < m - 1; i++) {
        var q0 = base + 2 * i;
        idx.push(q0, q0 + 1, q0 + 2, q0 + 1, q0 + 3, q0 + 2);
      }
      [x0, x1].forEach(function (x, e) {
        var cb = pos.length / 3;
        for (i = 0; i < cm; i++) {
          vert(x, capPoly[i].y * ca + capPoly[i].z * sa, -capPoly[i].y * sa + capPoly[i].z * ca, e ? 1 : -1, 0, 0);
        }
        for (i = 0; i < capTris.length; i++) idx.push(cb + capTris[i]);
        idx.push(centres[e], cb + m, cb + m + 1);
      });
    }
    return { pos: pos, nor: nor, idx: idx, x0: x0, x1: x1, perTooth: idx.length / N };
  }

  // One pitch of plain turned stock, before any groove is cut.
  function blankPitch(g) {
    var half = Math.PI / g.teeth, n = Math.max(4, Math.ceil(g.Ro * 2 * half / 0.5)), pts = [];
    for (var i = 0; i <= n; i++) {
      var th = -half + 2 * half * i / n;
      pts.push({ y: g.Ro * Math.sin(th), z: g.Ro * Math.cos(th) });
    }
    return pts;
  }

  // Cross-section of one tooth pitch after each cutting pass, for the carving
  // preview. Returns one mesh pair per pass count: a side strip running from
  // x = 0 to x = 1 (stretched to length when drawn) and the end face at x = 0.
  function passMeshes(r) {
    var g = r.geom, Rt = r.toolRadius, half = Math.PI / g.teeth, Rin = g.Rr * 0.9;
    var yb = g.Ro * Math.sin(half), yk = Rin * Math.sin(half), n = 150, ys = [], i;
    for (i = 0; i <= n; i++) ys.push(-yb + 2 * yb * i / n);
    ys.push(-yk, yk);
    ys.sort(function (a, b) { return a - b; });
    ys = ys.filter(function (y, j) { return j === 0 || y - ys[j - 1] > 1e-9; });
    var m = ys.length, iL = ys.indexOf(-yk), iR = ys.indexOf(yk);

    // floor of the tooth's wedge: the inner polygon edge, then the pitch boundaries
    var floor = ys.map(function (y) { return Math.abs(y) <= yk ? Rin * Math.cos(half) : Math.abs(y) / Math.tan(half); });
    var z = ys.map(function (y) { return Math.sqrt(g.Ro * g.Ro - y * y); });

    function build(top) {
      var side = { pos: [], nor: [], idx: [] }, face = { pos: [], nor: [], idx: [] }, j;
      for (j = 0; j < m; j++) {
        var a = Math.max(0, j - 1), b = Math.min(m - 1, j + 1);
        var ty = ys[b] - ys[a], tz = top[b] - top[a], l = Math.hypot(ty, tz) || 1;
        side.pos.push(0, ys[j], top[j], 1, ys[j], top[j]);
        side.nor.push(0, -tz / l, ty / l, 0, -tz / l, ty / l);
        face.pos.push(0, ys[j], top[j], 0, ys[j], floor[j]);
        face.nor.push(-1, 0, 0, -1, 0, 0);
      }
      for (j = 0; j < m - 1; j++) {
        var q = 2 * j;
        side.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        face.idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
      }
      face.pos.push(0, 0, 0); face.nor.push(-1, 0, 0);
      face.idx.push(2 * m, 2 * iL + 1, 2 * iR + 1);
      return { side: side, face: face };
    }

    var out = [build(z)];
    r.rough.concat(r.finish).forEach(function (c) {
      for (var j = 0; j < m; j++) z[j] = Math.min(z[j], HTD.cutFloor(c, ys[j], Rt, r.params.toolLength));
      out.push(build(z));
    });
    return out;
  }

  // Every cutting move of the program as line segments fixed to the part.
  // counts[i]: vertices up to and including move i; starts[i]: where move i's groove visit began.
  function trailLines(program) {
    var out = [], counts = [], starts = [], prev = program.start, visit = -1, begin = 0;
    function push(m) {
      var a = m.P * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      out.push(m.L, c * m.C + s * m.Z, -s * m.C + c * m.Z);
    }
    program.moves.forEach(function (m) {
      if (m.visit !== visit) { visit = m.visit; begin = out.length / 3; }
      if (m.cut) { push(prev); push(m); }
      starts.push(begin);
      counts.push(out.length / 3);
      prev = m;
    });
    return { lines: out, counts: counts, starts: starts };
  }

  // Ball-nose cutter, axis along +Z, ball centre at (cx, 0, cz).
  function cutterMesh(cx, cz, Rt, length) {
    var pos = [], nor = [], idx = [], seg = 28, lat = 8, i, j;
    var rings = [];
    for (j = 0; j <= lat; j++) {
      var t = (j / lat) * Math.PI / 2;                 // 0 = tip, 90 deg = equator
      rings.push({ r: Rt * Math.sin(t), z: cz - Rt * Math.cos(t), nr: Math.sin(t), nz: -Math.cos(t) });
    }
    rings.push({ r: Rt, z: cz, nr: 1, nz: 0 });
    rings.push({ r: Rt, z: cz + length, nr: 1, nz: 0 });
    rings.forEach(function (ring) {
      for (i = 0; i <= seg; i++) {
        var a = i / seg * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
        pos.push(cx + ring.r * c, ring.r * s, ring.z); nor.push(ring.nr * c, ring.nr * s, ring.nz);
      }
    });
    for (j = 0; j < rings.length - 1; j++) for (i = 0; i < seg; i++) {
      var q = j * (seg + 1) + i;
      idx.push(q, q + 1, q + seg + 1, q + 1, q + seg + 2, q + seg + 1);
    }
    var top = pos.length / 3;
    pos.push(cx, 0, cz + length); nor.push(0, 0, 1);
    for (i = 0; i <= seg; i++) {
      var b = i / seg * 2 * Math.PI;
      pos.push(cx + Rt * Math.cos(b), Rt * Math.sin(b), cz + length); nor.push(0, 0, 1);
    }
    for (i = 0; i < seg; i++) idx.push(top, top + 1 + i, top + 2 + i);
    return { pos: pos, nor: nor, idx: idx };
  }

  // Plain cylinder along +Z, standing in for the tool holder.
  function holderMesh(cx, z0, z1, radius) {
    var pos = [], nor = [], idx = [], seg = 32, i;
    for (i = 0; i <= seg; i++) {
      var a = i / seg * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      pos.push(cx + radius * c, radius * s, z0, cx + radius * c, radius * s, z1); nor.push(c, s, 0, c, s, 0);
    }
    for (i = 0; i < seg; i++) { var q = 2 * i; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    [[z0, -1], [z1, 1]].forEach(function (end) {
      var centre = pos.length / 3;
      pos.push(cx, 0, end[0]); nor.push(0, 0, end[1]);
      for (i = 0; i <= seg; i++) {
        var b = i / seg * 2 * Math.PI;
        pos.push(cx + radius * Math.cos(b), radius * Math.sin(b), end[0]); nor.push(0, 0, end[1]);
      }
      for (i = 0; i < seg; i++) idx.push(centre, centre + 1 + i, centre + 2 + i);
    });
    return { pos: pos, nor: nor, idx: idx };
  }

  // Arrow from the origin along one axis (0 = X, 1 = Y, 2 = Z): a thin shaft, then a cone.
  function arrowMesh(axis, len) {
    var pos = [], nor = [], idx = [], seg = 12, i, j;
    var rings = [[len * 0.022, 0], [len * 0.022, len * 0.76], [len * 0.07, len * 0.76], [0, len]];
    rings.forEach(function (ring) {
      for (i = 0; i <= seg; i++) {
        var a = i / seg * 2 * Math.PI, v = [ring[0] * Math.cos(a), ring[0] * Math.sin(a), ring[1]];
        // a cyclic shift of the coordinates points the arrow along the wanted axis
        for (var k = 0; k < 3; k++) { pos.push(v[(k + 2 - axis) % 3]); nor.push(k === axis ? 1 : 0); }
      }
    });
    for (j = 0; j < rings.length - 1; j++) for (i = 0; i < seg; i++) {
      var q = j * (seg + 1) + i;
      idx.push(q, q + 1, q + seg + 1, q + 1, q + seg + 2, q + seg + 1);
    }
    return { pos: pos, nor: nor, idx: idx };
  }

  // Small ball marking the program zero itself.
  function ballMesh(rad) {
    var pos = [], nor = [], idx = [], seg = 12, lat = 6, i, j;
    for (j = 0; j <= lat; j++) for (i = 0; i <= seg; i++) {
      var t = j / lat * Math.PI, a = i / seg * 2 * Math.PI;
      var n = [Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a), Math.cos(t)];
      pos.push(rad * n[0], rad * n[1], rad * n[2]); nor.push(n[0], n[1], n[2]);
    }
    for (j = 0; j < lat; j++) for (i = 0; i < seg; i++) {
      var q = j * (seg + 1) + i;
      idx.push(q, q + 1, q + seg + 1, q + 1, q + seg + 2, q + seg + 1);
    }
    return { pos: pos, nor: nor, idx: idx };
  }

  // Plain cylinder along X, for the rotary head and the bar it holds.
  function cylinderX(x0, x1, radius) {
    var m = holderMesh(0, x0, x1, radius), pos = [], nor = [];
    // a cyclic shift of the coordinates lays the upright cylinder along X
    for (var i = 0; i < m.pos.length; i += 3) {
      pos.push(m.pos[i + 2], m.pos[i], m.pos[i + 1]);
      nor.push(m.nor[i + 2], m.nor[i], m.nor[i + 1]);
    }
    return { pos: pos, nor: nor, idx: m.idx };
  }

  // Tool-tip path for the first groove, as line segments.
  function pathLines(r, centres, from) {
    var p = r.params, Rt = r.toolRadius, s = r.stats, out = [];
    var prev = from ? from.end : null, atStart = from ? from.atStart : true;
    centres.forEach(function (c) {
      var u = HTD.toolAxis(c), y = c.y - Rt * u.y, z = c.z - Rt * u.z;
      if (p.pattern === 'oneway') atStart = true;
      var xa = atStart ? s.xs : s.xe, xb = atStart ? s.xe : s.xs;
      if (prev && p.pattern !== 'oneway') out.push(prev.x, prev.y, prev.z, xa, y, z);
      out.push(xa, y, z, xb, y, z);
      prev = { x: xb, y: y, z: z };
      atStart = !atStart;
    });
    return { lines: out, end: prev, atStart: atStart };
  }

  function hex(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return [0.6, 0.6, 0.6];
    var v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  function create(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: true }) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
    if (!gl) return { supported: false, setResult: function () {}, setPose: function () {}, draw: function () {}, resetView: function () {}, show: {} };

    function shader(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var loc = {
      pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor'),
      mvp: gl.getUniformLocation(prog, 'uMVP'), rot: gl.getUniformLocation(prog, 'uRot'),
      color: gl.getUniformLocation(prog, 'uColor'), lit: gl.getUniformLocation(prog, 'uLit')
    };

    function solid(mesh) {
      var o = { pos: gl.createBuffer(), nor: gl.createBuffer(), idx: gl.createBuffer(), count: mesh.idx.length };
      gl.bindBuffer(gl.ARRAY_BUFFER, o.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.pos), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, o.nor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.nor), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx), gl.STATIC_DRAW);
      return o;
    }
    function lines(arr) {
      var o = { pos: gl.createBuffer(), count: arr.length / 3 };
      gl.bindBuffer(gl.ARRAY_BUFFER, o.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      return o;
    }
    function free(o) { if (!o) return; ['pos', 'nor', 'idx'].forEach(function (k) { if (o[k]) gl.deleteBuffer(o[k]); }); }

    var scene = null;
    var pose = null;      // playback state, or null for the finished-part view
    var headDir = -1;     // end of the part the rotary head is at; the opening view looks at the other, free end
    function homeYaw() { return headDir > 0 ? 0.6 : -0.6; }
    var view = { yaw: -0.6, tilt: 0.45, zoom: 1, panX: 0, panY: 0 };
    var show = { path: true, cutter: true, zero: true, chuck: true };
    // letters at the tips of the zero-point arrows, laid over the canvas
    var axisLabels = ['x', 'y', 'z'].map(function (k) {
      var el = document.createElement('span');
      el.className = 'axis-label axis-' + k;
      el.style.display = 'none';
      canvas.parentNode.appendChild(el);
      return el;
    });

    function setResult(r) {
      if (scene) {
        [scene.pulley, scene.blank, scene.cutter, scene.holder, scene.rough, scene.finish, scene.axis, scene.trail, scene.zero.ball, scene.bar, scene.head].forEach(free);
        scene.zero.arrows.forEach(free);
        scene.passes.forEach(function (ps) { free(ps.side); free(ps.face); });
      }
      scene = null; pose = null;
      if (r && r.gcode) {
        var g = r.geom, Rt = r.toolRadius;
        var ds = Math.max(Math.min(0.05, g.pitch / 100), g.teeth * g.pitch * 1.52 / 9000);          // keeps the mesh inside 16-bit indices
        var pm = pulleyMesh(r, HTD.pitchOutline(g, ds)), bm = pulleyMesh(r, blankPitch(g));
        var trail = trailLines(r.program);
        // cutter drawn at its real length, with a short holder above it
        var toolLen = r.params.toolLength, holderLen = 8, holderRad = Math.max(5, 3 * Rt), toolX = (pm.x0 + pm.x1) / 2;
        var rough = pathLines(r, r.rough, null);
        var finish = pathLines(r, r.finish, r.params.order === 'tooth' ? rough : null);
        var xa = Math.min(r.stats.xs, r.stats.xe), xb = Math.max(r.stats.xs, r.stats.xe);
        // program zero: on the rotary centreline across the part, at the centreline or the top of the stock in height
        var zeroLen = Math.max(5, Math.min(12, g.Ro * 0.5)), alongY = r.params.rotaryParallel === 'Y';
        var zero = {
          at: [0, 0, -r.stats.zOff], len: zeroLen, letters: [alongY ? 'Y' : 'X', alongY ? 'X' : 'Y', 'Z'],
          arrows: [0, 1, 2].map(function (k) { return solid(arrowMesh(k, zeroLen)); }), ball: solid(ballMesh(zeroLen * 0.06))
        };
        // rotary head at its end of the part, drawn as near as the cutter and holder leave room for
        var dir = r.stats.headDir, face = dir > 0 ? pm.x1 : pm.x0;
        var chuck = face + dir * (r.stats.headRoom + holderRad), headRad = g.Ro + 7, headLen = 12;
        if (dir > 0) xb = Math.max(xb, chuck + headLen); else xa = Math.min(xa, chuck - headLen);
        if (dir !== headDir) { headDir = dir; view.yaw = homeYaw(); }
        scene = {
          bar: solid(cylinderX(Math.min(face, chuck), Math.max(face, chuck), g.Rr * 0.8)),
          head: solid(cylinderX(Math.min(chuck, chuck + dir * headLen), Math.max(chuck, chuck + dir * headLen), headRad)),
          zero: zero,
          pulley: solid(pm), blank: solid(bm), perTooth: pm.perTooth, blankPerTooth: bm.perTooth,
          trail: lines(trail.lines), trailCounts: trail.counts, trailStarts: trail.starts,
          teeth: g.teeth, turn: r.program.turn, toolX: (pm.x0 + pm.x1) / 2, toolTip: g.Rr,
          passes: passMeshes(r).map(function (ps) { return { side: solid(ps.side), face: solid(ps.face) }; }),
          moves: r.program.moves, x0: pm.x0, x1: pm.x1,
          cutter: solid(cutterMesh(toolX, g.Rr + Rt, Rt, Math.max(0.1, toolLen - Rt))),
          holder: solid(holderMesh(toolX, g.Rr + toolLen, g.Rr + toolLen + holderLen, holderRad)),
          rough: lines(rough.lines), finish: lines(finish.lines),
          axis: lines([xa - 6, 0, 0, xb + 6, 0, 0]),
          centre: [(xa + xb) / 2, 0, (toolLen + holderLen) / 4],
          radius: Math.hypot((xb - xa) / 2, Math.max(headRad, g.Ro + (toolLen + holderLen) * 0.75))
        };
        // keep the zero point in the opening view unless it is far off the part
        var reach = Math.hypot(scene.centre[0] - zero.at[0], scene.centre[1] - zero.at[1], scene.centre[2] - zero.at[2]) + zeroLen * 1.2;
        if (reach <= scene.radius * 2.5) scene.radius = Math.max(scene.radius, reach);
      }
      draw();
    }

    function setPose(p) { pose = p; draw(); }

    function drawSolid(o, color, first, count, flat) {
      gl.bindBuffer(gl.ARRAY_BUFFER, o.pos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, o.nor); gl.enableVertexAttribArray(loc.nor); gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.idx);
      gl.uniform3fv(loc.color, color); gl.uniform1f(loc.lit, flat ? 0 : 1);
      gl.drawElements(gl.TRIANGLES, count === undefined ? o.count : count, gl.UNSIGNED_SHORT, (first || 0) * 2);
    }
    function drawLines(o, color, first, count) {
      if (first === undefined) { first = 0; count = o.count; }
      if (count <= 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, o.pos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(loc.nor); gl.vertexAttrib3f(loc.nor, 0, 0, 1);
      gl.uniform3fv(loc.color, color); gl.uniform1f(loc.lit, 0);
      gl.drawArrays(gl.LINES, first, count);
    }

    var FOV = 32 * Math.PI / 180;
    // Distance at which the whole scene fits the canvas.
    function fitDistance(aspect) {
      return scene.radius / Math.sin(Math.min(FOV, 2 * Math.atan(Math.tan(FOV / 2) * aspect)) / 2);
    }

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!scene || !show.zero) axisLabels.forEach(function (el) { el.style.display = 'none'; });
      if (!scene) return;

      var cs = getComputedStyle(document.documentElement);
      function col(name) { return hex(cs.getPropertyValue('--' + name)); }

      var fov = FOV, aspect = w / h;
      var dist = fitDistance(aspect) * view.zoom;
      var rot = mul(rotX(view.tilt - Math.PI / 2), rotZ(view.yaw));
      var mv = mul(translate(view.panX, view.panY, -dist), mul(rot, translate(-scene.centre[0], -scene.centre[1], -scene.centre[2])));
      var mvp = mul(perspective(fov, aspect, Math.max(0.5, dist - 3 * scene.radius), dist + 3 * scene.radius), mv);
      // model: optional 4x4 placing an object in the world
      function place(model) {
        var m = model ? mul(mvp, model) : mvp, n = model ? mul(rot, model) : rot;
        gl.uniformMatrix4fv(loc.mvp, false, m);
        gl.uniformMatrix3fv(loc.rot, false, new Float32Array([n[0], n[1], n[2], n[4], n[5], n[6], n[8], n[9], n[10]]));
      }

      // Program zero: an arrow along each machine axis, drawn over everything so it shows through the part.
      function drawZero() {
        if (!show.zero) return;
        var z = scene.zero, model = translate(z.at[0], z.at[1], z.at[2]), m = mul(mvp, model);
        var names = ['axis-x', 'axis-y', 'axis-z'];
        gl.disable(gl.DEPTH_TEST);
        place(model);
        z.arrows.forEach(function (a, k) { drawSolid(a, col(names[z.letters[k].charCodeAt(0) - 88]), undefined, undefined, true); });
        drawSolid(z.ball, col('text'), undefined, undefined, true);
        gl.enable(gl.DEPTH_TEST);
        axisLabels.forEach(function (el, k) {
          var t = [0, 0, 0]; t[k] = z.len * 1.15;
          var cx = m[0] * t[0] + m[4] * t[1] + m[8] * t[2] + m[12], cy = m[1] * t[0] + m[5] * t[1] + m[9] * t[2] + m[13];
          var cw = m[3] * t[0] + m[7] * t[1] + m[11] * t[2] + m[15];
          var px = (cx / cw * 0.5 + 0.5) * canvas.clientWidth, py = (0.5 - cy / cw * 0.5) * canvas.clientHeight;
          var seen = cw > 0 && px > 6 && py > 6 && px < canvas.clientWidth - 6 && py < canvas.clientHeight - 6;
          el.style.display = seen ? '' : 'none';
          if (!seen) return;
          el.textContent = z.letters[k];
          el.className = 'axis-label ' + names[z.letters[k].charCodeAt(0) - 88];
          el.style.left = px + 'px'; el.style.top = py + 'px';
        });
      }

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      if (!pose) {
        place(null);
        drawSolid(scene.pulley, col('metal-3d'));
        if (show.chuck) { drawSolid(scene.bar, col('metal-3d')); drawSolid(scene.head, col('rough')); }
        if (show.cutter) { drawSolid(scene.cutter, col('cutter-3d')); drawSolid(scene.holder, col('rough')); }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        drawLines(scene.axis, col('muted'));
        if (show.path) { drawLines(scene.rough, col('rough')); drawLines(scene.finish, col('finish')); }
        drawZero();
        return;
      }

      // Playback: the part turns with the rotary axis and each groove is shown
      // as the passes made so far have left it.
      var part = rotX(pose.P * Math.PI / 180), N = scene.teeth, metal = col('metal-3d');
      var mvNow = scene.moves[pose.move], last = scene.passes.length - 1, step = 2 * Math.PI / N;
      var x0 = scene.x0, x1 = scene.x1, partial = [], i;
      place(part);
      for (i = 0; i < N; i++) {
        var k = ((scene.turn * i) % N + N) % N;             // mesh tooth that groove i is cut into
        var count = mvNow.groove < 0 ? 0 : i < mvNow.groove ? mvNow.after : i > mvNow.groove ? mvNow.before : mvNow.done;
        var active = i === mvNow.groove && mvNow.stroke;
        if (!active && count <= 0) drawSolid(scene.blank, metal, k * scene.blankPerTooth, scene.blankPerTooth);
        else if (!active && count >= last) drawSolid(scene.pulley, metal, k * scene.perTooth, scene.perTooth);
        else partial.push({ k: k, count: Math.min(count, last), active: active });
      }
      partial.forEach(function (t) {
        var tooth = mul(part, rotX(-t.k * step));
        function span(mesh, xa, xb) {
          if (xb - xa < 1e-6) return;
          place(mul(tooth, mul(translate(xa, 0, 0), scale(xb - xa))));
          drawSolid(mesh.side, metal);
        }
        function face(mesh, x, flip) {
          place(mul(tooth, mul(translate(x, 0, 0), scale(flip ? -1 : 1))));
          drawSolid(mesh.face, metal);
        }
        var lo = scene.passes[t.count], hi = lo;
        if (t.active) {
          // the stroke in progress has cut from where it started up to the cutter
          var forward = pose.L >= pose.L0, xc = Math.max(x0, Math.min(x1, pose.L));
          var cutMesh = scene.passes[Math.min(t.count + 1, last)], uncut = lo;
          var atStart = xc - x0 < 1e-6, atEnd = x1 - xc < 1e-6;
          if (forward) lo = cutMesh; else hi = cutMesh;
          span(lo, x0, xc); span(hi, xc, x1);
          // wall of metal still ahead of the cutter; none while the cutter is clear of the part on a lead
          if (!atStart && !atEnd) face(uncut, xc, !forward);
          // an end face takes the section that actually reaches it
          if (atStart) lo = hi; else if (atEnd) hi = lo;
        } else {
          span(lo, x0, x1);
        }
        face(lo, x0, false); face(hi, x1, true);
      });
      place(part);
      if (show.chuck) { drawSolid(scene.bar, metal); drawSolid(scene.head, col('rough')); }
      if (show.cutter) {
        place(translate(pose.L - scene.toolX, pose.C, pose.Z - scene.toolTip));
        drawSolid(scene.cutter, col('cutter-3d'));
        drawSolid(scene.holder, col('rough'));
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      place(null);
      drawLines(scene.axis, col('muted'));
      if (show.path) {
        place(part);
        // only the groove being worked on, so finished grooves stay readable
        var first = scene.trailStarts[pose.move], done = pose.move > 0 ? scene.trailCounts[pose.move - 1] : 0;
        drawLines(scene.trail, col('finish'), first, done - first);
      }
      drawZero();
    }

    // ---- orbit and zoom
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      view.yaw += (e.clientX - drag.x) * 0.01;
      view.tilt = Math.max(-1.5, Math.min(1.5, view.tilt + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      draw();
    });
    function endDrag() { drag = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!scene) return;
      // Zoom about the point under the mouse: shift the view so that point stays put.
      var box = canvas.getBoundingClientRect(), aspect = box.width / box.height, fit = fitDistance(aspect);
      var before = fit * view.zoom;
      view.zoom = Math.max(0.05, Math.min(4, view.zoom * Math.exp(e.deltaY * 0.0012)));
      var change = (fit * view.zoom - before) * Math.tan(FOV / 2);
      view.panX += ((e.clientX - box.left) / box.width * 2 - 1) * aspect * change;
      view.panY += (1 - (e.clientY - box.top) / box.height * 2) * change;
      draw();
    }, { passive: false });

    function resetView() { view.yaw = homeYaw(); view.tilt = 0.45; view.zoom = 1; view.panX = view.panY = 0; draw(); }
    canvas.addEventListener('dblclick', resetView);

    return { supported: true, setResult: setResult, setPose: setPose, draw: draw, resetView: resetView, show: show };
  }

  return { create: create };
})();

export default HTDView3D;
