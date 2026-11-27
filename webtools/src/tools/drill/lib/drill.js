/*
 * Drilling patterns: holes in a grid, along a line or at listed positions, drilled with LinuxCNC canned
 * cycles (G81 / G82 / G83 / G73), rigid tapped (G33.1), or peck drilled deep with pecks that get
 * shorter as the hole deepens (written out as G0 / G1, as no canned cycle does that). The cycles, drill feeds and tap sizes are
 * PCD's (tools/pcd/lib/pcd.js); holes round a circle are the PCD page's job. No DOM access here.
 *
 * Program frame: hole positions in work coordinates, Z zero where "Top of part" says. Each canned
 * cycle line is one G-code line, but the preview needs the moves the control makes for it, so the
 * cycle is expanded into recorded moves that all point at that line.
 */
import PCD from '../../pcd/lib/pcd.js';
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import { PROGRAM_DEFAULTS, checkCommon, checkNumbers, startProgram, endProgram, SPINDLE_MAX } from '../../../shared/toolpath/cutting.js';
import { parseCentres } from '../../bore/lib/bore.js';

const DEFAULTS = {
  pattern: 'grid',        // 'grid' | 'line' | 'list'
  x0: 10, y0: 10,         // first hole (grid and line)
  cols: 4, rows: 3,       // grid
  dx: 20, dy: 15,         // grid spacing along the rows and between them
  count: 5, pitch: 20,    // line
  angle: 0,               // pattern turned anticlockwise about the first hole, degrees
  order: 'zigzag',        // grid: 'zigzag' (back and forth) | 'rows' (every row the same way)
  centres: '0,0; 20,0; 20,20',   // list
  skip: '',               // hole numbers left out, "2, 5-6"
  cycle: 'drill',         // key of CYCLES
  holeDia: 6.8,
  depth: 12,
  depthTo: 'full',        // 'full' (the tip goes further) | 'tip'
  pointAngle: 118,
  zTop: 0,
  thickness: 15,          // 0 = not given
  retract: 2,             // R plane above the top
  clearance: 10,
  retractMode: 'r',       // 'r' (G99) | 'clear' (G98)
  peck: 3,                // peck depth (Q); the first peck in 'deep'
  peckMin: 1,             // deep: the pecks get no shorter than this
  peckReduce: 20,         // deep: each peck this % shorter than the one before
  fullEvery: 3,           // deep: pull right out to the R plane every this many pecks (1 = every peck)
  holeDwell: 0.5,
  tapPitch: 1.25,
  toolDia: 6.8,
  material: 'aluminium',
  rpm: 1500,
  feedAuto: true,
  feed: 220,
  ...PROGRAM_DEFAULTS
};

const PATTERNS = { grid: 'Grid of holes', line: 'Row of holes', list: 'Listed holes' };

// PCD's cycles, named by how they treat the chips, plus deep-hole pecking that no canned cycle does.
const CYCLES = {
  drill: { ...PCD.CYCLES.drill, label: 'Straight through (G81)' },
  spot: { ...PCD.CYCLES.spot, label: 'Spot drilling (G81)' },
  dwell: { ...PCD.CYCLES.dwell, label: 'Dwell at the bottom (G82)' },
  chipbreak: { ...PCD.CYCLES.chipbreak, label: 'Peck, chip break (G73)' },
  peck: { ...PCD.CYCLES.peck, label: 'Peck, full retract (G83)' },
  deep: { label: 'Deep hole, shrinking pecks', code: 'G0/G1', title: 'Deep' },
  tap: { ...PCD.CYCLES.tap, label: 'Rigid tapping (G33.1)' }
};
const PECKING = ['peck', 'chipbreak', 'deep'];

/** Z of the bottom of each peck, from the R plane down (deep: shrinking from p.peck to p.peckMin). */
function peckDepths(p, zR, zBottom) {
  const out = [];
  let z = zR, d = p.peck;
  while (z > zBottom + 1e-9 && out.length < 1000) {
    z = Math.max(zBottom, z - d);
    out.push(z);
    if (p.cycle === 'deep') d = Math.max(p.peckMin, d * (1 - p.peckReduce / 100));
  }
  return out;
}
const BACKOFF = 0.254;    // LinuxCNC: G73 backs off this far; G83 comes back down to this far above the last depth
const RAD = Math.PI / 180;
const n2 = (v) => fmt(v, 2).replace(/\.?0+$/, '');

/** Every hole of the pattern in drilling order: { n (1-based), x, y, skip }; null when the list does not read. */
function holes(p) {
  const skip = PCD.parseSkip(p.skip) || [], c = Math.cos(p.angle * RAD), s = Math.sin(p.angle * RAD), out = [];
  const add = (u, v) => {
    const x = p.x0 + u * c - v * s, y = p.y0 + u * s + v * c;
    out.push({ n: out.length + 1, x: Math.abs(x) < 5e-6 ? 0 : x, y: Math.abs(y) < 5e-6 ? 0 : y });
  };
  if (p.pattern === 'list') {
    const list = parseCentres(p.centres);
    if (!list) return null;
    list.forEach((q) => out.push({ n: out.length + 1, x: q.x, y: q.y }));
  } else if (p.pattern === 'line') {
    for (let i = 0; i < p.count; i++) add(i * p.pitch, 0);
  } else {
    for (let j = 0; j < p.rows; j++) {
      for (let k = 0; k < p.cols; k++) {
        const i = p.order === 'zigzag' && j % 2 ? p.cols - 1 - k : k;
        add(i * p.dx, j * p.dy);
      }
    }
  }
  out.forEach((h) => { h.skip = skip.indexOf(h.n) >= 0; });
  return out;
}

function count(p) {
  return p.pattern === 'list' ? (parseCentres(p.centres) || []).length : p.pattern === 'line' ? p.count : p.cols * p.rows;
}

// Lower-case a cycle label but keep its G-code (G81, G33.1) in capitals.
const lowerLabel = (c) => c.label.toLowerCase().replace(/\bg(\d)/g, 'G$1');

function title(p) {
  const c = CYCLES[p.cycle] || CYCLES.drill;
  return (p.pattern === 'grid' ? p.cols + ' × ' + p.rows + ' grid' : count(p) + ' holes') + ', ' + lowerLabel(c);
}

function fileName(p) {
  const n = (v) => String(Math.round(v * 1000) / 1000);
  return 'holes-' + (p.pattern === 'grid' ? p.cols + 'x' + p.rows : count(p)) + 'x' + n(p.holeDia) + '-' + p.cycle + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!PATTERNS[p.pattern]) e.push('Unknown pattern.');
  if (!CYCLES[p.cycle]) e.push('Unknown cycle.');
  if (p.pattern !== 'list') { c.num('x0', 'First hole X'); c.num('y0', 'First hole Y'); c.num('angle', 'Angle'); }
  if (p.pattern === 'grid') { c.int('cols', 'Holes per row', 1, 100); c.int('rows', 'Rows', 1, 100); c.pos('dx', 'Spacing along the rows'); c.pos('dy', 'Row spacing'); }
  if (p.pattern === 'line') { c.int('count', 'Number of holes', 1, 500); c.pos('pitch', 'Spacing'); }
  if (p.pattern === 'list' && !parseCentres(p.centres)) e.push('Hole positions must be pairs of numbers, x,y, separated by semicolons, for example 0,0; 20,0.');
  if (PCD.parseSkip(p.skip) === null) e.push('Holes to skip: give hole numbers or ranges, like "2, 5-6".');
  c.pos('holeDia', 'Hole diameter'); c.pos('depth', 'Hole depth');
  if (!(p.pointAngle >= 60 && p.pointAngle <= 180)) e.push('Point angle must be between 60° and 180°.');
  c.num('zTop', 'Top of part'); c.nonNeg('thickness', 'Part thickness');
  c.pos('retract', 'R plane height'); c.nonNeg('clearance', 'Clearance');
  if (PECKING.indexOf(p.cycle) >= 0) c.pos('peck', p.cycle === 'deep' ? 'First peck' : 'Peck depth');
  if (p.cycle === 'deep') {
    c.pos('peckMin', 'Smallest peck');
    if (!(p.peckReduce >= 0 && p.peckReduce <= 90)) e.push('Each peck can be from 0% to 90% shorter than the one before.');
    c.int('fullEvery', 'Full retract every', 1, 50);
    if (p.peckMin > p.peck) e.push('The smallest peck cannot be more than the first.');
  }
  if (p.cycle === 'dwell') c.pos('holeDwell', 'Dwell at the bottom');
  if (p.cycle === 'tap') c.pos('tapPitch', 'Thread pitch');
  c.pos('toolDia', 'Tool diameter'); c.pos('rpm', 'Spindle speed');
  if (p.cycle !== 'tap') c.pos('feed', 'Feed');
  checkCommon(p, e, false);
  if (!e.length && p.clearance < p.retract) e.push('The clearance height must be at least the R plane height.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  const w = out.warnings, mat = PCD.MATERIALS[p.material] || PCD.MATERIALS.aluminium, cyc = CYCLES[p.cycle] || CYCLES.drill;
  const tap = p.cycle === 'tap', spot = p.cycle === 'spot', deep = p.cycle === 'deep', pecking = PECKING.indexOf(p.cycle) >= 0;
  const revFor = () => Math.min(0.5, Math.max(0.02, mat.rev * p.toolDia * (spot ? 0.5 : 1)));
  if (p.feedAuto && p.toolDia > 0 && p.rpm > 0) {
    p.feed = Math.max(5, Math.round(revFor() * p.rpm / 5) * 5);
    out.auto = { feed: p.feed };
  }
  if (out.errors.length) return out;

  const all = holes(p), list = all.filter((h) => !h.skip);
  if (!list.length) { out.errors.push('Every hole is skipped: nothing to drill.'); return out; }
  // holes closer than their size run into each other
  let closest = Infinity;
  for (let i = 0; i < all.length; i++) for (let k = i + 1; k < all.length; k++) closest = Math.min(closest, Math.hypot(all[i].x - all[k].x, all[i].y - all[k].y));
  if (all.length > 1 && closest < p.holeDia - 1e-9) { out.errors.push('Holes overlap: two are ' + n2(closest) + ' mm apart but ' + n2(p.holeDia) + ' mm across.'); return out; }

  // ---- Z levels (as PCD)
  const tipLen = tap ? 0 : PCD.tipLength(p.toolDia, p.pointAngle);
  const zBottom = tap || spot || p.depthTo === 'tip' ? p.zTop - p.depth : p.zTop - p.depth - tipLen;
  const fullDepth = tap ? p.depth : spot || p.depthTo === 'tip' ? Math.max(0, p.depth - tipLen) : p.depth;
  const zR = p.zTop + p.retract, zClear = p.zTop + p.clearance;
  const spotDia = spot ? Math.min(p.toolDia, 2 * p.depth * Math.tan(p.pointAngle / 2 * RAD)) : 0;
  const tapFeed = tap ? p.rpm * p.tapPitch : 0;
  const peckLevels = pecking ? peckDepths(p, zR, zBottom) : [];
  const sugRpm = mat.speed * 1000 / (Math.PI * p.toolDia) * (tap ? 0.3 : 1);

  // ---- warnings (as PCD)
  const wall = closest - p.holeDia;
  if (all.length > 1 && wall < Math.max(1, 0.2 * p.holeDia)) w.push('Only ' + n2(wall) + ' mm of metal is left between the closest holes.');
  if (!spot && !tap && Math.abs(p.toolDia - p.holeDia) > 0.005) w.push('The drill (' + n2(p.toolDia) + ' mm) is not the hole size (' + n2(p.holeDia) + ' mm). A drill cuts its own size.');
  if (spot && spotDia < p.holeDia) w.push('The spot mark (' + n2(spotDia) + ' mm across) is smaller than the hole (' + n2(p.holeDia) + ' mm): spot a little bigger so the drill starts in it.');
  if (tap && p.toolDia <= p.holeDia) w.push('The tap (' + n2(p.toolDia) + ' mm) is not bigger than the hole (' + n2(p.holeDia) + ' mm): it will not cut a thread.');
  if ((p.cycle === 'drill' || p.cycle === 'dwell') && fullDepth > 4 * p.toolDia) w.push('The holes are ' + fmt(fullDepth / p.toolDia, 1) + ' diameters deep. Above about 4, peck drilling (G83) clears the chips.');
  if (pecking && p.peck > p.toolDia) w.push('Pecks deeper than the drill diameter pack the flutes; about half the diameter is usual.');
  if (p.cycle === 'chipbreak' && fullDepth > 5 * p.toolDia) w.push('G73 never pulls the drill out, so chips can pack in a hole ' + fmt(fullDepth / p.toolDia, 1) + ' diameters deep: peck with full retract (G83) or deep-hole pecking clears them.');
  if (deep && p.peckMin < 0.1 * p.toolDia) w.push('Pecks under a tenth of the drill diameter take a long time and rub more than they cut.');
  if (p.thickness > 0 && zBottom < p.zTop - p.thickness - 1e-6) w.push('The tip goes ' + n2(p.zTop - p.thickness - zBottom) + ' mm below the part: make sure there is clearance or a spoil board under it.');
  if (!tap && p.rpm > sugRpm * 1.6) w.push('The spindle speed is high for a ' + fmt(p.toolDia, 1) + ' mm drill in ' + mat.label.toLowerCase() + ': about ' + Math.round(Math.min(sugRpm, SPINDLE_MAX) / 50) * 50 + ' rpm is usual.');
  if (p.rpm > SPINDLE_MAX) w.push('The spindle tops out at ' + SPINDLE_MAX + ' rpm.');
  if (tap) w.push('Rigid tapping (G33.1) needs a spindle encoder set up in LinuxCNC, and the spindle reverses at the bottom. Feed override does not apply.');

  // ---- program
  const b = createProgram(p);
  const c0 = list[0];
  startProgram(b, p, {
    comments: [
      title(p),
      PATTERNS[p.pattern] + ': ' + (p.pattern === 'grid' ? p.cols + ' x ' + p.rows + ', ' + n2(p.dx) + ' x ' + n2(p.dy) + ' apart' : p.pattern === 'line' ? p.count + ', ' + n2(p.pitch) + ' apart' : all.length + ' positions') +
        (p.pattern !== 'list' ? ', first at X' + fmt(p.x0, 3) + ' Y' + fmt(p.y0, 3) + (p.angle ? ', turned ' + n2(p.angle) + ' deg' : '') : '') +
        (list.length < all.length ? ', skipping ' + all.filter((h) => h.skip).map((h) => h.n).join(' ') : ''),
      'Hole ' + fmt(p.holeDia, 3) + ' dia, ' + (tap ? fmt(p.depth, 2) + ' mm of thread, pitch ' + fmt(p.tapPitch, 3)
        : spot ? 'spot ' + fmt(p.depth, 2) + ' deep, ' + fmt(spotDia, 2) + ' across' : fmt(fullDepth, 2) + ' mm deep at full dia, tip to Z' + fmt(zBottom, 3)),
      'Tool: ' + fmt(p.toolDia, 2) + ' mm ' + (tap ? 'tap' : spot ? 'spot drill' : 'drill') + ', ' + fmt(p.rpm, 0) + ' rpm' + (tap ? ', ' + fmt(tapFeed, 0) + ' mm/min synchronised' : ', F' + fmt(p.feed, 0) + ' = ' + fmt(p.feed / p.rpm, 3) + ' mm/rev'),
      'Cycle: ' + lowerLabel(cyc) + (deep ? ', pecks ' + fmt(p.peck, 2) + ' down to ' + fmt(p.peckMin, 2) + ', ' + peckLevels.length + ' per hole, full retract every ' + p.fullEvery : '') +
        ', R plane Z' + fmt(zR, 3) + ', clearance Z' + fmt(zClear, 3),
      'SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', tool tip as the length reference'
    ],
    x: c0.x, y: c0.y, zSafe: zClear
  });
  const retZ = p.retractMode === 'clear' ? zClear : zR;
  list.forEach((h, i) => {
    b.feat = i;
    b.comment('Hole ' + h.n + ' at X' + fmt(h.x, 3) + ' Y' + fmt(h.y, 3));
    if (tap) {
      b.phase = 'move';
      b.rapid({ X: h.x, Y: h.y });
      b.rapid({ Z: zR });
      b.phase = 'cut'; b.sim({ Z: zBottom }, tapFeed, true);
      b.phase = 'out'; b.sim({ Z: zR }, tapFeed, true);
      b.raw('G33.1 Z' + fmt(zBottom, 4) + ' K' + fmt(p.tapPitch, 4));
      b.forget();
      b.done = i + 1;
      if (p.retractMode === 'clear' || i === list.length - 1) { b.phase = 'move'; b.rapid({ Z: zClear }); }
      return;
    }
    if (deep) {
      // written out: full retract to R every fullEvery pecks, a chip-break back-off between them
      b.phase = 'move';
      b.rapid({ X: h.x, Y: h.y });
      b.rapid({ Z: zR });
      peckLevels.forEach((z, k) => {
        if (k > 0 && b.pos().Z > peckLevels[k - 1] + BACKOFF + 1e-6) { b.phase = 'move'; b.rapid({ Z: peckLevels[k - 1] + BACKOFF }); }
        b.phase = 'cut';
        b.line({ Z: z }, p.feed);
        if (k === peckLevels.length - 1) return;
        b.phase = 'move';
        b.rapid({ Z: (k + 1) % p.fullEvery === 0 ? zR : z + BACKOFF });
      });
      b.phase = 'move';
      b.rapid({ Z: retZ });
      b.done = i + 1;
      return;
    }
    // what the control does for the cycle line: XY at the current level, down to R, then the cycle
    b.phase = 'move';
    b.sim({ X: h.x, Y: h.y });
    b.sim({ Z: zR });
    b.phase = 'cut';
    if (pecking) {
      let z = zR;
      while (z > zBottom + 1e-9) {
        const next = Math.max(zBottom, z - p.peck);
        if (z < zR) b.sim({ Z: p.cycle === 'peck' ? z + BACKOFF : b.pos().Z });
        b.sim({ Z: next }, p.feed);
        z = next;
        if (z > zBottom + 1e-9) b.sim({ Z: p.cycle === 'peck' ? zR : z + BACKOFF });
      }
    } else {
      b.sim({ Z: zBottom }, p.feed);
      if (p.cycle === 'dwell') b.pause(p.holeDwell, 'pause');
    }
    b.sim({ Z: retZ });
    let line = 'X' + fmt(h.x, 4) + ' Y' + fmt(h.y, 4);
    if (i === 0) {
      line = (p.retractMode === 'clear' ? 'G98 ' : 'G99 ') + cyc.code + ' ' + line + ' Z' + fmt(zBottom, 4) + ' R' + fmt(zR, 4) +
        (pecking ? ' Q' + fmt(p.peck, 4) : '') + (p.cycle === 'dwell' ? ' P' + fmt(p.holeDwell, 2) : '') + ' F' + fmt(p.feed, 0);
    }
    b.raw(line);
    b.done = i + 1;
  });
  if (!tap && !deep) { b.raw('G80'); b.forget(); }
  endProgram(b, p, zClear);
  const res = b.finish();
  out.gcode = res.gcode;
  out.program = res.program;
  out.stats = { ...res.stats, holes: list.length, holeDepth: p.zTop - zBottom, tapFeed, per: { word: 'hole', count: list.length } };
  out.geom = { all, list, closest, wall, tipLen, zBottom, fullDepth, zR, zClear, spotDia, peckLevels, tap, spot, sugRpm, materialLabel: mat.label, materialRev: revFor() };

  // ---- drawings
  const hr = p.holeDia / 2, m = hr + Math.max(8, p.holeDia * 1.5);
  const xs = all.map((q) => q.x), ys = all.map((q) => q.y);
  const thick = p.thickness > 0 ? p.thickness : Math.max(fullDepth + 5, 10);
  const circle = (q, r) => { const pts = []; for (let k = 0; k <= 48; k++) { const a = k / 48 * 2 * Math.PI; pts.push([q.x + r * Math.cos(a), q.y + r * Math.sin(a)]); } return pts; };
  let feat = 0;
  const outlines = all.map((q) => (q.skip ? { pts: circle(q, hr), role: 'guide' } : { pts: circle(q, hr), role: 'cut', z1: p.zTop - fullDepth, feat: feat++, sel: 'dia' }));
  const cuts = [];
  list.forEach((q, i) => { if (Math.abs(q.y - c0.y) < hr) cuts.push({ u0: q.x - hr, u1: q.x + hr, z: zBottom, feat: i }); });
  const second = list[1];
  out.scene = {
    stock: { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines,
    dims: [
      { sel: 'dia', a: [c0.x - hr, c0.y - hr - 3], b: [c0.x + hr, c0.y - hr - 3], text: 'Ø' + n2(p.holeDia) },
      ...(second ? [{ sel: 'spacing', a: [c0.x, c0.y], b: [second.x, second.y], text: n2(Math.hypot(second.x - c0.x, second.y - c0.y)) + ' mm' }] : [])
    ],
    labels: [{ text: title(p), sel: 'holes' }, { text: list.length + ' × Ø' + n2(p.holeDia) + (list.length < all.length ? ' (' + (all.length - list.length) + ' skipped)' : '') }],
    note: cyc.code,
    section: {
      axis: 'X', at: c0.y, title: 'Section through hole ' + c0.n + ', along X',
      cuts,
      levels: [
        { z: zClear, text: 'Clear Z' + fmt(zClear, 2), role: 'clear' },
        { z: zR, text: 'R Z' + fmt(zR, 2), role: 'retract' },
        ...peckLevels.slice(0, -1).map((z) => ({ z, role: 'level', sel: 'cycle' })),
        { z: zBottom, text: 'Z' + fmt(zBottom, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [{ sel: 'depth', u: c0.x - hr - 3, z0: p.zTop, z1: zBottom, text: n2(p.zTop - zBottom) + ' mm' }]
    },
    tool: { dia: p.toolDia, kind: tap ? 'tap' : 'drill', tipLen, pitch: p.tapPitch },
    rest: { X: c0.x, Y: c0.y, Z: zR }
  };
  return out;
}

const DRILL = { DEFAULTS, PATTERNS, CYCLES, holes, title, fileName, generate };
export default DRILL;
