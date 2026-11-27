/*
 * G-code builder for the toolpath pages (Facing, Pocket, Profile, Bore, Drilling, Slot). It writes the
 * program text and records every move the control makes, so the preview can play it back and the
 * time calculator can time it. No DOM access here, so it also loads in Node.
 *
 * Moves: { line, kind, X, Y, Z, dt, feat, done, deep, arc? }
 *   kind  'rapid' (G0), 'move' (feed move in the clear), 'cut', 'finish' (finish pass), 'dwell'
 *   feat  the feature being cut (pocket, hole, pass...), -1 for none; done: features finished before it
 *   deep  the lowest Z cut on that feature before this move (for the section drawing)
 *   arc   { cx, cy, r, a0, turn, z0, dz } for G2 / G3 (turn in radians, positive anticlockwise)
 * Time and distance go into buckets named after the phase (b.phase), plus 'rapid' and 'dwell'.
 */
export function fmt(v, dp) {
  const s = v.toFixed(dp);
  return parseFloat(s) === 0 ? (0).toFixed(dp) : s;
}

/** p: { rapidRate, feedOverride } from the time calculator. */
export function createProgram(p) {
  const lines = [], moves = [], deep = [];
  const time = {}, dist = {};
  const feedScale = p.feedOverride / 100;
  let pos = { X: undefined, Y: undefined, Z: undefined };
  let txt = {}, feedWord = null;

  const b = { phase: 'cut', feat: -1, done: 0 };

  function add(bucket, minutes, len) {
    time[bucket] = (time[bucket] || 0) + minutes;
    dist[bucket] = (dist[bucket] || 0) + len;
  }
  function known(q) { return q.X !== undefined && q.Y !== undefined && q.Z !== undefined; }
  function resolve(t) {
    return { X: t.X !== undefined ? t.X : pos.X, Y: t.Y !== undefined ? t.Y : pos.Y, Z: t.Z !== undefined ? t.Z : pos.Z };
  }
  function kindOf(F) {
    if (!F) return 'rapid';
    return b.phase === 'move' ? 'move' : b.phase === 'finish' ? 'finish' : 'cut';
  }
  // A move the control makes. It points at the G-code line written next.
  function record(to, F, len, arc, noOverride) {
    const from = pos, ok = known(from), kind = kindOf(F);
    const minutes = !ok ? 0 : F ? len / (F * (noOverride ? 1 : feedScale)) : len / p.rapidRate;
    if (ok) add(F ? b.phase : 'rapid', minutes, len);
    const f = b.feat;
    const m = { line: lines.length, kind, X: to.X, Y: to.Y, Z: to.Z, dt: minutes, feat: f, done: b.done,
      deep: f >= 0 && deep[f] !== undefined ? deep[f] : Infinity };
    if (arc) m.arc = arc;
    if ((kind === 'cut' || kind === 'finish') && f >= 0) {
      deep[f] = Math.min(deep[f] !== undefined ? deep[f] : Infinity, to.Z, from.Z !== undefined ? from.Z : Infinity);
    }
    moves.push(m);
    pos = to;
    return m;
  }
  function words(t, all) {
    const ws = [];
    ['X', 'Y', 'Z'].forEach((k) => {
      if (t[k] === undefined) return;
      const s = fmt(t[k], 4);
      if (!all && txt[k] === s) return;
      txt[k] = s;
      ws.push(k + s);
    });
    return ws;
  }
  function feedText(F) {
    if (feedWord === F) return '';
    feedWord = F;
    return ' F' + fmt(F, 0);
  }

  b.raw = (s) => { lines.push(s); };
  b.comment = (s) => { lines.push('(' + String(s).replace(/[()]/g, '') + ')'); };
  b.pos = () => ({ ...pos });

  b.rapid = (t) => {
    const to = resolve(t), ws = words(t);
    if (!ws.length) return;
    const len = known(pos) ? Math.hypot(to.X - pos.X, to.Y - pos.Y, to.Z - pos.Z) : 0;
    record(to, 0, len);
    lines.push('G0 ' + ws.join(' '));
  };

  b.line = (t, F) => {
    const to = resolve(t), ws = words(t);
    if (!ws.length) return;
    const len = Math.hypot(to.X - pos.X, to.Y - pos.Y, to.Z - pos.Z);
    record(to, F, len);
    lines.push('G1 ' + ws.join(' ') + feedText(F));
  };

  /**
   * Arc (a helix when z changes) about (cx, cy) from the current position, sweeping `turn` radians
   * (positive anticlockwise, G3). The end point is worked out here, so it always lies on the arc.
   */
  b.arc = (cx, cy, turn, z, F) => {
    const r = Math.hypot(pos.X - cx, pos.Y - cy), a0 = Math.atan2(pos.Y - cy, pos.X - cx);
    const zEnd = z !== undefined ? z : pos.Z;
    const to = { X: cx + r * Math.cos(a0 + turn), Y: cy + r * Math.sin(a0 + turn), Z: zEnd };
    if (Math.abs(turn) < 1e-9 || r < 1e-6) { b.line(to, F); return; }
    const i = cx - pos.X, j = cy - pos.Y, dz = zEnd - pos.Z;
    const ws = words(to, true);         // full circles repeat the start point, so every word goes out
    const len = Math.hypot(Math.abs(turn) * r, dz);
    record(to, F, len, { cx, cy, r, a0, turn, z0: pos.Z, dz });
    lines.push((turn > 0 ? 'G3 ' : 'G2 ') + ws.join(' ') + ' I' + fmt(i, 4) + ' J' + fmt(j, 4) + feedText(F));
  };

  /** A move the control makes inside a canned cycle: recorded, but writes no line. */
  b.sim = (t, F, noOverride) => {
    const to = resolve(t);
    const len = known(pos) ? Math.hypot(to.X - pos.X, to.Y - pos.Y, to.Z - pos.Z) : 0;
    if (known(pos) && len < 1e-9) return;
    record(to, F, len, null, noOverride);
  };

  b.pause = (seconds, bucket) => {
    const m = { line: lines.length, kind: 'dwell', X: pos.X, Y: pos.Y, Z: pos.Z, dt: seconds / 60, feat: b.feat, done: b.done,
      deep: b.feat >= 0 && deep[b.feat] !== undefined ? deep[b.feat] : Infinity };
    moves.push(m);
    add(bucket || 'dwell', seconds / 60, 0);
  };

  /** After a canned cycle or a raw motion line the written words and feed are no longer known. */
  b.forget = () => { txt = {}; feedWord = null; };

  /** The finished program: G-code text, playback data and the time and distance per bucket. */
  b.finish = () => {
    const first = moves.find((m) => known(m)) || { X: 0, Y: 0, Z: 0 };
    let last = { X: first.X, Y: first.Y, Z: first.Z }, clock = 0;
    const out = moves.map((m, i) => {
      ['X', 'Y', 'Z'].forEach((k) => { if (m[k] === undefined) m[k] = last[k]; });
      const o = { ...m, i, t0: clock, t1: clock + m.dt };
      last = m; clock += m.dt;
      return o;
    });
    let minutes = 0;
    Object.keys(time).forEach((k) => { minutes += time[k]; });
    return {
      gcode: lines.join('\n') + '\n',
      program: { start: { X: first.X, Y: first.Y, Z: first.Z }, moves: out, total: clock },
      stats: { lines: lines.length, minutes, time, dist }
    };
  };

  return b;
}
