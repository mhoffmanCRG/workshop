/*
 * Bore: mills round holes to size with an end mill by helical interpolation: a helix down near the
 * wall to the bottom, a flat turn there, then a finish pass that helixes back up on the wall itself.
 * One or more holes. No DOM access here, so it also loads in Node.
 *
 * Program frame: hole centres in work coordinates, Z zero where "Top of part" says.
 */
import { createProgram, fmt } from '../../../shared/toolpath/program.js';
import {
  TOOL_DEFAULTS, PROGRAM_DEFAULTS, autoFeeds, checkCommon, checkNumbers, spindleWarnings,
  toolComment, startProgram, endProgram
} from '../../../shared/toolpath/cutting.js';

const DEFAULTS = {
  milling: 'climb',       // 'climb' | 'conventional'
  centres: '0,0',         // hole centres, "x,y" pairs separated by semicolons or new lines
  holeDia: 20,
  depth: 10,
  zTop: 0,
  thickness: 0,           // 0 = not given
  pitch: 1,               // helix: Z per turn going down
  allowance: 0.2,         // on the radius, for the finish pass
  finish: true,
  finishPitch: 1.5,       // Z per turn of the finish helix going up
  retract: 2,
  clearance: 5,
  ...TOOL_DEFAULTS,
  toolDia: 10,
  ...PROGRAM_DEFAULTS
};

const TAU = 2 * Math.PI;
const n2 = (v) => fmt(v, 2).replace(/\.?0+$/, '');

/** "x,y; x,y" (also spaces or new lines between pairs) -> [{ x, y }], null when it does not read. */
export function parseCentres(text) {
  const nums = String(text || '').split(/[\s,;]+/).filter((t) => t !== '');
  if (!nums.length || nums.length % 2) return null;
  const out = [];
  for (let i = 0; i < nums.length; i += 2) {
    const x = Number(nums[i]), y = Number(nums[i + 1]);
    if (!isFinite(x) || !isFinite(y)) return null;
    out.push({ x, y });
  }
  return out;
}

function title(p) {
  const c = parseCentres(p.centres), n = c ? c.length : 1;
  return (n > 1 ? n + ' bores' : 'Bore') + ' Ø' + n2(p.holeDia) + ', ' + n2(p.depth) + ' deep';
}

function fileName(p) {
  const c = parseCentres(p.centres), n = c ? c.length : 1, r = (v) => String(Math.round(v * 100) / 100);
  return 'bore' + (n > 1 ? n + 'x' : '') + 'D' + r(p.holeDia) + '-' + r(p.depth) + '.nc';
}

function check(p) {
  const e = [], c = checkNumbers(p, e);
  if (!parseCentres(p.centres)) e.push('Hole centres must be pairs of numbers, x,y, separated by semicolons, for example 0,0; 40,0.');
  c.pos('holeDia', 'Hole diameter'); c.pos('depth', 'Depth'); c.num('zTop', 'Top of part'); c.nonNeg('thickness', 'Part thickness');
  c.pos('pitch', 'Helix pitch'); c.nonNeg('allowance', 'Finish allowance'); c.pos('finishPitch', 'Finish helix pitch');
  c.pos('retract', 'Start height'); c.nonNeg('clearance', 'Clearance');
  checkCommon(p, e);
  if (!e.length && p.clearance < p.retract) e.push('The clearance must be at least the start height.');
  return e;
}

function generate(p) {
  const out = { params: p, errors: check(p), warnings: [], gcode: '' };
  autoFeeds(p, out);
  if (out.errors.length) return out;
  const w = out.warnings, rt = p.toolDia / 2, R = p.holeDia / 2;
  if (p.toolDia > p.holeDia + 1e-9) { out.errors.push('The cutter (' + n2(p.toolDia) + ' mm) is bigger than the hole (' + n2(p.holeDia) + ' mm).'); return out; }
  const centres = parseCentres(p.centres);
  const climb = p.milling !== 'conventional', sense = climb ? 1 : -1;   // inside a hole, climb milling goes anticlockwise
  const finishing = p.finish && R - rt > 0.005;
  const Rf = R - rt, Rr = Math.max(0, finishing ? Rf - p.allowance : Rf);
  const core = Rr - rt;                 // > 0: a post is left in the middle
  const zBottom = p.zTop - p.depth, zSafe = p.zTop + p.clearance, zApproach = p.zTop + p.retract, zs = p.zTop + 0.5;
  const plunge = Rr < 0.05;
  const turns = plunge ? 0 : Math.max(1, Math.ceil((zs - zBottom) / p.pitch - 1e-9));
  const fTurns = finishing ? Math.max(1, Math.ceil((p.zTop + 0.2 - zBottom) / p.finishPitch - 1e-9)) : 0;
  const through = p.thickness > 0 && p.depth >= p.thickness - 1e-9;
  const rampAngle = plunge ? 90 : Math.atan((zs - zBottom) / turns / (TAU * Rr)) * 180 / Math.PI;

  // ---- warnings
  if (plunge) w.push('The hole is about the cutter\'s size, so it plunges straight down like a drill: it needs a centre-cutting end mill, and a drill does the job better.');
  if (core > 0.05) {
    w.push(through
      ? 'The helix leaves a core Ø' + n2(2 * core) + ' mm in the middle, which drops out when the hole breaks through. Make sure it cannot jam under the cutter.'
      : 'The helix leaves a post Ø' + n2(2 * core) + ' mm standing in the middle of the hole. For a blind hole this size use Pocket (round), or a bigger cutter (at least ' + n2(p.holeDia / 2 + 0.1) + ' mm).');
  }
  if (!plunge && rampAngle > 8) w.push('The helix goes down ' + n2(rampAngle) + '° steep: about 2 to 5° is kind to the cutter. Use a smaller pitch.');
  if (!finishing && p.finish) w.push('The cutter is the hole size, so there is no room for a finish pass.');
  if (p.depth > 4 * p.toolDia) w.push('The hole is ' + fmt(p.depth / p.toolDia, 1) + ' cutter diameters deep: the flutes must be that long and the chips need clearing.');
  if (p.thickness > 0 && p.depth > p.thickness + 1e-9) w.push('The cutter goes ' + n2(p.depth - p.thickness) + ' mm below the part: support it on a spoil board.');
  spindleWarnings(p, w);

  const b = createProgram(p);
  startProgram(b, p, {
    comments: [
      title(p),
      'Centres ' + centres.map((c) => 'X' + fmt(c.x, 3) + ' Y' + fmt(c.y, 3)).join(', ') + ', bottom Z' + fmt(zBottom, 3),
      (plunge ? 'Plunge to depth' : turns + ' helix turns of ' + n2((zs - zBottom) / turns) + ' mm on radius ' + n2(Rr)) +
        (finishing ? ', finish helix up in ' + fTurns + ' turns on radius ' + n2(Rf) : '') + ', ' + (climb ? 'climb' : 'conventional') + ' milling',
      toolComment(p),
      'SETUP: Z0 so the top of the part is at Z' + fmt(p.zTop, 3) + ', X0 Y0 at the work zero for the centres above'
    ],
    x: centres[0].x, y: centres[0].y, zSafe
  });

  centres.forEach((c, h) => {
    b.feat = h;
    b.comment('Hole ' + (h + 1) + ' of ' + centres.length + ' at X' + fmt(c.x, 3) + ' Y' + fmt(c.y, 3));
    b.phase = 'move';
    if (h > 0) { b.rapid({ Z: zSafe }); b.rapid({ X: c.x, Y: c.y }); }
    b.rapid({ Z: zApproach });
    b.line({ X: c.x + Rr, Y: c.y }, p.feed);
    b.line({ Z: zs }, p.plungeFeed);
    b.phase = 'rough';
    if (plunge) b.line({ Z: zBottom }, p.plungeFeed);
    else {
      for (let i = 1; i <= turns; i++) b.arc(c.x, c.y, sense * TAU, zs - (zs - zBottom) * i / turns, p.feed);
      b.arc(c.x, c.y, sense * TAU, zBottom, p.feed);        // a flat turn to clean up the bottom
    }
    if (finishing) {
      b.phase = 'finish';
      b.line({ X: c.x + Rf, Y: c.y }, p.feed);
      b.arc(c.x, c.y, sense * TAU, zBottom, p.feed);
      for (let i = 1; i <= fTurns; i++) b.arc(c.x, c.y, sense * TAU, zBottom + (p.zTop + 0.2 - zBottom) * i / fTurns, p.feed);
      b.phase = 'move';
      b.line({ X: c.x, Y: c.y }, p.feed);
    } else if (core <= 0.05) {
      b.phase = 'move';
      b.line({ X: c.x, Y: c.y }, p.feed);
    }
    b.done = h + 1;
  });
  endProgram(b, p, zSafe);
  const res = b.finish();
  out.gcode = res.gcode;
  out.program = res.program;
  out.stats = { ...res.stats, holes: centres.length, turns, fTurns, per: { word: 'hole', count: centres.length } };
  out.geom = { centres, Rr, Rf, core, turns, fTurns, rampAngle, plunge, zBottom };

  // ---- drawings
  const xs = centres.map((c) => c.x), ys = centres.map((c) => c.y), m = R + Math.max(8, p.holeDia * 0.4);
  const thick = p.thickness > 0 ? p.thickness : p.depth + Math.max(5, p.depth * 0.5);
  const circle = (c, r) => { const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * TAU; pts.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); } return pts; };
  const y0 = centres[0].y;
  const cuts = [];
  centres.forEach((c, h) => {
    const off = Math.abs(c.y - y0);
    if (off >= R) return;
    const half = Math.sqrt(R * R - off * off);
    if (core > 0.05 && off < core) {
      const ch = Math.sqrt(core * core - off * off);
      cuts.push({ u0: c.x - half, u1: c.x - ch, z: zBottom, feat: h }, { u0: c.x + ch, u1: c.x + half, z: zBottom, feat: h });
    } else cuts.push({ u0: c.x - half, u1: c.x + half, z: zBottom, feat: h });
  });
  const c0 = centres[0];
  out.scene = {
    stock: { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m, zTop: p.zTop, zBottom: p.zTop - thick },
    outlines: centres.map((c, h) => ({ pts: circle(c, R), role: 'cut', z1: zBottom, feat: h, sel: 'dia' }))
      .concat(core > 0.05 ? centres.map((c, h) => ({ pts: circle(c, core), role: 'part', feat: h, sel: 'core' })) : []),
    dims: [
      { sel: 'dia', a: [c0.x - R * 0.707, c0.y - R * 0.707], b: [c0.x + R * 0.707, c0.y + R * 0.707], text: 'Ø' + n2(p.holeDia) },
      ...(core > 0.05 ? [{ sel: 'core', a: [c0.x - core, c0.y], b: [c0.x + core, c0.y], text: 'Ø' + n2(2 * core) }] : [])
    ],
    labels: [{ text: title(p), sel: 'dia' }, { text: plunge ? 'Plunged' : turns + ' turns down' + (finishing ? ', ' + fTurns + ' up' : '') }],
    note: 'Ø' + n2(p.toolDia) + ' cutter',
    section: {
      axis: 'X', at: y0, title: 'Section through hole 1, along X',
      cuts,
      levels: [
        { z: zSafe, text: 'Clear Z' + fmt(zSafe, 2), role: 'clear' },
        { z: zApproach, text: 'Start Z' + fmt(zApproach, 2), role: 'retract' },
        { z: zBottom, text: 'Bottom Z' + fmt(zBottom, 3), role: 'bottom', sel: 'depth' }
      ],
      dims: [
        { sel: 'depth', u: c0.x - R - 3, z0: p.zTop, z1: zBottom, text: n2(p.depth) + ' mm' },
        { sel: 'dia', z: p.zTop + 1.5, u0: c0.x - R, u1: c0.x + R, text: 'Ø' + n2(p.holeDia) }
      ]
    },
    tool: { dia: p.toolDia, kind: 'mill' },
    rest: { X: c0.x, Y: c0.y, Z: zApproach }
  };
  return out;
}

const BORE = { DEFAULTS, title, fileName, generate };
export default BORE;
