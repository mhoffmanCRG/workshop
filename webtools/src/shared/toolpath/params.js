/*
 * Settings for a toolpath page: form values (strings and booleans, as the inputs hold them) <->
 * generator params, from the page's DEFAULTS, remembered in browser storage under storeKey.
 */
import { loadJSON } from '../storage.js';

export function makeParams(DEFAULTS, storeKey) {
  const names = Object.keys(DEFAULTS);
  const toInput = (name, v) => (typeof DEFAULTS[name] === 'boolean' ? !!v : String(v));
  function toValues(params) {
    const out = {};
    names.forEach((k) => { if (params[k] !== undefined) out[k] = toInput(k, params[k]); });
    return out;
  }
  // numeric settings come back as numbers, NaN when empty
  function toParams(values) {
    const p = {};
    names.forEach((k) => {
      const d = DEFAULTS[k], v = values[k];
      if (typeof d === 'boolean') p[k] = !!v;
      else if (typeof d === 'number') p[k] = v === '' || v === undefined ? NaN : Number(v);
      else p[k] = v === undefined ? '' : v;
    });
    return p;
  }
  function initialValues() {
    let saved = loadJSON(storeKey, {});
    if (!saved || typeof saved !== 'object') saved = {};
    const initial = {};
    names.forEach((k) => {
      const s = saved[k];
      initial[k] = s !== undefined && s !== null && typeof s === typeof DEFAULTS[k] && !(typeof s === 'number' && !isFinite(s)) ? s : DEFAULTS[k];
    });
    return toValues(initial);
  }
  return { storeKey, toInput, toValues, toParams, initialValues, defaultFor: (n) => DEFAULTS[n] };
}
