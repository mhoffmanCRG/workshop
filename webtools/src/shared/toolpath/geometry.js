/*
 * 2D toolpath geometry for the toolpath pages. A path is a list of segments:
 *   { t: 'L', x0, y0, x1, y1 }            straight line
 *   { t: 'A', cx, cy, r, a0, turn }       arc from angle a0, sweeping turn radians (positive anticlockwise)
 * Rounded rectangles cover rectangles (r = 0), circles (r = half the size) and slots (r = half the width).
 */
const TAU = 2 * Math.PI;

export function segStart(s) {
  return s.t === 'L' ? [s.x0, s.y0] : [s.cx + s.r * Math.cos(s.a0), s.cy + s.r * Math.sin(s.a0)];
}
export function segEnd(s) {
  return s.t === 'L' ? [s.x1, s.y1] : [s.cx + s.r * Math.cos(s.a0 + s.turn), s.cy + s.r * Math.sin(s.a0 + s.turn)];
}
export function segLen(s) {
  return s.t === 'L' ? Math.hypot(s.x1 - s.x0, s.y1 - s.y0) : Math.abs(s.turn) * s.r;
}
export function pathLen(path) {
  return path.reduce((a, s) => a + segLen(s), 0);
}

/** The part of a segment from fraction f0 to f1 of its length. */
export function sliceSeg(s, f0, f1) {
  if (s.t === 'L') {
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
    return { t: 'L', x0: s.x0 + dx * f0, y0: s.y0 + dy * f0, x1: s.x0 + dx * f1, y1: s.y0 + dy * f1 };
  }
  return { ...s, a0: s.a0 + s.turn * f0, turn: s.turn * (f1 - f0) };
}

export function reversePath(path) {
  return path.slice().reverse().map((s) => (s.t === 'L'
    ? { t: 'L', x0: s.x1, y0: s.y1, x1: s.x0, y1: s.y0 }
    : { ...s, a0: s.a0 + s.turn, turn: -s.turn }));
}

/** Turn a path by rot (radians) about the origin, then move it to (cx, cy). */
export function placePath(path, cx, cy, rot) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const tp = (x, y) => [cx + x * c - y * sn, cy + x * sn + y * c];
  return path.map((s) => {
    if (s.t === 'L') {
      const a = tp(s.x0, s.y0), b = tp(s.x1, s.y1);
      return { t: 'L', x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
    }
    const q = tp(s.cx, s.cy);
    return { ...s, cx: q[0], cy: q[1], a0: s.a0 + rot };
  });
}

/**
 * Closed rounded rectangle w × h with corner radius r, centred on the origin, starting at the middle of
 * its right-hand side (w/2, 0) and going anticlockwise (ccw) or clockwise. Zero-length sides are left
 * out and arcs about the same centre joined, so a circle is one full-turn arc.
 */
export function roundedRect(w, h, r, ccw) {
  const a = w / 2, b = h / 2;
  r = Math.max(0, Math.min(r, a, b));
  const ex = a - r, ey = b - r, segs = [];
  const line = (x0, y0, x1, y1) => { if (Math.hypot(x1 - x0, y1 - y0) > 1e-9) segs.push({ t: 'L', x0, y0, x1, y1 }); };
  const arc = (cx, cy, a0) => { if (r > 1e-9) segs.push({ t: 'A', cx, cy, r, a0, turn: Math.PI / 2 }); };
  line(a, 0, a, ey);
  arc(ex, ey, 0);
  line(ex, b, -ex, b);
  arc(-ex, ey, Math.PI / 2);
  line(-a, ey, -a, -ey);
  arc(-ex, -ey, Math.PI);
  line(-ex, -b, ex, -b);
  arc(ex, -ey, 1.5 * Math.PI);
  line(a, -ey, a, 0);
  // join neighbouring arcs about one centre (a circle becomes one arc). The first and last stay
  // apart even about one centre (a slot's end), so the path still starts at (w/2, 0).
  const out = [];
  segs.forEach((s) => {
    const p = out[out.length - 1];
    if (p && p.t === 'A' && s.t === 'A' && Math.hypot(p.cx - s.cx, p.cy - s.cy) < 1e-9) p.turn += s.turn;
    else out.push({ ...s });
  });
  return ccw ? out : reversePath(out);
}

/** Points along a path, arcs split finely enough to look round. */
export function samplePath(path, closed) {
  const pts = [];
  path.forEach((s, i) => {
    if (i === 0) pts.push(segStart(s));
    if (s.t === 'L') pts.push([s.x1, s.y1]);
    else {
      const n = Math.max(2, Math.ceil(Math.abs(s.turn) / TAU * 72));
      for (let k = 1; k <= n; k++) {
        const t = s.a0 + s.turn * k / n;
        pts.push([s.cx + s.r * Math.cos(t), s.cy + s.r * Math.sin(t)]);
      }
    }
  });
  if (closed && pts.length) pts.push(pts[0].slice());
  return pts;
}

/** Cut along a path at one Z, starting where it starts (the builder must already be there). */
export function emitPath(b, path, z, F) {
  path.forEach((s) => {
    if (s.t === 'L') b.line({ X: s.x1, Y: s.y1, Z: z }, F);
    else b.arc(s.cx, s.cy, s.turn, z, F);
  });
}

/**
 * One closed contour at a depth, from the point s0 mm along it (where the builder must already be):
 * ramps down along the contour from zStart to zEnd over `ramp` mm of travel (0 = plunge straight down
 * first), then goes on at zEnd for `len` mm more (default once all the way round). Along tab stretches
 * ([[s0, s1], ...] measured along the path) it rises to tabZ when the cut is lower than that.
 * Returns how far along the contour it stopped, for the next level to carry on from.
 */
export function emitContour(b, path, o) {
  const L = pathLen(path), starts = [];
  let acc = 0;
  path.forEach((s) => { starts.push(acc); acc += segLen(s); });
  const s0 = o.s0 || 0;
  const drop = o.zStart - o.zEnd;
  const R = drop > 1e-9 && o.ramp > 0 ? o.ramp : 0;
  if (drop > 1e-9 && !R) b.line({ Z: o.zEnd }, o.plungeF);
  const total = R + (o.len !== undefined ? o.len : L);
  const tabs = o.tabs || [], tabZ = o.tabZ;
  const zr = (u) => (u < R ? o.zStart - drop * u / R : o.zEnd);
  const inTab = (u) => {
    const s = (((s0 + u) % L) + L) % L;
    return tabs.some(([a, c]) => s > a + 1e-9 && s < c - 1e-9);
  };
  // break points, in travel from s0: segment ends on every lap, tab edges, the end of the ramp
  const br = new Set([0, total, R]);
  for (let k = -1; k * L < s0 + total + 1e-9; k++) {
    starts.forEach((a) => br.add(k * L + a - s0));
    tabs.forEach(([a, c]) => { br.add(k * L + a - s0); br.add(k * L + c - s0); });
  }
  const pts = [...br].filter((u) => u >= 0 && u <= total + 1e-9).sort((x, y) => x - y);
  for (let i = 0; i + 1 < pts.length; i++) {
    const u0 = pts[i], u1 = Math.min(pts[i + 1], total);
    if (u1 - u0 < 1e-7) continue;
    const mid = (u0 + u1) / 2, absMid = s0 + mid, lap = Math.floor(absMid / L) * L, sMid = absMid - lap;
    let k = 0;
    while (k + 1 < path.length && starts[k + 1] <= sMid) k++;
    const seg = path[k], len = segLen(seg);
    const f0 = Math.max(0, (s0 + u0 - lap - starts[k]) / len), f1 = Math.min(1, (s0 + u1 - lap - starts[k]) / len);
    const raised = tabZ !== undefined && inTab(mid) && tabZ > zr(mid);
    const zA = raised ? tabZ : zr(u0), zB = raised ? tabZ : zr(u1);
    if (Math.abs(b.pos().Z - zA) > 1e-6) b.line({ Z: zA }, zA > b.pos().Z ? o.F : o.plungeF);
    const piece = sliceSeg(seg, f0, f1);
    if (piece.t === 'L') b.line({ X: piece.x1, Y: piece.y1, Z: zB }, o.F);
    else b.arc(piece.cx, piece.cy, piece.turn, zB, o.F);
  }
  if (Math.abs(b.pos().Z - o.zEnd) > 1e-6) b.line({ Z: o.zEnd }, o.plungeF);
  return (s0 + total) % L;
}

/** Equally spaced tab stretches along a closed path of length L: count tabs, each `width` long. */
export function tabStretches(L, count, width) {
  const out = [];
  if (!(count > 0) || !(width > 0) || width * count >= L) return out;
  for (let i = 0; i < count; i++) {
    const c = (i + 0.5) * L / count;
    out.push([c - width / 2, c + width / 2]);
  }
  return out;
}
