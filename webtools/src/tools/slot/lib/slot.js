/*
 * Slot: a straight slot with round ends between two centre points, at any angle, cut level by level.
 * A slot the cutter's width is cut by ramping back and forth along it; a wider one is cleared like a
 * pocket (shared/toolpath/pocket.js) and finished round the wall. No DOM access here.
 *
 * Program frame: the end centres in work coordinates, Z zero where "Top of part" says.
 */
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import {
  TOOL_DEFAULTS, PROGRAM_DEFAULTS, autoFeeds, checkCommon, checkNumbers, spindleWarnings, depthLevels,
  toolComment, startProgram, endProgram
} from '../../../shared/toolpath/cutting.js';
import { planPocket, cutPocket } from '../../../shared/toolpath/pocket.js';

const DEFAULTS = {
  ends: 'points',         // 'points' (start and end centres) | 'length' (start, length and angle)
  x1: 0, y1: 0,           // centre of the first end
  x2: 40, y2: 0,          // centre of the other end
  length: 40,             // between the end centres
  angle: 0,               // direction from the first end, degrees anticlockwise from +X
  width: 8,
  depth: 5,
  zTop: 0,
  thickness: 0,           // 0 = not given
  stepdown: 1,
  stepover: 40,
  allowance: 0.1,
  finish: true,
  entry: 'ramp',          // 'ramp' | 'helix' | 'plunge'
  rampAngle: 3,
  milling: 'climb',
  retract: 2,
  clearance: 5,
  ...TOOL_DEFAULTS,
  ...PROGRAM_DEFAULTS
};

const ENDS = { points: 'Slot between two points', length: 'Slot by length and angle' };
const RAD = Math.PI / 180;
const n2 = (v) => fmt(v, 2).replace(/\.?0+$/, '');

/** The two end centres. */
function endsOf(p) {
  if (p.ends === 'length') return [[p.x1, p.y1], [p.x1 + p.length * Math.cos(p.angle * RAD), p.y1 + p.length * Math.sin(p.angle * RAD)]];
  return [[p.x1, p.y1], [p.x2, p.y2]];
}

function title(p) {
  const [a, b] = endsOf(p), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return 'Slot ' + n2(p.width) + ' wide, ' + n2(L) + ' between centres, ' + n2(p.depth) + ' deep';
}

function fileName(p) {
  const [a, b] = endsOf(p), r = (v) => String(Math.round(v * 100) / 100);
  return 'slot' + r(p.width) + 'x' + r(Math.hypot(b[0] - a[0], b[1] - a[1])) + '-' + r(p.depth) + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!ENDS[p.ends]) e.push('Unknown way of giving the slot.');
  c.num('x1', 'First end X'); c.num('y1', 'First end Y');
  if (p.ends === 'length') { c.nonNeg('length', 'Length'); c.num('angle', 'Angle'); } else { c.num('x2', 'Second end X'); c.num('y2', 'Second end Y'); }
  c.pos('width', 'Width'); c.pos('depth', 'Depth'); c.num('zTop', 'Top of part'); c.nonNeg('thickness', 'Part thickness');
  c.pos('stepdown', 'Depth per level');
  if (!(p.stepover >= 5 && p.stepover <= 70)) e.push('Stepover must be from 5% to 70% of the cutter diameter.');
  c.nonNeg('allowance', 'Finish allowance');
  if (!(p.rampAngle > 0 && p.rampAngle <= 30)) e.push('Ramp angle must be more than 0° and at most 30°.');
  c.pos('retract', 'Start height'); c.nonNeg('clearance', 'Clearance');
  checkCommon(p, e);
  if (!e.length && p.clearance < p.retract) e.push('The clearance must be at least the start height.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  autoFeeds(p, out);
  if (out.errors.length) return out;
  const w = out.warnings, rt = p.toolDia / 2;
  if (p.width < p.toolDia - 1e-9) { out.errors.push('The cutter (' + n2(p.toolDia) + ' mm) is wider than the slot (' + n2(p.width) + ' mm).'); return out; }
  const [a, e2] = endsOf(p);
  const L = Math.hypot(e2[0] - a[0], e2[1] - a[1]);
  const rot = L > 1e-9 ? Math.atan2(e2[1] - a[1], e2[0] - a[0]) : 0;
  const cx = (a[0] + e2[0]) / 2, cy = (a[1] + e2[1]) / 2;
  const region = { cx, cy, w: L + p.width, h: p.width, r: p.width / 2, rot };
  const exact = p.width - p.toolDia < 0.01;
  const plan = planPocket(region, { rt, allow: exact || !p.finish ? 0 : p.allowance, step: p.toolDia * p.stepover / 100, entry: p.entry, climb: p.milling !== 'conventional', finish: p.finish });
  const zBottom = p.zTop - p.depth;
  const levels = depthLevels(p.zTop, zBottom, p.stepdown);
  const zSafe = p.zTop + p.clearance, zApproach = p.zTop + p.retract;

  // ---- warnings
  if (exact) w.push('The slot is the cutter\'s width: every level is a full-width cut, and the width comes out as the cutter cuts. A slightly smaller cutter and a finish pass give a truer slot.');
  if (plan.entry !== plan.wanted) w.push('There is no room to ' + plan.wanted + ' in, so the cutter ' + (plan.entry === 'plunge' ? 'plunges straight down: it must cut at its centre' : plan.entry === 'ramp' ? 'ramps along the slot instead' : 'helixes in instead') + '.');
  if (p.stepdown > (exact ? 0.5 : 1) * p.toolDia) w.push('Depth per level is ' + n2(p.stepdown / p.toolDia) + ' × the cutter diameter: ' + (exact ? 'full-width slotting is easiest at half the diameter or less.' : 'heavy for a small mill.'));
  if (p.thickness > 0 && p.depth > p.thickness + 1e-9) w.push('The slot goes ' + n2(p.depth - p.thickness) + ' mm through the bottom of the part: support it on a spoil board.');
  spindleWarnings(p, w);

  const b = createProgram(p);
  startProgram(b, p, {
    comments: [
      title(p),
      'Ends X' + fmt(a[0], 3) + ' Y' + fmt(a[1], 3) + ' and X' + fmt(e2[0], 3) + ' Y' + fmt(e2[1], 3) + ', ' + n2(rot / RAD) + ' deg, bottom Z' + fmt(zBottom, 3),
      levels.length + ' level' + (levels.length > 1 ? 's' : '') + ' of ' + fmt(p.depth / levels.length, 3) + ' mm, in by ' + plan.entry + (plan.offsets.length ? ', ' + plan.offsets.length + ' loop' + (plan.offsets.length > 1 ? 's' : '') + ' per level' : '') +
        (plan.finishable ? ', finish pass round the wall' : ''),
      toolComment(p),
      'SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', X0 Y0 at the work zero for the end centres above'
    ],
    x: cx, y: cy, zSafe
  });
  b.feat = 0;
  cutPocket(b, plan, { rt, levels, zTop: p.zTop, zApproach, rampAngle: p.rampAngle, feed: p.feed, plungeFeed: p.plungeFeed, lift: 0.5 });
  b.done = 1;
  endProgram(b, p, zSafe);
  const res = b.finish();
  out.gcode = res.gcode;
  out.program = res.program;
  out.stats = { ...res.stats, levels: levels.length, length: L, loops: plan.offsets.length, volume: (L * p.width + Math.PI * p.width * p.width / 4) * p.depth / 1000, per: { word: 'level', count: levels.length } };
  out.geom = { plan, levels, zBottom, L, rot, ends: [a, e2], exact };

  // ---- drawings
  const outline = plan.outline();
  const xs = outline.map((q) => q[0]), ys = outline.map((q) => q[1]), m = Math.max(8, p.width);
  const thick = p.thickness > 0 ? p.thickness : p.depth + Math.max(5, p.depth * 0.5);
  // the section runs across the slot: along Y for a slot nearer X, along X otherwise
  const acrossY = Math.abs(Math.cos(rot)) >= Math.abs(Math.sin(rot));
  const halfAcross = (p.width / 2) / Math.max(Math.abs(acrossY ? Math.cos(rot) : Math.sin(rot)), 1e-6);
  const cMid = acrossY ? cy : cx;
  const nx = -Math.sin(rot), ny = Math.cos(rot), hw = p.width / 2;
  out.scene = {
    stock: { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines: [
      { pts: outline, role: 'cut', z1: zBottom, feat: 0, sel: 'width' },
      { pts: [a, e2], role: 'guide', sel: 'length' }
    ],
    dims: [
      { sel: 'width', a: [cx - nx * hw, cy - ny * hw], b: [cx + nx * hw, cy + ny * hw], text: n2(p.width) + ' mm' },
      { sel: 'length', a: a, b: e2, text: n2(L) + ' mm' }
    ],
    labels: [{ text: title(p), sel: 'width' }, { text: levels.length + ' levels, in by ' + plan.entry }],
    note: 'Ø' + n2(p.toolDia) + ' cutter',
    section: {
      axis: acrossY ? 'Y' : 'X', at: acrossY ? cx : cy, title: 'Section across the middle of the slot',
      cuts: [{ u0: cMid - halfAcross, u1: cMid + halfAcross, z: zBottom, feat: 0 }],
      levels: [
        { z: zSafe, text: 'Clear Z' + fmt(zSafe, 2), role: 'clear' },
        { z: zApproach, text: 'Start Z' + fmt(zApproach, 2), role: 'retract' },
        ...levels.slice(0, -1).map((z) => ({ z, role: 'level', sel: 'levels' })),
        { z: zBottom, text: 'Bottom Z' + fmt(zBottom, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [
        { sel: 'depth', u: cMid - halfAcross - 3, z0: p.zTop, z1: zBottom, text: n2(p.depth) + ' mm' },
        { sel: 'width', z: p.zTop + 1.5, u0: cMid - halfAcross, u1: cMid + halfAcross, text: n2(2 * halfAcross) + ' mm' }
      ]
    },
    tool: { dia: p.toolDia, kind: 'mill' },
    rest: { X: cx, Y: cy, Z: zApproach }
  };
  return out;
}

const SLOT = { DEFAULTS, ENDS, title, fileName, generate };
export default SLOT;
