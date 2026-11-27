/*
 * Pocket: clears a rectangular (optionally rounded and turned) or round pocket to depth, in levels, from
 * the middle out, then finishes the wall at full depth. The clearing itself is shared with Slot
 * (shared/toolpath/pocket.js). No DOM access here, so it also loads in Node.
 *
 * Program frame: the pocket centre is (cx, cy) in work coordinates, Z zero where "Top of part" says.
 */
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import {
  TOOL_DEFAULTS, PROGRAM_DEFAULTS, autoFeeds, checkCommon, checkNumbers, spindleWarnings, depthLevels,
  toolComment, startProgram, endProgram
} from '../../../shared/toolpath/cutting.js';
import { planPocket, cutPocket } from '../../../shared/toolpath/pocket.js';

const DEFAULTS = {
  shape: 'rect',          // 'rect' | 'circle'
  cx: 0, cy: 0,           // pocket centre
  width: 40,              // along X (before turning)
  length: 25,             // along Y
  cornerR: 4,             // inside corner radius
  angle: 0,               // turned anticlockwise, degrees
  dia: 30,                // round pocket
  depth: 6,
  zTop: 0,
  thickness: 0,           // part thickness, 0 = not given (for the drawing and the through check)
  stepdown: 2,
  stepover: 40,           // % of the cutter diameter
  allowance: 0.2,         // left on the wall for the finish pass
  finish: true,
  entry: 'helix',         // 'helix' | 'ramp' | 'plunge'
  rampAngle: 3,           // degrees, for helix and ramp
  milling: 'climb',       // 'climb' | 'conventional'
  retract: 2,             // where the entry starts above the top
  clearance: 5,
  ...TOOL_DEFAULTS,
  ...PROGRAM_DEFAULTS
};

const SHAPES = { rect: 'Rectangular pocket', circle: 'Round pocket' };
const RAD = Math.PI / 180;

function title(p) {
  const n = (v) => fmt(v, 2).replace(/\.?0+$/, '');
  return (SHAPES[p.shape] || SHAPES.rect) + ' ' + (p.shape === 'circle' ? 'Ø' + n(p.dia) : n(p.width) + ' × ' + n(p.length)) + ', ' + n(p.depth) + ' deep';
}

function fileName(p) {
  const n = (v) => String(Math.round(v * 100) / 100);
  return 'pocket' + (p.shape === 'circle' ? 'D' + n(p.dia) : n(p.width) + 'x' + n(p.length)) + '-' + n(p.depth) + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!SHAPES[p.shape]) e.push('Unknown pocket shape.');
  c.num('cx', 'Centre X'); c.num('cy', 'Centre Y'); c.num('zTop', 'Top of part');
  if (p.shape === 'circle') c.pos('dia', 'Pocket diameter');
  else { c.pos('width', 'Width'); c.pos('length', 'Length'); c.nonNeg('cornerR', 'Corner radius'); c.num('angle', 'Angle'); }
  c.pos('depth', 'Depth'); c.nonNeg('thickness', 'Part thickness'); c.pos('stepdown', 'Depth per level');
  if (!(p.stepover >= 5 && p.stepover <= 70)) e.push('Stepover must be from 5% to 70% of the cutter diameter: more leaves stock in the corners between loops.');
  c.nonNeg('allowance', 'Finish allowance');
  if (!(p.rampAngle > 0 && p.rampAngle <= 30)) e.push('Ramp angle must be more than 0° and at most 30°.');
  c.pos('retract', 'Start height'); c.nonNeg('clearance', 'Clearance');
  checkCommon(p, e);
  if (!e.length && p.shape !== 'circle' && p.cornerR > Math.min(p.width, p.length) / 2 + 1e-9) e.push('The corner radius cannot be more than half the width or length.');
  if (!e.length && p.clearance < p.retract) e.push('The clearance must be at least the start height.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  autoFeeds(p, out);
  if (out.errors.length) return out;
  const w = out.warnings, rt = p.toolDia / 2;
  const round = p.shape === 'circle';
  const W = round ? p.dia : p.width, H = round ? p.dia : p.length, R = round ? p.dia / 2 : p.cornerR;
  if (Math.min(W, H) < p.toolDia - 1e-9) { out.errors.push('The cutter (' + fmt(p.toolDia, 2) + ' mm) is bigger than the pocket is ' + (round ? 'across' : 'narrow') + ' (' + fmt(Math.min(W, H), 2) + ' mm).'); return out; }
  const region = { cx: p.cx, cy: p.cy, w: W, h: H, r: R, rot: round ? 0 : p.angle * RAD };
  const step = p.toolDia * p.stepover / 100;
  const plan = planPocket(region, { rt, allow: p.finish ? p.allowance : 0, step, entry: p.entry, climb: p.milling !== 'conventional', finish: p.finish });
  const zBottom = p.zTop - p.depth;
  const levels = depthLevels(p.zTop, zBottom, p.stepdown);
  const zSafe = p.zTop + p.clearance, zApproach = p.zTop + p.retract;

  // ---- warnings
  if (!round && R < rt - 1e-9) {
    w.push(R > 0 ? 'The corners come out with the cutter\'s radius (' + fmt(rt, 2) + ' mm), not ' + fmt(R, 2) + ' mm: use a cutter no bigger than ' + fmt(2 * R, 2) + ' mm across for these corners.'
      : 'An end mill cannot cut sharp inside corners: they come out with the cutter\'s radius, ' + fmt(rt, 2) + ' mm.');
  }
  if (plan.entry !== plan.wanted) w.push('There is no room to ' + (plan.wanted === 'helix' ? 'helix' : 'ramp') + ' in, so the cutter ' + (plan.entry === 'plunge' ? 'plunges straight down: it must cut at its centre' : 'ramps along the middle instead') + '.');
  if (plan.entry === 'plunge' && plan.wanted === 'plunge') w.push('Plunging straight down needs a centre-cutting end mill (one with a tooth across the middle of its end).');
  if (p.stepdown > p.toolDia) w.push('Depth per level is more than the cutter diameter: heavy for full-width cuts on a small mill.');
  if (p.finish && p.allowance === 0) w.push('With no allowance the finish pass only goes round the wall again (a spring pass).');
  if (p.thickness > 0 && p.depth > p.thickness + 1e-9) w.push('The pocket goes ' + fmt(p.depth - p.thickness, 2) + ' mm through the bottom of the part: support it on a spoil board.');
  if (p.depth > 4 * p.toolDia) w.push('The pocket is ' + fmt(p.depth / p.toolDia, 1) + ' cutter diameters deep: the flutes must be that long, and the finish pass takes the whole wall at once.');
  spindleWarnings(p, w);

  const b = createProgram(p);
  const centre = plan.toWorld(0, 0);
  startProgram(b, p, {
    comments: [
      title(p),
      'Centre X' + fmt(p.cx, 3) + ' Y' + fmt(p.cy, 3) + (round ? '' : ', corners R' + fmt(R, 2) + (p.angle ? ', turned ' + fmt(p.angle, 2) + ' deg' : '')) + ', bottom Z' + fmt(zBottom, 3),
      levels.length + ' level' + (levels.length > 1 ? 's' : '') + ' of ' + fmt(p.depth / levels.length, 3) + ' mm, ' + plan.offsets.length + ' loop' + (plan.offsets.length === 1 ? '' : 's') + ' per level, stepover ' + fmt(step, 2) +
        ', in by ' + plan.entry + (p.finish ? ', ' + fmt(p.allowance, 2) + ' mm left for the finish pass' : '') + ', ' + (p.milling === 'conventional' ? 'conventional' : 'climb') + ' milling',
      toolComment(p),
      'SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', X0 Y0 so the pocket centre is at X' + fmt(p.cx, 3) + ' Y' + fmt(p.cy, 3)
    ],
    x: centre[0], y: centre[1], zSafe
  });
  b.feat = 0;
  cutPocket(b, plan, { rt, levels, zTop: p.zTop, zApproach, rampAngle: p.rampAngle, feed: p.feed, plungeFeed: p.plungeFeed, lift: 0.5 });
  b.done = 1;
  endProgram(b, p, zSafe);
  const fin = b.finish();
  out.gcode = fin.gcode;
  out.program = fin.program;

  const area = round ? Math.PI * R * R : W * H - (4 - Math.PI) * R * R;
  out.stats = { ...fin.stats, levels: levels.length, loops: plan.offsets.length, step, volume: area * p.depth / 1000, area, per: { word: 'level', count: levels.length } };
  out.geom = { plan, levels, zBottom, entry: plan.entry };

  // ---- drawings
  const outline = plan.outline();
  const ext = Math.max(W, H) / 2 + Math.max(8, 0.25 * Math.max(W, H));
  const thick = p.thickness > 0 ? p.thickness : p.depth + Math.max(5, p.depth * 0.5);
  // the section runs along the pocket's X through its centre
  const halfX = (() => {
    let m = 0;
    outline.forEach((q) => { if (Math.abs(q[1] - p.cy) < 1e-6 + 0.02 * H) m = Math.max(m, Math.abs(q[0] - p.cx)); });
    return m || W / 2;
  })();
  const cAng = round ? 0 : p.angle * RAD, half = (v) => v / 2;
  const dimAt = (x, y) => [p.cx + x * Math.cos(cAng) - y * Math.sin(cAng), p.cy + x * Math.sin(cAng) + y * Math.cos(cAng)];
  out.scene = {
    stock: { x0: p.cx - ext, x1: p.cx + ext, y0: p.cy - ext, y1: p.cy + ext, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines: [
      { pts: outline, role: 'cut', z1: zBottom, feat: 0, sel: 'size' },
      { pts: [[p.cx - ext * 0.95, p.cy], [p.cx + ext * 0.95, p.cy]], role: 'guide' },
      { pts: [[p.cx, p.cy - ext * 0.95], [p.cx, p.cy + ext * 0.95]], role: 'guide' }
    ],
    dims: round
      ? [{ sel: 'size', a: [p.cx - R * 0.707, p.cy - R * 0.707], b: [p.cx + R * 0.707, p.cy + R * 0.707], text: 'Ø' + fmt(p.dia, 2) }]
      : [
        { sel: 'size', a: dimAt(-half(W), -half(H) - 4), b: dimAt(half(W), -half(H) - 4), text: fmt(W, 2) + ' mm' },
        { sel: 'size', a: dimAt(half(W) + 4, -half(H)), b: dimAt(half(W) + 4, half(H)), text: fmt(H, 2) + ' mm' }
      ],
    labels: [{ text: title(p), sel: 'size' }, { text: plan.offsets.length + ' loops × ' + levels.length + ' levels, in by ' + plan.entry }],
    note: 'Ø' + fmt(p.toolDia, 1) + ' cutter',
    section: {
      axis: 'X', at: p.cy, title: 'Section through the centre, along X',
      cuts: [{ u0: p.cx - halfX, u1: p.cx + halfX, z: zBottom, feat: 0 }],
      levels: [
        { z: zSafe, text: 'Clear Z' + fmt(zSafe, 2), role: 'clear' },
        { z: zApproach, text: 'Start Z' + fmt(zApproach, 2), role: 'retract' },
        ...levels.slice(0, -1).map((z) => ({ z, role: 'level', sel: 'levels' })),
        { z: zBottom, text: 'Bottom Z' + fmt(zBottom, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [
        { sel: 'depth', u: p.cx - halfX - 3, z0: p.zTop, z1: zBottom, text: fmt(p.depth, 2) + ' mm' },
        { sel: 'size', z: p.zTop + 1.5, u0: p.cx - halfX, u1: p.cx + halfX, text: fmt(2 * halfX, 2) + ' mm' }
      ]
    },
    tool: { dia: p.toolDia, kind: 'mill' },
    rest: { X: centre[0], Y: centre[1], Z: zApproach }
  };
  return out;
}

const POCKET = { DEFAULTS, SHAPES, title, fileName, generate };
export default POCKET;
