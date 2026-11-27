/*
 * Browser storage for remembered settings. It can be missing or throw (private windows, blocked
 * site data), so every access is guarded and falls back to the default.
 */
export function loadItem(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
export function storeItem(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}
export function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? fallback : v; } catch (e) { return fallback; }
}
