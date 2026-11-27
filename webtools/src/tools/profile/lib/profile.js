/*
 * Profile: cuts round the outside of a rectangle (optionally rounded and turned) or circle, or round
 * the inside of one, in depth steps with the cutter offset by its radius, ramping down along the
 * contour; tabs hold a part that is cut right through. A finish pass at full depth takes the allowance.
 * No DOM access here, so it also loads in Node.
 *
 * Program frame: the shape's centre is (cx, cy) in work coordinates, Z zero where "Top of part" says.
 */
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import {
  TOOL_DEFAULTS, PROGRAM_DEFAULTS, autoFeeds, checkCommon, checkNumbers, spindleWarnings, depthLevels,
  toolComment, startProgram, endProgram
} from '../../../shared/toolpath/cutting.js';
import { roundedRect, placePath, samplePath, emitContour, pathLen, tabStretches, segStart } from '../../../shared/toolpath/geometry.js';

const DEFAULTS = {
  shape: 'rect',          // 'rect' | 'circle'
  side: 'outside',        // 'outside' | 'inside'
  cx: 0, cy: 0,
  width: 60, length: 40,  // finished size along X and Y (before turning)
  cornerR: 5,
  angle: 0,
  dia: 50,
  depth: 6.3,             // through a 6 mm plate with a little to spare
  zTop: 0,
  thickness: 6,           // 0 = not given
  stepdown: 1.5,
  allowance: 0.2,
  finish: true,
  entry: 'ramp',          // 'ramp' (down along the contour) | 'plunge'
  rampAngle: 3,
  milling: 'climb',       // 'climb' | 'conventional'
  tabs: 4,                // 0 = none
  tabWidth: 5,            // along the edge
  tabHeight: 1,           // above the bottom of the cut
  retract: 2,
  clearance: 5,
  ...TOOL_DEFAULTS,
  ...PROGRAM_DEFAULTS
};

const SHAPES = { rect: 'Rectangle profile', circle: 'Round profile' };
const RAD = Math.PI / 180;
const n2 = (v) => fmt(v, 2).replace(/\.?0+$/, '');

function title(p) {
  return (SHAPES[p.shape] || SHAPES.rect) + ' ' + (p.shape === 'circle' ? 'Ø' + n2(p.dia) : n2(p.width) + ' × ' + n2(p.length)) + ', ' + (p.side === 'inside' ? 'inside' : 'outside');
}

function fileName(p) {
  const n = (v) => String(Math.round(v * 100) / 100);
  return 'profile-' + (p.side === 'inside' ? 'in' : 'out') + '-' + (p.shape === 'circle' ? 'D' + n(p.dia) : n(p.width) + 'x' + n(p.length)) + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!SHAPES[p.shape]) e.push('Unknown shape.');
  c.num('cx', 'Centre X'); c.num('cy', 'Centre Y'); c.num('zTop', 'Top of part');
  if (p.shape === 'circle') c.pos('dia', 'Diameter');
  else { c.pos('width', 'Width'); c.pos('length', 'Length'); c.nonNeg('cornerR', 'Corner radius'); c.num('angle', 'Angle'); }
  c.pos('depth', 'Depth'); c.nonNeg('thickness', 'Part thickness'); c.pos('stepdown', 'Depth per level');
  c.nonNeg('allowance', 'Finish allowance');
  if (!(p.rampAngle > 0 && p.rampAngle <= 30)) e.push('Ramp angle must be more than 0° and at most 30°.');
  c.int('tabs', 'Tabs', 0, 24); c.nonNeg('tabWidth', 'Tab width'); c.nonNeg('tabHeight', 'Tab height');
  c.pos('retract', 'Start height'); c.nonNeg('clearance', 'Clearance');
  checkCommon(p, e);
  if (!e.length && p.shape !== 'circle' && p.cornerR > Math.min(p.width, p.length) / 2 + 1e-9) e.push('The corner radius cannot be more than half the width or length.');
  if (!e.length && p.clearance < p.retract) e.push('The clearance must be at least the start height.');
  if (!e.length && p.tabs > 0 && !(p.tabWidth > 0 && p.tabHeight > 0)) e.push('Tabs need a width and a height; set Tabs to 0 for none.');
  if (!e.length && p.tabs > 0 && p.tabHeight >= p.depth) e.push('The tabs must be lower than the depth of the cut.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  autoFeeds(p, out);
  if (out.errors.length) return out;
  const w = out.warnings, rt = p.toolDia / 2, inside = p.side === 'inside', round = p.shape === 'circle';
  const W = round ? p.dia : p.width, H = round ? p.dia : p.length, R = round ? p.dia / 2 : p.cornerR;
  const rot = round ? 0 : p.angle * RAD;
  if (inside && Math.min(W, H) <= p.toolDia + 2 * p.allowance + 1e-6) {
    out.errors.push('The opening (' + n2(Math.min(W, H)) + ' mm) leaves the cutter no room to go round inside it: use Pocket, Bore or a drill, or a smaller cutter.');
    return out;
  }
  // climb milling goes clockwise round the outside, anticlockwise round the inside (spindle M3)
  const climb = p.milling !== 'conventional', ccw = inside ? climb : !climb;
  const offsetPath = (d) => placePath(inside
    ? roundedRect(W - 2 * d, H - 2 * d, Math.max(R - d, 0), ccw)
    : roundedRect(W + 2 * d, H + 2 * d, R + d, ccw), p.cx, p.cy, rot);
  const finishing = p.finish;
  const dRough = rt + (finishing ? p.allowance : 0);
  const rough = offsetPath(dRough), fin = offsetPath(rt);
  const zBottom = p.zTop - p.depth;
  const levels = depthLevels(p.zTop, zBottom, p.stepdown);
  const zSafe = p.zTop + p.clearance, zApproach = p.zTop + p.retract;
  const tanA = Math.tan(p.rampAngle * RAD);
  const tabZ = p.tabs > 0 ? zBottom + p.tabHeight : undefined;
  const tabsOn = (path) => (p.tabs > 0 ? tabStretches(pathLen(path), p.tabs, p.tabWidth + p.toolDia) : []);
  const roughTabs = tabsOn(rough), finTabs = tabsOn(fin);
  const through = p.thickness > 0 && p.depth >= p.thickness - 1e-9;

  // ---- warnings
  if (inside && !round && R < rt - 1e-9) w.push(R > 0 ? 'The inside corners come out with the cutter\'s radius (' + n2(rt) + ' mm), not ' + n2(R) + ' mm.' : 'An end mill cannot cut sharp inside corners: they come out with the cutter\'s radius, ' + n2(rt) + ' mm.');
  if (p.tabs > 0 && !roughTabs.length) w.push('The tabs do not fit round the contour: use fewer or narrower tabs.');
  if (through && !(p.tabs > 0)) w.push('The cut goes right through with no tabs: the ' + (inside ? 'slug' : 'part') + ' comes loose on the last level. Hold it down or add tabs.');
  if (!through && p.tabs > 0) w.push(p.thickness > 0 ? 'The cut does not go right through the part, so the tabs are not needed.' : 'Tabs only matter when the cut goes right through: give the part thickness to check.');
  if (p.thickness > 0 && p.depth > p.thickness + 1) w.push('The cut goes ' + n2(p.depth - p.thickness) + ' mm below the part: about 0.2 to 0.5 mm is enough to cut through.');
  if (p.stepdown > p.toolDia) w.push('Depth per level is more than the cutter diameter: a full-width slot that deep is heavy on a small mill.');
  if (p.entry === 'plunge') w.push('Plunging straight down needs a centre-cutting end mill and leaves a small mark on the wall where it goes in.');
  if (p.tabs > 0 && p.tabHeight < 0.5) w.push('Tabs thinner than about 0.5 mm can break before the last level finishes.');
  spindleWarnings(p, w);

  const b = createProgram(p);
  const start = segStart(rough[0]);
  startProgram(b, p, {
    comments: [
      title(p),
      'Centre X' + fmt(p.cx, 3) + ' Y' + fmt(p.cy, 3) + (round ? '' : ', corners R' + n2(R) + (p.angle ? ', turned ' + n2(p.angle) + ' deg' : '')) + ', down to Z' + fmt(zBottom, 3),
      levels.length + ' level' + (levels.length > 1 ? 's' : '') + ', ' + (p.entry === 'ramp' ? 'ramping down along the contour at ' + n2(p.rampAngle) + ' deg' : 'plunging') +
        (finishing ? ', ' + n2(p.allowance) + ' mm left for the finish pass' : '') + ', ' + (climb ? 'climb' : 'conventional') + ' milling' +
        (p.tabs > 0 ? ', ' + p.tabs + ' tabs ' + n2(p.tabWidth) + ' wide ' + n2(p.tabHeight) + ' high' : ''),
      toolComment(p),
      'SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', X0 Y0 so the centre of the shape is at X' + fmt(p.cx, 3) + ' Y' + fmt(p.cy, 3)
    ],
    x: start[0], y: start[1], zSafe
  });
  b.feat = 0;
  b.phase = 'move';
  b.rapid({ Z: zApproach });
  b.line({ Z: p.zTop }, p.plungeFeed);
  let zPrev = p.zTop, along = 0;
  levels.forEach((z, k) => {
    b.comment('Level ' + (k + 1) + ' of ' + levels.length + ' to Z' + fmt(z, 3));
    b.phase = 'rough';
    // each level ramps on from where the one before stopped
    along = emitContour(b, rough, {
      s0: along, zStart: zPrev, zEnd: z, ramp: p.entry === 'ramp' ? (zPrev - z) / tanA : 0,
      tabs: roughTabs, tabZ, F: p.feed, plungeF: p.plungeFeed
    });
    zPrev = z;
  });
  // on round to the start point, where the finish pass and the way out begin
  const Lr = pathLen(rough);
  if (along > 1e-6 && Lr - along > 1e-6) emitContour(b, rough, { s0: along, zStart: zBottom, zEnd: zBottom, ramp: 0, len: Lr - along, tabs: roughTabs, tabZ, F: p.feed, plungeF: p.plungeFeed });
  if (finishing) {
    const fs = segStart(fin[0]);
    b.comment('Finish pass at full depth');
    b.phase = 'finish';
    b.line({ X: fs[0], Y: fs[1], Z: zBottom }, p.feed);
    emitContour(b, fin, { zStart: zBottom, zEnd: zBottom, ramp: 0, tabs: finTabs, tabZ, F: p.feed, plungeF: p.plungeFeed });
    b.phase = 'move';
    b.line({ X: start[0], Y: start[1] }, p.feed);
  }
  b.done = 1;
  endProgram(b, p, zSafe);
  const res = b.finish();
  out.gcode = res.gcode;
  out.program = res.program;

  const L = pathLen(finishing ? fin : rough);
  out.stats = { ...res.stats, levels: levels.length, length: L, per: { word: 'level', count: levels.length } };
  out.geom = { levels, zBottom, tabZ, tabs: roughTabs.length, through };

  // ---- drawings
  const partOutline = samplePath(placePath(roundedRect(W, H, R, true), p.cx, p.cy, rot), true);
  const kerf = 2 * dRough;
  const ext = Math.max(W, H) / 2 + (inside ? Math.max(8, 0.25 * Math.max(W, H)) : kerf + Math.max(8, 0.2 * Math.max(W, H)));
  const thick = p.thickness > 0 ? p.thickness : p.depth + Math.max(5, p.depth * 0.5);
  let halfX = 0;
  partOutline.forEach((q) => { if (Math.abs(q[1] - p.cy) < 0.02 * H + 1e-6) halfX = Math.max(halfX, Math.abs(q[0] - p.cx)); });
  if (!halfX) halfX = W / 2;
  const cuts = inside
    ? [{ u0: p.cx - halfX, u1: p.cx - halfX + kerf, z: zBottom, feat: 0 }, { u0: p.cx + halfX - kerf, u1: p.cx + halfX, z: zBottom, feat: 0 }]
    : [{ u0: p.cx - halfX - kerf, u1: p.cx - halfX, z: zBottom, feat: 0 }, { u0: p.cx + halfX, u1: p.cx + halfX + kerf, z: zBottom, feat: 0 }];
  // where the tabs stand, as short marks on the part edge
  const tabMarks = roughTabs.map(([s0, s1]) => {
    const pts = [], seg = samplePath(rough, false);
    let acc = 0;
    for (let i = 1; i < seg.length; i++) {
      const d = Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]);
      const mid = acc + d / 2;
      if (mid > s0 + rt && mid < s1 - rt) pts.push(seg[i]);
      acc += d;
    }
    return { pts, role: 'part', sel: 'tabs' };
  }).filter((o) => o.pts.length > 1);
  const cAng = rot, at = (x, y) => [p.cx + x * Math.cos(cAng) - y * Math.sin(cAng), p.cy + x * Math.sin(cAng) + y * Math.cos(cAng)];
  out.scene = {
    stock: { x0: p.cx - ext, x1: p.cx + ext, y0: p.cy - ext, y1: p.cy + ext, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines: [
      { pts: partOutline, role: 'part', z1: zBottom, sel: 'size' },
      { pts: samplePath(rough, true), role: 'cut', feat: 0, sel: 'path' },
      ...tabMarks
    ],
    dims: round
      ? [{ sel: 'size', a: [p.cx - R * 0.707, p.cy - R * 0.707], b: [p.cx + R * 0.707, p.cy + R * 0.707], text: 'Ø' + n2(p.dia) }]
      : [
        { sel: 'size', a: at(-W / 2, -H / 2 - 4), b: at(W / 2, -H / 2 - 4), text: n2(W) + ' mm' },
        { sel: 'size', a: at(W / 2 + 4, -H / 2), b: at(W / 2 + 4, H / 2), text: n2(H) + ' mm' }
      ],
    labels: [{ text: title(p), sel: 'size' }, { text: levels.length + ' levels' + (p.tabs > 0 ? ', ' + roughTabs.length + ' tabs' : ''), sel: 'tabs' }],
    note: 'Ø' + n2(p.toolDia) + ' cutter',
    section: {
      axis: 'X', at: p.cy, title: 'Section through the centre, along X',
      cuts,
      levels: [
        { z: zSafe, text: 'Clear Z' + fmt(zSafe, 2), role: 'clear' },
        { z: zApproach, text: 'Start Z' + fmt(zApproach, 2), role: 'retract' },
        ...levels.slice(0, -1).map((z) => ({ z, role: 'level', sel: 'levels' })),
        ...(tabZ !== undefined ? [{ z: tabZ, text: 'Tabs Z' + fmt(tabZ, 2), role: 'level', sel: 'tabs' }] : []),
        { z: zBottom, text: 'Bottom Z' + fmt(zBottom, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [{ sel: 'depth', u: cuts[0].u0 - 3, z0: p.zTop, z1: zBottom, text: n2(p.depth) + ' mm' }]
    },
    tool: { dia: p.toolDia, kind: 'mill' },
    rest: { X: start[0], Y: start[1], Z: zApproach }
  };
  return out;
}

const PROFILE = { DEFAULTS, SHAPES, title, fileName, generate };
export default PROFILE;
