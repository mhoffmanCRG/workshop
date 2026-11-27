/*
 * What every milling page shares: end mill speeds and feeds, the settings for the tool, program and
 * time calculator, their checks, and the start and end of the program. No DOM access.
 */
import { fmt } from './program.js';

// The mill's spindle tops out here (linuxcnc/mill/Mill.ini, [SPINDLE_9] OUTPUT_MAX_LIMIT).
export const SPINDLE_MAX = 5000;

// Starting values for a carbide end mill: surface speed (m/min) and feed per tooth as a fraction of
// the cutter diameter. HSS runs at about a third of the speed.
export const MILL_MATERIALS = {
  aluminium: { label: 'Aluminium', vc: 250, fz: 0.006 },
  steel: { label: 'Mild steel', vc: 100, fz: 0.004 },
  stainless: { label: 'Stainless steel', vc: 60, fz: 0.003 },
  brass: { label: 'Brass', vc: 150, fz: 0.005 },
  castiron: { label: 'Cast iron', vc: 80, fz: 0.004 },
  plastic: { label: 'Plastic', vc: 200, fz: 0.008 }
};
export const MATERIAL_OPTIONS = Object.keys(MILL_MATERIALS).map((k) => [k, MILL_MATERIALS[k].label]);

export const TOOL_DEFAULTS = {
  toolDia: 6,
  flutes: 2,
  material: 'aluminium',
  rpm: 4000,
  feedAuto: true,
  feed: 400,
  plungeFeed: 130
};

export const PROGRAM_DEFAULTS = {
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

const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);

export function materialOf(p) { return MILL_MATERIALS[p.material] || MILL_MATERIALS.aluminium; }
export function chipLoad(p) { return Math.min(0.15, Math.max(0.005, materialOf(p).fz * p.toolDia)); }
export function suggestedRpm(p) { return Math.min(SPINDLE_MAX, materialOf(p).vc * 1000 / (Math.PI * p.toolDia)); }

/** With "Set the feeds from the material", work out the feed and plunge feed; out.auto lists them for the form. */
export function autoFeeds(p, out) {
  if (!(p.feedAuto && p.toolDia > 0 && p.rpm > 0 && Number.isInteger(p.flutes) && p.flutes >= 1)) return;
  p.feed = round5(p.rpm * p.flutes * chipLoad(p));
  p.plungeFeed = round5(p.feed / 3);
  out.auto = { feed: p.feed, plungeFeed: p.plungeFeed };
}

/** Text under the tool settings: where the feed comes from and what spindle speed suits. */
export function feedInfo(r) {
  if (!r || !r.gcode) return '';
  const p = r.params, mat = materialOf(p), fz = p.feed / (p.rpm * p.flutes);
  const sug = suggestedRpm(p), capped = sug >= SPINDLE_MAX - 1;
  return (p.feedAuto
    ? mat.label + ': ' + chipLoad(p).toFixed(3) + ' mm per tooth × ' + p.flutes + ' flutes × ' + p.rpm + ' rpm gives ' + p.feed + ' mm/min; plunging at a third of that. '
    : 'Feed per tooth: ' + fz.toFixed(3) + ' mm (about ' + chipLoad(p).toFixed(3) + ' suits ' + mat.label.toLowerCase() + '). ') +
    'A ' + p.toolDia + ' mm carbide end mill in ' + mat.label.toLowerCase() + ' runs at ' +
    (capped ? 'the spindle\'s top speed, ' + SPINDLE_MAX + ' rpm' : 'about ' + (Math.round(sug / 50) * 50).toLocaleString() + ' rpm') + '; HSS at a third of that.';
}

export function checkNumbers(p, e) {
  return {
    pos(k, label) { if (!(p[k] > 0)) e.push(label + ' must be greater than zero.'); },
    nonNeg(k, label) { if (!(p[k] >= 0)) e.push(label + ' cannot be negative.'); },
    num(k, label) { if (!isFinite(p[k])) e.push(label + ' must be a number.'); },
    int(k, label, lo, hi) { if (!(Number.isInteger(p[k]) && p[k] >= lo && p[k] <= hi)) e.push(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); }
  };
}

/** Checks for the tool and program settings (cutter: false for pages that set their own tool fields). */
export function checkCommon(p, e, cutter = true) {
  const c = checkNumbers(p, e);
  if (cutter) {
    c.pos('toolDia', 'Cutter diameter'); c.int('flutes', 'Flutes', 1, 12);
    c.pos('rpm', 'Spindle speed'); c.pos('feed', 'Feed'); c.pos('plungeFeed', 'Plunge feed');
  }
  c.int('toolNumber', 'Tool number', 1, 99); c.nonNeg('dwell', 'Spindle start dwell');
  c.pos('rapidRate', 'Rapid rate'); c.pos('feedOverride', 'Feed override');
  if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) e.push('Parts to make must be a whole number, 1 or more.');
}

export function spindleWarnings(p, w) {
  if (p.rpm > SPINDLE_MAX) w.push('The spindle tops out at ' + SPINDLE_MAX + ' rpm; LinuxCNC will run it at that and the feed per tooth goes up.');
  if (p.rpm < 100) w.push('The spindle does not run below 100 rpm.');
}

/** Equal depth steps from zTop down to zBottom, none deeper than `step`: the Z of each level. */
export function depthLevels(zTop, zBottom, step) {
  const depth = zTop - zBottom;
  if (!(depth > 1e-9)) return [];
  const n = Math.max(1, Math.ceil(depth / step - 1e-9));
  const out = [];
  for (let i = 1; i <= n; i++) out.push(zTop - depth * i / n);
  return out;
}

export function toolComment(p, kind) {
  return 'Tool: ' + fmt(p.toolDia, 2) + ' mm ' + (kind || 'end mill') + ', ' + p.flutes + ' flutes, ' + fmt(p.rpm, 0) + ' rpm, F' + fmt(p.feed, 0) +
    ' = ' + fmt(p.feed / (p.rpm * p.flutes), 3) + ' mm/tooth, plunge F' + fmt(p.plungeFeed, 0);
}

/**
 * Program start: comments, modes, work offset, tool change, then to the start point at the safe Z
 * with the spindle and coolant on. o: { comments: [text], x, y, zSafe }
 */
export function startProgram(b, p, o) {
  o.comments.forEach((s) => b.comment(s));
  b.raw('G17 G21 G90 G94 G40 G49');
  if (p.wcs) b.raw(p.wcs);
  if (p.toolChange) { b.raw('T' + p.toolNumber + ' M6'); b.raw('G43 H' + p.toolNumber); }
  b.phase = 'move';
  b.rapid({ Z: o.zSafe });
  b.rapid({ X: o.x, Y: o.y });
  b.raw('M3 S' + fmt(p.rpm, 0));
  if (p.coolant === 'flood') b.raw('M8');
  if (p.coolant === 'mist') b.raw('M7');
  if (p.dwell > 0) { b.pause(p.dwell, 'dwell'); b.raw('G4 P' + fmt(p.dwell, 1)); }
}

export function endProgram(b, p, zSafe) {
  b.feat = -1;
  b.phase = 'move';
  b.rapid({ Z: zSafe });
  if (p.coolant !== 'off') b.raw('M9');
  b.raw('M5');
  b.raw('M30');
}
