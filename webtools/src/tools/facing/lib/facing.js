/*
 * Facing: skims the top of a block flat with passes side by side, in depth steps, the last one a light
 * finishing cut. No DOM access here, so it also loads in Node.
 *
 * Program frame: X and Y as the stock limits say, Z zero where "Top of stock" says. All lengths in mm.
 */
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import {
  TOOL_DEFAULTS, PROGRAM_DEFAULTS, autoFeeds, checkCommon, checkNumbers, spindleWarnings, depthLevels,
  toolComment, startProgram, endProgram
} from '../../../shared/toolpath/cutting.js';

const DEFAULTS = {
  pattern: 'zigzag',      // 'zigzag' (both ways) | 'oneway' (every pass the same way, back above the stock)
  // stock
  x0: 0, x1: 100,         // stock limits in X
  y0: 0, y1: 60,          // and Y
  zTop: 0,                // top of the stock before facing
  thickness: 20,          // stock thickness, 0 = not given (only for drawing)
  // cut
  depth: 1,               // total taken off the top
  stepdown: 0.5,          // deepest roughing step
  finishDepth: 0.1,       // the last pass takes this much, 0 = no separate finishing pass
  stepover: 70,           // % of the cutter diameter
  along: 'x',             // passes run along 'x' or 'y'
  overrun: 2,             // past the stock edge beyond the cutter's radius at each end
  clearance: 5,           // safe Z above the top
  ...TOOL_DEFAULTS,
  toolDia: 16,
  flutes: 3,
  ...PROGRAM_DEFAULTS
};

const PATTERNS = { zigzag: 'Zig-zag facing', oneway: 'One-way facing' };

function title(p) {
  return (PATTERNS[p.pattern] || PATTERNS.zigzag) + ' ' + fmt(Math.abs(p.x1 - p.x0), 1).replace(/\.0$/, '') + ' × ' + fmt(Math.abs(p.y1 - p.y0), 1).replace(/\.0$/, '');
}

function fileName(p) {
  const n = (v) => String(Math.round(v * 100) / 100);
  return 'face' + n(Math.abs(p.x1 - p.x0)) + 'x' + n(Math.abs(p.y1 - p.y0)) + '-' + n(p.depth) + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!PATTERNS[p.pattern]) e.push('Unknown pattern.');
  ['x0', 'x1', 'y0', 'y1', 'zTop'].forEach((k) => c.num(k, 'Stock limit ' + k.toUpperCase()));
  if (!(p.x1 > p.x0)) e.push('X to must be greater than X from.');
  if (!(p.y1 > p.y0)) e.push('Y to must be greater than Y from.');
  c.nonNeg('thickness', 'Stock thickness');
  c.pos('depth', 'Depth to take off'); c.pos('stepdown', 'Depth per pass'); c.nonNeg('finishDepth', 'Finishing pass depth');
  if (!(p.stepover >= 5 && p.stepover <= 95)) e.push('Stepover must be from 5% to 95% of the cutter diameter.');
  c.nonNeg('overrun', 'Run past the edge'); c.nonNeg('clearance', 'Clearance');
  checkCommon(p, e);
  if (!e.length && p.finishDepth >= p.depth) e.push('The finishing pass must take less than the whole depth.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  autoFeeds(p, out);
  if (out.errors.length) return out;
  const w = out.warnings, rt = p.toolDia / 2;
  const alongX = p.along !== 'y';
  // pass direction u (along), step direction v (across)
  const u0 = alongX ? p.x0 : p.y0, u1 = alongX ? p.x1 : p.y1, v0 = alongX ? p.y0 : p.x0, v1 = alongX ? p.y1 : p.x1;
  const step = p.toolDia * p.stepover / 100;
  // the outer passes hang a little over the edges, so the edges come out clean
  const edge = Math.min(0.25 * p.toolDia, 3);
  let vA = v0 + rt - edge, vB = v1 - rt + edge;
  if (vB < vA) { vA = vB = (v0 + v1) / 2; }
  const passes = vB - vA < 1e-9 ? 1 : Math.ceil((vB - vA) / step - 1e-9) + 1;
  const pitch = passes > 1 ? (vB - vA) / (passes - 1) : 0;
  const vs = [];
  for (let i = 0; i < passes; i++) vs.push(vA + pitch * i);
  const uStart = u0 - rt - p.overrun, uEnd = u1 + rt + p.overrun;

  const zFinal = p.zTop - p.depth;
  const finishing = p.finishDepth > 0;
  const rough = depthLevels(p.zTop, zFinal + (finishing ? p.finishDepth : 0), p.stepdown);
  const levels = rough.map((z) => ({ z, finish: false }));
  if (finishing) levels.push({ z: zFinal, finish: true });
  const zSafe = p.zTop + p.clearance, zLift = p.zTop + Math.min(1, p.clearance);

  if (p.stepover > 80) w.push('Above about 80% stepover the passes can leave ridges, most of all with a cutter that is not quite square to the table.');
  if (p.stepdown > 0.5 * p.toolDia) w.push('A face cut deeper than half the cutter diameter is heavy; most facing takes well under a millimetre per pass.');
  spindleWarnings(p, w);

  const xy = (u, v) => (alongX ? { X: u, Y: v } : { X: v, Y: u });
  const b = createProgram(p);
  const first = xy(uStart, vs[0]);
  startProgram(b, p, {
    comments: [
      title(p),
      'Stock X' + fmt(p.x0, 3) + ' to ' + fmt(p.x1, 3) + ', Y' + fmt(p.y0, 3) + ' to ' + fmt(p.y1, 3) + ', top Z' + fmt(p.zTop, 3),
      'Take off ' + fmt(p.depth, 3) + ' mm in ' + levels.length + ' level' + (levels.length > 1 ? 's' : '') + (finishing ? ', last ' + fmt(p.finishDepth, 3) + ' mm a finishing pass' : '') +
        ', ' + passes + ' passes along ' + (alongX ? 'X' : 'Y') + ' ' + fmt(pitch, 3) + ' mm apart',
      toolComment(p, 'face mill / end mill'),
      'SETUP: Z0 so the top of the stock is at Z' + fmt(p.zTop, 3) + ', X and Y so the stock lies within the limits above'
    ],
    x: first.X, y: first.Y, zSafe
  });

  b.feat = 0;
  levels.forEach((lv, k) => {
    b.comment('Level ' + (k + 1) + ' of ' + levels.length + ' at Z' + fmt(lv.z, 3) + (lv.finish ? ', finishing' : ''));
    b.phase = 'move';
    b.rapid({ Z: zLift });
    b.rapid(xy(uStart, vs[0]));
    b.line({ Z: lv.z }, p.plungeFeed);
    vs.forEach((v, i) => {
      const forward = p.pattern === 'oneway' || i % 2 === 0;
      const ua = forward ? uStart : uEnd, ub = forward ? uEnd : uStart;
      if (i > 0) {
        if (p.pattern === 'oneway') {
          b.phase = 'move';
          b.rapid({ Z: zLift });
          b.rapid(xy(ua, v));
          b.line({ Z: lv.z }, p.plungeFeed);
        } else {
          b.phase = 'move';
          b.line(xy(ua, v), p.feed);          // step over beyond the end of the stock
        }
      }
      b.phase = lv.finish ? 'finish' : 'rough';
      b.line(xy(ub, v), p.feed);
    });
  });
  b.done = 1;
  endProgram(b, p, zSafe);
  const fin = b.finish();
  out.gcode = fin.gcode;
  out.program = fin.program;

  const area = (p.x1 - p.x0) * (p.y1 - p.y0);
  out.stats = { ...fin.stats, passes, levels: levels.length, pitch, area, volume: area * p.depth / 1000, per: { word: 'level', count: levels.length } };
  out.geom = { passes, pitch, levels, zFinal, vs, uStart, uEnd };

  const thick = p.thickness > 0 ? p.thickness : Math.max(p.depth * 4, 10);
  const vMid = (v0 + v1) / 2;
  const rect = [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1], [p.x0, p.y0]];
  // stepover shown between the first two passes, at the middle of the stock
  const uMid = (u0 + u1) / 2;
  const pa = xy(uMid, vs[0]), pb = xy(uMid, vs[Math.min(1, vs.length - 1)]);
  out.scene = {
    stock: { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines: [{ pts: rect, role: 'cut', z1: zFinal, feat: 0, sel: 'area' }],
    dims: [
      { sel: 'area', a: [p.x0, p.y0 - 0.04 * (p.y1 - p.y0)], b: [p.x1, p.y0 - 0.04 * (p.y1 - p.y0)], text: fmt(p.x1 - p.x0, 2) + ' mm' },
      ...(passes > 1 ? [{ sel: 'stepover', a: [pa.X, pa.Y], b: [pb.X, pb.Y], text: fmt(pitch, 2) + ' mm' }] : [])
    ],
    labels: [{ text: title(p), sel: 'area' }, { text: passes + ' passes × ' + levels.length + ' levels' }],
    note: 'Ø' + fmt(p.toolDia, 1) + ' cutter',
    section: {
      axis: alongX ? 'Y' : 'X', at: alongX ? (p.x0 + p.x1) / 2 : vMid,
      title: 'Section across the passes',
      cuts: [{ u0: v0 - 1, u1: v1 + 1, z: zFinal, feat: 0 }],
      levels: [
        { z: zSafe, text: 'Clear Z' + fmt(zSafe, 2), role: 'clear' },
        ...rough.slice(0, -1).map((z) => ({ z, role: 'level', sel: 'levels' })),
        ...(finishing ? [{ z: rough[rough.length - 1], text: 'Rough Z' + fmt(rough[rough.length - 1], 3), role: 'level', sel: 'levels' }] : []),
        { z: zFinal, text: 'Face Z' + fmt(zFinal, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [{ sel: 'depth', u: v0 + 0.15 * (v1 - v0), z0: p.zTop, z1: zFinal, text: fmt(p.depth, 2) + ' mm' }]
    },
    tool: { dia: p.toolDia, kind: 'mill' },
    rest: { ...first, Z: zLift }
  };
  return out;
}

const FACING = { DEFAULTS, PATTERNS, title, fileName, generate };
export default FACING;
