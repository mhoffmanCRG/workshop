/* Settings: form values (strings and booleans, as the inputs hold them) <-> generator params. */
import THREAD from './thread.js';
import { loadJSON } from '../../../shared/storage.js';

export const STORE_KEY = 'thread-settings';
export const FIELD_NAMES = Object.keys(THREAD.DEFAULTS);

// What an input holds for a setting value.
export function toInput(name, v) {
  return typeof THREAD.DEFAULTS[name] === 'boolean' ? !!v : String(v);
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
    const d = THREAD.DEFAULTS[k], v = values[k];
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
    initial[k] = saved[k] !== undefined && saved[k] !== null && !(typeof saved[k] === 'number' && !isFinite(saved[k])) ? saved[k] : THREAD.DEFAULTS[k];
  });
  // settings saved before the shaft was a setting: give the cutter a neck that clears its thread
  if (saved.shaftDia === undefined && saved.toolDia !== undefined) {
    const depth = initial.kind === 'external' ? (initial.stockDia - initial.minorDia) / 2 : (initial.majorDia - initial.holeDia) / 2;
    const d = Math.floor((initial.toolDia - 2 * depth - 0.2) * 10) / 10;
    if (d > 0) initial.shaftDia = d;
  }
  return toValues(initial);
}

// Cutter sizes offered when the chosen one will not fit a smaller hole.
const CUTTERS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** The values after setting `name`: a size brings its diameters, a new form recomputes the ones that follow it. */
export function applyEdit(values, name, value) {
  const next = { ...values, [name]: value };
  const num = (k) => Number(next[k]);
  const fill = (o) => { if (o) Object.keys(o).forEach((k) => { next[k] = toInput(k, o[k]); }); };
  if (name === 'standard') {
    const st = THREAD.STANDARDS[value] || THREAD.STANDARDS.M;
    next.size = st.size;
    if (value === 'custom') next.angle = String(st.angle);
  }
  if (name === 'standard' || name === 'size') {
    fill(THREAD.sizeSettings(next.standard, next.size, next.kind));
    // a cutter too big for the new hole is swapped for the largest that fits about 2/3 of the thread
    if (next.kind !== 'external' && !(num('toolDia') <= 0.7 * num('majorDia'))) {
      const fit = CUTTERS.filter((d) => d <= 0.65 * num('majorDia'));
      if (fit.length) {
        next.toolDia = String(fit[fit.length - 1]);
        // the neck has to clear the crests: cutting diameter less twice the thread depth
        next.shaftDia = String(Math.max(0.5, Math.floor((num('toolDia') - (num('majorDia') - num('holeDia')) - 0.2) * 10) / 10));
      }
    }
  } else if (['majorDia', 'pitch', 'angle', 'kind'].indexOf(name) >= 0) {
    // a hand-entered size is no longer the listed one
    if (name !== 'kind' && next.standard !== 'custom') next.size = 'custom';
    if (num('majorDia') > 0 && num('pitch') > 0 && num('angle') > 0) {
      const d = THREAD.derived(num('majorDia'), num('pitch'), num('angle'), next.kind);
      next.minorDia = String(d.minorDia);
      if (name !== 'kind') { next.holeDia = String(d.holeDia); next.stockDia = String(d.stockDia); }
    }
  }
  return next;
}

/** Default for one setting; the size settings follow the chosen size. */
export function defaultFor(name, values) {
  if (THREAD.SIZE_FIELDS.indexOf(name) >= 0) {
    const s = THREAD.sizeSettings(values.standard, values.size, values.kind);
    if (s) return s[name];
    const D = Number(values.majorDia), P = Number(values.pitch), a = Number(values.angle);
    if (name === 'majorDia' || name === 'pitch') return values[name];
    if (name === 'angle') return (THREAD.STANDARDS[values.standard] || THREAD.STANDARDS.M).angle;
    if (D > 0 && P > 0 && a > 0) return THREAD.derived(D, P, a, values.kind)[name];
  }
  return THREAD.DEFAULTS[name];
}

export function defaultFileName(p) {
  // "M10 × 1.5" -> m10x1.5-int.nc, "1/4-20 UNC" -> 1_4-20unc-int.nc
  return THREAD.threadName(p).toLowerCase().replace(/\s*×\s*/g, 'x').replace(/\//g, '_').replace(/[^a-z0-9._\-x]/g, '') +
    '-' + (p.kind === 'external' ? 'ext' : 'int') + '.nc';
}
