/* Settings: form values (strings and booleans, as the inputs hold them) <-> generator params. */
import PCD from './pcd.js';
import { loadJSON } from '../../../shared/storage.js';

export const STORE_KEY = 'pcd-settings';
export const FIELD_NAMES = Object.keys(PCD.DEFAULTS);

export function toInput(name, v) {
  return typeof PCD.DEFAULTS[name] === 'boolean' ? !!v : String(v);
}

export function toValues(params) {
  const out = {};
  FIELD_NAMES.forEach((k) => { if (params[k] !== undefined) out[k] = toInput(k, params[k]); });
  return out;
}

// Numeric settings come back as numbers, NaN when empty.
export function toParams(values) {
  const p = {};
  FIELD_NAMES.forEach((k) => {
    const d = PCD.DEFAULTS[k], v = values[k];
    if (typeof d === 'boolean') p[k] = !!v;
    else if (typeof d === 'number') p[k] = v === '' || v === undefined ? NaN : Number(v);
    else p[k] = v === undefined ? '' : v;
  });
  return p;
}

export function initialValues() {
  let saved = loadJSON(STORE_KEY, {});
  if (!saved || typeof saved !== 'object') saved = {};
  const initial = {};
  FIELD_NAMES.forEach((k) => {
    initial[k] = saved[k] !== undefined && saved[k] !== null && !(typeof saved[k] === 'number' && !isFinite(saved[k])) ? saved[k] : PCD.DEFAULTS[k];
  });
  return toValues(initial);
}

const round = (v, dp) => String(Math.round(v * 10 ** dp) / 10 ** dp);

/** The values after setting `name`: a new cycle brings a tool and depth that suit it. */
export function applyEdit(values, name, value) {
  const prev = values, next = { ...values, [name]: value };
  const num = (k) => Number(next[k]);
  if (name === 'cycle' && value !== prev.cycle) {
    const hole = num('holeDia');
    if (value === 'spot') {
      // a 90° spot drill, deep enough to mark a little over the hole size
      next.pointAngle = '90';
      next.depth = round((hole / 2 + 0.3) / Math.tan(Math.PI / 4), 2);
      next.depthTo = 'tip';
      if (num('toolDia') < hole + 0.6) next.toolDia = String([6, 8, 10, 12, 16, 20].find((d) => d >= hole + 0.6) || 20);
    } else if (value === 'tap') {
      // the metric coarse tap whose tap drill is this hole
      const t = PCD.TAPS.reduce((b, s) => (Math.abs(s[0] - s[1] - hole) < Math.abs(b[0] - b[1] - hole) ? s : b));
      next.toolDia = String(t[0]);
      next.tapPitch = String(t[1]);
      next.rpm = String(Math.min(num('rpm') || 300, 300));
      if (prev.cycle === 'spot') next.depth = String(PCD.DEFAULTS.depth);
    } else if (prev.cycle === 'spot' || prev.cycle === 'tap') {
      next.pointAngle = String(PCD.DEFAULTS.pointAngle);
      next.depthTo = 'full';
      next.toolDia = String(hole);
      if (prev.cycle === 'spot') next.depth = String(PCD.DEFAULTS.depth);
      if (prev.cycle === 'tap') next.rpm = String(PCD.DEFAULTS.rpm);
    }
  }
  // a drill that was the hole size stays the hole size
  if (name === 'holeDia' && ['drill', 'dwell', 'peck', 'chipbreak'].indexOf(next.cycle) >= 0 && Number(prev.toolDia) === Number(prev.holeDia)) next.toolDia = value;
  return next;
}

export function defaultFor(name) { return PCD.DEFAULTS[name]; }

export function defaultFileName(p) {
  // 6 holes on 80 PCD, peck -> pcd80-6x8.5-peck.nc
  const n = (v) => String(Math.round(v * 1000) / 1000);
  return 'pcd' + n(p.pcd) + '-' + p.count + 'x' + n(p.holeDia) + '-' + p.cycle + '.nc';
}
