/*
 * Keyway slotting: an internal keyway shaped in a bore on a 3-axis mill. The spindle is stopped
 * and held (oriented with M19, or locked by hand), a slotting tool in it, and Z strokes the
 * cutting edge down the bore. Each stroke steps the edge a little further out from the bore
 * centre; on the way back up the tool is pulled clear of the cut by the relief.
 * No DOM access here, so it also loads in Node.
 *
 * Geometry, per keyway: u is the unit vector from the bore centre toward the keyway bottom (the
 * keyway angle), v is square to it. The keyway runs from the bore wall to radius R + t2 along u
 * and is b wide along v. The cutting edge is a flat face, square to u, toolWidth wide; it sits
 * edgeOffset in front of the spindle axis, so the program X/Y (spindle axis) is
 * centre + u (r - edgeOffset) + v y for an edge at radius r on a lane at side offset y.
 * All lengths in mm, angles in degrees.
 */
const KEYWAY = (function () {
  'use strict';

  var IN = 25.4;
  // DIN 6885-1 (ISO R773) parallel keys: [bore from, bore to, key width b, key height h, hub depth t2]
  var DIN = [
    [6, 8, 2, 2, 1.0], [8, 10, 3, 3, 1.4], [10, 12, 4, 4, 1.8], [12, 17, 5, 5, 2.3], [17, 22, 6, 6, 2.8],
    [22, 30, 8, 7, 3.3], [30, 38, 10, 8, 3.3], [38, 44, 12, 8, 3.3], [44, 50, 14, 9, 3.8], [50, 58, 16, 10, 4.3],
    [58, 65, 18, 11, 4.4], [65, 75, 20, 12, 4.9], [75, 85, 22, 14, 5.4], [85, 95, 25, 14, 5.4], [95, 110, 28, 16, 6.4],
    [110, 130, 32, 18, 7.4], [130, 150, 36, 20, 8.4]
  ];
  // ANSI B17.1 square keys: [bore from, bore to (inch), key width (inch)]; hub depth is half the key at the side walls
  var ANSI = [
    [5 / 16, 7 / 16, 3 / 32], [7 / 16, 9 / 16, 1 / 8], [9 / 16, 7 / 8, 3 / 16], [7 / 8, 1.25, 1 / 4], [1.25, 1.375, 5 / 16],
    [1.375, 1.75, 3 / 8], [1.75, 2.25, 1 / 2], [2.25, 2.75, 5 / 8], [2.75, 3.25, 3 / 4], [3.25, 3.75, 7 / 8], [3.75, 4.5, 1]
  ];
  var STANDARDS = {
    DIN: { label: 'DIN 6885', bore: 20 },
    ANSI: { label: 'ANSI B17.1', bore: 25.4, inch: true },
    custom: { label: 'Custom' }
  };

  // Usual depth per stroke for a sharp HSS or carbide slotting tool, mm.
  var MATERIALS = {
    aluminium: { label: 'Aluminium', doc: 0.08 },
    brass: { label: 'Brass', doc: 0.06 },
    steel: { label: 'Mild steel', doc: 0.04 },
    castiron: { label: 'Cast iron', doc: 0.05 },
    stainless: { label: 'Stainless steel', doc: 0.025 },
    plastic: { label: 'Plastic', doc: 0.12 }
  };

  var DEFAULTS = {
    standard: 'DIN',        // key of STANDARDS
    boreDia: 20,            // bore the keyway is cut in
    width: 6,               // keyway width b
    depth: 2.8,             // hub depth t2, bore wall to keyway bottom, on the keyway centre line
    hubLength: 25,          // length of the bore (top face to bottom face)
    ends: 'through',        // 'through' | 'blind'
    keyLength: 20,          // blind: keyway length from the top face
    hubDia: 50,             // outside of the hub, for the drawings only
    // position
    centreX: 0, centreY: 0, // bore centre in work coordinates
    angle: 0,               // direction of the (first) keyway from the bore centre, degrees from +X
    keyways: 1,             // number of keyways, equally spaced round the bore
    zTop: 0,                // top face of the hub
    clearance: 3,           // above the top face for the moves between strokes
    // tool
    toolWidth: 6,           // width of the cutting edge
    edgeOffset: 3,          // cutting edge in front of the spindle axis
    headDepth: 8,           // tool head from the cutting edge back to its back face
    reach: 40,              // cutting edge to the holder
    orient: true,           // M19 spindle orient before each keyway
    orientOffset: 0,        // M19 R angle when the edge faces +X
    // cutting
    material: 'steel',
    docAuto: true,          // depth per stroke from the material
    doc: 0.04,              // depth of cut per stroke (radial)
    springStrokes: 2,       // extra strokes at full depth
    strokeFeed: 2000,       // cutting stroke, down
    returnRapid: true,      // stroke back up at rapid (tool pulled clear)
    returnFeed: 4000,
    relief: 0.2,            // tool pulled back from the cut before the return stroke
    sideFeed: 600,          // moves in and out (relief, step to the next stroke)
    overtravel: 2,          // through keyway: edge goes this far below the bottom face
    // program
    wcs: 'G54',
    toolChange: false,
    toolNumber: 1,
    coolant: 'off',
    // time calculator
    rapidRate: 2000,
    feedOverride: 100,
    quantity: 1
  };

  var SIZE_FIELDS = ['width', 'depth'];

  /** Key width and hub depth for a bore, or null outside the standard's range. */
  function sizeFor(standard, bore) {
    if (!(bore > 0)) return null;
    if (standard === 'DIN') {
      for (var i = 0; i < DIN.length; i++) {
        var d = DIN[i];
        if (bore > d[0] - 1e-9 && (bore <= d[1] + 1e-9)) return { width: d[2], depth: d[4], height: d[3], range: d[0] + '-' + d[1] + ' mm' };
      }
      return null;
    }
    if (standard === 'ANSI') {
      var b = bore / IN;
      for (var j = 0; j < ANSI.length; j++) {
        var a = ANSI[j];
        if (b > a[0] - 1e-6 && b <= a[1] + 1e-6) {
          var w = a[2] * IN, R = bore / 2;
          // half the key at the side walls, plus the rise of the bore between the wall and the centre line
          var chord = R - Math.sqrt(Math.max(0, R * R - w * w / 4));
          return { width: round(w, 3), depth: round(w / 2 + chord, 3), height: round(w, 3), range: inchText(a[0]) + '-' + inchText(a[1]) + ' in' };
        }
      }
      return null;
    }
    return null;
  }

  function inchText(v) {
    var whole = Math.floor(v + 1e-9), frac = v - whole;
    if (frac < 1e-6) return String(whole);
    for (var den = 2; den <= 32; den *= 2) {
      var num = Math.round(frac * den);
      if (Math.abs(num / den - frac) < 1e-6) return (whole ? whole + ' ' : '') + num + '/' + den;
    }
    return v.toFixed(3);
  }

  function round(v, dp) { var m = Math.pow(10, dp); return Math.round(v * m) / m; }

  function fmt(v, dp) {
    var s = v.toFixed(dp);
    return parseFloat(s) === 0 ? (0).toFixed(dp) : s;
  }

  function keyName(p) {
    return fmt(p.width, 2).replace(/\.?0+$/, '') + ' x ' + fmt(p.depth, 2).replace(/\.?0+$/, '') + ' keyway in ' + fmt(p.boreDia, 2).replace(/\.?0+$/, '') + ' bore';
  }

  // ---------------------------------------------------------------- G-code

  function Emitter(p) {
    this.lines = [];
    this.pos = { X: undefined, Y: undefined, Z: undefined };
    this.txt = {};
    this.feed = null;
    this.rapidRate = p.rapidRate;
    this.feedScale = p.feedOverride / 100;
    this.moves = [];
    // hole: keyway index, lane, stroke (in the lane), phase, edgeR: edge radius of this stroke,
    // reached: deepest edge radius finished in this keyway before this move
    this.tag = { hole: -1, lane: -1, stroke: -1, phase: 'move', edgeR: 0, reached: 0 };
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
  // kind: 'rapid' | 'feed' (moves in and out) | 'cut' (a cutting stroke)
  Emitter.prototype.lin = function (code, t, F, kind) {
    var from = { X: this.pos.X, Y: this.pos.Y, Z: this.pos.Z }, to = {
      X: t.X !== undefined ? t.X : from.X, Y: t.Y !== undefined ? t.Y : from.Y, Z: t.Z !== undefined ? t.Z : from.Z };
    var words = this.words(t);
    if (!words.length) return;
    var line = code + ' ' + words.join(' ');
    if (code === 'G1' && this.feed !== F) { line += ' F' + fmt(F, 0); this.feed = F; }
    var len = Math.hypot((to.X || 0) - (from.X || 0), (to.Y || 0) - (from.Y || 0), (to.Z || 0) - (from.Z || 0));
    this.pos = to;
    var known = from.X !== undefined && from.Y !== undefined && from.Z !== undefined;
    var minutes = !known ? 0 : code === 'G1' ? len / (F * this.feedScale) : len / this.rapidRate;
    var bucket = code === 'G1' ? (kind === 'cut' ? this.tag.phase : 'move') : 'rapid';
    if (known) { this.time[bucket] += minutes; this.dist[bucket] += len; }
    this.moves.push({ line: this.lines.length, kind: code === 'G1' ? kind || 'feed' : 'rapid', X: to.X, Y: to.Y, Z: to.Z, dt: minutes,
      hole: this.tag.hole, lane: this.tag.lane, stroke: this.tag.stroke, phase: this.tag.phase, edgeR: this.tag.edgeR, reached: this.tag.reached });
    this.lines.push(line);
  };
  Emitter.prototype.rapid = function (t) { this.lin('G0', t); };
  Emitter.prototype.line = function (t, F) { this.lin('G1', t, F, 'feed'); };
  Emitter.prototype.cut = function (t, F) { this.lin('G1', t, F, 'cut'); };

  // ---------------------------------------------------------------- generate

  function validate(p) {
    var e = [];
    function pos(k, label) { if (!(p[k] > 0)) e.push(label + ' must be greater than zero.'); }
    function nonNeg(k, label) { if (!(p[k] >= 0)) e.push(label + ' cannot be negative.'); }
    function num(k, label) { if (!isFinite(p[k])) e.push(label + ' must be a number.'); }
    function int(k, label, lo, hi) { if (!(Number.isInteger(p[k]) && p[k] >= lo && p[k] <= hi)) e.push(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); }
    pos('boreDia', 'Bore diameter'); pos('width', 'Keyway width'); pos('depth', 'Keyway depth'); pos('hubLength', 'Hub length');
    if (p.ends === 'blind') pos('keyLength', 'Keyway length');
    nonNeg('hubDia', 'Hub diameter');
    num('centreX', 'Bore centre X'); num('centreY', 'Bore centre Y'); num('angle', 'Keyway angle'); num('zTop', 'Top face');
    int('keyways', 'Number of keyways', 1, 8);
    nonNeg('clearance', 'Clearance');
    pos('toolWidth', 'Tool width'); num('edgeOffset', 'Edge offset'); pos('headDepth', 'Tool head depth'); pos('reach', 'Tool reach');
    num('orientOffset', 'Orient angle');
    pos('doc', 'Depth per stroke'); int('springStrokes', 'Spring strokes', 0, 10);
    pos('strokeFeed', 'Stroke feed'); pos('sideFeed', 'Feed in and out'); if (!p.returnRapid) pos('returnFeed', 'Return feed');
    nonNeg('relief', 'Relief'); nonNeg('overtravel', 'Overtravel');
    int('toolNumber', 'Tool number', 1, 99);
    pos('rapidRate', 'Rapid rate'); pos('feedOverride', 'Feed override');
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push('Parts to make must be a whole number, 1 or more.');
    if (e.length) return e;
    if (p.width >= p.boreDia) e.push('The keyway (' + fmt(p.width, 2) + ' mm) must be narrower than the bore (' + fmt(p.boreDia, 2) + ' mm).');
    if (p.toolWidth > p.width + 1e-9) e.push('The tool (' + fmt(p.toolWidth, 2) + ' mm) is wider than the keyway (' + fmt(p.width, 2) + ' mm). Use a tool no wider than the keyway.');
    if (p.ends === 'blind' && p.keyLength > p.hubLength + 1e-9) e.push('The blind keyway is longer than the hub; make it a through keyway.');
    if (p.hubDia > 0 && p.hubDia <= p.boreDia + 2 * p.depth) e.push('The hub (' + fmt(p.hubDia, 2) + ' mm) must be bigger than the bore plus the keyway depth.');
    return e;
  }

  // Side offsets (along v) of the lanes: one when the tool fills the keyway, else spread evenly
  // edge to edge with each step no more than 80 % of the tool width.
  function laneOffsets(b, w) {
    var span = b - w;
    if (span < 1e-6) return [0];
    var n = Math.ceil(span / (0.8 * w) - 1e-9) + 1;
    var out = [];
    for (var i = 0; i < n; i++) out.push(-span / 2 + span * i / (n - 1));
    // middle lane first, then outward alternately
    return out.map(function (y, i) { return { y: y, i: i }; })
      .sort(function (a, c) { return Math.abs(a.y) - Math.abs(c.y) || a.y - c.y; })
      .map(function (o) { return o.y; });
  }

  function generate(input) {
    var p = {}, k;
    for (k in DEFAULTS) p[k] = input && input[k] !== undefined ? input[k] : DEFAULTS[k];
    var out = { params: p, errors: [], warnings: [], gcode: '' };
    var mat = MATERIALS[p.material] || MATERIALS.steel;
    out.autoDoc = mat.doc;
    if (p.docAuto) p.doc = mat.doc;
    out.errors = validate(p);
    if (out.errors.length) return out;

    var w = out.warnings, R = p.boreDia / 2, rBottom = R + p.depth, hw = p.toolWidth / 2;
    var lanes = laneOffsets(p.width, p.toolWidth);
    // edge radius where a lane first touches the bore: its outer corner meets the wall
    function firstTouch(y) { var ym = Math.abs(y) + hw; return Math.sqrt(Math.max(0, R * R - ym * ym)); }
    var laneStrokes = lanes.map(function (y) {
      var r0 = firstTouch(y), n = Math.max(1, Math.ceil((rBottom - r0) / p.doc - 1e-9));
      var radii = [];
      for (var i = 1; i <= n; i++) radii.push(r0 + (rBottom - r0) * i / n);
      return { y: y, r0: r0, n: n, step: (rBottom - r0) / n, radii: radii };
    });
    var strokesPerKeyway = laneStrokes.reduce(function (s, l) { return s + l.n + p.springStrokes; }, 0);
    var zTop = p.zTop, zSafe = zTop + Math.max(p.clearance, 1) + 5, zAppr = zTop + p.clearance;
    var keyLen = p.ends === 'blind' ? p.keyLength : p.hubLength;
    var zBottom = p.ends === 'blind' ? zTop - p.keyLength : zTop - p.hubLength - p.overtravel;
    var strokeLen = zAppr - zBottom;
    var stepDoc = laneStrokes[0].step;

    // ---- checks
    if (p.depth > 0.35 * p.boreDia) w.push('The keyway is deep for the bore (' + Math.round(p.depth / p.boreDia * 100) + ' % of the diameter); check the hub wall is left strong enough.');
    // the tool has to fit in the bore pulled back from the first cut: back face inside the far wall
    var backAt = laneStrokes[0].r0 - p.relief - p.headDepth;
    if (backAt < -R + 0.3) out.errors.push('The tool head (' + fmt(p.headDepth, 2) + ' mm from edge to back) does not fit the ' + fmt(p.boreDia, 2) + ' mm bore with the edge at the wall. It needs less than ' + fmt(laneStrokes[0].r0 - p.relief + R - 0.3, 2) + ' mm.');
    // the tool's corners when pulled back must clear the bore on the side lanes too
    if (p.toolWidth > p.boreDia * 0.7) w.push('The tool is wide for the bore; check its body clears the bore wall behind the edge.');
    var reachNeeded = zTop - zBottom;
    if (reachNeeded > p.reach + 1e-6) w.push('The edge goes ' + fmt(reachNeeded, 1) + ' mm below the top face, more than the tool reach of ' + fmt(p.reach, 1) + ' mm: the holder will hit the part.');
    if (p.doc > mat.doc * 1.6) w.push('A depth per stroke of ' + fmt(p.doc, 3) + ' mm is heavy for ' + mat.label.toLowerCase() + ' (about ' + fmt(mat.doc, 3) + ' mm is usual). Slotting puts the whole cut on the Z axis and the spindle lock.');
    if (p.ends === 'blind') w.push('Blind keyway: the tool stops at the bottom with nowhere for the chip to go. Drill or turn a relief groove at the bottom of the keyway first, and expect a radius there.');
    if (p.ends !== 'blind' && p.overtravel < 0.5) w.push('With less than 0.5 mm overtravel the chip may not break off at the bottom face.');
    if (p.relief < 0.05) w.push('With almost no relief the edge rubs on the way back up and dulls quickly.');
    if (!p.orient && p.keyways > 1) w.push('Without spindle orient the program stops (M0) before each further keyway so the tool can be turned by hand to face it.');
    if (strokesPerKeyway * p.keyways > 3000) w.push('That is ' + strokesPerKeyway * p.keyways + ' strokes; a bigger depth per stroke or a wider tool would be quicker.');

    if (out.errors.length) return out;

    // ---- program
    var E = new Emitter(p), name = keyName(p);
    var stdLabel = (STANDARDS[p.standard] || STANDARDS.custom).label;
    E.comment(name + (p.standard !== 'custom' ? ', ' + stdLabel : '') + ', ' + (p.ends === 'blind' ? fmt(keyLen, 2) + ' mm blind' : 'through ' + fmt(p.hubLength, 2) + ' mm hub'));
    E.comment('Over bore + keyway ' + fmt(p.boreDia + p.depth, 3) + ', ' + p.keyways + (p.keyways > 1 ? ' keyways' : ' keyway') + ' from ' + fmt(p.angle, 1) + ' deg');
    E.comment('Tool: ' + fmt(p.toolWidth, 2) + ' mm slotting tool, edge ' + fmt(p.edgeOffset, 2) + ' mm from the spindle axis, ' + lanes.length + (lanes.length > 1 ? ' lanes' : ' lane'));
    E.comment('Strokes: ' + fmt(stepDoc, 3) + ' mm each, ' + strokesPerKeyway + ' per keyway incl. ' + p.springStrokes + ' spring per lane, F' + fmt(p.strokeFeed, 0) + ' down');
    E.comment('SPINDLE MUST NOT TURN. M5 below; ' + (p.orient ? 'M19 holds it oriented.' : 'lock it by hand with the edge facing the keyway.'));
    E.comment('SETUP: bore centre at X' + fmt(p.centreX, 3) + ' Y' + fmt(p.centreY, 3) + ', Z0 so the top face is at Z' + fmt(zTop, 3) + ', cutting edge tip as tool length reference');
    E.raw('G17 G21 G90 G94 G40');
    if (p.wcs) E.raw(p.wcs);
    if (p.toolChange) { E.raw('T' + p.toolNumber + ' M6'); E.raw('G43 H' + p.toolNumber); }
    E.raw('M5');
    E.rapid({ Z: zSafe });
    if (p.coolant === 'flood') E.raw('M8');
    if (p.coolant === 'mist') E.raw('M7');

    var keyAngles = [];
    for (var kk = 0; kk < p.keyways; kk++) keyAngles.push(p.angle + kk * 360 / p.keyways);
    var c0 = { x: p.centreX, y: p.centreY };
    function axisAt(a, r, y) {
      var t = a * Math.PI / 180, u = { x: Math.cos(t), y: Math.sin(t) }, v = { x: -u.y, y: u.x };
      return { X: c0.x + u.x * (r - p.edgeOffset) + v.x * y, Y: c0.y + u.y * (r - p.edgeOffset) + v.y * y };
    }
    var start = null;
    keyAngles.forEach(function (a, h) {
      E.tag.hole = h; E.tag.lane = -1; E.tag.stroke = -1; E.tag.phase = 'move'; E.tag.reached = 0; E.tag.edgeR = 0;
      E.comment('Keyway ' + (h + 1) + ' of ' + p.keyways + ' at ' + fmt(((a % 360) + 360) % 360, 2) + ' deg');
      E.rapid({ Z: zSafe });
      var orientR = (((a + p.orientOffset) % 360) + 360) % 360;
      if (p.orient) E.raw('M19 R' + fmt(orientR, 2));
      else if (h > 0) { E.comment('Turn the tool by hand to face ' + fmt(((a % 360) + 360) % 360, 1) + ' deg, lock it, then cycle start'); E.raw('M0'); }
      var reached = 0;
      laneStrokes.forEach(function (L, li) {
        E.tag.lane = li;
        if (lanes.length > 1) E.comment('Lane ' + (li + 1) + ' of ' + lanes.length + ', ' + fmt(L.y, 3) + ' mm to the side');
        var list = L.radii.map(function (r, i) { return { r: r, phase: i === L.radii.length - 1 ? 'finish' : 'rough' }; });
        for (var s = 0; s < p.springStrokes; s++) list.push({ r: rBottom, phase: 'spring' });
        var back = axisAt(a, L.r0 - p.relief, L.y);
        E.tag.phase = 'move'; E.tag.stroke = -1; E.tag.edgeR = L.r0;
        E.rapid({ Z: zSafe });
        E.rapid(back);
        if (!start) start = { X: back.X, Y: back.Y, Z: zSafe };
        E.rapid({ Z: zAppr });
        list.forEach(function (st, si) {
          var at = axisAt(a, st.r, L.y), off = axisAt(a, st.r - p.relief, L.y);
          E.tag.stroke = si; E.tag.edgeR = st.r; E.tag.reached = reached;
          E.tag.phase = 'move';
          E.line(at, p.sideFeed);                       // in to the cut, above the part
          E.tag.phase = st.phase;
          E.cut({ Z: zBottom }, p.strokeFeed);           // the cutting stroke
          reached = Math.max(reached, st.r);
          E.tag.reached = reached;
          E.tag.phase = 'move';
          E.line(off, p.sideFeed);                       // pull clear of the cut
          if (p.returnRapid) E.rapid({ Z: zAppr }); else E.line({ Z: zAppr }, p.returnFeed);
        });
      });
      E.tag.lane = -1; E.tag.stroke = -1; E.tag.phase = 'move';
      E.rapid({ Z: zSafe });
    });
    if (p.coolant !== 'off') E.raw('M9');
    if (p.orient) E.raw('M5');
    E.raw('M30');
    out.gcode = E.lines.join('\n') + '\n';

    // ---- playback data
    var clock = 0, last = start;
    out.program = {
      start: start,
      moves: E.moves.map(function (m) {
        ['X', 'Y', 'Z'].forEach(function (q) { if (m[q] === undefined) m[q] = last[q]; });
        var o = { line: m.line, kind: m.kind, X: m.X, Y: m.Y, Z: m.Z, t0: clock, t1: clock + m.dt,
          hole: m.hole, lane: m.lane, stroke: m.stroke, phase: m.phase, edgeR: m.edgeR, reached: m.reached };
        last = m;
        clock += m.dt;
        return o;
      })
    };
    out.program.total = clock;

    var time = E.time, total = 0;
    time.dwell = 0;
    ['rough', 'finish', 'spring', 'move', 'rapid'].forEach(function (q) { total += time[q]; });
    // material removed: the keyway's cross-section beyond the bore circle times its length
    var hb = p.width / 2, area = 2 * hb * rBottom - (hb * Math.sqrt(Math.max(0, R * R - hb * hb)) + R * R * Math.asin(Math.min(1, hb / R)));
    out.geom = {
      name: name, R: R, rBottom: rBottom, lanes: lanes, laneStrokes: laneStrokes, angles: keyAngles, centre: c0,
      zTop: zTop, zSafe: zSafe, zAppr: zAppr, zBottom: zBottom, keyLen: keyLen, strokeLen: strokeLen, stepDoc: stepDoc
    };
    out.stats = {
      lines: E.lines.length, minutes: total, time: time, dist: E.dist,
      strokes: strokesPerKeyway, strokesTotal: strokesPerKeyway * p.keyways,
      over: p.boreDia + p.depth, volume: area * keyLen * p.keyways, materialLabel: mat.label, materialDoc: mat.doc,
      reachNeeded: reachNeeded, holes: p.keyways
    };
    return out;
  }

  return {
    DEFAULTS: DEFAULTS, STANDARDS: STANDARDS, MATERIALS: MATERIALS, SIZE_FIELDS: SIZE_FIELDS, DIN: DIN, ANSI: ANSI,
    sizeFor: sizeFor, keyName: keyName, laneOffsets: laneOffsets, generate: generate
  };
})();

export default KEYWAY;
