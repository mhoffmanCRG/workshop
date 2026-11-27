/*
 * The two 2D drawings of a toolpath page, both to scale, drawn from the generator's r.scene:
 *   drawTop      seen from above: the stock, the outlines of what is cut, the toolpath, the area the
 *                cutter has swept so far (all of it with no playback) and the cutter
 *   drawSection  a section through the part: the stock with the cuts as deep as they are so far, the
 *                safe and depth levels and the cutter. It follows the cutter when the part is wide.
 *
 * r.scene: {
 *   stock: { x0, x1, y0, y1, zTop, zBottom } (a block) or { cx, cy, r, zTop, zBottom } (a round)
 *   outlines: [{ pts: [[x, y]...], role: 'part' | 'cut' | 'hole' | 'guide', z1?, feat?, sel? }]
 *   dims: [{ sel, a: [x, y], b: [x, y], text }]        top view dimensions, shown for the selected tile
 *   labels: [{ text, sel? }], note: text                corner labels on the top view
 *   section: { axis: 'X' | 'Y', at, title, cuts: [{ u0, u1, z, feat }], levels: [{ z, text, role, sel? }],
 *              dims: [{ sel, u, z0, z1, text } | { sel, z, u0, u1, text }] }
 *   tool: { dia, kind: 'mill' | 'drill' | 'tap', tipLen?, pitch? }, rest: { X, Y, Z }
 * }
 * opts: { selected tile, showZero, pose } where pose is the playback or machine position
 * { X, Y, Z, move } or null. Both allow for zero-size canvases (the AXIS tab lays them out late).
 */
import { movePoints } from './view3d.js';

function prep(canvas) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function colours() {
  const cs = getComputedStyle(document.documentElement), c = {};
  ['metal', 'metal-edge', 'cut', 'finish', 'rough', 'muted', 'text', 'accent', 'mark', 'panel', 'cutter-3d', 'axis-x', 'axis-y', 'axis-z'].forEach((k) => {
    c[k] = cs.getPropertyValue('--' + k).trim();
  });
  return c;
}

// Label with a backing patch so it stays readable over the drawing.
function tag(ctx, c, text, x, y, align, colour) {
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width, x0 = align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x;
  ctx.fillStyle = c.panel; ctx.globalAlpha = 0.85; ctx.fillRect(x0 - 3, y - 8, tw + 6, 16); ctx.globalAlpha = 1;
  ctx.fillStyle = colour || c.text; ctx.fillText(text, x, y);
  ctx.restore();
}

// Dimension line between two points with arrow heads and a label at its middle.
function dim(ctx, c, x0, y0, x1, y1, text, colour) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const d = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / d, uy = (y1 - y0) / d;
  [[x0, y0, 1], [x1, y1, -1]].forEach(([x, y, s]) => {
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + s * ux * 7 - uy * 3, y + s * uy * 7 + ux * 3); ctx.lineTo(x + s * ux * 7 + uy * 3, y + s * uy * 7 - ux * 3);
    ctx.closePath(); ctx.fill();
  });
  ctx.restore();
  const vertical = Math.abs(uy) > 0.7;
  tag(ctx, c, text, (x0 + x1) / 2 + (vertical ? 6 : 0), (y0 + y1) / 2 - (vertical ? 0 : 10), vertical ? 'left' : 'center', colour);
}

// Program zero: the quartered-circle datum mark with an arrow along each axis in the drawing.
function drawZero(ctx, c, px, py, axes) {
  ctx.save();
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  axes.forEach((a) => {
    const len = 26, head = 6, ex = px + a.dx * len, ey = py + a.dy * len, colour = c['axis-' + a.letter.toLowerCase()];
    ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex + a.dx * head, ey + a.dy * head);
    ctx.lineTo(ex - a.dy * head * 0.5, ey + a.dx * head * 0.5); ctx.lineTo(ex + a.dy * head * 0.5, ey - a.dx * head * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = c.panel;
    ctx.strokeText(a.letter, ex + a.dx * (head + 9), ey + a.dy * (head + 9));
    ctx.fillText(a.letter, ex + a.dx * (head + 9), ey + a.dy * (head + 9));
  });
  const rad = 6;
  ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(px, py, rad, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = c.text;
  [0, Math.PI].forEach((a0) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, rad, a0, a0 + Math.PI / 2); ctx.closePath(); ctx.fill(); });
  ctx.strokeStyle = c.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, rad, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}

function message(ctx, c, w, h, text) {
  ctx.fillStyle = c.muted; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}

// The toolpath as XY polylines, one per move, worked out once per result.
const pathCache = new WeakMap();
function movePolys(r) {
  let polys = pathCache.get(r);
  if (polys) return polys;
  const P = r.program;
  let from = P.start;
  polys = P.moves.map((m) => {
    const pts = m.kind === 'dwell' ? [] : movePoints(from, m);
    const o = { i: m.i, kind: m.kind, pts, low: Math.min(from.Z, m.Z) < r.scene.stock.zTop - 1e-6 };
    from = m;
    return o;
  });
  pathCache.set(r, polys);
  return polys;
}

function stockBounds(s) {
  return s.r !== undefined ? [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r] : [s.x0, s.y0, s.x1, s.y1];
}

// How deep a feature is cut so far: all the way with no playback, else as deep as the cutter has been.
function depthSoFar(cut, pose, zTop) {
  if (!pose || !pose.move) return cut.z;
  const m = pose.move, f = cut.feat !== undefined ? cut.feat : 0;
  if (f < m.done) return cut.z;
  if (m.feat === f) {
    const cutting = m.kind === 'cut' || m.kind === 'finish';
    return Math.max(cut.z, Math.min(zTop, m.deep, cutting ? pose.Z : Infinity));
  }
  return zTop;
}

// ---------------------------------------------------------------- top view

export function drawTop(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const s = r.scene, sel = opts.selected, pose = opts.pose, rt = s.tool.dia / 2;
  const polys = movePolys(r);

  // fit the stock, the outlines and the cutting moves
  const b = stockBounds(s.stock);
  const grow = (x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); };
  s.outlines.forEach((o) => o.pts.forEach((q) => grow(q[0], q[1])));
  polys.forEach((q) => { if (q.kind !== 'rapid') q.pts.forEach((v) => { grow(v[0] - rt, v[1] - rt); grow(v[0] + rt, v[1] + rt); }); });
  const bw = Math.max(b[2] - b[0], 1), bh = Math.max(b[3] - b[1], 1);
  const top = 40, pad = 14;
  const scale = Math.min((w - 2 * pad) / bw, (h - top - pad) / bh);
  const ox = (w - bw * scale) / 2 - b[0] * scale, oy = top + (h - top - pad - bh * scale) / 2 + b[3] * scale;
  const X = (x) => ox + x * scale, Y = (y) => oy - y * scale;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // stock
  const st = s.stock;
  ctx.beginPath();
  if (st.r !== undefined) ctx.arc(X(st.cx), Y(st.cy), st.r * scale, 0, 2 * Math.PI);
  else ctx.rect(X(st.x0), Y(st.y1), (st.x1 - st.x0) * scale, (st.y1 - st.y0) * scale);
  ctx.fillStyle = c.metal; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();

  // the area swept by the cutter below the top so far
  const upto = pose && pose.move ? pose.move.i : Infinity;
  const swept = new Path2D();
  polys.forEach((q) => {
    if (!q.low || q.i > upto || (q.kind !== 'cut' && q.kind !== 'finish')) return;
    let pts = q.pts;
    if (q.i === upto && pose) pts = pts.slice(0, -1).concat([[pose.X, pose.Y]]);
    const flat = pts.every((v) => Math.abs(v[0] - pts[0][0]) < 1e-6 && Math.abs(v[1] - pts[0][1]) < 1e-6);
    // a straight plunge has no length to stroke: a tiny ring stroked as wide as the cutter shows it
    if (flat) { swept.moveTo(X(pts[0][0]) + 0.1, Y(pts[0][1])); swept.arc(X(pts[0][0]), Y(pts[0][1]), 0.1, 0, 2 * Math.PI); return; }
    pts.forEach((v, k) => { if (k) swept.lineTo(X(v[0]), Y(v[1])); else swept.moveTo(X(v[0]), Y(v[1])); });
  });
  ctx.save();
  ctx.strokeStyle = c.cut; ctx.globalAlpha = 0.28; ctx.lineWidth = Math.max(1, 2 * rt * scale); ctx.stroke(swept);
  ctx.restore();

  // outlines of the job
  const outline = (o) => {
    const on = sel && o.sel === sel;
    ctx.beginPath();
    o.pts.forEach((v, k) => { if (k) ctx.lineTo(X(v[0]), Y(v[1])); else ctx.moveTo(X(v[0]), Y(v[1])); });
    if (o.role === 'guide') { ctx.setLineDash([8, 3, 2, 3]); ctx.strokeStyle = on ? c.mark : c.muted; ctx.lineWidth = on ? 1.8 : 1; }
    else if (o.role === 'cut') { ctx.setLineDash([]); ctx.strokeStyle = on ? c.mark : c.cut; ctx.lineWidth = on ? 2 : 1.4; }
    else { ctx.setLineDash([]); ctx.strokeStyle = on ? c.mark : c['metal-edge']; ctx.lineWidth = on ? 2 : 1.4; }
    ctx.stroke(); ctx.setLineDash([]);
  };
  s.outlines.forEach(outline);

  // toolpath
  const style = { rapid: [c.muted, 1, [4, 4]], move: [c.finish, 1, null], cut: [c.cut, 1, null], finish: [c.finish, 1.4, null] };
  ['rapid', 'move', 'cut', 'finish'].forEach((kind) => {
    const [colour, lw, dash] = style[kind];
    ctx.beginPath();
    polys.forEach((q) => {
      if (q.kind !== kind) return;
      q.pts.forEach((v, k) => { if (k) ctx.lineTo(X(v[0]), Y(v[1])); else ctx.moveTo(X(v[0]), Y(v[1])); });
    });
    ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.globalAlpha = kind === 'rapid' ? 0.7 : 0.85;
    ctx.stroke();
  });
  ctx.globalAlpha = 1; ctx.setLineDash([]);

  // dimensions for the selected tile
  (s.dims || []).forEach((d) => { if (d.sel === sel) dim(ctx, c, X(d.a[0]), Y(d.a[1]), X(d.b[0]), Y(d.b[1]), d.text, c.mark); });

  // the cutter
  const at = pose || s.rest;
  if (at) {
    ctx.beginPath(); ctx.arc(X(at.X), Y(at.Y), Math.max(rt * scale, 2), 0, 2 * Math.PI);
    ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.text; ctx.lineWidth = 1.2; ctx.stroke();
  }

  (s.labels || []).forEach((l, k) => tag(ctx, c, l.text, 8, 14 + 18 * k, 'left', l.sel && l.sel === sel ? c.mark : k ? c.muted : c.text));
  if (s.note) tag(ctx, c, s.note, w - 8, 14, 'right', c.muted);

  if (opts.showZero !== false) {
    const zx = X(0), zy = Y(0);
    if (zx > 10 && zx < w - 10 && zy > 10 && zy < h - 10) drawZero(ctx, c, zx, zy, [{ letter: 'X', dx: 1, dy: 0 }, { letter: 'Y', dx: 0, dy: -1 }]);
  }
}

// ---------------------------------------------------------------- section

export function drawSection(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const s = r.scene, sec = s.section, st = s.stock, sel = opts.selected, pose = opts.pose;
  const tool = s.tool, rt = tool.dia / 2, ax = sec.axis;
  const at = pose || s.rest;
  const toolU = at ? at[ax] : null, toolZ = at ? at.Z : s.rest.Z;

  // the stock along the section line
  let u0, u1;
  if (st.r !== undefined) {
    const off = ax === 'X' ? sec.at - st.cy : sec.at - st.cx, half = Math.sqrt(Math.max(0, st.r * st.r - off * off));
    const cc = ax === 'X' ? st.cx : st.cy;
    u0 = cc - half; u1 = cc + half;
  } else {
    u0 = ax === 'X' ? st.x0 : st.y0; u1 = ax === 'X' ? st.x1 : st.y1;
  }
  let lo = u0, hi = u1;
  sec.cuts.forEach((k) => { lo = Math.min(lo, k.u0); hi = Math.max(hi, k.u1); });
  if (toolU !== null) { lo = Math.min(lo, toolU - rt); hi = Math.max(hi, toolU + rt); }

  const levelZs = sec.levels.map((l) => l.z);
  const zMax = Math.max(st.zTop, toolZ, ...levelZs) + 2;
  const zMin = Math.min(st.zBottom, ...sec.cuts.map((k) => k.z), ...levelZs) - 1;
  const top = 26, bottom = 8;
  // the whole width when that leaves the depths readable, else zoomed in on the cutter
  const scaleV = (h - top - bottom) / (zMax - zMin), scaleH = (w - 16) / Math.max(hi - lo, 1);
  const scale = Math.min(scaleV, Math.max(scaleH, scaleV * 0.35));
  const span = (w - 16) / scale;
  let centre = (lo + hi) / 2;
  if (hi - lo > span) centre = Math.min(hi - span / 2, Math.max(lo + span / 2, toolU !== null ? toolU : centre));
  const U = (u) => w / 2 + (u - centre) * scale, Z = (z) => top + (zMax - z) * scale;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // stock with the cuts taken out of it
  const rect = [U(u0), Z(st.zTop), (u1 - u0) * scale, (st.zTop - st.zBottom) * scale];
  ctx.fillStyle = c.metal; ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
  ctx.save();
  ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
  sec.cuts.forEach((k) => {
    const d = depthSoFar(k, pose, st.zTop);
    if (d >= st.zTop - 1e-6) return;
    ctx.fillStyle = c.panel; ctx.fillRect(U(k.u0), Z(st.zTop + 1), (k.u1 - k.u0) * scale, (st.zTop + 1 - d) * scale);
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.strokeRect(U(k.u0), Z(st.zTop + 1), (k.u1 - k.u0) * scale, (st.zTop + 1 - d) * scale);
  });
  ctx.restore();
  ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);

  // levels
  const role = { clear: c.muted, retract: c.finish, level: c.rough, bottom: c.cut, top: c.muted };
  sec.levels.forEach((l) => {
    const on = l.sel && l.sel === sel, colour = on ? c.mark : role[l.role] || c.muted;
    ctx.setLineDash(l.role === 'level' ? [2, 3] : [5, 4]); ctx.strokeStyle = colour; ctx.lineWidth = on ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(0, Z(l.z)); ctx.lineTo(w, Z(l.z)); ctx.stroke(); ctx.setLineDash([]);
    if (l.text) tag(ctx, c, l.text, w - 8, Z(l.z) + (l.role === 'bottom' ? 10 : -9), 'right', colour);
  });

  // the cutter
  if (toolU !== null) {
    const x = toolU, bodyTop = zMax + 10;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.beginPath();
    if (tool.kind === 'drill') {
      ctx.moveTo(U(x), Z(toolZ)); ctx.lineTo(U(x + rt), Z(toolZ + tool.tipLen)); ctx.lineTo(U(x + rt), Z(bodyTop));
      ctx.lineTo(U(x - rt), Z(bodyTop)); ctx.lineTo(U(x - rt), Z(toolZ + tool.tipLen));
    } else {
      ctx.rect(U(x - rt), Z(bodyTop), 2 * rt * scale, (bodyTop - toolZ) * scale);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = c.text; ctx.globalAlpha = 0.5;
    const stepZ = tool.kind === 'tap' ? tool.pitch * 2 : tool.dia * 0.9, z0 = toolZ + (tool.kind === 'drill' ? tool.tipLen : 0);
    for (let z = z0 + stepZ * 0.5; z < bodyTop; z += stepZ) {
      ctx.beginPath(); ctx.moveTo(U(x - rt), Z(z)); ctx.lineTo(U(x + rt), Z(z + stepZ * 0.5)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  (sec.dims || []).forEach((d) => {
    if (d.sel !== sel) return;
    if (d.u !== undefined) dim(ctx, c, U(d.u), Z(d.z0), U(d.u), Z(d.z1), d.text, c.mark);
    else dim(ctx, c, U(d.u0), Z(d.z), U(d.u1), Z(d.z), d.text, c.mark);
  });

  tag(ctx, c, sec.title, 8, 13, 'left', c.text);

  if (opts.showZero !== false && Z(0) > 10 && Z(0) < h - 10) {
    const zx = U(0) > 20 && U(0) < w - 60 ? U(0) : 24;
    drawZero(ctx, c, zx, Z(0), [{ letter: ax, dx: 1, dy: 0 }, { letter: 'Z', dx: 0, dy: -1 }]);
  }
}
