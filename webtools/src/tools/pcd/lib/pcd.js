/*
 * Pitch circle drilling: holes spaced round a circle (or an arc of one), drilled with LinuxCNC
 * canned cycles (G81 / G82 / G83 / G73) or rigid tapped (G33.1). No DOM access here, so it also
 * loads in Node.
 *
 * Program frame: the work zero is wherever the setting puts it; the pattern centre is (cx, cy)
 * in work coordinates, Z zero where "Top of part" says. All lengths in mm, angles in degrees
 * (counter-clockwise from +X) unless a name says otherwise.
 *
 * Each canned-cycle line is one G-code line, but the preview needs the moves the control makes
 * for it, so the cycle is expanded here into recorded moves that all point at that line.
 */
const PCD = (function () {
  'use strict';

  var CYCLES = {
    drill: { label: 'Drilling', code: 'G81', title: 'Drill' },
    spot: { label: 'Spot drilling', code: 'G81', title: 'Spot' },
    dwell: { label: 'Counterboring (dwell)', code: 'G82', title: 'Dwell' },
    peck: { label: 'Peck drilling', code: 'G83', title: 'Peck' },
    chipbreak: { label: 'Chip-break drilling', code: 'G73', title: 'Chip break' },
    tap: { label: 'Rigid tapping', code: 'G33.1', title: 'Tap' }
  };

  // Starting values for HSS drills: feed per revolution as a fraction of the drill diameter,
  // and surface speed in m/min (used for the suggested spindle speed).
  var MATERIALS = {
    aluminium: { label: 'Aluminium', rev: 0.022, speed: 60 },
    steel: { label: 'Mild steel', rev: 0.014, speed: 25 },
    stainless: { label: 'Stainless steel', rev: 0.010, speed: 12 },
    brass: { label: 'Brass', rev: 0.018, speed: 45 },
    castiron: { label: 'Cast iron', rev: 0.018, speed: 20 },
    plastic: { label: 'Plastic', rev: 0.025, speed: 40 }
  };

  // ISO metric coarse taps: [size, pitch]; the tap drill is size - pitch.
  var TAPS = [[2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [20, 2.5], [24, 3]];

  var DEFAULTS = {
    cycle: 'drill',         // key of CYCLES
    // pattern
    cx: 0, cy: 0,           // pattern centre, work coordinates
    pcd: 80,                // pitch circle diameter
    count: 6,               // holes in the pattern (skipped ones included)
    layout: 'full',         // 'full' (equal round the circle) | 'arc' (first to last over `span`)
    span: 90,               // arc: angle from the first hole to the last
    startAngle: 0,          // first hole, degrees counter-clockwise from +X
    direction: 'ccw',       // 'ccw' | 'cw': which way the numbering goes round
    skip: '',               // hole numbers left out, "2, 5-6"
    // hole
    holeDia: 8.5,
    depth: 12,              // to full diameter (or to the tip, see depthTo)
    depthTo: 'full',        // 'full' (the tip goes further) | 'tip'
    pointAngle: 118,        // drill point angle
    zTop: 0,                // top of the part
    thickness: 15,          // part thickness, 0 = not given (only for checks and drawing)
    retract: 2,             // R plane above the top
    clearance: 10,          // safe Z above the top, for moves between holes with G98 and at start/end
    retractMode: 'r',       // 'r' (G99: back to R between holes) | 'clear' (G98: back to clearance)
    peck: 3,                // G83 / G73 peck (Q)
    holeDwell: 0.5,         // G82 dwell at the bottom (P), seconds
    tapPitch: 1.5,          // G33.1 K, thread pitch
    // tool
    toolDia: 8.5,
    material: 'aluminium',
    rpm: 1500,
    feedAuto: true,
    feed: 280,
    // program
    wcs: 'G54',
    toolChange: false,
    toolNumber: 1,
    coolant: 'off',         // 'off' | 'flood' | 'mist'
    dwell: 2,               // spindle start dwell, seconds
    // time calculator
    rapidRate: 2000,
    feedOverride: 100,
    quantity: 1
  };

  var BACKOFF = 0.254;      // LinuxCNC: G73 retracts this far, G83 comes back down to this far above the last depth
  var RAD = Math.PI / 180;

  function fmt(v, dp) {
    var s = v.toFixed(dp);
    return parseFloat(s) === 0 ? (0).toFixed(dp) : s;
  }

  /** "2, 5-6" -> [2, 5, 6]; null when it does not read. */
  function parseSkip(text) {
    var out = [], parts = String(text || '').split(/[\s,;]+/).filter(function (t) { return t !== ''; });
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d+)(?:-(\d+))?$/.exec(parts[i]);
      if (!m) return null;
      var a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      if (b < a) { var t = a; a = b; b = t; }
      for (var k = a; k <= b; k++) if (out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }

  /** Angle between neighbouring holes (signed: negative going clockwise). */
  function stepAngle(p) {
    var sign = p.direction === 'cw' ? -1 : 1;
    if (p.layout === 'arc') return p.count > 1 ? sign * p.span / (p.count - 1) : 0;
    return sign * 360 / p.count;
  }

  /** Every hole of the pattern: { n (1-based), angle, x, y, skip }. */
  function holes(p) {
    var step = stepAngle(p), r = p.pcd / 2, skip = parseSkip(p.skip) || [], out = [];
    for (var i = 0; i < p.count; i++) {
      var a = p.startAngle + i * step;
      var x = p.cx + r * Math.cos(a * RAD), y = p.cy + r * Math.sin(a * RAD);
      out.push({ n: i + 1, angle: ((a % 360) + 360) % 360, x: Math.abs(x) < 5e-6 ? 0 : x, y: Math.abs(y) < 5e-6 ? 0 : y, skip: skip.indexOf(i + 1) >= 0 });
    }
    return out;
  }

  /** Length of the drill's cone: what the tip goes past the full-diameter depth. */
  function tipLength(dia, angle) { return 0.5 * dia / Math.tan(angle / 2 * RAD); }

  function title(p) {
    var c = CYCLES[p.cycle] || CYCLES.drill;
    return p.count + ' holes on ' + fmt(p.pcd, 2).replace(/\.?0+$/, '') + ' PCD, ' + c.label.toLowerCase();
  }

  function check(p) {
    var e = [];
    function pos(k, label) { if (!(p[k] > 0)) e.push(label + ' must be greater than zero.'); }
    function nonNeg(k, label) { if (!(p[k] >= 0)) e.push(label + ' cannot be negative.'); }
    function num(k, label) { if (!isFinite(p[k])) e.push(label + ' must be a number.'); }
    function int(k, label, lo, hi) { if (!(Number.isInteger(p[k]) && p[k] >= lo && p[k] <= hi)) e.push(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); }
    if (!CYCLES[p.cycle]) e.push('Unknown cycle.');
    num('cx', 'Centre X'); num('cy', 'Centre Y'); pos('pcd', 'Pitch circle diameter');
    int('count', 'Number of holes', 1, 360);
    if (p.layout === 'arc' && !(p.span > 0 && p.span <= 360)) e.push('The arc must span more than 0° and at most 360°.');
    num('startAngle', 'Start angle');
    if (parseSkip(p.skip) === null) e.push('Holes to skip: give hole numbers or ranges, like "2, 5-6".');
    pos('holeDia', 'Hole diameter'); pos('depth', 'Hole depth');
    if (!(p.pointAngle >= 60 && p.pointAngle <= 180)) e.push('Point angle must be between 60° and 180°.');
    num('zTop', 'Top of part'); nonNeg('thickness', 'Part thickness');
    pos('retract', 'R plane height'); nonNeg('clearance', 'Clearance');
    if (p.cycle === 'peck' || p.cycle === 'chipbreak') pos('peck', 'Peck depth');
    if (p.cycle === 'dwell') pos('holeDwell', 'Dwell at the bottom');
    if (p.cycle === 'tap') pos('tapPitch', 'Thread pitch');
    pos('toolDia', 'Tool diameter'); pos('rpm', 'Spindle speed');
    if (p.cycle !== 'tap') pos('feed', 'Feed');
    int('toolNumber', 'Tool number', 1, 99); nonNeg('dwell', 'Spindle start dwell');
    pos('rapidRate', 'Rapid rate'); pos('feedOverride', 'Feed override');
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push('Parts to make must be a whole number, 1 or more.');
    return e;
  }

  function generate(p) {
    var out = { params: p, errors: check(p), warnings: [], gcode: '' };
    var w = out.warnings, mat = MATERIALS[p.material] || MATERIALS.aluminium, cyc = CYCLES[p.cycle] || CYCLES.drill;
    var tap = p.cycle === 'tap', spot = p.cycle === 'spot', pecking = p.cycle === 'peck' || p.cycle === 'chipbreak';

    // feed from the material (taps feed one pitch per turn, so they have none to set)
    if (p.feedAuto && p.toolDia > 0 && p.rpm > 0) {
      var rev = Math.min(0.5, Math.max(0.02, mat.rev * p.toolDia * (spot ? 0.5 : 1)));
      p.feed = Math.max(5, Math.round(rev * p.rpm / 5) * 5);
      out.autoFeed = p.feed;
    }
    if (out.errors.length) return out;

    var all = holes(p), list = all.filter(function (h) { return !h.skip; });
    if (!list.length) { out.errors.push('Every hole is skipped: nothing to drill.'); return out; }
    var step = stepAngle(p), chord = p.count > 1 ? p.pcd * Math.abs(Math.sin(step / 2 * RAD)) : 0;
    var wall = chord - p.holeDia;
    if (p.count > 1 && chord < p.holeDia - 1e-9) out.errors.push('The holes overlap: they are ' + fmt(chord, 2) + ' mm apart but ' + fmt(p.holeDia, 2) + ' mm across. Use fewer holes or a bigger circle.');
    if (p.layout === 'arc' && p.count > 1 && Math.abs(p.span - 360) < 1e-9) out.errors.push('A 360° arc puts the last hole on the first. Use "Full circle" instead.');
    if (p.clearance < p.retract) out.errors.push('The clearance height must be at least the R plane height.');
    if (out.errors.length) return out;

    // ---- Z levels
    var tipLen = tap ? 0 : tipLength(p.toolDia, p.pointAngle);
    var zBottom = tap || spot || p.depthTo === 'tip' ? p.zTop - p.depth : p.zTop - p.depth - tipLen;   // tip Z at the bottom
    var fullDepth = tap ? p.depth : spot || p.depthTo === 'tip' ? Math.max(0, p.depth - tipLen) : p.depth;   // depth at full diameter
    var zR = p.zTop + p.retract, zClear = p.zTop + p.clearance;
    var spotDia = spot ? Math.min(p.toolDia, 2 * p.depth * Math.tan(p.pointAngle / 2 * RAD)) : 0;
    var tapFeed = tap ? p.rpm * p.tapPitch : 0;
    var pecks = pecking ? Math.max(1, Math.ceil((zR - zBottom) / p.peck - 1e-9)) : 1;
    var sugRpm = mat.speed * 1000 / (Math.PI * p.toolDia) * (tap ? 0.3 : 1);

    // ---- warnings
    if (p.count > 1 && wall < Math.max(1, 0.2 * p.holeDia) && wall >= 0) w.push('Only ' + fmt(wall, 2) + ' mm of metal is left between neighbouring holes.');
    if (!spot && !tap && Math.abs(p.toolDia - p.holeDia) > 0.005) w.push('The drill (' + fmt(p.toolDia, 2) + ' mm) is not the hole size (' + fmt(p.holeDia, 2) + ' mm). A drill cuts its own size: change one of them, or bore or mill the hole to size afterwards.');
    if (spot && spotDia < p.holeDia) w.push('The spot mark (' + fmt(spotDia, 2) + ' mm across) is smaller than the hole (' + fmt(p.holeDia, 2) + ' mm). Spot a little bigger than the hole so the drill starts in it and the edge gets a chamfer.');
    if (tap && p.toolDia <= p.holeDia) w.push('The tap (' + fmt(p.toolDia, 2) + ' mm) is not bigger than the hole (' + fmt(p.holeDia, 2) + ' mm): it will not cut a thread.');
    if (tap && p.toolDia - p.holeDia > 1.3 * p.tapPitch) w.push('The hole is small for this tap: about ' + fmt(p.toolDia - p.tapPitch, 2) + ' mm is usual for a ' + fmt(p.toolDia, 1) + ' × ' + fmt(p.tapPitch, 2) + ' tap.');
    if ((p.cycle === 'drill' || p.cycle === 'dwell') && fullDepth > 4 * p.toolDia) w.push('The hole is ' + fmt(fullDepth / p.toolDia, 1) + ' diameters deep. Above about 4 diameters, peck drilling (G83) clears the chips.');
    if (pecking && p.peck > p.toolDia) w.push('Pecks deeper than the drill diameter pack the flutes; about half the diameter is usual.');
    if (p.thickness > 0 && zBottom < p.zTop - p.thickness - 1e-6) w.push('The tip goes ' + fmt(p.zTop - p.thickness - zBottom, 2) + ' mm below the bottom of the part: make sure there is clearance or a spoil board under it.');
    if (p.thickness > 0 && tap && zBottom > p.zTop - p.thickness + 1e-6) w.push('Blind tapped holes: the tap needs the drilled hole deeper than the thread, so drill at least ' + fmt(2 * p.tapPitch, 1) + ' mm past it.');
    if (!tap && p.rpm > sugRpm * 1.6) w.push('The spindle speed is high for a ' + fmt(p.toolDia, 1) + ' mm drill in ' + mat.label.toLowerCase() + ': about ' + Math.round(sugRpm / 50) * 50 + ' rpm is usual.');
    if (tap) w.push('Rigid tapping (G33.1) needs a spindle encoder set up in LinuxCNC, and the spindle reverses at the bottom. Feed override does not apply.');

    // ---- program
    var lines = [], moves = [], pos = { X: undefined, Y: undefined, Z: undefined };
    var feedScale = p.feedOverride / 100;
    var time = { cut: 0, out: 0, rapid: 0, pause: 0, dwell: 0 }, dist = { cut: 0, out: 0, rapid: 0 };
    var tagHole = -1, done = 0, deep = p.zTop;

    function raw(s) { lines.push(s); }
    function comment(s) { lines.push('(' + s.replace(/[()]/g, '') + ')'); }
    // a move the control makes, recorded against the G-code line about to be written
    function sim(kind, to, F, bucket, noOverride) {
      var from = { X: pos.X, Y: pos.Y, Z: pos.Z };
      var t = { X: to.X !== undefined ? to.X : from.X, Y: to.Y !== undefined ? to.Y : from.Y, Z: to.Z !== undefined ? to.Z : from.Z };
      var known = from.X !== undefined && from.Y !== undefined && from.Z !== undefined;
      var len = known ? Math.hypot(t.X - from.X, t.Y - from.Y, t.Z - from.Z) : 0;
      if (known && len < 1e-9) return;
      var minutes = !known ? 0 : F ? len / (F * (noOverride ? 1 : feedScale)) : len / p.rapidRate;
      var b = F ? bucket || 'cut' : 'rapid';
      if (known) { time[b] += minutes; dist[b] += len; }
      if (kind === 'cut' && tagHole >= 0) deep = Math.min(deep, t.Z);
      moves.push({ line: lines.length, kind: kind, X: t.X, Y: t.Y, Z: t.Z, dt: minutes, hole: tagHole, done: done, deep: deep });
      pos = t;
    }
    function pause(seconds, bucket) {
      moves.push({ line: lines.length, kind: 'dwell', X: pos.X, Y: pos.Y, Z: pos.Z, dt: seconds / 60, hole: tagHole, done: done, deep: deep });
      time[bucket] += seconds / 60;
    }
    var txt = {};
    function words(t) {
      var ws = [];
      ['X', 'Y', 'Z'].forEach(function (k) {
        if (t[k] === undefined) return;
        var s = fmt(t[k], 4);
        if (txt[k] === s) return;
        txt[k] = s; ws.push(k + s);
      });
      return ws;
    }
    function rapid(t) {
      var ws = words(t);
      if (!ws.length) return;
      sim('rapid', t);
      raw('G0 ' + ws.join(' '));
    }

    var c0 = list[0];
    comment(title(p));
    comment('PCD ' + fmt(p.pcd, 3) + ' centre X' + fmt(p.cx, 3) + ' Y' + fmt(p.cy, 3) + ', ' + p.count + ' holes ' +
      (p.layout === 'arc' ? 'over ' + fmt(p.span, 2) + ' deg' : 'round the full circle') + ', ' + fmt(Math.abs(step), 3) + ' deg apart, first at ' + fmt(p.startAngle, 2) + ' deg, ' +
      (p.direction === 'cw' ? 'clockwise' : 'anticlockwise') + (list.length < all.length ? ', skipping ' + all.filter(function (h) { return h.skip; }).map(function (h) { return h.n; }).join(' ') : ''));
    comment('Hole ' + fmt(p.holeDia, 3) + ' dia, ' + (tap ? fmt(p.depth, 2) + ' mm of thread, pitch ' + fmt(p.tapPitch, 3)
      : spot ? 'spot ' + fmt(p.depth, 2) + ' deep, ' + fmt(spotDia, 2) + ' across'
        : fmt(fullDepth, 2) + ' mm deep at full dia, tip to Z' + fmt(zBottom, 3)));
    comment('Tool: ' + fmt(p.toolDia, 2) + ' mm ' + (tap ? 'tap' : spot ? 'spot drill' : 'drill') + (tap ? '' : ', ' + fmt(p.pointAngle, 0) + ' deg point') + ', ' + fmt(p.rpm, 0) + ' rpm' +
      (tap ? ', ' + fmt(tapFeed, 0) + ' mm/min synchronised' : ', F' + fmt(p.feed, 0) + ' = ' + fmt(p.feed / p.rpm, 3) + ' mm/rev'));
    comment('Cycle: ' + cyc.code + ' ' + cyc.label.toLowerCase() + ', R plane Z' + fmt(zR, 3) + ', clearance Z' + fmt(zClear, 3));
    comment('SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', tool tip as the length reference');
    raw('G17 G21 G90 G94 G40');
    if (p.wcs) raw(p.wcs);
    if (p.toolChange) { raw('T' + p.toolNumber + ' M6'); raw('G43 H' + p.toolNumber); }
    rapid({ Z: zClear });
    rapid({ X: c0.x, Y: c0.y });
    raw('M3 S' + fmt(p.rpm, 0));
    if (p.coolant === 'flood') raw('M8');
    if (p.coolant === 'mist') raw('M7');
    if (p.dwell > 0) { pause(p.dwell, 'dwell'); raw('G4 P' + fmt(p.dwell, 1)); }

    var holeLine = function (h) { return 'Hole ' + h.n + ' at ' + fmt(h.angle, 2) + ' deg'; };
    if (tap) {
      // G33.1 taps from the current position to Z, reverses the spindle and comes back out to where it started
      list.forEach(function (h, i) {
        tagHole = i; deep = p.zTop;
        comment(holeLine(h, i));
        rapid({ X: h.x, Y: h.y });
        rapid({ Z: zR });
        sim('cut', { Z: zBottom }, tapFeed, 'cut', true);
        sim('feed', { Z: zR }, tapFeed, 'out', true);
        raw('G33.1 Z' + fmt(zBottom, 4) + ' K' + fmt(p.tapPitch, 4));
        done = i + 1;
        if (p.retractMode === 'clear' || i === list.length - 1) rapid({ Z: zClear });
      });
    } else {
      // canned cycle: the first hole carries every word, the rest only X and Y
      var retZ = p.retractMode === 'clear' ? zClear : zR;   // G98 goes back to the start level (the clearance), G99 to R
      var head = (p.retractMode === 'clear' ? 'G98 ' : 'G99 ') + cyc.code;
      list.forEach(function (h, i) {
        tagHole = i; deep = p.zTop;
        // what the control does: XY at the current level, down to R, then the cycle
        sim('rapid', { X: h.x, Y: h.y });
        sim('rapid', { Z: zR });
        if (pecking) {
          var z = zR;
          while (z > zBottom + 1e-9) {
            var next = Math.max(zBottom, z - p.peck);
            if (z < zR) sim('rapid', { Z: p.cycle === 'peck' ? z + BACKOFF : pos.Z });
            sim('cut', { Z: next }, p.feed);
            z = next;
            if (z > zBottom + 1e-9) sim('rapid', { Z: p.cycle === 'peck' ? zR : z + BACKOFF });
          }
        } else {
          sim('cut', { Z: zBottom }, p.feed);
          if (p.cycle === 'dwell') pause(p.holeDwell, 'pause');
        }
        sim('rapid', { Z: retZ });
        var ws = 'X' + fmt(h.x, 4) + ' Y' + fmt(h.y, 4);
        if (i === 0) {
          ws = head + ' ' + ws + ' Z' + fmt(zBottom, 4) + ' R' + fmt(zR, 4) +
            (pecking ? ' Q' + fmt(p.peck, 4) : '') + (p.cycle === 'dwell' ? ' P' + fmt(p.holeDwell, 2) : '') + ' F' + fmt(p.feed, 0);
        }
        comment(holeLine(h, i));
        // the comment above went in first: point this hole's moves at the cycle line after it
        for (var k = moves.length - 1; k >= 0 && moves[k].hole === i; k--) moves[k].line = lines.length;
        raw(ws);
        done = i + 1;
      });
      raw('G80');
      tagHole = -1;
      txt = {};
      rapid({ Z: zClear });
    }
    if (p.coolant !== 'off') raw('M9');
    raw('M5');
    raw('M30');
    out.gcode = lines.join('\n') + '\n';

    // ---- playback data
    var clock = 0, start = { X: c0.x, Y: c0.y, Z: zClear }, last = start;
    out.program = {
      start: start,
      moves: moves.map(function (m) {
        ['X', 'Y', 'Z'].forEach(function (k) { if (m[k] === undefined) m[k] = last[k]; });
        var o = { line: m.line, kind: m.kind, X: m.X, Y: m.Y, Z: m.Z, t0: clock, t1: clock + m.dt, hole: m.hole, done: m.done, deep: m.deep };
        last = m; clock += m.dt;
        return o;
      })
    };
    out.program.total = clock;

    var total = 0;
    Object.keys(time).forEach(function (k) { total += time[k]; });
    out.geom = {
      name: title(p), holes: all, list: list, step: step, chord: chord, wall: wall, tipLen: tipLen,
      zBottom: zBottom, fullDepth: fullDepth, zR: zR, zClear: zClear, spotDia: spotDia, pecks: pecks,
      peckLevels: pecking ? (function () { var a = [], z = zR; while (z > zBottom + 1e-9) { z = Math.max(zBottom, z - p.peck); a.push(z); } return a; })() : [],
      tap: tap, spot: spot
    };
    out.stats = {
      lines: lines.length, minutes: total, time: time, dist: dist,
      holeDepth: p.zTop - zBottom, tapFeed: tapFeed, feedRev: tap ? p.tapPitch : p.feed / p.rpm,
      materialLabel: mat.label, materialRev: Math.min(0.5, Math.max(0.02, mat.rev * p.toolDia * (spot ? 0.5 : 1))), suggestedRpm: sugRpm,
      holes: list.length
    };
    return out;
  }

  return {
    DEFAULTS: DEFAULTS, CYCLES: CYCLES, MATERIALS: MATERIALS, TAPS: TAPS,
    parseSkip: parseSkip, stepAngle: stepAngle, holes: holes, tipLength: tipLength, title: title, generate: generate
  };
})();

export default PCD;
