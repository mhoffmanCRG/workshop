/* Settings: form values (strings and booleans, as the inputs hold them) <-> generator params. */
import KEYWAY from './keyway.js';
import { loadJSON } from '../../../shared/storage.js';

export const STORE_KEY = 'keyway-settings';
export const FIELD_NAMES = Object.keys(KEYWAY.DEFAULTS);

// What an input holds for a setting value.
export function toInput(name, v) {
  return typeof KEYWAY.DEFAULTS[name] === 'boolean' ? !!v : String(v);
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
    const d = KEYWAY.DEFAULTS[k], v = values[k];
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
    initial[k] = saved[k] !== undefined && saved[k] !== null && !(typeof saved[k] === 'number' && !isFinite(saved[k])) ? saved[k] : KEYWAY.DEFAULTS[k];
  });
  return toValues(initial);
}

/** The values after setting `name`: a standard and bore bring the key size; a hand-entered size makes it custom. */
export function applyEdit(values, name, value) {
  const next = { ...values, [name]: value };
  const fill = (o) => { if (o) KEYWAY.SIZE_FIELDS.forEach((k) => { next[k] = toInput(k, o[k]); }); };
  if (name === 'standard' && value !== 'custom') {
    const st = KEYWAY.STANDARDS[value];
    // keep the bore when the new standard covers it, else take the standard's example bore
    if (!KEYWAY.sizeFor(value, Number(next.boreDia))) next.boreDia = String(st.bore);
  }
  if ((name === 'standard' || name === 'boreDia') && next.standard !== 'custom') {
    const s = KEYWAY.sizeFor(next.standard, Number(next.boreDia));
    if (s) {
      fill(s);
      // a tool wider than the new keyway is brought down to it
      if (!(Number(next.toolWidth) <= s.width)) next.toolWidth = String(s.width);
    }
  }
  if (KEYWAY.SIZE_FIELDS.indexOf(name) >= 0 && next.standard !== 'custom') next.standard = 'custom';
  return next;
}

/** Default for one setting; the keyway size follows the standard and bore. */
export function defaultFor(name, values) {
  if (KEYWAY.SIZE_FIELDS.indexOf(name) >= 0) {
    const s = KEYWAY.sizeFor(values.standard, Number(values.boreDia));
    if (s) return s[name];
    return values[name];
  }
  return KEYWAY.DEFAULTS[name];
}

export function defaultFileName(p) {
  // "6 x 2.8 keyway in 20 bore" -> keyway-20-6x2.8.nc
  const n = (v) => String(Math.round(v * 100) / 100);
  return 'keyway-' + n(p.boreDia) + '-' + n(p.width) + 'x' + n(p.depth) + (p.keyways > 1 ? '-' + p.keyways + 'x' : '') + '.nc';
}
