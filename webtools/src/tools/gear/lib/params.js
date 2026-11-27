/* Settings: form values (strings and booleans, as the inputs hold them) <-> generator params. */
import HTD from './htd.js';

export const STORE_KEY = 'htd5m-settings';
export const FIELD_NAMES = Object.keys(HTD.DEFAULTS);

// Browser storage can be missing or throw (private windows, blocked site data), so every access is guarded.
export function loadItem(key, fallback) {
  try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
export function storeItem(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}
export function loadJSON(key, fallback) {
  try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? fallback : v; } catch (e) { return fallback; }
}

// What an input holds for a setting value.
export function toInput(name, v) {
  return typeof HTD.DEFAULTS[name] === 'boolean' ? !!v : String(v);
}

export function toValues(params) {
  var out = {};
  FIELD_NAMES.forEach(function (k) { if (params[k] !== undefined) out[k] = toInput(k, params[k]); });
  return out;
}

// Numeric settings (number boxes and the +1/-1 selects) come back as numbers, NaN when empty.
export function toParams(values) {
  var p = {};
  FIELD_NAMES.forEach(function (k) {
    var d = HTD.DEFAULTS[k], v = values[k];
    if (typeof d === 'boolean') p[k] = !!v;
    else if (typeof d === 'number') p[k] = v === '' || v === undefined ? NaN : Number(v);
    else p[k] = v === undefined ? '' : v;
  });
  return p;
}

export function initialValues() {
  var saved = loadJSON(STORE_KEY, {}), initial = {};
  if (!saved || typeof saved !== 'object') saved = {};
  FIELD_NAMES.forEach(function (k) {
    initial[k] = saved[k] !== undefined && saved[k] !== null ? saved[k] : HTD.DEFAULTS[k];
  });
  return toValues(initial);
}

export function profileOf(values) {
  return HTD.PROFILES[values.profile] || HTD.PROFILES[HTD.DEFAULTS.profile];
}

// Default for one setting; the groove settings follow the chosen belt and groove form.
export function defaultFor(name, values) {
  if (HTD.PROFILE_FIELDS.indexOf(name) === -1) return HTD.DEFAULTS[name];
  return HTD.profileSettings(values.profile, values.grooveForm)[name];
}

export function defaultFileName(p) {
  var prof = HTD.PROFILES[p.profile];
  return (prof ? prof.label : 'pulley').toLowerCase().replace(/\s+/g, '') + '-' + p.teeth + 't.nc';
}
