/*
 * Thread milling: thread sizes, helical toolpath and G-code for a thread mill on a 3-axis mill.
 * Internal threads (in a drilled hole) and external ones (on a turned boss), right or left hand,
 * one or more starts, single-point or multi-row cutters. No DOM access here, so it also loads in Node.
 *
 * Program frame: X/Y zero on the centre of each thread (the hole positions are offsets from the
 * work zero), Z zero where the setting "Top of thread" says. All lengths in mm, angles in degrees
 * unless a name says otherwise. Helical moves are G2/G3 arcs with Z, one line per full turn.
 */
const THREAD = (function () {
  'use strict';

  var IN = 25.4;
  // Thread sizes per standard: [key, label, major diameter mm, pitch mm].
  function inch(label, dia, tpi) { return [label, label, dia * IN, IN / tpi]; }
  var SIZES = {
    M: [['M2', 2, 0.4], ['M2.5', 2.5, 0.45], ['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25],
      ['M10', 10, 1.5], ['M12', 12, 1.75], ['M14', 14, 2], ['M16', 16, 2], ['M18', 18, 2.5], ['M20', 20, 2.5], ['M22', 22, 2.5],
      ['M24', 24, 3], ['M27', 27, 3], ['M30', 30, 3.5], ['M33', 33, 3.5], ['M36', 36, 4], ['M42', 42, 4.5], ['M48', 48, 5]]
      .map(function (s) { return [s[0], s[0] + ' × ' + s[2], s[1], s[2]]; }),
    MF: [[8, 1], [10, 1], [10, 1.25], [12, 1.25], [12, 1.5], [14, 1.5], [16, 1.5], [18, 1.5], [20, 1.5], [22, 1.5], [24, 2], [27, 2],
      [30, 2], [33, 2], [36, 3], [42, 3], [48, 3]]
      .map(function (s) { var k = 'M' + s[0] + 'x' + s[1]; return [k, 'M' + s[0] + ' × ' + s[1], s[0], s[1]]; }),
    UNC: [inch('#4-40', 0.112, 40), inch('#6-32', 0.138, 32), inch('#8-32', 0.164, 32), inch('#10-24', 0.19, 24), inch('1/4-20', 0.25, 20),
      inch('5/16-18', 0.3125, 18), inch('3/8-16', 0.375, 16), inch('7/16-14', 0.4375, 14), inch('1/2-13', 0.5, 13), inch('9/16-12', 0.5625, 12),
      inch('5/8-11', 0.625, 11), inch('3/4-10', 0.75, 10), inch('7/8-9', 0.875, 9), inch('1-8', 1, 8), inch('1 1/8-7', 1.125, 7),
      inch('1 1/4-7', 1.25, 7), inch('1 1/2-6', 1.5, 6)],
    UNF: [inch('#4-48', 0.112, 48), inch('#6-40', 0.138, 40), inch('#8-36', 0.164, 36), inch('#10-32', 0.19, 32), inch('1/4-28', 0.25, 28),
      inch('5/16-24', 0.3125, 24), inch('3/8-24', 0.375, 24), inch('7/16-20', 0.4375, 20), inch('1/2-20', 0.5, 20), inch('9/16-18', 0.5625, 18),
      inch('5/8-18', 0.625, 18), inch('3/4-16', 0.75, 16), inch('7/8-14', 0.875, 14), inch('1-12', 1, 12), inch('1 1/4-12', 1.25, 12),
      inch('1 1/2-12', 1.5, 12)],
    // BSP parallel (G / BSPP): Whitworth form, the size names the bore of the pipe, not the thread
    G: [['G1/8', 9.728, 28], ['G1/4', 13.157, 19], ['G3/8', 16.662, 19], ['G1/2', 20.955, 14], ['G5/8', 22.911, 14], ['G3/4', 26.441, 14],
      ['G7/8', 30.201, 14], ['G1', 33.249, 11], ['G1 1/4', 41.91, 11], ['G1 1/2', 47.803, 11], ['G2', 59.614, 11]]
      .map(function (s) { return [s[0], s[0] + ' (' + s[2] + ' tpi)', s[1], IN / s[2]]; })
  };
  var STANDARDS = {
    M: { label: 'ISO metric', angle: 60, size: 'M10' },
    MF: { label: 'ISO metric fine', angle: 60, size: 'M12x1.5' },
    UNC: { label: 'UNC', angle: 60, size: '1/4-20', inch: true },
    UNF: { label: 'UNF', angle: 60, size: '1/4-28', inch: true },
    G: { label: 'BSP (G)', angle: 55, size: 'G1/2', inch: true },
    custom: { label: 'Custom', angle: 60, size: 'custom' }
  };

  // Starting values for carbide thread mills: chip load per tooth as a fraction of the cutter
  // diameter, and surface speed in m/min (used only to suggest a spindle speed).
  var MATERIALS = {
    aluminium: { label: 'Aluminium', chip: 0.006, speed: 200 },
    steel: { label: 'Mild steel', chip: 0.0035, speed: 90 },
    stainless: { label: 'Stainless steel', chip: 0.0025, speed: 60 },
    brass: { label: 'Brass', chip: 0.005, speed: 150 },
    castiron: { label: 'Cast iron', chip: 0.004, speed: 80 },
    plastic: { label: 'Plastic', chip: 0.009, speed: 200 }
  };

  var DEFAULTS = {
    standard: 'M',          // key of STANDARDS
    size: 'M10',            // key in SIZES[standard], or 'custom'
    kind: 'internal',       // 'internal' (in a hole) | 'external' (on a boss)
    hand: 'right',          // 'right' | 'left'
    starts: 1,
    majorDia: 10,
    pitch: 1.5,
    angle: 60,              // included angle of the thread form
    minorDia: 8.376,        // internal: basic minor (hole) diameter; external: root diameter the cutter tip reaches
    holeDia: 8.5,           // internal: drilled hole
    stockDia: 10,           // external: turned boss
    allowance: 0,           // mm on the diameter: + makes the thread looser (internal bigger, external smaller)
    length: 15,             // full thread from the top down
    zTop: 0,                // Z of the top of the thread (the face the hole is drilled from)
    holeDepth: 0,           // internal blind hole: drilled depth below the top, 0 = through
    centres: '0,0',         // thread centres, "x,y" pairs separated by semicolons or new lines
    toolDia: 6,             // cutting diameter of the thread mill
    rows: 1,                // teeth along the cutter at the thread pitch (1 = single-point)
    tipOffset: 0,           // lowest tooth's centre above the cutter tip
    shaftDia: 4.3,          // diameter of the shaft (neck) above the teeth; at most cutter − 2 × thread depth
    shaftLen: 20,           // shaft length from the top tooth up to the holder
    flutes: 3,
    material: 'aluminium',
    rpm: 6000,
    feedAuto: true,         // work the cutting feed out from the material
    feed: 380,              // feed at the cutting edge, mm/min (used as entered when feedAuto is off)
    edgeFeed: true,         // the feed is at the cutting edge: convert it to the cutter-centre feed G-code needs
    plunge: 500,            // straight feed moves into and out of the work
    direction: 'climb',     // 'climb' | 'conventional'
    passes: 3,              // radial passes to full depth
    spacing: 'area',        // 'area' (equal chip area: deeper first) | 'equal' (equal depth)
    springPasses: 1,        // extra passes at full depth
    clearance: 5,           // above the top of the thread
    wcs: 'G54',
    toolChange: false,
    toolNumber: 1,
    coolant: 'off',         // 'off' | 'flood' (M8) | 'mist' (M7)
    dwell: 2,
    rapidRate: 2000,        // the last three only feed the time estimate
    feedOverride: 100,
    quantity: 1
  };
  // Settings that follow the thread size (and the internal/external choice).
  var SIZE_FIELDS = ['majorDia', 'pitch', 'angle', 'minorDia', 'holeDia', 'stockDia'];

  // ---------------------------------------------------------------- sizes and form

  function sizeList(standard) { return SIZES[standard] || []; }
  function findSize(standard, key) {
    var list = sizeList(standard);
    for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i];
    return null;
  }

  // Radial depth of the basic form from the major diameter: to the internal minor diameter, and to the
  // external root the cutter tip has to reach. ISO/UN 60°: 5/8 H and 17/24 H; Whitworth 55°: 2/3 H for both.
  function formDepths(pitch, angle) {
    var H = pitch / (2 * Math.tan(angle * Math.PI / 360));
    if (Math.abs(angle - 55) < 1e-6) return { H: H, internal: H * 2 / 3, external: H * 2 / 3 };
    return { H: H, internal: H * 5 / 8, external: H * 17 / 24 };
  }

  function round(v, dp) { var f = Math.pow(10, dp); return Math.round(v * f) / f; }

  // Diameters that follow a size (major, pitch, angle) for an internal or external thread.
  function derived(major, pitch, angle, kind) {
    var d = formDepths(pitch, angle);
    // the usual tap drill leaves about 75 % of the basic thread height
    var drill = Math.abs(angle - 55) < 1e-6 ? major - 1.19 * pitch : major - pitch;
    return {
      minorDia: round(major - 2 * (kind === 'external' ? d.external : d.internal), 3),
      holeDia: round(drill, 2),
      stockDia: round(major, 3)
    };
  }

  /** Values of SIZE_FIELDS for a standard and size key (null for a custom size). */
  function sizeSettings(standard, key, kind) {
    var s = findSize(standard, key);
    if (!s) return null;
    var angle = (STANDARDS[standard] || STANDARDS.M).angle;
    var out = derived(s[2], s[3], angle, kind);
    out.majorDia = round(s[2], 3); out.pitch = round(s[3], 4); out.angle = angle;
    return out;
  }

  /** "M10 × 1.5", "1/4-20 UNC", or "Ø10 × 1.5" for a custom size. */
  function threadName(p) {
    var st = STANDARDS[p.standard] || STANDARDS.custom, s = findSize(p.standard, p.size);
    if (!s) return 'Ø' + fmt(p.majorDia, 2) + ' × ' + fmt(p.pitch, 3);
    if (p.standard === 'UNC' || p.standard === 'UNF') return s[0] + ' ' + p.standard;
    if (p.standard === 'G') return s[0];
    return s[1];
  }

  /** Bigger than this the cutter will not fit the hole comfortably (cutter dia / thread major). */
  var MAX_INTERNAL_RATIO = 0.7;
  var APPROACH = 1;            // mm above the top where rapids hand over to feed

  // ---------------------------------------------------------------- G-code

  function fmt(v, dp) {
    var s = v.toFixed(dp);
    return parseFloat(s) === 0 ? (0).toFixed(dp) : s;
  }

  // Parse "x,y; x,y" (also spaces or new lines between pairs).
  function parseCentres(text) {
    var nums = String(text || '').split(/[\s,;]+/).filter(function (t) { return t !== ''; });
    if (!nums.length || nums.length % 2) return null;
    var out = [];
    for (var i = 0; i < nums.length; i += 2) {
      var x = Number(nums[i]), y = Number(nums[i + 1]);
      if (!isFinite(x) || !isFinite(y)) return null;
      out.push({ x: x, y: y });
    }
    return out;
  }

  function Emitter(p) {
    this.lines = [];
    this.pos = { X: undefined, Y: undefined, Z: undefined };
    this.txt = {};
    this.feed = null;
    this.rapidRate = p.rapidRate;
    this.feedScale = p.feedOverride / 100;
    this.moves = [];            // every motion line, for the playback preview
    this.tag = { hole: -1, pass: -1, start: 0, phase: 'move', done: 0 };   // done: passes finished on this thread
    this.time = { rough: 0, finish: 0, spring: 0, move: 0, rapid: 0 };
    this.dist = { rough: 0, finish: 0, spring: 0, move: 0, rapid: 0 };
  }
  Emitter.prototype.raw = function (s) { this.lines.push(s); };
  Emitter.prototype.comment = function (s) { this.lines.push('(' + s.replace(/[()]/g, '') + ')'); };
  Emitter.prototype.words = function (t) {
    var words = [], self = this;
    ['X', 'Y', 'Z'].forEach(function (k) {
      if (t[k] === undefined) return;
      var s = fmt(t[k], 4);
      if (self.txt[k] === s) return;
      self.txt[k] = s;
      words.push(k + s);
    });
    return words;
  };
  Emitter.prototype.record = function (line, kind, from, to, len, F, arc) {
    var known = from.X !== undefined && from.Y !== undefined && from.Z !== undefined;
    var minutes = !known ? 0 : F ? len / (F * this.feedScale) : len / this.rapidRate;
    var bucket = F ? (kind === 'cut' ? this.tag.phase : 'move') : 'rapid';
    if (known) { this.time[bucket] += minutes; this.dist[bucket] += len; }
    var m = { line: this.lines.length, kind: kind, X: to.X, Y: to.Y, Z: to.Z, dt: minutes,
      hole: this.tag.hole, pass: this.tag.pass, start: this.tag.start, phase: this.tag.phase, done: this.tag.done };
    if (arc) m.arc = arc;
    this.moves.push(m);
    this.lines.push(line);
  };
  Emitter.prototype.lin = function (code, t, F) {
    var from = { X: this.pos.X, Y: this.pos.Y, Z: this.pos.Z }, to = {
      X: t.X !== undefined ? t.X : from.X, Y: t.Y !== undefined ? t.Y : from.Y, Z: t.Z !== undefined ? t.Z : from.Z };
    var words = this.words(t);
    if (!words.length) return;
    var line = code + ' ' + words.join(' ');
    if (code === 'G1' && this.feed !== F) { line += ' F' + fmt(F, 0); this.feed = F; }
    var len = Math.hypot((to.X || 0) - (from.X || 0), (to.Y || 0) - (from.Y || 0), (to.Z || 0) - (from.Z || 0));
    this.pos = to;
    this.record(line, code === 'G1' ? 'feed' : 'rapid', from, to, len, code === 'G1' ? F : 0);
  };
  Emitter.prototype.rapid = function (t) { this.lin('G0', t); };
  Emitter.prototype.line = function (t, F) { this.lin('G1', t, F); };
  // Arc (with Z: a helix) about centre (cx, cy) to the end point, sweeping `turn` radians
  // (positive = counter-clockwise, G3). A full turn ends where it started.
  Emitter.prototype.arc = function (t, cx, cy, turn, F) {
    var from = { X: this.pos.X, Y: this.pos.Y, Z: this.pos.Z };
    var code = turn > 0 ? 'G3' : 'G2';
    var i = cx - from.X, j = cy - from.Y, r = Math.hypot(i, j);
    // a full circle repeats the end point, so every word is written out
    this.txt = {};
    var line = code + ' ' + this.words(t).join(' ') + ' I' + fmt(i, 4) + ' J' + fmt(j, 4);
    if (this.feed !== F) { line += ' F' + fmt(F, 0); this.feed = F; }
    var dz = t.Z - from.Z, len = Math.hypot(Math.abs(turn) * r, dz);
    this.pos = { X: t.X, Y: t.Y, Z: t.Z };
    this.record(line, 'cut', from, this.pos, len, F,
      { cx: cx, cy: cy, r: r, a0: Math.atan2(from.Y - cy, from.X - cx), turn: turn, z0: from.Z, dz: dz });
  };

  // ---------------------------------------------------------------- generate

  function validate(p) {
    var e = [];
    function pos(k, label) { if (!(p[k] > 0)) e.push(label + ' must be greater than zero.'); }
    function nonNeg(k, label) { if (!(p[k] >= 0)) e.push(label + ' cannot be negative.'); }
    function int(k, label, lo, hi) { if (!(Number.isInteger(p[k]) && p[k] >= lo && p[k] <= hi)) e.push(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); }
    pos('majorDia', 'Major diameter'); pos('pitch', 'Pitch'); pos('length', 'Thread length');
    if (!(p.angle >= 20 && p.angle <= 120)) e.push('Thread angle must be between 20° and 120°.');
    pos('minorDia', p.kind === 'external' ? 'Root diameter' : 'Minor diameter');
    if (p.kind === 'external') pos('stockDia', 'Stock diameter'); else pos('holeDia', 'Hole diameter');
    if (!isFinite(p.allowance)) e.push('Diameter allowance must be a number.');
    if (!isFinite(p.zTop)) e.push('Top of thread must be a number.');
    nonNeg('holeDepth', 'Hole depth');
    int('starts', 'Starts', 1, 8);
    pos('toolDia', 'Cutter diameter'); int('rows', 'Teeth along the cutter', 1, 60); nonNeg('tipOffset', 'Lowest tooth above the tip');
    pos('shaftDia', 'Shaft diameter'); nonNeg('shaftLen', 'Shaft length'); int('flutes', 'Flutes', 1, 12);
    pos('rpm', 'Spindle speed'); pos('feed', 'Cutting feed'); pos('plunge', 'Plunge feed');
    int('passes', 'Radial passes', 1, 50); int('springPasses', 'Spring passes', 0, 5);
    nonNeg('clearance', 'Clearance');
    int('toolNumber', 'Tool number', 1, 99); nonNeg('dwell', 'Spindle start dwell');
    pos('rapidRate', 'Rapid rate'); pos('feedOverride', 'Feed override');
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push('Parts to make must be a whole number, 1 or more.');
    if (!parseCentres(p.centres)) e.push('Thread centres must be pairs of numbers, x,y, separated by semicolons, for example 0,0; 20,0.');
    if (e.length) return e;
    if (p.minorDia >= p.majorDia) e.push((p.kind === 'external' ? 'Root' : 'Minor') + ' diameter must be smaller than the major diameter.');
    if (p.kind === 'internal') {
      if (p.holeDia + 1e-9 >= p.majorDia + p.allowance) e.push('The hole is already as big as the thread: drill it smaller than ' + fmt(p.majorDia + p.allowance, 3) + ' mm.');
      if (p.toolDia >= p.holeDia) e.push('The cutter (' + fmt(p.toolDia, 2) + ' mm) must be smaller than the hole (' + fmt(p.holeDia, 2) + ' mm).');
    } else {
      if (p.stockDia <= p.minorDia - p.allowance + 1e-9) e.push('The stock is already as small as the thread root: turn it bigger than ' + fmt(p.minorDia - p.allowance, 3) + ' mm.');
      if (p.minorDia - p.allowance <= 0) e.push('The allowance takes the root diameter to zero.');
    }
    return e;
  }

  function generate(input) {
    var p = {}, k;
    for (k in DEFAULTS) p[k] = input && input[k] !== undefined ? input[k] : DEFAULTS[k];
    var out = { params: p, errors: [], warnings: [], gcode: '' };
    var mat = MATERIALS[p.material] || MATERIALS.aluminium;
    // the feed worked out from the material, shown even while the entered one is used
    out.autoFeed = Math.round(mat.chip * p.toolDia * p.flutes * p.rpm / 5) * 5;
    if (p.feedAuto && isFinite(out.autoFeed) && out.autoFeed > 0) p.feed = out.autoFeed;
    out.errors = validate(p);
    if (out.errors.length) return out;

    var w = out.warnings, internal = p.kind !== 'external';
    var rt = p.toolDia / 2, P = p.pitch, lead = P * p.starts;
    var dep = formDepths(P, p.angle);
    var centres = parseCentres(p.centres);

    // ---- radial passes: diameter the cutter tip reaches on each, from the prepared surface to full depth
    var dStart = internal ? p.holeDia : p.stockDia;
    var dFinal = internal ? p.majorDia + p.allowance : p.minorDia - p.allowance;
    var depth = Math.abs(dFinal - dStart) / 2, sgn = internal ? 1 : -1;
    var passes = [];
    for (var i = 1; i <= p.passes; i++) {
      var f = p.spacing === 'equal' ? i / p.passes : Math.sqrt(i / p.passes);
      passes.push({ tipDia: dStart + sgn * 2 * depth * f, phase: i === p.passes ? 'finish' : 'rough' });
    }
    for (i = 0; i < p.springPasses; i++) passes.push({ tipDia: dFinal, phase: 'spring' });
    passes.forEach(function (ps, n) {
      ps.n = n;
      ps.cut = n === 0 ? depth * (p.spacing === 'equal' ? 1 / p.passes : Math.sqrt(1 / p.passes)) : Math.abs(ps.tipDia - passes[n - 1].tipDia) / 2;
      ps.r = ps.tipDia / 2 - sgn * rt;          // radius of the cutter-centre path
    });

    // ---- feeds: the entered feed is at the cutting edge; the cutter centre runs on a smaller circle
    // inside a hole and a larger one round a boss, so G-code gets the centre feed
    passes.forEach(function (ps) {
      var ratio = p.edgeFeed ? ps.r / (ps.tipDia / 2) : 1;
      ps.feed = Math.max(1, Math.round(p.feed * ratio));
    });

    // ---- direction: climb milling has the cutter go anticlockwise (G3) inside a hole and clockwise
    // (G2) round a boss, with the spindle turning clockwise (M3). A right-hand thread rises going
    // anticlockwise seen from above.
    var ccw = (internal === (p.direction !== 'conventional'));
    var turnSign = ccw ? 1 : -1;
    var rises = (p.hand === 'left') ? !ccw : ccw;

    // ---- Z: the lowest tooth runs from half a pitch above the bottom of the thread up until the top
    // tooth clears the top by half a pitch, in whole turns so every start lands in the same place
    var zBottom = p.zTop - p.length + P / 2;            // lowest tooth centre, low end of the helix
    var zTopTooth = p.zTop + P / 2 - (p.rows - 1) * P;   // lowest tooth centre when the top tooth clears the top
    var turns = Math.max(1, Math.ceil((zTopTooth - zBottom) / lead - 1e-9));
    var zHigh = zBottom + turns * lead;
    var ramp = lead / 4;                                 // Z change over each quarter-turn lead arc
    var zLowTip = zBottom - ramp - p.tipOffset, zHighTip = zHigh + ramp - p.tipOffset;
    var zSafe = p.zTop + p.clearance, zAppr = p.zTop + Math.min(APPROACH, p.clearance);
    var finalR = passes[p.passes - 1].r;

    // ---- lead arcs: a quarter circle tangent to the helix, in from the hole centre or from outside the boss
    function leadRadius(ps) {
      if (internal) return ps.r / 2;
      // far enough out that the cutter starts clear of the stock
      return Math.max(1, p.stockDia / 2 + 0.5 + rt - ps.r);
    }

    // ---- checks
    var ratio = p.toolDia / p.majorDia;
    if (internal && ratio > MAX_INTERNAL_RATIO) w.push('The cutter is ' + Math.round(ratio * 100) + ' % of the thread diameter. Above about 70 % it rubs on the far side of its cut and chatters; a smaller cutter cuts a truer thread.');
    if (internal) {
      var ps0 = passes[0], re0 = leadRadius(ps0), startDist = Math.hypot(ps0.r - re0, re0);
      if (startDist + rt > p.holeDia / 2 + 1e-6) w.push('The cutter is too big for a clean lead-in: it touches the hole wall before the arc starts.');
    }
    if (internal && p.holeDia < p.minorDia - 1e-6) w.push('The hole (' + fmt(p.holeDia, 2) + ' mm) is smaller than the minor diameter (' + fmt(p.minorDia, 3) + ' mm): the cutter will also cut the crests, at full width, on the first pass.');
    if (!internal && p.stockDia > p.majorDia + 1e-6) w.push('The stock (' + fmt(p.stockDia, 2) + ' mm) is bigger than the thread (' + fmt(p.majorDia, 3) + ' mm): the cutter will also cut the crests on the first pass.');
    // ---- shaft and holder: the head (teeth) ends half a pitch above the top tooth, the shaft runs on to the holder
    var headLen = p.tipOffset + (p.rows - 1) * P + P / 2;
    var stickOut = headLen + p.shaftLen;                     // tip to holder
    var reachNeeded = p.zTop - zLowTip;                      // from the top face down to the lowest tip
    if (reachNeeded > stickOut + 1e-6) w.push('The tip goes ' + fmt(reachNeeded, 1) + ' mm below the top, but the holder is only ' + fmt(stickOut, 1) + ' mm above the tip (teeth ' + fmt(headLen, 1) + ' + shaft ' + fmt(p.shaftLen, 1) + ' mm): the holder will hit the part.');
    // the shaft goes into the thread when the head is fully below the top; it must then clear the crests on every pass
    var shaftR = p.shaftDia / 2, shaftIn = zLowTip + headLen < p.zTop - 1e-6;
    if (shaftIn) {
      var crestR = internal ? p.holeDia / 2 : p.stockDia / 2;
      var gap = internal ? crestR - (finalR + shaftR) : (finalR - shaftR) - crestR;
      if (gap < 0) out.errors.push('The shaft (Ø' + fmt(p.shaftDia, 2) + ' mm) goes ' + fmt(p.zTop - zLowTip - headLen, 1) + ' mm into the thread and would cut the crests by ' + fmt(-gap, 2) + ' mm. The neck must be no more than the cutting diameter less twice the thread depth (' + fmt(p.toolDia - 2 * (internal ? (p.majorDia - p.holeDia) / 2 : (p.stockDia - p.minorDia) / 2), 2) + ' mm here). Use a cutter with a thinner neck, or a shorter thread.');
      else if (gap < 0.05) w.push('The shaft clears the thread crests by only ' + fmt(gap, 2) + ' mm.');
    }
    if (internal && p.holeDepth > 0 && p.zTop - zLowTip > p.holeDepth + 1e-6)
      out.errors.push('The cutter tip goes ' + fmt(p.zTop - zLowTip, 2) + ' mm deep, below the bottom of the ' + fmt(p.holeDepth, 2) + ' mm hole. Shorten the thread or drill deeper.');
    if (internal && p.holeDepth > 0 && p.holeDepth < p.length) out.errors.push('The thread is longer than the hole is deep.');
    if (p.rows > 1 && (p.rows - 1) * P > p.length) w.push('The cutter’s teeth span more than the thread length; the extra teeth cut above the top in air.');
    var maxCut = Math.max.apply(null, passes.map(function (ps) { return ps.cut; }));
    if (maxCut > 0.6 * P + 0.1) w.push('The first pass is ' + fmt(maxCut, 2) + ' mm deep. A thread mill usually takes no more than about half the pitch per pass; add radial passes.');
    if (p.feedAuto) {
      var sug = mat.speed * 1000 / (Math.PI * p.toolDia);
      if (p.rpm > sug * 1.6) w.push('The spindle speed is well above the usual ' + Math.round(sug / 100) * 100 + ' rpm for this cutter in ' + mat.label.toLowerCase() + '.');
    }
    if (out.errors.length) return out;

    // ---- program
    var E = new Emitter(p);
    var name = threadName(p);
    E.comment(name + ' ' + (internal ? 'internal' : 'external') + ' thread, ' + p.hand + ' hand' + (p.starts > 1 ? ', ' + p.starts + ' starts' : '') +
      ', ' + fmt(p.length, 2) + ' mm long');
    E.comment('Major dia ' + fmt(p.majorDia, 3) + '  Pitch ' + fmt(P, 4) + (p.starts > 1 ? '  Lead ' + fmt(lead, 4) : '') + '  Angle ' + fmt(p.angle, 1) + ' deg');
    E.comment(internal ? 'Hole ' + fmt(p.holeDia, 3) + ', cut to ' + fmt(dFinal, 3) + ' dia' + (p.holeDepth > 0 ? ', hole ' + fmt(p.holeDepth, 2) + ' deep' : ', through hole')
      : 'Stock ' + fmt(p.stockDia, 3) + ', cut to ' + fmt(dFinal, 3) + ' root dia');
    E.comment('Cutter: ' + fmt(p.toolDia, 2) + ' mm thread mill, ' + (p.rows > 1 ? p.rows + ' teeth along it' : 'single point') + ', ' + p.flutes + ' flutes, ' + fmt(p.rpm, 0) + ' rpm');
    E.comment('Shaft: ' + fmt(p.shaftDia, 2) + ' mm dia, ' + fmt(p.shaftLen, 1) + ' mm long; holder ' + fmt(stickOut, 1) + ' mm above the tip');
    E.comment('Material: ' + mat.label + ', edge feed ' + fmt(p.feed, 0) + ' mm/min = ' + fmt(p.feed / (p.rpm * p.flutes), 4) + ' mm per tooth' + (p.feedAuto ? ', set from it' : ''));
    E.comment((p.direction === 'conventional' ? 'Conventional' : 'Climb') + ' milling, ' + (rises ? 'bottom up' : 'top down') + ', ' +
      p.passes + ' radial passes' + (p.springPasses ? ' + ' + p.springPasses + ' spring' : '') + ', ' + turns + ' turns each');
    E.comment('SETUP: X0 Y0 at the work zero, threads at ' + centres.map(function (c) { return 'X' + fmt(c.x, 3) + ' Y' + fmt(c.y, 3); }).join(', '));
    E.comment('SETUP: Z0 so the top of the thread is at Z' + fmt(p.zTop, 3) + ', cutter tip as the tool length reference');
    E.raw('G17 G21 G90 G94 G40');
    if (p.wcs) E.raw(p.wcs);
    if (p.toolChange) { E.raw('T' + p.toolNumber + ' M6'); E.raw('G43 H' + p.toolNumber); }
    E.rapid({ Z: zSafe });
    E.rapid({ X: centres[0].x, Y: centres[0].y });
    E.raw('M3 S' + fmt(p.rpm, 0));
    if (p.coolant === 'flood') E.raw('M8');
    if (p.coolant === 'mist') E.raw('M7');
    if (p.dwell > 0) {
      E.moves.push({ line: E.lines.length, kind: 'dwell', X: E.pos.X, Y: E.pos.Y, Z: E.pos.Z, dt: p.dwell / 60, hole: -1, pass: -1, start: 0, phase: 'move', done: 0 });
      E.raw('G4 P' + fmt(p.dwell, 1));
    }

    // One pass: lead in on a quarter arc, `turns` full turns of helix, lead out on a quarter arc.
    // Tooth Z values are converted to tip Z (minus tipOffset) for the program.
    function cutPass(c, ps, s) {
      var a = 2 * Math.PI * s / p.starts;              // each start begins a share of a turn further round
      var u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -u.y * turnSign, y: u.x * turnSign };
      var re = leadRadius(ps), out1 = internal ? ps.r - re : ps.r + re;
      var arcSign = internal ? turnSign : -turnSign;   // a boss is approached on an arc curving the other way
      var ce = { x: c.x + out1 * u.x, y: c.y + out1 * u.y };
      var sIn = { x: ce.x - re * v.x, y: ce.y - re * v.y }, sOut = { x: ce.x + re * v.x, y: ce.y + re * v.y };
      var onPath = { x: c.x + ps.r * u.x, y: c.y + ps.r * u.y };
      var z0 = rises ? zBottom : zHigh, dir = rises ? 1 : -1;
      var tip = function (z) { return z - p.tipOffset; };
      var zIn = tip(z0 - dir * ramp);
      E.tag.phase = 'move';
      if (internal) {
        // down the middle of the hole, which is clear, then out to the start of the lead arc
        E.rapid({ X: c.x, Y: c.y });
        E.rapid({ Z: zIn });
        E.line({ X: sIn.x, Y: sIn.y }, p.plunge);
      } else {
        // beside the boss, outside it, then down in the clear
        if (E.pos.Z < zAppr) E.rapid({ Z: zAppr });
        E.rapid({ X: sIn.x, Y: sIn.y });
        E.rapid({ Z: zAppr });
        E.line({ Z: zIn }, p.plunge);
      }
      E.tag.phase = ps.phase;
      E.arc({ X: onPath.x, Y: onPath.y, Z: tip(z0) }, ce.x, ce.y, arcSign * Math.PI / 2, ps.feed);
      for (var t = 1; t <= turns; t++) E.arc({ X: onPath.x, Y: onPath.y, Z: tip(z0 + dir * lead * t) }, c.x, c.y, turnSign * 2 * Math.PI, ps.feed);
      var z1 = z0 + dir * lead * turns;
      E.arc({ X: sOut.x, Y: sOut.y, Z: tip(z1 + dir * ramp) }, ce.x, ce.y, arcSign * Math.PI / 2, ps.feed);
      E.tag.phase = 'move';
      if (internal) E.line({ X: c.x, Y: c.y }, p.plunge);
      else E.line({ Z: Math.max(zAppr, E.pos.Z) }, p.plunge);
    }

    centres.forEach(function (c, h) {
      E.tag.hole = h; E.tag.done = 0;
      E.tag.pass = -1; E.tag.phase = 'move';
      E.comment('Thread ' + (h + 1) + ' of ' + centres.length + ' at X' + fmt(c.x, 3) + ' Y' + fmt(c.y, 3));
      E.rapid({ Z: zSafe });
      passes.forEach(function (ps) {
        E.tag.pass = ps.n; E.tag.done = ps.n;
        E.comment('Pass ' + (ps.n + 1) + ' of ' + passes.length + (ps.phase === 'spring' ? ', spring pass' : ps.phase === 'finish' ? ', to full depth' : '') +
          ': tip at ' + fmt(ps.tipDia, 3) + ' dia, ' + fmt(ps.cut, 3) + ' mm cut, F' + ps.feed);
        for (var s = 0; s < p.starts; s++) {
          E.tag.start = s;
          if (p.starts > 1) E.comment('Start ' + (s + 1) + ' of ' + p.starts);
          cutPass(c, ps, s);
        }
      });
      E.tag.pass = -1; E.tag.phase = 'move'; E.tag.done = passes.length;
      E.rapid({ Z: zSafe });
    });
    if (p.coolant !== 'off') E.raw('M9');
    E.raw('M5');
    E.raw('M30');
    out.gcode = E.lines.join('\n') + '\n';

    // ---- playback data: end of each move, start and end times in minutes
    var clock = 0, last = { X: centres[0].x, Y: centres[0].y, Z: zSafe };
    out.program = {
      start: { X: centres[0].x, Y: centres[0].y, Z: zSafe },
      moves: E.moves.map(function (m) {
        ['X', 'Y', 'Z'].forEach(function (kk) { if (m[kk] === undefined) m[kk] = last[kk]; });
        var o = { line: m.line, kind: m.kind, X: m.X, Y: m.Y, Z: m.Z, t0: clock, t1: clock + m.dt,
          hole: m.hole, pass: m.pass, start: m.start, phase: m.phase, done: m.done, arc: m.arc };
        last = m;
        clock += m.dt;
        return o;
      })
    };
    out.program.total = clock;

    var time = E.time, total = p.dwell / 60;
    time.dwell = p.dwell / 60;
    ['rough', 'finish', 'spring', 'move', 'rapid'].forEach(function (kk) { total += time[kk]; });
    out.geom = {
      name: name, internal: internal, H: dep.H, depth: depth, dStart: dStart, dFinal: dFinal, lead: lead,
      turns: turns, zBottom: zBottom, zHigh: zHigh, ramp: ramp, zLowTip: zLowTip, zHighTip: zHighTip,
      zSafe: zSafe, zAppr: zAppr, finalR: finalR, rises: rises, ccw: ccw, centres: centres,
      leadRadius: passes.map(leadRadius)
    };
    out.passes = passes;
    out.stats = {
      lines: E.lines.length,
      minutes: total,
      time: time,
      dist: E.dist,
      cutLength: E.dist.rough + E.dist.finish + E.dist.spring,
      finalFeed: passes[p.passes - 1].feed,
      toothLoad: p.feed / (p.rpm * p.flutes),
      materialLabel: mat.label, materialChip: mat.chip * p.toolDia, suggestedRpm: mat.speed * 1000 / (Math.PI * p.toolDia),
      ratio: ratio, reachNeeded: reachNeeded, headLen: headLen, stickOut: stickOut, holes: centres.length
    };
    return out;
  }

  return {
    DEFAULTS: DEFAULTS, STANDARDS: STANDARDS, SIZES: SIZES, SIZE_FIELDS: SIZE_FIELDS, MATERIALS: MATERIALS,
    sizeList: sizeList, findSize: findSize, sizeSettings: sizeSettings, derived: derived, formDepths: formDepths,
    threadName: threadName, parseCentres: parseCentres, generate: generate
  };
})();

export default THREAD;
