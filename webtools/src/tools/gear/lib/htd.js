/*
 * Timing pulley geometry (HTD 3M, 5M, 8M, 14M, GT2, T2.5, T5 and T10), ball-nose toolpath and G-code generation for a
 * 4th-axis (rotary) mill. No DOM access here, so it also loads in Node.
 *
 * Tooth frame used throughout: origin on the pulley axis, z radial through the
 * centre of a groove, y tangential. All lengths in mm, angles in radians
 * unless a name says otherwise.
 */
const HTD = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  // Belt profiles: groove shape, pitch, pitch diameter minus outside diameter and nominal
  // groove form, plus cutter settings that suit the groove (all mm). Settings a profile does
  // not list take the value in DEFAULTS.
  var PROFILES = {
    '3M': { label: 'HTD 3M', shape: 'round', pitch: 3, pld: 0.762, grooveDepth: 1.28, grooveRadius: 0.91, tipRadius: 0.3, flankAngle: 0, minTeeth: 10, toolDia: 1.5, toolLength: 6 },
    '5M': { label: 'HTD 5M', shape: 'round', pitch: 5, pld: 1.143, grooveDepth: 2.16, grooveRadius: 1.56, tipRadius: 0.48, flankAngle: 0, minTeeth: 12, toolDia: 3 },
    '8M': { label: 'HTD 8M', shape: 'round', pitch: 8, pld: 1.372, grooveDepth: 3.5, grooveRadius: 2.55, tipRadius: 0.8, flankAngle: 0, minTeeth: 22, toolDia: 3 },
    '14M': { label: 'HTD 14M', shape: 'round', pitch: 14, pld: 2.794, grooveDepth: 6.2, grooveRadius: 4.5, tipRadius: 1.4, flankAngle: 0, minTeeth: 28, toolDia: 6 },
    // GT2: the bottom radius runs into a larger flank radius struck from across the centreline
    'GT2': { label: 'GT2', shape: 'gt', pitch: 2, pld: 0.508, grooveDepth: 0.76, grooveRadius: 0.555, flankRadius: 1, flankOffset: 0.4, tipRadius: 0.15, flankAngle: 0,
      minTeeth: 12, toolDia: 1, toolLength: 4, stepDown: 0.25 },
    // T profiles: flat-bottomed trapezoid; grooveRadius is the bottom corner radius. Each comes in
    // two groove forms: SE (snug, 50 deg included, belt tooth seats on the bottom) for up to 20
    // teeth, and N (40 deg included, deeper, with clearance) above that.
    'T2.5': { label: 'T2.5', shape: 'trapezoid', pitch: 2.5, pld: 0.52, grooveRadius: 0.2, tipRadius: 0.3, minTeeth: 10, toolDia: 0.5, toolLength: 3, stepDown: 0.12,
      forms: { SE: { grooveWidth: 1.75, grooveDepth: 0.75, flankAngle: 25 }, N: { grooveWidth: 1.83, grooveDepth: 1, flankAngle: 20 } } },
    'T5': { label: 'T5', shape: 'trapezoid', pitch: 5, pld: 0.85, grooveRadius: 0.4, tipRadius: 0.6, minTeeth: 10, toolDia: 0.8, toolLength: 4, stepDown: 0.2,
      forms: { SE: { grooveWidth: 2.96, grooveDepth: 1.25, flankAngle: 25 }, N: { grooveWidth: 3.32, grooveDepth: 1.95, flankAngle: 20 } } },
    'T10': { label: 'T10', shape: 'trapezoid', pitch: 10, pld: 1.85, grooveRadius: 0.6, tipRadius: 0.8, minTeeth: 12, toolDia: 1, toolLength: 5, stepDown: 0.25,
      forms: { SE: { grooveWidth: 6.02, grooveDepth: 2.6, flankAngle: 25 }, N: { grooveWidth: 6.57, grooveDepth: 3.4, flankAngle: 20 } } }
  };
  // Settings that follow the belt profile (and, for T profiles, the groove form).
  var PROFILE_FIELDS = ['pld', 'grooveDepth', 'grooveRadius', 'flankRadius', 'flankOffset', 'grooveWidth', 'tipRadius', 'flankAngle', 'toolDia', 'toolLength', 'stepDown'];
  function profileSettings(key, form) {
    var prof = PROFILES[key] || PROFILES['5M'], own = prof.forms ? (prof.forms[form] || prof.forms.SE) : {}, out = {};
    PROFILE_FIELDS.forEach(function (k) { out[k] = own[k] !== undefined ? own[k] : prof[k] !== undefined ? prof[k] : DEFAULTS[k]; });
    return out;
  }
  var APPROACH = 1;          // mm above the OD where rapids hand over to feed
  var HOLDER_GAP = 1;        // mm kept between the tool holder and the top of the stock
  var CONTACT_TOL = 1e-4;    // mm, lets the cutter sit tangent to a wall
  var TIP_ZONE = 10 * Math.PI / 180;   // part of the ball this close to its tip counts as "the tip"
  var SLOW_RADIUS = 0.5;               // below this fraction of the cutter radius the ball cuts slowly
  var MIN_GAIN = 0.06;                 // mm: side roughing gives up keeping the tip clear when a pass gains less depth than this

  // Typical starting values for carbide cutters: chip load per tooth as a fraction of the cutter
  // diameter, and surface speed in m/min (used only to suggest a spindle speed).
  var MATERIALS = {
    aluminium: { label: 'Aluminium', chip: 0.007, speed: 150 },
    nylon: { label: 'Nylon', chip: 0.015, speed: 200 },
    castiron: { label: 'Cast iron', chip: 0.005, speed: 80 }
  };

  var DEFAULTS = {
    teeth: 20,
    faceWidth: 20,
    profile: '5M',         // key of PROFILES; the groove values below are that profile's nominal ones
    pld: 1.143,            // pitch diameter minus outside diameter
    grooveDepth: 2.16,
    grooveRadius: 1.56,    // bottom radius; on a trapezoid groove, the bottom corner radius
    flankRadius: 1,        // gt shape only: radius of the flank arc
    flankOffset: 0.4,      // gt shape only: how far across the centreline that arc is struck from
    grooveWidth: 2.96,     // trapezoid shape only: width across the groove at the OD, before the tip radius
    grooveForm: 'SE',      // trapezoid shape only: 'SE' or 'N', the form the groove values were taken from
    tipRadius: 0.48,
    flankAngle: 0,         // degrees each flank leans away from the groove centreline
    toolDia: 3,
    toolLength: 12,        // cutter sticking out below the holder
    rpm: 5000,
    material: 'aluminium',
    feedAuto: true,        // work the cutting and plunge feeds out from the material
    feed: 210,             // these two are used as entered only when feedAuto is off
    plunge: 70,
    flutes: 2,
    adaptFeed: true,       // scale each pass's feed to its tooth load and to where on the cutter it cuts
    feedMin: 50,           // limits for that scaling, % of the cutting feed
    feedMax: 150,
    method: 'centre',      // 'centre' = slot the groove centre first, 'side' = work in from the sides with the cutter leaning
    finishOnly: false,     // side cutting only: leave out the roughing passes
    stepDown: 0.5,
    finishAllow: 0.1,
    scallop: 0.005,
    pattern: 'zigzag',     // 'zigzag' | 'oneway'
    order: 'tooth',        // 'tooth' | 'split' (rough all teeth, then finish all) | 'pass' (each pass on every groove in turn)
    rotaryParallel: 'X',   // linear axis the rotary axis lies along
    rotaryLetter: 'A',
    mode: 'Y',             // 'Y' = offset the cross axis, 'A' = rotate, cross axis stays 0
    rotDir: 1,
    edgeTilt: true,        // turn the part so the side of the ball cuts the tooth-tip radii
    maxTilt: 90,           // degrees, limit on that turn
    shaftIn: 90,           // % of the way in along the shaft for tilted finishing passes (0 = cut on the ball)
    topSense: 1,           // +1: a positive rotary move carries the top of the stock toward cross-axis plus
    zZero: 'axis',         // 'axis' = rotary centreline, 'top' = top of stock
    clearance: 10,
    headSide: 'left',      // end of the long axis the rotary head sits at: 'left' = minus end, 'right' = plus end
    faceStart: 0,
    stockDir: -1,          // from the start face toward the head, so the start face is the free end
    leadIn: 3,
    leadOut: 3,
    wcs: 'G54',
    toolChange: false,
    toolNumber: 1,
    coolant: false,
    dwell: 3,
    returnA: true,
    rapidRate: 2000,       // the last four only feed the time estimate
    rotaryRapid: 3600,
    feedOverride: 100,
    quantity: 1
  };

  // ---------------------------------------------------------------- geometry

  // Where two circles cross: the point at distance ra from A and rb from B that lies
  // further toward +y, or null if they do not meet.
  function circleMeet(A, ra, B, rb) {
    var dy = B.y - A.y, dz = B.z - A.z, d = Math.hypot(dy, dz);
    if (!(d > 1e-12) || d > ra + rb || d < Math.abs(ra - rb)) return null;
    var a = (ra * ra - rb * rb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, ra * ra - a * a));
    var my = A.y + a * dy / d, mz = A.z + a * dz / d;
    var p1 = { y: my + h * dz / d, z: mz - h * dy / d }, p2 = { y: my - h * dz / d, z: mz + h * dy / d };
    return p1.y >= p2.y ? p1 : p2;
  }

  // The right half of a groove is a chain of segments from the bottom centre out to the OD:
  //   arcs  { arc, c, r, t0, t1, concave }  point = c + r (cos t, sin t), t running t0 -> t1
  //   lines { line, p, d, len, n }          from p along unit d; n = unit normal out of the metal
  // Three groove shapes build that chain:
  //   round      one bottom radius, optional straight flank, tip radius (HTD)
  //   gt         bottom radius running into a larger flank radius, tip radius (GT2)
  //   trapezoid  flat bottom, corner radius, straight flank, tip radius (T profiles)
  function buildGeometry(p) {
    var errors = [];
    var prof = PROFILES[p.profile] || PROFILES['5M'], pitch = prof.pitch, shape = prof.shape || 'round';
    var PD = p.teeth * pitch / Math.PI;
    var OD = PD - p.pld;
    var Ro = OD / 2;
    var Rr = Ro - p.grooveDepth;
    var Rg = p.grooveRadius, rt = p.tipRadius, phi = p.flankAngle * DEG;
    var g = {
      teeth: p.teeth, pitch: pitch, shape: shape, PD: PD, OD: OD, Ro: Ro, Rr: Rr, Rg: Rg, rt: rt, phi: phi,
      rootDia: 2 * Rr, indexDeg: 360 / p.teeth, errors: errors, segs: []
    };
    if (!(Rr > 0)) { errors.push('Groove depth is larger than the pulley radius.'); return g; }

    var segs = g.segs, O = { y: 0, z: 0 }, r1 = Ro - rt;   // the tip fillet centre is rt inside the OD circle
    var Ct, psi0, Cg;
    if (shape === 'gt') {
      var Rf = p.flankRadius, off = p.flankOffset, rise2 = (Rf - Rg) * (Rf - Rg) - off * off;
      if (!(Rf > Rg && rise2 >= 0)) { errors.push('Flank radius and centre offset do not blend with the groove radius.'); return g; }
      Cg = { y: 0, z: Rr + Rg };                          // centre of the groove-bottom arc
      var Cf = { y: -off, z: Cg.z + Math.sqrt(rise2) };   // flank arc centre, across the centreline
      var tj = Math.atan2(Cg.z - Cf.z, Cg.y - Cf.y);      // where the two arcs run into each other
      Ct = circleMeet(O, r1, Cf, Rf + rt);
      if (!Ct) { errors.push('Groove radius, depth and tip radius do not form a valid profile.'); return g; }
      var tf = Math.atan2(Ct.z - Cf.z, Ct.y - Cf.y);
      if (!(tf >= tj - 1e-9)) { errors.push('Profile would be undercut: increase groove depth or reduce the tip radius.'); return g; }
      segs.push({ arc: true, c: Cg, r: Rg, t0: -Math.PI / 2, t1: tj, concave: true });
      if (tf - tj > 1e-9) segs.push({ arc: true, c: Cf, r: Rf, t0: tj, t1: tf, concave: true });
      psi0 = Math.atan2(Cf.z - Ct.z, Cf.y - Ct.y);
      g.minRadius = Math.min(Rg, Rf);
    } else {
      var flat = 0;                                       // half-width of a flat groove bottom
      if (shape === 'trapezoid') {
        var hw = p.grooveWidth / 2;
        if (!(hw < Ro)) { errors.push('Groove width is larger than the pulley.'); return g; }
        // the flank runs down from the sharp corner it would make with the OD
        var corner = { y: hw, z: Math.sqrt(Ro * Ro - hw * hw) };
        flat = corner.y + ((Rr + Rg - corner.z) * Math.sin(phi) - Rg) / Math.cos(phi);
        if (!(flat >= -1e-9)) { errors.push('Groove is too narrow for its depth, flank angle and corner radius.'); return g; }
        flat = Math.max(0, flat);
        if (flat > 1e-9) segs.push({ line: true, p: { y: 0, z: Rr }, d: { y: 1, z: 0 }, len: flat, n: { y: 0, z: 1 } });
      }
      Cg = { y: flat, z: Rr + Rg };                       // centre of the groove-bottom (or corner) arc
      var d = { y: Math.sin(phi), z: Math.cos(phi) };     // flank direction, going outward
      var nm = { y: Math.cos(phi), z: -Math.sin(phi) };   // flank normal, into the tooth
      var a1 = Math.PI / 2 - phi;                         // bottom arc ends tangent to the flank
      var P1 = { y: Cg.y + Rg * nm.y, z: Cg.z + Rg * nm.z };

      // Tip fillet centre: rt from the flank line, and rt inside the OD circle.
      var Q = { y: P1.y + rt * nm.y, z: P1.z + rt * nm.z };
      var qd = Q.y * d.y + Q.z * d.z;
      var disc = qd * qd - (Q.y * Q.y + Q.z * Q.z) + r1 * r1;
      var t = disc >= 0 ? -qd + Math.sqrt(disc) : NaN;
      var flankLen;
      if (t >= 0) {
        Ct = { y: Q.y + t * d.y, z: Q.z + t * d.z };
        psi0 = Math.PI - phi;
        flankLen = t;
      } else {
        // Groove too shallow for a straight flank: blend the fillet straight into the arc.
        var r2 = Rg + rt;
        Ct = circleMeet(O, r1, Cg, r2);
        if (!Ct) { errors.push('Groove radius, depth and tip radius do not form a valid profile.'); return g; }
        var e = { y: (Ct.y - Cg.y) / r2, z: (Ct.z - Cg.z) / r2 };
        a1 = Math.atan2(e.y, -e.z);
        psi0 = Math.atan2(-e.z, -e.y);
        flankLen = 0;
        if (a1 > Math.PI / 2 + 1e-9) { errors.push('Profile would be undercut: increase groove depth or reduce the tip radius.'); return g; }
      }
      segs.push({ arc: true, c: Cg, r: Rg, t0: -Math.PI / 2, t1: a1 - Math.PI / 2, concave: true });
      if (flankLen > 1e-9) segs.push({ line: true, p: P1, d: d, len: flankLen, n: { y: -nm.y, z: -nm.z } });
      g.minRadius = Rg;
    }
    var psi1 = Math.atan2(Ct.z, Ct.y);
    if (rt > 1e-9 && psi0 - psi1 > 1e-9) segs.push({ arc: true, c: Ct, r: rt, t0: psi0, t1: psi1, concave: false, tip: true });
    var cl = Math.hypot(Ct.y, Ct.z);
    var T = { y: Ct.y * Ro / cl, z: Ct.z * Ro / cl };   // where the fillet meets the OD
    var thetaT = Math.atan2(T.y, T.z);

    g.Cg = Cg; g.Ct = Ct; g.T = T; g.thetaT = thetaT;
    g.grooveWidth = 2 * T.y;
    g.landWidth = Ro * (2 * Math.PI / p.teeth - 2 * thetaT);
    if (!(psi0 - psi1 >= -1e-9)) errors.push('Tip radius does not fit this profile.');
    if (!(g.landWidth > 0)) errors.push('Grooves overlap: there is no land left between teeth.');
    return g;
  }

  // Right half of one groove, bottom centre out to the OD tangent point.
  // Each point carries the unit normal pointing out of the metal.
  function sampleHalf(g, ds) {
    var pts = [];
    g.segs.forEach(function (sg, k) {
      var n, i, first = k === 0 ? 0 : 1;                  // later segments start where the one before ended
      if (sg.line) {
        n = Math.max(1, Math.ceil(sg.len / ds));
        for (i = first; i <= n; i++) {
          var l = sg.len * i / n;
          pts.push({ y: sg.p.y + sg.d.y * l, z: sg.p.z + sg.d.z * l, ny: sg.n.y, nz: sg.n.z });
        }
      } else {
        var sweep = sg.t1 - sg.t0, out = sg.concave ? -1 : 1;
        n = Math.max(k === 0 ? 2 : 1, Math.ceil(sg.r * Math.abs(sweep) / ds));
        for (i = first; i <= n; i++) {
          var t = sg.t0 + sweep * i / n, ct = Math.cos(t), st = Math.sin(t);
          pts.push({ y: sg.c.y + sg.r * ct, z: sg.c.z + sg.r * st, ny: out * ct, nz: out * st });
        }
      }
    });
    return pts;
  }

  function mirrorJoin(half) {
    var out = [];
    for (var i = half.length - 1; i >= 1; i--) {
      var q = half[i];
      out.push({ y: -q.y, z: q.z, ny: -q.ny, nz: q.nz });
    }
    return out.concat(half);
  }

  function sampleGroove(g, ds) { return mirrorJoin(sampleHalf(g, ds)); }

  // Groove plus the OD either side, as a height field for the drop-cutter test.
  // The OD is carried past the neighbouring grooves, which only errs on the safe side.
  function heightField(g, ds, reach) {
    var pts = sampleGroove(g, ds).map(function (q) { return { y: q.y, z: q.z }; });
    var yMax = Math.min(g.T.y + reach, g.Ro * 0.999);
    for (var y = g.T.y + ds; y <= yMax; y += ds) {
      var z = Math.sqrt(g.Ro * g.Ro - y * y);
      pts.push({ y: y, z: z }); pts.push({ y: -y, z: z });
    }
    return pts;
  }

  // Lowest ball-centre height at lateral position y that does not cut the profile.
  function dropCutter(field, y, Rt) {
    var r = Rt - CONTACT_TOL, best = -Infinity;
    for (var i = 0; i < field.length; i++) {
      var dy = field[i].y - y;
      if (dy > -r && dy < r) {
        var z = field[i].z + Math.sqrt(r * r - dy * dy);
        if (z > best) best = z;
      }
    }
    return best;
  }

  // Outline of one pitch (centred on the groove) for drawing the whole pulley.
  function pitchOutline(g, ds) {
    var half = Math.PI / g.teeth, pts = [], th, n, i;
    n = Math.max(1, Math.ceil(g.Ro * (half - g.thetaT) / ds));
    for (i = 0; i < n; i++) {
      th = -half + (half - g.thetaT) * i / n;
      pts.push({ y: g.Ro * Math.sin(th), z: g.Ro * Math.cos(th) });
    }
    sampleGroove(g, ds).forEach(function (q) { pts.push({ y: q.y, z: q.z }); });
    for (i = 1; i <= n; i++) {
      th = g.thetaT + (half - g.thetaT) * i / n;
      pts.push({ y: g.Ro * Math.sin(th), z: g.Ro * Math.cos(th) });
    }
    return pts;
  }

  // ---------------------------------------------------------------- toolpath

  // Ball-centre positions along the right-hand half of the groove, from the bottom
  // centre out to where the tooth tip meets the OD. Spacing follows the scallop height h
  // (and, if maxStep is given, the ball centre never moves further than that between
  // neighbouring points). Each point carries `want`: how far the cutter
  // axis would have to lean toward +y for the widest part of the ball to do the cutting.
  // Points on the tooth-tip radius also carry `edge` (the same angle).
  function halfCentres(g, Rt, h, field, maxStep) {
    var half = [];
    // travel: how far the ball centre moves per unit of travel of the contact point
    function step(v, travel) { return maxStep ? Math.min(v, maxStep / travel) : v; }
    // Stretch of each straight segment the ball works along. Where two of them meet in a corner
    // tighter than the ball, it stops at the point where it touches both.
    var range = g.segs.map(function (sg) { return sg.line ? [0, sg.len] : null; });
    g.segs.forEach(function (sg, k) {
      var a = g.segs[k - 1], b = g.segs[k + 1];
      if (!sg.arc || !sg.concave || sg.r - Rt > 1e-9 || !a || !b || !a.line || !b.line) return;
      // ball-centre lines: each wall moved the ball radius out of the metal
      var ry = b.p.y + b.n.y * Rt - a.p.y - a.n.y * Rt, rz = b.p.z + b.n.z * Rt - a.p.z - a.n.z * Rt;
      var det = b.d.y * a.d.z - a.d.y * b.d.z;
      if (Math.abs(det) < 1e-12) return;
      range[k - 1][1] = Math.max(0, Math.min(a.len, (b.d.y * rz - b.d.z * ry) / det));
      range[k + 1][0] = Math.max(0, Math.min(b.len, (a.d.y * rz - a.d.z * ry) / det));
    });
    g.segs.forEach(function (sg, k) {
      var first = k === 0 ? 0 : 1, n, i, s;
      if (sg.line) {
        // A flank parallel to the cutter is cut by the cutter's side, so it needs no passes of its own.
        if (Math.abs(sg.d.y) < 1e-6) return;
        var from = range[k][0], span = range[k][1] - from;
        s = step(Math.sqrt(8 * h * Rt), 1);
        n = Math.max(1, Math.ceil(span / s));
        var lean = Math.atan2(sg.n.z, -sg.n.y);
        for (i = first; i <= (span > 1e-9 ? n : 0); i++) {
          var l = from + span * i / n;
          half.push({ y: sg.p.y + sg.d.y * l + sg.n.y * Rt, z: sg.p.z + sg.d.z * l + sg.n.z * Rt, want: lean });
        }
        return;
      }
      var sweep = sg.t1 - sg.t0, t;
      if (sg.concave) {
        var rho = sg.r - Rt;
        if (rho > 1e-9) {
          s = step(Math.sqrt(8 * h / (1 / Rt - 1 / sg.r)), rho / sg.r);
          n = Math.max(1, Math.ceil(sg.r * Math.abs(sweep) / s));
          for (i = first; i <= n; i++) {
            t = sg.t0 + sweep * i / n;
            half.push({ y: sg.c.y + rho * Math.cos(t), z: sg.c.z + rho * Math.sin(t), want: -t });
          }
        } else if (k === 0) {
          // the ball is too big to follow this radius: one pass, sitting where the arc starts
          half.push({ y: sg.c.y + rho * Math.cos(sg.t0), z: sg.c.z + rho * Math.sin(sg.t0), want: -sg.t0 });
        }
        return;
      }
      s = step(Math.sqrt(8 * h / (1 / Rt + 1 / sg.r)), (sg.r + Rt) / sg.r);
      n = Math.ceil(sg.r * Math.abs(sweep) / s);
      for (i = 1; i <= n; i++) {
        t = sg.t0 + sweep * i / n;
        var c = { y: sg.c.y + (sg.r + Rt) * Math.cos(t), z: sg.c.z + (sg.r + Rt) * Math.sin(t), want: Math.PI - t };
        if (sg.tip) c.edge = Math.PI - t;
        half.push(c);
      }
    });
    half.forEach(function (c) {
      var floor = dropCutter(field, c.y, Rt);
      if (floor > c.z + 1e-6) { c.z = floor; delete c.edge; }   // lifted clear of something: no longer a clean edge contact
    });
    return half;
  }

  function mirrored(c) {
    var q = { y: -c.y, z: c.z, want: c.want };
    if (c.edge !== undefined) q.edge = -c.edge;
    return q;
  }

  // Finishing passes for centre slotting: swept from the OD on one side, through the
  // groove bottom, to the OD on the other.
  function finishCentres(g, Rt, h, field) {
    var half = halfCentres(g, Rt, h, field), all = [];
    for (var i = half.length - 1; i >= 1; i--) all.push(mirrored(half[i]));
    return all.concat(half);
  }

  // Slotting passes that take the groove down in steps: one down the centre line at each
  // depth and, with `wide`, further passes worked out toward both walls wherever the groove
  // is wider than the cutter, leaving the finish allowance on the walls.
  function roughCentres(g, Rt, stepDown, allow, field, wide) {
    var zTop = g.Ro + Rt;
    var zEnd = Math.max(dropCutter(field, 0, Rt), g.Rr + Rt) + allow;
    var depth = zTop - zEnd, out = [];
    if (depth <= 1e-6) return out;
    var n = Math.max(1, Math.ceil(depth / stepDown - 1e-9));
    function clear(y, z) { return dropCutter(field, y, Rt) + allow <= z + 1e-9; }
    for (var k = 1; k <= n; k++) {
      var z = zTop - depth * k / n;
      out.push({ y: 0, z: z });
      if (!wide) continue;
      // how far the ball can move off centre at this depth before it reaches the allowance
      var inc = Rt / 20, lo = 0, hi = inc, limit = g.T.y + Rt;
      while (hi < limit && clear(hi, z)) { lo = hi; hi += inc; }
      for (var it = 0; it < 20; it++) { var mid = (lo + hi) / 2; if (clear(mid, z)) lo = mid; else hi = mid; }
      if (lo < 0.2 * Rt) continue;
      // centre first, then alternately left and right so each pass only takes a step-over
      var m = Math.ceil(lo / (0.8 * Rt));
      for (var i = 1; i <= m; i++) { out.push({ y: lo * i / m, z: z }); out.push({ y: -lo * i / m, z: z }); }
    }
    return out;
  }

  // Lowest point the cutter reaches at position y across the groove: under the ball,
  // or under the lower edge of a leaning shaft. Infinity where it does not reach.
  function cutFloor(c, y, Rt, len) {
    var best = Infinity, dy = y - c.y, t = c.tilt || 0;
    if (Math.abs(dy) < Rt) best = c.z - Math.sqrt(Rt * Rt - dy * dy);
    if (Math.abs(t) > 1e-6) {
      var st = Math.sin(Math.abs(t)), ct = Math.cos(t);
      var along = ((t > 0 ? dy : -dy) - Rt * ct) / st;      // distance up the shaft to the point above y
      if (along >= 0 && along <= len) best = Math.min(best, c.z + along * ct - Rt * st);
    }
    return best;
  }

  // Top surface of one tooth pitch after each cutting pass, as heights over a
  // fixed set of positions across the pitch: tops[k] is the surface after k passes.
  function passProfiles(r) {
    var g = r.geom, Rt = r.toolRadius, len = r.params.toolLength, yb = g.Ro * Math.sin(Math.PI / g.teeth), n = 120, ys = [], i;
    for (i = 0; i <= n; i++) ys.push(-yb + 2 * yb * i / n);
    var z = ys.map(function (y) { return Math.sqrt(g.Ro * g.Ro - y * y); }), tops = [z.slice()];
    r.rough.concat(r.finish).forEach(function (c) {
      for (var j = 0; j <= n; j++) z[j] = Math.min(z[j], cutFloor(c, ys[j], Rt, len));
      tops.push(z.slice());
    });
    return { ys: ys, tops: tops };
  }

  // ---------------------------------------------------------------- cut simulation

  // The cutter seen along the pulley axis is a disc (the ball) plus a strip
  // (the shank) leaving the disc centre along unit vector u.
  // tilt: lean of the cutter axis from the groove centreline toward +y, in radians.
  function toolAxis(c) {
    var t = c.tilt || 0;
    return { y: Math.sin(t), z: Math.cos(t) };
  }

  // Distance along the ray p + t*n (t >= 0) at which it enters the cutter.
  function rayEntry(p, c, u, Rt) {
    var wy = p.y - c.y, wz = p.z - c.z, best = Infinity;
    var wn = wy * p.ny + wz * p.nz, cc = wy * wy + wz * wz - Rt * Rt;
    if (cc <= 0) return 0;
    var disc = wn * wn - cc;
    if (disc >= 0) { var tb = -wn - Math.sqrt(disc); if (tb >= 0) best = tb; }
    var lat0 = wy * u.z - wz * u.y, ln = p.ny * u.z - p.nz * u.y;
    var al0 = wy * u.y + wz * u.z, an = p.ny * u.y + p.nz * u.z;
    var lo = 0, hi = Infinity;
    if (Math.abs(ln) < 1e-12) { if (Math.abs(lat0) > Rt) return best; }
    else {
      var t1 = (-Rt - lat0) / ln, t2 = (Rt - lat0) / ln;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    }
    if (Math.abs(an) < 1e-12) { if (al0 < 0) return best; }
    else if (an > 0) lo = Math.max(lo, -al0 / an);
    else hi = Math.min(hi, -al0 / an);
    if (lo <= hi) best = Math.min(best, lo);
    return best;
  }

  function penetration(p, c, u, Rt) {
    var wy = p.y - c.y, wz = p.z - c.z;
    var al = wy * u.y + wz * u.z;
    var dist = al >= 0 ? Math.abs(wy * u.z - wz * u.y) : Math.hypot(wy, wz);
    return Rt - dist;
  }

  // For every profile sample: metal left standing along the normal (excess)
  // and how far any cutter position digs below the profile (gouge).
  function simulate(g, samples, centres, Rt) {
    var axes = centres.map(toolAxis);
    var maxExcess = 0, maxGouge = 0;
    var res = samples.map(function (p) {
      var pn = p.y * p.ny + p.z * p.nz;
      var excess = -pn + Math.sqrt(Math.max(0, pn * pn - (p.y * p.y + p.z * p.z - g.Ro * g.Ro)));
      var gouge = 0;
      for (var i = 0; i < centres.length; i++) {
        var e = rayEntry(p, centres[i], axes[i], Rt);
        if (e < excess) excess = e;
        var pen = penetration(p, centres[i], axes[i], Rt);
        if (pen > gouge) gouge = pen;
      }
      if (excess > maxExcess) maxExcess = excess;
      if (gouge > maxGouge) maxGouge = gouge;
      return { y: p.y, z: p.z, cy: p.y + p.ny * excess, cz: p.z + p.nz * excess, excess: excess, gouge: gouge };
    });
    return { points: res, maxExcess: maxExcess, maxGouge: maxGouge };
  }

  // ---------------------------------------------------------------- G-code

  function fmt(v, dp) {
    var s = v.toFixed(dp);
    return parseFloat(s) === 0 ? (0).toFixed(dp) : s;
  }

  function Emitter(p) {
    this.lines = [];
    this.letters = {
      L: p.rotaryParallel === 'Y' ? 'Y' : 'X',
      C: p.rotaryParallel === 'Y' ? 'X' : 'Y',
      Z: 'Z',
      R: p.rotaryLetter
    };
    this.pos = {}; this.txt = {}; this.feed = null;
    this.rapidRate = p.rapidRate; this.rotaryRapid = p.rotaryRapid;
    this.feedScale = p.feedOverride / 100;
    this.phase = 'rough';
    this.moves = [];           // every motion line, for the playback preview
    this.started = 0;          // grooves begun so far
    this.visit = 0;            // counts each time work starts on a groove
    // Carving state for the preview: groove being worked on, passes finished on it,
    // whether this move is a cutting stroke, and the pass counts of grooves not yet / already visited.
    this.groove = -1; this.done = 0; this.stroke = false; this.before = 0; this.after = 0;
    this.time = { rough: 0, finish: 0, step: 0, rapid: 0, index: 0 };
    this.dist = { rough: 0, finish: 0, step: 0, rapid: 0, index: 0 };
    this.rotaryTravel = 0;     // degrees the rotary axis turns in total
  }
  Emitter.prototype.raw = function (s) { this.lines.push(s); };
  Emitter.prototype.comment = function (s) { this.lines.push('(' + s.replace(/[()]/g, '') + ')'); };
  Emitter.prototype.move = function (code, target, F) {
    var words = [], self = this, lin = 0, rot = 0, known = true, along = false;
    ['L', 'C', 'Z', 'R'].forEach(function (k) {
      if (target[k] === undefined) return;
      var s = fmt(target[k], k === 'R' ? 4 : 3);
      if (self.txt[k] === s) return;
      if (self.pos[k] === undefined) known = false;
      else if (k === 'R') rot = Math.abs(target[k] - self.pos[k]);
      else { var dv = target[k] - self.pos[k]; lin += dv * dv; if (k === 'L') along = true; }
      self.pos[k] = target[k]; self.txt[k] = s;
      words.push(self.letters[k] + s);
    });
    if (!words.length) return;
    lin = Math.sqrt(lin);
    var line = code + ' ' + words.join(' ');
    var kind, minutes;
    if (code === 'G1') {
      if (this.feed !== F) { line += ' F' + fmt(F, 0); this.feed = F; }
      kind = along ? this.phase : 'step';
      minutes = (lin > 1e-9 ? lin : rot) / (F * this.feedScale);
    } else {
      var tl = lin / this.rapidRate, tr = rot / this.rotaryRapid;
      kind = tr > tl ? 'index' : 'rapid';
      minutes = Math.max(tl, tr);
    }
    if (known) { this.time[kind] += minutes; this.dist[kind] += kind === 'index' ? rot : lin; this.rotaryTravel += rot; }
    this.moves.push({ line: this.lines.length, cut: code === 'G1', L: this.pos.L, C: this.pos.C, Z: this.pos.Z, R: this.pos.R,
      dt: known ? minutes : 0, started: this.started, visit: this.visit,
      groove: this.groove, done: this.done, stroke: this.stroke, before: this.before, after: this.after });
    this.lines.push(line);
  };
  Emitter.prototype.rapid = function (t) { this.move('G0', t); };
  Emitter.prototype.cut = function (t, F) { this.move('G1', t, F); };

  function validate(p) {
    var e = [];
    function pos(k, label) { if (!(p[k] > 0)) e.push(label + ' must be greater than zero.'); }
    function nonNeg(k, label) { if (!(p[k] >= 0)) e.push(label + ' cannot be negative.'); }
    if (!PROFILES[p.profile]) e.push('Unknown belt profile.');
    if (!(Number.isInteger(p.teeth) && p.teeth >= 6 && p.teeth <= 400)) e.push('Number of teeth must be a whole number from 6 to 400.');
    pos('faceWidth', 'Face width'); pos('pld', 'Pitch line differential'); pos('grooveDepth', 'Groove depth');
    pos('grooveRadius', 'Groove radius'); nonNeg('tipRadius', 'Tip radius');
    var shape = (PROFILES[p.profile] || {}).shape;
    if (shape === 'gt') { pos('flankRadius', 'Flank radius'); nonNeg('flankOffset', 'Flank centre offset'); }
    if (shape === 'trapezoid') pos('grooveWidth', 'Groove width');
    if (!(p.flankAngle >= 0 && p.flankAngle <= 30)) e.push('Flank angle must be between 0 and 30 degrees.');
    pos('toolDia', 'Cutter diameter'); pos('toolLength', 'Cutter length');
    if (p.toolLength < p.grooveDepth + HOLDER_GAP) e.push('The cutter must be at least ' + HOLDER_GAP + ' mm longer than the groove depth.');
    if (!MATERIALS[p.material]) e.push('Unknown material.');
    pos('rpm', 'Spindle speed'); pos('feed', 'Cutting feed'); pos('plunge', 'Plunge feed');
    if (!(Number.isInteger(p.flutes) && p.flutes >= 1 && p.flutes <= 8)) e.push('Flutes must be a whole number from 1 to 8.');
    if (!(p.feedMin > 0 && p.feedMin <= 100)) e.push('Lowest feed must be between 1 and 100 percent.');
    if (!(p.feedMax >= 100 && p.feedMax <= 500)) e.push('Highest feed must be between 100 and 500 percent.');
    if (p.method !== 'centre' && p.method !== 'side') e.push('Unknown cutting method.');
    pos('stepDown', 'Step-down'); nonNeg('finishAllow', 'Finish allowance'); pos('scallop', 'Scallop height');
    pos('rapidRate', 'Rapid rate'); pos('rotaryRapid', 'Rotary rapid rate'); pos('feedOverride', 'Feed override');
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push('Number of pulleys must be a whole number, 1 or more.');
    if (!(p.maxTilt >= 0 && p.maxTilt <= 180)) e.push('Tilt limit must be between 0 and 180 degrees.');
    if (!(p.shaftIn >= 0 && p.shaftIn <= 100)) e.push('Finish on the shaft must be between 0 and 100 percent.');
    pos('clearance', 'Clearance'); nonNeg('leadIn', 'Lead-in'); nonNeg('leadOut', 'Lead-out'); nonNeg('dwell', 'Spindle dwell');
    if (!isFinite(p.faceStart)) e.push('Face position must be a number.');
    return e;
  }

  function generate(input) {
    var p = {}, k;
    for (k in DEFAULTS) p[k] = input && input[k] !== undefined ? input[k] : DEFAULTS[k];
    // feeds from the material: chip load per tooth x flutes x spindle speed, plunging at a third of that
    var mat = MATERIALS[p.material];
    if (p.feedAuto && mat && p.rpm > 0 && p.toolDia > 0 && p.flutes >= 1) {
      p.feed = Math.max(1, Math.round(mat.chip * p.toolDia * p.flutes * p.rpm));
      p.plunge = Math.max(1, Math.round(p.feed / 3));
    }
    var out = { params: p, errors: validate(p), warnings: [], gcode: '' };
    if (out.errors.length) return out;

    var g = out.geom = buildGeometry(p);
    if (g.errors.length) { out.errors = g.errors; return out; }

    var Rt = p.toolDia / 2;
    var field = heightField(g, 0.004, 2 * Rt + 0.5);
    var finish, rough;
    var tiltLimit = p.maxTilt * DEG, maxLean = 0, wantedLean = 0, wantedReach = 0, heldBack = false;

    // Furthest the cutter may lean (toward side s = +1 or -1) before the holder comes within
    // HOLDER_GAP of the top of the stock. Tip height is rho * cos(lean - beta) - Rt.
    function leanByLength(c, s) {
      var rho = Math.hypot(c.y, c.z), beta = s * Math.atan2(c.y, c.z);
      var room = (g.Ro + Rt - (p.toolLength - HOLDER_GAP)) / rho;
      return Math.max(0, room >= 1 ? beta : room <= -1 ? Math.PI : beta + Math.acos(room));
    }

    // points all round the finished pulley, for checking where the cutter may go
    var solid = [], sstep = 2 * Math.PI / p.teeth, sk, sth;
    var grooveCoarse = sampleGroove(g, 0.03);
    for (sk = 0; sk < p.teeth; sk++) {
      var sca = Math.cos(sk * sstep), ssa = Math.sin(sk * sstep);
      grooveCoarse.forEach(function (q) { solid.push({ y: q.y * sca + q.z * ssa, z: -q.y * ssa + q.z * sca }); });
      for (sth = g.thetaT; sth <= sstep - g.thetaT; sth += 0.05 / g.Ro) solid.push({ y: g.Ro * Math.sin(sth + sk * sstep), z: g.Ro * Math.cos(sth + sk * sstep) });
    }

    // Finishing the tooth-tip radii on the shaft: where the cutter lies along the surface, push it
    // in along its own axis so the straight side does the cutting and the ball hangs clear in
    // the groove. It goes shaftIn % of the way to where the ball would start cutting stock the
    // finishing has not reached yet, or the holder would get too close.
    function finishOnShaft(list) {
      if (p.shaftIn > 0) list.forEach(function (c) {
        // only passes on the tooth-tip radius whose lean lays the cutter flat along the surface
        if (!c.tilted || c.edge === undefined || Math.abs(Math.abs(c.tilt) - Math.abs(c.edge)) > 1e-9) return;
        var u = toolAxis(c), keep = Rt + p.finishAllow + 0.1;
        var cap = Math.max(0, (p.toolLength - HOLDER_GAP) - (g.Ro - (c.y * u.y + c.z * u.z - Rt)));
        var reachSq = Math.pow(p.toolLength + Rt + cap + 0.2, 2);
        var near = solid.filter(function (q) { return (q.y - c.y) * (q.y - c.y) + (q.z - c.z) * (q.z - c.z) <= reachSq; });
        function ok(sl) {
          var cy = c.y - sl * u.y, cz = c.z - sl * u.z;
          for (var i = 0; i < near.length; i++) {
            var wy = near[i].y - cy, wz = near[i].z - cz, al = wy * u.y + wz * u.z;
            if (al > p.toolLength) continue;
            if (al >= 0) { if (Rt - Math.abs(wy * u.z - wz * u.y) > 3e-4) return false; continue; }
            var dd = Math.hypot(wy, wz);
            if (Rt - dd > 3e-4) return false;
            if (-al >= 0.5 * dd && dd < keep) return false;          // the front of the ball stays out of uncut stock
          }
          return true;
        }
        if (!cap || !ok(0)) return;
        var lo = 0, hi = cap;
        if (!ok(cap)) {
          while (lo + 0.1 < cap && ok(lo + 0.1)) lo += 0.1;
          hi = Math.min(cap, lo + 0.1);
          for (var it = 0; it < 10; it++) { var mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
        } else lo = cap;
        c.slide = lo * p.shaftIn / 100;
        c.y -= c.slide * u.y; c.z -= c.slide * u.z;
      });
    }

    if (p.method === 'side') {
      // ---------------- side cutting: every pass leans as far as the finished pulley allows
      // Largest lean up to `wanted` at which neither ball nor shaft cuts into the finished pulley.
      var leanFor = function (c, s, wanted) {
        var reachSq = Math.pow(p.toolLength + Rt + 0.2, 2);
        var near = solid.filter(function (q) { return (q.y - c.y) * (q.y - c.y) + (q.z - c.z) * (q.z - c.z) <= reachSq; });
        function clear(lean) {
          var uy = s * Math.sin(lean), uz = Math.cos(lean);
          for (var i = 0; i < near.length; i++) {
            var wy = near[i].y - c.y, wz = near[i].z - c.z, al = wy * uy + wz * uz;
            if (al > p.toolLength) continue;                      // level with the holder, which leanByLength keeps clear
            var dist = al >= 0 ? Math.abs(wy * uz - wz * uy) : Math.hypot(wy, wz);
            if (Rt - dist > 3e-4) return false;
          }
          return true;
        }
        var limit = Math.min(wanted, tiltLimit, leanByLength(c, s));
        if (limit <= 0) return 0;
        if (clear(limit)) return limit;
        var lo = 0, hi = limit;
        for (var it = 0; it < 14; it++) { var mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
        return lo;
      };
      var place = function (c, s, wanted, isRough) {
        var q = { y: s * c.y, z: c.z + (isRough ? p.finishAllow : 0), want: c.want, tilted: true };
        if (c.edge !== undefined) { q.edge = s * c.edge; q.beside = !isRough; }
        q.tilt = s * leanFor({ y: q.y, z: q.z }, s, wanted);
        return q;
      };

      // finishing: each side from the tooth tip down to the groove bottom
      var halfFin = halfCentres(g, Rt, p.scallop, field).reverse();
      // on the tooth-tip radius the lean puts the contact on the widest part of the ball; inside the
      // groove proper the cutter leans as far as the tooth lets it, to keep the tip off the surface
      var leanWanted = function (c) { return c.edge !== undefined ? c.want : Math.PI; };
      var finRight = halfFin.map(function (c) { return place(c, 1, leanWanted(c), false); });
      var finLeft = halfFin.map(function (c) { return place(c, -1, leanWanted(c), false); });
      if (p.finishOnly) {
        // with no roughing first, come down the groove from both sides in turn so neither side takes it all
        finish = [];
        // the side that leads swaps at every level, so the heavier first cut is shared between them
        finRight.forEach(function (c, idx) { if (idx % 2) finish.push(finLeft[idx], c); else finish.push(c, finLeft[idx]); });
      } else finish = finRight.concat(finLeft);

      // roughing: closely spaced candidate positions down each side, lifted by the finish allowance
      var halfRough = halfCentres(g, Rt, p.scallop, field, 0.02).reverse();
      var cand = [halfRough.map(function (c) { return place(c, 1, Math.PI, true); }), null];
      cand[1] = cand[0].map(function (c) { var q = { y: -c.y, z: c.z, want: c.want, tilted: true, tilt: -c.tilt }; if (c.edge !== undefined) q.edge = -c.edge; return q; });
      var last = cand[0].length - 1, cutSoFar = [];
      // true when the part of the ball near its tip sits in space that is already cut, or outside the stock
      var tipFree = function (c) {
        var u = toolAxis(c);
        for (var gi = 0; gi <= 2; gi++) for (var sg = -1; sg <= 1; sg += 2) {
          var gam = TIP_ZONE * gi / 2, qy = c.y + Rt * (-u.y * Math.cos(gam) + sg * u.z * Math.sin(gam)), qz = c.z + Rt * (-u.z * Math.cos(gam) - sg * u.y * Math.sin(gam));
          if (Math.hypot(qy, qz) >= g.Ro - 1e-3) continue;
          var free = false;
          for (var j = 0; j < cutSoFar.length && !free; j++) if (penetration({ y: qy, z: qz }, cutSoFar[j].c, cutSoFar[j].u, Rt) > -1e-3) free = true;
          if (!free) return false;
        }
        return true;
      };
      rough = [];
      var at = [-1, -1], sideZ = [Infinity, Infinity], deepest = cand[0][0].z, sd = 1, forcedStep = Math.min(p.stepDown, 0.1 * Rt), minGain = Math.min(MIN_GAIN, 0.04 * Rt);
      var take = function (sideIdx, j, forced) {
        var c = cand[sideIdx][j];
        if (forced) c.forced = true;
        rough.push(c); cutSoFar.push({ c: c, u: toolAxis(c) });
        at[sideIdx] = j; sideZ[sideIdx] = c.z; deepest = Math.min(deepest, c.z);
      };
      take(0, 0, false);                                    // start at one side, leaning as far as the machine allows
      while ((at[0] < last || at[1] < last) && rough.length < 150) {
        if (at[sd] >= last) sd = 1 - sd;
        var list = cand[sd], jmax = at[sd], j;
        for (j = at[sd] + 1; j <= last; j++) { if (list[j].z >= deepest - p.stepDown - 1e-9) jmax = j; else break; }
        var pick = -1;
        for (j = jmax; j > at[sd]; j--) if (tipFree(list[j])) { pick = j; break; }
        if (pick >= 0 && (sideZ[sd] - list[pick].z >= minGain || pick === last || sideZ[sd] === Infinity)) take(sd, pick, false);
        else {
          // no way down here without the tip cutting: take a small step and carry on
          var jf = at[sd] + 1;
          for (j = at[sd] + 1; j <= last; j++) { if (list[j].z >= deepest - forcedStep - 1e-9) jf = j; else break; }
          take(sd, jf, true);
        }
        sd = 1 - sd;
      }

      finishOnShaft(finish);
      if (p.finishOnly) rough = [];                          // grooves already roughed out some other way

      rough.concat(finish).forEach(function (c) {
        maxLean = Math.max(maxLean, Math.abs(c.tilt));
        if (c.edge !== undefined) {
          var sgn = c.edge < 0 ? -1 : 1, wanted = Math.min(Math.abs(c.edge), tiltLimit), byLen = leanByLength(c, sgn);
          if (byLen < wanted - 1e-9) heldBack = true;
          wantedLean = Math.max(wantedLean, wanted);
          var rho = Math.hypot(c.y, c.z);
          wantedReach = Math.max(wantedReach, g.Ro + Rt - rho * Math.cos(wanted - sgn * Math.atan2(c.y, c.z)) + HOLDER_GAP);
        }
      });
    } else {
      // ---------------- centre slotting: upright cutter, optionally tilted for the tooth-tip radii
      finish = finishCentres(g, Rt, p.scallop, field);
      rough = roughCentres(g, Rt, p.stepDown, p.finishAllow, field);
      // a groove much wider than the cutter is opened out sideways too, so the finishing passes are not left a full-depth cut
      var heavyCut = Math.min(0.5, 0.6 * Rt);
      if (simulate(g, sampleGroove(g, 0.01), rough, Rt).maxExcess > heavyCut) rough = roughCentres(g, Rt, p.stepDown, p.finishAllow, field, true);
      rough.concat(finish).forEach(function (c) {
        c.tilted = c.beside = p.edgeTilt && c.edge !== undefined && tiltLimit > 0;
        if (!c.tilted) { c.tilt = p.mode === 'A' ? Math.atan2(c.y, c.z) : 0; return; }
        var sgn = c.edge < 0 ? -1 : 1, wanted = Math.min(Math.abs(c.edge), tiltLimit), byLen = leanByLength(c, sgn);
        var lean = Math.min(wanted, byLen);
        if (lean < wanted - 1e-9) heldBack = true;
        c.tilt = sgn * lean;
        maxLean = Math.max(maxLean, lean);
        wantedLean = Math.max(wantedLean, wanted);
        var rho = Math.hypot(c.y, c.z);
        wantedReach = Math.max(wantedReach, g.Ro + Rt - rho * Math.cos(wanted - sgn * Math.atan2(c.y, c.z)) + HOLDER_GAP);
      });

      finishOnShaft(finish);
    }

    // How far each leaning pass must back out along the cutter to be clear of the uncut stock.
    rough.concat(finish).forEach(function (c) {
      if (!c.tilted) return;
      var u = toolAxis(c), cu = c.y * u.y + c.z * u.z, need = g.Ro + Rt + 0.5;
      var b = Math.max(0, -cu + Math.sqrt(Math.max(0, cu * cu - (c.y * c.y + c.z * c.z) + need * need)));
      c.back = Math.max(APPROACH, Math.max(b, -cu));
    });

    // Which part of the cutter removes the metal: cut the groove cross-section pass by pass on a
    // fine grid and note, for every cell, the radius of the cutter at the height along its axis
    // where that cell was removed (full radius on the shaft, falling to zero at the tip).
    var tipUse = { slowShare: 0, tipShare: 0, meanRadius: 1, passes: 0 };
    (function () {
      var cell = Math.min(0.02, Math.max(Rt / 40, p.grooveDepth / 150)), y0 = -(g.T.y + 0.3), nz = Math.ceil((p.grooveDepth + 0.3) / cell), ny = Math.ceil(-2 * y0 / cell);
      var z0 = g.Rr - 0.1, cut = new Uint8Array(ny * nz), tipR = Rt * Math.sin(TIP_ZONE), slowR = Rt * SLOW_RADIUS, total = 0, slow = 0, tipTotal = 0, sumR = 0;
      rough.concat(finish).forEach(function (c) {
        var u = toolAxis(c), tipCells = 0, cells = 0, sumLocal = 0, deepest = 0;
        var ia = Math.max(0, Math.floor((c.y - Rt - 0.05 - y0) / cell)), ib = c.tilt ? ny - 1 : Math.min(ny - 1, Math.ceil((c.y + Rt + 0.05 - y0) / cell));
        if (c.tilt < 0) { ib = Math.min(ny - 1, Math.ceil((c.y + Rt + 0.05 - y0) / cell)); ia = 0; }
        for (var i = ia; i <= ib; i++) for (var j = 0; j < nz; j++) {
          if (cut[i * nz + j]) continue;
          var qy = y0 + (i + 0.5) * cell, qz = z0 + (j + 0.5) * cell;
          if (qy * qy + qz * qz >= g.Ro * g.Ro) continue;
          var wy = qy - c.y, wz = qz - c.z, al = wy * u.y + wz * u.z;
          var dist = al >= 0 ? Math.abs(wy * u.z - wz * u.y) : Math.hypot(wy, wz);
          if (dist > Rt) continue;
          cut[i * nz + j] = 1;
          var local = al >= 0 ? Rt : Math.sqrt(Math.max(0, Rt * Rt - al * al));
          total++; sumR += local;
          // how far in from the cutter's edge this cell lies, as a fraction of the radius at its height
          var depth = local > 1e-6 ? 1 - Math.abs(wy * u.z - wz * u.y) / local : 1;
          cells++; sumLocal += local; if (depth > deepest) deepest = depth;
          if (local < slowR) slow++;
          if (local < tipR) { tipTotal++; tipCells++; }
        }
        c.tipArea = tipCells * cell * cell;                // mm2 of metal this pass removes with the tip zone
        c.area = cells * cell * cell;                      // mm2 of metal this pass removes in all
        c.engage = cells ? Math.max(deepest, cell / Rt) : 0;   // radial depth of cut over cutter radius
        c.cutRadius = cells ? sumLocal / cells / Rt : 1;       // where on the cutter it cuts, 1 = full radius

        // Feed for this pass. Tooth load: a cutter that only grazes the metal takes a thinner chip
        // per tooth than one buried to its centre, so the feed goes up to restore the chip thickness
        // (sin of the engagement angle). Cutter angle: metal removed low on the ball, where the
        // cutter turns slowly, is fed in proportion to the radius doing the cutting.
        c.feed = p.feed;
        if (p.adaptFeed) {
          var thin = c.engage > 0 ? 1 / Math.sqrt(Math.max(1e-6, 2 * c.engage - c.engage * c.engage)) : Infinity;
          var factor = Math.max(p.feedMin / 100, Math.min(p.feedMax / 100, thin * c.cutRadius));
          c.feed = Math.round(p.feed * factor);
        }
        if (tipCells) tipUse.passes++;
      });
      if (total) { tipUse.slowShare = slow / total; tipUse.tipShare = tipTotal / total; tipUse.meanRadius = sumR / total / Rt; }
    })();

    var feedLo = Infinity, feedHi = 0;
    rough.concat(finish).forEach(function (c) { feedLo = Math.min(feedLo, c.feed); feedHi = Math.max(feedHi, c.feed); });

    var samples = sampleGroove(g, 0.01);
    var sim = simulate(g, samples, rough.concat(finish), Rt);
    var roughSim = simulate(g, samples, rough, Rt);
    // A tilted cutter reaches across neighbouring teeth, so check it against the rest of the pulley too.
    var tilted = rough.concat(finish).filter(function (c) { return c.tilted; });
    if (tilted.length) {
      var axes = tilted.map(toolAxis), coarse = sampleGroove(g, 0.03), step = 2 * Math.PI / p.teeth, th, k;
      var check = function (y, z) {
        for (var j = 0; j < tilted.length; j++) {
          var pen = penetration({ y: y, z: z }, tilted[j], axes[j], Rt);
          if (pen > sim.maxGouge) sim.maxGouge = pen;
        }
      };
      for (k = 0; k < p.teeth; k++) {
        var ca = Math.cos(k * step), sa = Math.sin(k * step);
        if (k) coarse.forEach(function (q) { check(q.y * ca + q.z * sa, -q.y * sa + q.z * ca); });
        for (th = g.thetaT; th <= step - g.thetaT; th += 0.05 / g.Ro) check(g.Ro * Math.sin(th + k * step), g.Ro * Math.cos(th + k * step));
      }
    }
    out.finish = finish; out.rough = rough; out.sim = sim; out.toolRadius = Rt;
    out.outline = pitchOutline(g, Math.min(0.05, g.pitch / 100));

    // ---- warnings
    var w = out.warnings;
    var usualRpm = mat.speed * 1000 / (Math.PI * p.toolDia);
    if (p.feedAuto && p.rpm < usualRpm / 5) w.push('At ' + fmt(p.rpm, 0) + ' rpm the feed for ' + mat.label.toLowerCase() + ' works out at only ' + p.feed + ' mm/min, so the job is slow. A usual speed for a ' + fmt(p.toolDia, 1) + ' mm cutter in ' + mat.label.toLowerCase() + ' is about ' + fmt(Math.round(usualRpm / 100) * 100, 0) + ' rpm.');
    var prof = PROFILES[p.profile];
    if (p.teeth < prof.minTeeth) w.push('Fewer than ' + prof.minTeeth + ' teeth is below the usual minimum for ' + (p.profile === '8M' ? 'an ' : 'a ') + prof.label + ' belt; expect short belt life.');
    // (on a trapezoid groove a larger ball only rounds the bottom corners; the metal-left warning below covers that)
    if (g.shape !== 'trapezoid' && g.minRadius < Rt - 1e-6) w.push('The cutter radius (' + fmt(Rt, 2) + ' mm) is larger than the groove radius, so it cannot form this groove.');
    if (g.shape === 'trapezoid' && (p.grooveForm === 'N') !== (p.teeth > 20)) w.push('T pulleys normally use the SE groove form up to 20 teeth and the N form above that; this one has ' + p.teeth + ' teeth and the ' + (p.grooveForm === 'N' ? 'N' : 'SE') + ' form.');
    if (sim.maxExcess > Math.max(3 * p.scallop, 0.01)) w.push('The cutter leaves up to ' + fmt(sim.maxExcess, 3) + ' mm of metal the profile calls for removing.');
    if (sim.maxGouge > 0.003) w.push('The cutter shank cuts up to ' + fmt(sim.maxGouge, 3) + ' mm below the profile in this positioning mode.');
    if (!rough.length) w.push('No roughing passes: this program expects the grooves to be roughed out already. On solid stock the finishing passes would cut the full ' + fmt(p.grooveDepth, 2) + ' mm groove depth in one go.');
    else if (roughSim.maxExcess > Math.min(0.5, 0.6 * Rt)) w.push('Finishing passes take up to ' + fmt(roughSim.maxExcess, 2) + ' mm in one cut.');
    if (p.leadIn < Rt) w.push('Lead-in is shorter than the cutter radius, so the cutter plunges into the stock at the start face.');
    if (p.leadOut < Rt) w.push(p.pattern === 'zigzag'
      ? 'Lead-out is shorter than the cutter radius: the groove ends in a ball-shaped run-out and zigzag passes step over inside the metal.'
      : 'Lead-out is shorter than the cutter radius: the groove ends in a ball-shaped run-out, not full depth at the far face.');
    if (p.stepDown > Rt) w.push('Step-down is more than the cutter radius. That is a heavy slotting cut for a ball-nose cutter.');
    if (tilted.length) {
      var lowest = Infinity;
      tilted.forEach(function (c) { lowest = Math.min(lowest, c.y * Math.sin(c.tilt) + c.z * Math.cos(c.tilt) - Rt); });
      out.reach = g.Ro - lowest;
      w.push((p.method === 'side' ? 'Side cutting turns' : 'Top-edge passes turn') + ' the part up to ' + fmt(maxLean / DEG, 0) + ' deg' +
        (heldBack ? ', limited by the ' + fmt(p.toolLength, 1) + ' mm cutter (' + fmt(wantedLean / DEG, 0) + ' deg needs ' + fmt(wantedReach, 1) + ' mm)' : '') +
        '. The tip goes ' + fmt(out.reach, 1) + ' mm below the stock top, beside it: the shank must be no wider than the cutter there, and the rotary direction setting must match the machine.');
    }
    if (p.stockDir !== (p.headSide === 'left' ? -1 : 1)) w.push('The start face is the one nearest the rotary head, so the cutter comes down beside the chuck and cuts toward the free end. If the start face should be the free end, change \u201cStock runs toward\u201d.');
    if (g.landWidth < (g.pitch >= 5 ? 0.5 : 0.04 * g.pitch)) w.push('Only ' + fmt(g.landWidth, 2) + ' mm of land is left between grooves.');

    // ---- machine coordinates
    var zOff = p.zZero === 'top' ? -g.Ro : 0;
    var zSafe = g.Ro + p.clearance + zOff;
    var zApproach = g.Ro + Math.min(APPROACH, p.clearance) + zOff;
    var xs = p.faceStart - p.stockDir * p.leadIn;
    var xe = p.faceStart + p.stockDir * (p.faceWidth + p.leadOut);
    // the rotary head holds one end of the stock; the cutter overruns the face nearest it by a lead plus its radius
    var headDir = p.headSide === 'left' ? -1 : 1, freeStart = p.stockDir === headDir;
    var headRoom = (freeStart ? p.leadOut : p.leadIn) + Rt;
    // The part is turned until the cutter axis for this pass stands vertical.
    function machine(c, base) {
      var cs = Math.cos(c.tilt), sn = Math.sin(c.tilt);
      return { C: c.y * cs - c.z * sn, Z: c.y * sn + c.z * cs - Rt + zOff, R: base - p.topSense * c.tilt / DEG };
    }

    var E = new Emitter(p), L = E.letters;
    E.comment(prof.label + ' pulley, ' + p.teeth + ' teeth, face width ' + fmt(p.faceWidth, 2) + ' mm');
    E.comment('Pitch dia ' + fmt(g.PD, 3) + '  Outside dia ' + fmt(g.OD, 3) + '  Root dia ' + fmt(g.rootDia, 3));
    E.comment('Groove: depth ' + fmt(p.grooveDepth, 3) +
      (g.shape === 'trapezoid' ? ' (' + (p.grooveForm === 'N' ? 'N' : 'SE') + ' form), width at OD ' + fmt(p.grooveWidth, 3) + ', corner radius ' + fmt(p.grooveRadius, 3) : ', radius ' + fmt(p.grooveRadius, 3)) +
      ', tip radius ' + fmt(p.tipRadius, 3) +
      (g.shape === 'gt' ? ', flank radius ' + fmt(p.flankRadius, 3) + ' struck ' + fmt(p.flankOffset, 3) + ' across the centreline' : ', flank ' + fmt(p.flankAngle, 1) + ' deg'));
    E.comment('Cutter: ' + fmt(p.toolDia, 2) + ' mm ball nose, ' + p.flutes + ' flutes, ' + fmt(p.rpm, 0) + ' rpm');
    E.comment('Material: ' + mat.label + (p.feedAuto ? ', feeds set from it' : ', feeds entered by hand'));
    if (p.adaptFeed) E.comment('Feed adjusted pass by pass, ' + feedLo + ' to ' + feedHi + ' mm/min, base ' + fmt(p.feed, 0) + ' = ' + fmt(p.feed / (p.rpm * p.flutes), 4) + ' mm per tooth');
    E.comment('Method: ' + (p.method === 'side' ? 'side cutting, cutter leaning, ' + (rough.length ? 'worked in from alternate sides' : 'finishing passes only') : 'centre slotting'));
    E.comment('SETUP: stock turned to ' + fmt(g.OD, 3) + ' mm dia, rotary axis along ' + L.L);
    E.comment('SETUP: ' + L.C + '0 on the rotary centreline, Z0 at ' + (p.zZero === 'top' ? 'the top of the stock' : 'the rotary centreline'));
    if (tilted.length) E.comment('SETUP: positive ' + L.R + ' must carry the top of the stock toward ' + L.C + (p.topSense > 0 ? '+' : '-') + ', cutter reach ' + fmt(out.reach, 1) + ' mm');
    E.comment('SETUP: ' + L.L + fmt(p.faceStart, 3) + ' at the start face, stock runs toward ' + L.L + (p.stockDir > 0 ? '+' : '-'));
    E.comment('SETUP: rotary head at the ' + L.L + (headDir > 0 ? '+' : '-') + ' end, start face is ' + (freeStart ? 'the free end' : 'next to the head') +
      ', keep the chuck ' + fmt(headRoom, 1) + ' mm or more clear of the face nearest it');
    E.comment('Index ' + fmt(g.indexDeg, 4) + ' deg per tooth, ' + rough.length + ' roughing + ' + finish.length + ' finishing passes per groove');
    E.raw('G17 G21 G90 G94');
    if (p.wcs) E.raw(p.wcs);
    if (p.toolChange) { E.raw('T' + p.toolNumber + ' M6'); E.raw('G43 H' + p.toolNumber); }
    E.rapid({ Z: zSafe });
    E.rapid({ L: xs, C: 0, R: 0 });
    E.raw('M3 S' + fmt(p.rpm, 0));
    if (p.coolant) E.raw('M8');
    if (p.dwell > 0) {
      E.moves.push({ line: E.lines.length, cut: false, L: E.pos.L, C: E.pos.C, Z: E.pos.Z, R: E.pos.R, dt: p.dwell / 60, started: 0, visit: 0,
        groove: -1, done: 0, stroke: false, before: 0, after: 0 });
      E.raw('G4 P' + fmt(p.dwell, 1));
    }

    // Extra height needed while stepping from one pass to the next so the
    // ball clears whatever profile lies between them (the tooth tip, mostly).
    function stepLifts(centres) {
      return centres.map(function (c, i) {
        if (i === 0) return 0;
        var a = centres[i - 1], top = Math.max(a.z, c.z), peak = top;
        var n = Math.ceil(Math.abs(c.y - a.y) / 0.02);
        for (var j = 1; j < n; j++) peak = Math.max(peak, dropCutter(field, a.y + (c.y - a.y) * j / n, Rt));
        return peak - top > 2e-4 ? peak - top : 0;
      });
    }

    // offset: passes already made on this groove before this visit
    function cutGroove(index, centres, lifts, roughCount, offset) {
      if (!centres.length) return;
      var base = p.rotDir * index * 360 / p.teeth;
      E.started = Math.max(E.started, index + 1);
      E.visit++;
      E.groove = index; E.done = E.before = offset; E.after = offset + centres.length;
      var atStart = true, prev = null;
      E.rapid({ Z: zSafe });
      centres.forEach(function (c, i) {
        var m = machine(c, base);
        E.phase = i < roughCount ? 'rough' : 'finish';
        var restart = p.pattern === 'oneway' || i === 0;
        if (restart || c.tilted || centres[i - 1].tilted) {
          // Retract along the cutter, turn and shift the part in the clear, then come back down.
          if (i > 0) E.rapid({ Z: zApproach });
          if (restart) { E.rapid({ L: xs, C: m.C, R: m.R }); atStart = true; }
          else E.rapid({ C: m.C, R: m.R });
          E.rapid({ Z: c.tilted ? Math.min(zApproach, m.Z + c.back) : Math.max(zApproach, m.Z) });
          // a leaning cutter comes in along its own axis through space it has already cleared
          if (c.tilted && c.back > APPROACH) E.cut({ Z: m.Z + APPROACH }, p.feed);
          E.cut({ Z: m.Z }, p.plunge);
        } else if (m.Z >= prev.Z || lifts[i] > 0) {
          // stepping outward or over a tooth tip: lift first, then move across
          E.cut({ Z: Math.max(m.Z, prev.Z) + lifts[i] }, p.plunge);
          E.cut({ C: m.C, R: m.R }, p.plunge);
          E.cut({ Z: m.Z }, p.plunge);
        } else {
          E.cut({ C: m.C, R: m.R }, p.plunge);
          E.cut({ Z: m.Z }, p.plunge);
        }
        E.stroke = true;
        E.cut({ L: atStart ? xe : xs }, c.feed);
        E.stroke = false; E.done++;
        atStart = !atStart;
        prev = m;
      });
      E.rapid({ Z: zSafe });
    }

    var i, both = rough.concat(finish);
    var roughLifts = stepLifts(rough), finishLifts = stepLifts(finish), bothLifts = stepLifts(both);
    // One pass made on every groove in turn before moving to the next pass. The cutter keeps its
    // lean for the whole pass, so the rotary only steps from groove to groove; alternate passes
    // go round the other way, so it never has to wind back.
    var acrossAtStart = true;
    function cutAcross(k, c) {
      var forward = k % 2 === 0, oneway = p.pattern === 'oneway', clearZ = zApproach;
      E.phase = k < rough.length ? 'rough' : 'finish';
      for (var n = 0; n < p.teeth; n++) {
        var gi = forward ? n : p.teeth - 1 - n;
        var m = machine(c, p.rotDir * gi * 360 / p.teeth);
        // height at which the cutter is clear of the stock, so the part can turn under it
        clearZ = c.tilted ? Math.min(zApproach, m.Z + c.back) : zApproach;
        E.visit++; E.started = p.teeth;
        E.groove = gi; E.done = k; E.before = forward ? k : k + 1; E.after = forward ? k + 1 : k;
        if (n === 0) {
          E.rapid({ Z: k === 0 ? zSafe : zApproach });
          if (oneway || k === 0) { E.rapid({ L: xs, C: m.C, R: m.R }); acrossAtStart = true; }
          else E.rapid({ C: m.C, R: m.R });
        } else {
          E.rapid({ Z: clearZ });
          if (oneway) { E.rapid({ L: xs, R: m.R }); acrossAtStart = true; }
          else E.rapid({ R: m.R });
        }
        E.rapid({ Z: clearZ });
        if (c.tilted && c.back > APPROACH) E.cut({ Z: m.Z + APPROACH }, p.feed);
        E.cut({ Z: m.Z }, p.plunge);
        E.stroke = true;
        E.cut({ L: acrossAtStart ? xe : xs }, c.feed);
        E.stroke = false; E.done++;
        acrossAtStart = !acrossAtStart;
      }
      E.rapid({ Z: clearZ });
    }

    if (p.order === 'pass') {
      both.forEach(function (c, k) {
        E.comment('Pass ' + (k + 1) + ' of ' + both.length + (k < rough.length ? ', roughing' : ', finishing') + ', on every groove');
        cutAcross(k, c);
      });
    } else if (p.order === 'split') {
      if (rough.length) for (i = 0; i < p.teeth; i++) { E.comment('Rough groove ' + (i + 1) + ' of ' + p.teeth); cutGroove(i, rough, roughLifts, rough.length, 0); }
      for (i = 0; i < p.teeth; i++) { E.comment('Finish groove ' + (i + 1) + ' of ' + p.teeth); cutGroove(i, finish, finishLifts, 0, rough.length); }
    } else {
      for (i = 0; i < p.teeth; i++) { E.comment('Groove ' + (i + 1) + ' of ' + p.teeth); cutGroove(i, both, bothLifts, rough.length, 0); }
    }

    E.rapid({ Z: zSafe });
    if (p.coolant) E.raw('M9');
    E.raw('M5');
    if (p.returnA) E.rapid({ R: 0 });
    E.raw('M30');

    out.gcode = E.lines.join('\n') + '\n';

    // Playback data: cutter tip (Z measured from the rotary centreline) and rotary angle
    // at the end of each move, with start and end times in minutes.
    var clock = 0, last = { L: xs, C: 0, Z: zSafe, R: 0 };
    out.program = {
      start: { L: xs, C: 0, Z: zSafe - zOff, R: 0, P: 0 },
      turn: -p.topSense * p.rotDir,
      zOff: zOff,               // program Z minus playback Z, to show a live machine position
      moves: E.moves.map(function (m) {
        ['L', 'C', 'Z', 'R'].forEach(function (kk) { if (m[kk] === undefined) m[kk] = last[kk]; });
        last = m;
        var o = { line: m.line, cut: m.cut, L: m.L, C: m.C, Z: m.Z - zOff, R: m.R, t0: clock, t1: clock + m.dt, started: m.started, visit: m.visit,
          P: -p.topSense * m.R,     // how far the part has physically turned, right-handed about the rotary axis
          groove: m.groove, done: m.done, stroke: m.stroke, before: m.before, after: m.after };
        clock += m.dt;
        return o;
      })
    };
    out.program.total = clock;
    var time = E.time, total = p.dwell / 60;
    time.dwell = p.dwell / 60;
    ['rough', 'finish', 'step', 'rapid', 'index'].forEach(function (kk) { total += time[kk]; });
    out.stats = {
      lines: E.lines.length,
      minutes: total,
      time: time,
      dist: E.dist,
      cutLength: E.dist.rough + E.dist.finish,
      rotaryTravel: E.rotaryTravel,
      roughPasses: rough.length,
      finishPasses: finish.length,
      maxExcess: sim.maxExcess,
      maxGouge: sim.maxGouge,
      finishStock: roughSim.maxExcess,
      feedLow: feedLo, feedHigh: feedHi, toothLoad: p.feed / (p.rpm * p.flutes),
      materialLabel: mat.label, materialChip: mat.chip * p.toolDia, suggestedRpm: mat.speed * 1000 / (Math.PI * p.toolDia),
      slowShare: tipUse.slowShare, tipShare: tipUse.tipShare, meanCutRadius: tipUse.meanRadius, tipPasses: tipUse.passes,
      forcedPasses: rough.filter(function (c) { return c.forced; }).length,
      zOff: zOff, headDir: headDir, headRoom: headRoom, freeStart: freeStart,
      zSafe: zSafe, xs: xs, xe: xe
    };
    return out;
  }

  return {
    DEFAULTS: DEFAULTS, PROFILES: PROFILES, PROFILE_FIELDS: PROFILE_FIELDS, profileSettings: profileSettings, MATERIALS: MATERIALS,
    generate: generate, buildGeometry: buildGeometry,
    sampleGroove: sampleGroove, pitchOutline: pitchOutline, toolAxis: toolAxis, passProfiles: passProfiles, cutFloor: cutFloor,
    simulate: simulate, dropCutter: dropCutter
  };
})();

export default HTD;
