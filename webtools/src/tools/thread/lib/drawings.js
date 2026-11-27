/*
 * The two 2D drawings, both to scale:
 *   drawTop      one thread seen from above: hole or boss, the pass circles, lead arcs and the cutter
 *   drawSection  a section through the wall at the top of the thread: the thread form as cut, the
 *                tip line of each pass and the cutter's teeth
 * State from the page comes in `opts`: { selected tile, showZero, pose } where pose is the playback
 * or machine position { X, Y, Z, move } (move: the program move it is on), or null.
 * Both allow for zero-size canvases (the AXIS tab lays them out late).
 */

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

function colours() {
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
  tag(ctx, c, text, (x0 + x1) / 2 + (Math.abs(uy) > 0.7 ? 6 : 0), (y0 + y1) / 2 - (Math.abs(uy) > 0.7 ? 0 : 10), Math.abs(uy) > 0.7 ? 'left' : 'center', colour);
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

// Which thread the drawings show: the one the pose is on, else the first.
function holeIndex(r, pose) {
  if (pose && pose.move && pose.move.hole >= 0) return pose.move.hole;
  return 0;
}

// ---------------------------------------------------------------- top view

export function drawTop(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, rt = p.toolDia / 2, sel = opts.selected, pose = opts.pose;
  const hi = holeIndex(r, pose), ctr = g.centres[hi];
  const fin = r.passes[p.passes - 1], re = g.leadRadius[p.passes - 1];
  // the furthest anything reaches from the thread centre: cutter on its path, lead-in start, stock
  const leadOut = g.internal ? fin.r : Math.hypot(fin.r + re, re);
  let reach = Math.max(leadOut + rt, (g.internal ? p.holeDia : p.stockDia) / 2 * 1.25);
  if (pose) reach = Math.max(reach, Math.hypot(pose.X - ctr.x, pose.Y - ctr.y) + rt);
  const scale = Math.min(w, h) / 2 / (reach * 1.12);
  if (!(scale > 0)) return;
  const ox = w / 2, oy = h / 2;
  const X = (x) => ox + (x - ctr.x) * scale, Y = (y) => oy - (y - ctr.y) * scale;
  const ring = (rad, colour, width, dash, fill) => {
    ctx.beginPath(); ctx.arc(ox, oy, Math.max(0, rad * scale), 0, 2 * Math.PI);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (colour) { ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); }
  };
  const mark = (id, colour) => (sel === id ? c.mark : colour);

  // the part
  if (g.internal) {
    ctx.fillStyle = c.metal; ctx.fillRect(0, 0, w, h);
    ring(p.holeDia / 2, mark('prep', c['metal-edge']), sel === 'prep' ? 2.5 : 1.5, null, c.panel);
  } else {
    ring(p.stockDia / 2, mark('prep', c['metal-edge']), sel === 'prep' ? 2.5 : 1.5, null, c.metal);
  }
  // diameter the cutter tip reaches at full depth
  ring(g.dFinal / 2, mark('tip', c['metal-edge']), sel === 'tip' ? 2.5 : 1, [5, 4]);

  // pass paths (cutter centre) and the final pass's lead arcs
  r.passes.forEach((ps, i) => {
    if (ps.phase === 'spring') return;
    const final = i === p.passes - 1, colour = sel === 'passes' ? c.mark : final ? c.cut : c.rough;
    ring(ps.r, sel === 'path' && final ? c.mark : colour, final ? 1.8 : 1, final ? null : [4, 3]);
  });
  const turn = g.ccw ? 1 : -1, arcSign = g.internal ? turn : -turn;
  const u = { x: 1, y: 0 }, v = { x: -u.y * turn, y: u.x * turn };
  const out1 = g.internal ? fin.r - re : fin.r + re;
  const ce = { x: ctr.x + out1 * u.x, y: ctr.y + out1 * u.y };
  ctx.strokeStyle = c.cut; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
  const a0 = Math.atan2(-v.y, -v.x), a1 = Math.atan2(v.y, v.x), aMid = g.internal ? 0 : Math.PI;
  // canvas angles run clockwise on screen (y down), so flip the sign of each angle
  ctx.beginPath(); ctx.arc(X(ce.x), Y(ce.y), re * scale, -a0, -aMid, arcSign > 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(ce.x), Y(ce.y), re * scale, -aMid, -a1, arcSign > 0); ctx.stroke();
  if (g.internal) {
    ctx.beginPath(); ctx.moveTo(X(ctr.x), Y(ctr.y)); ctx.lineTo(X(ce.x - re * v.x), Y(ce.y - re * v.y));
    ctx.moveTo(X(ce.x + re * v.x), Y(ce.y + re * v.y)); ctx.lineTo(X(ctr.x), Y(ctr.y)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // direction arrow on the final path, a quarter turn on from the start
  {
    const t = Math.PI / 2 * turn, px = X(ctr.x + fin.r * Math.cos(t)), py = Y(ctr.y + fin.r * Math.sin(t));
    const dx = -Math.sin(t) * turn, dy = Math.cos(t) * turn;      // world direction of travel
    const sx = dx, sy = -dy;                                       // on screen
    ctx.fillStyle = c.cut; ctx.beginPath();
    ctx.moveTo(px + sx * 8, py + sy * 8); ctx.lineTo(px - sx * 4 - sy * 5, py - sy * 4 + sx * 5); ctx.lineTo(px - sx * 4 + sy * 5, py - sy * 4 - sx * 5);
    ctx.closePath(); ctx.fill();
  }
  if (sel === 'path') dim(ctx, c, ox, oy, X(ctr.x + fin.r * Math.cos(-Math.PI / 4)), Y(ctr.y + fin.r * Math.sin(-Math.PI / 4)), 'R ' + fin.r.toFixed(3), c.mark);

  // the cutter: at the pose, or where the final pass meets its path
  const at = pose ? { x: pose.X, y: pose.Y } : { x: ctr.x + fin.r, y: ctr.y };
  ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d'];
  ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), rt * scale, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = sel === 'ratio' ? c.mark : c.text; ctx.lineWidth = sel === 'ratio' ? 2.5 : 1.2;
  ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), rt * scale, 0, 2 * Math.PI); ctx.stroke();
  // the shaft above the teeth, seen through the head (outside it when the shaft is the thicker)
  ctx.setLineDash([3, 3]); ctx.strokeStyle = c.text; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), p.shaftDia / 2 * scale, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), 2, 0, 2 * Math.PI); ctx.fill();

  // labels
  tag(ctx, c, (g.internal ? 'Hole Ø' + p.holeDia.toFixed(2) : 'Stock Ø' + p.stockDia.toFixed(2)), 8, 14, 'left', sel === 'prep' ? c.mark : c.text);
  tag(ctx, c, (g.internal ? 'Major Ø' : 'Root Ø') + g.dFinal.toFixed(3), 8, 32, 'left', sel === 'tip' ? c.mark : c.muted);
  tag(ctx, c, (g.ccw ? 'G3' : 'G2') + (g.rises ? ', bottom up' : ', top down'), w - 8, 14, 'right', c.muted);
  if (g.centres.length > 1) tag(ctx, c, 'Thread ' + (hi + 1) + ' of ' + g.centres.length, w - 8, 32, 'right', c.muted);

  // program zero, if it is in view (it is the thread centre unless the threads are offset)
  if (opts.showZero !== false) {
    const zx = X(0), zy = Y(0);
    if (zx > 10 && zx < w - 10 && zy > 10 && zy < h - 10) drawZero(ctx, c, zx, zy, [{ letter: 'X', dx: 1, dy: 0 }, { letter: 'Y', dx: 0, dy: -1 }]);
  }
}

// ---------------------------------------------------------------- section

/*
 * Section through the wall on the +X side of the thread (where every pass starts), looking along
 * -Y: radius from the thread axis runs right, Z runs up. Shows the top few pitches only, since a
 * long thread would make the form too small to see.
 */
export function drawSection(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, P = p.pitch, rt = p.toolDia / 2, sel = opts.selected, pose = opts.pose;
  const cot = 1 / Math.tan(p.angle * Math.PI / 360);
  const internal = g.internal, sgn = internal ? 1 : -1;
  const rStart = g.dStart / 2, rFinal = g.dFinal / 2;

  // how far each pass has got: tip radius per tooth position, from the pose
  const hi = holeIndex(r, pose), m = pose && pose.move;
  const done = !pose ? r.passes.length : m.hole > hi ? r.passes.length : m.hole < hi ? 0 : m.done;
  let deepest = rStart;
  for (let i = 0; i < done; i++) deepest = internal ? Math.max(deepest, r.passes[i].tipDia / 2) : Math.min(deepest, r.passes[i].tipDia / 2);
  const cur = pose && m.hole === hi && m.pass >= 0 && m.pass >= done ? r.passes[m.pass] : null;
  const curTooth = pose ? pose.Z + p.tipOffset : null;      // lowest tooth centre now
  const span = (p.rows - 1) * P;
  const curCut = cur && m.kind === 'cut';
  function tipAt(zc) {
    let tr = deepest;
    if (curCut) {
      const passed = g.rises ? zc <= curTooth + span + 1e-9 : zc >= curTooth - 1e-9;
      const reached = internal ? Math.hypot(pose.X - g.centres[hi].x, pose.Y - g.centres[hi].y) + rt : Math.hypot(pose.X - g.centres[hi].x, pose.Y - g.centres[hi].y) - rt;
      if (passed) tr = internal ? Math.max(tr, Math.min(reached, cur.tipDia / 2)) : Math.min(tr, Math.max(reached, cur.tipDia / 2));
    }
    return tr;
  }
  // tooth centres where the helix crosses this section
  const teeth = [];
  for (let zc = g.zBottom; zc <= g.zHigh + span + 1e-6; zc += P) teeth.push(zc);

  // window: the top of the thread, a few pitches, and the wall
  const shown = Math.min(p.length, 4.5 * P);
  const zMax = p.zTop + 1.4 * P, zMin = p.zTop - shown - 0.6 * P;
  const depth = Math.max(g.depth, 0.3 * P);
  let rMin = Math.min(rStart, rFinal) - Math.max(1.5 * depth, 0.8 * P), rMax = Math.max(rStart, rFinal) + Math.max(1.5 * depth, 0.8 * P);
  const scale = Math.min(w / (rMax - rMin), (h - 8) / (zMax - zMin));
  if (!(scale > 0)) return;
  const extra = (w / scale - (rMax - rMin)) / 2;
  rMin -= extra; rMax += extra;
  const zMid = (zMax + zMin) / 2;
  const X = (rad) => (rad - rMin) * scale, Y = (z) => h / 2 - (z - zMid) * scale;

  // metal boundary at height z
  const blindZ = internal && p.holeDepth > 0 ? p.zTop - p.holeDepth : -Infinity;
  function edge(z) {
    if (internal) {
      if (z < blindZ) return rMin;
      let b = rStart;
      teeth.forEach((zc) => { const v = tipAt(zc) - Math.abs(z - zc) * cot; if (v > b) b = v; });
      return b;
    }
    let b = rStart;
    teeth.forEach((zc) => { const v = tipAt(zc) + Math.abs(z - zc) * cot; if (v < b) b = v; });
    return b;
  }
  const n = Math.max(50, Math.ceil(h * 1.5)), zTopV = Math.min(p.zTop, zMax);
  ctx.beginPath();
  ctx.moveTo(internal ? w : 0, Y(zTopV));
  for (let i = 0; i <= n; i++) { const z = zTopV - (zTopV - zMin) * i / n; ctx.lineTo(X(edge(z)), Y(z)); }
  ctx.lineTo(internal ? w : 0, Y(zMin));
  ctx.closePath();
  ctx.fillStyle = c.metal; ctx.fill();
  ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();

  // tip line of each pass (full height of the shown thread)
  const tipLine = (rad, colour, width, dash) => {
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(X(rad), Y(p.zTop + 0.5 * P)); ctx.lineTo(X(rad), Y(zMin)); ctx.stroke();
  };
  r.passes.forEach((ps, i) => {
    if (ps.phase === 'spring') return;
    const final = i === p.passes - 1;
    tipLine(ps.tipDia / 2, sel === 'passes' || (sel === 'tip' && final) ? c.mark : final ? c.cut : c.rough, final ? 1.5 : 1, final ? null : [4, 3]);
  });
  tipLine(rStart, sel === 'prep' ? c.mark : c.muted, sel === 'prep' ? 2 : 1, [2, 3]);
  ctx.setLineDash([]);

  // the cutter: axis on its current radius, lowest tooth at its height
  const ctr = g.centres[hi];
  const fin = r.passes[p.passes - 1];
  let axisR, toothZ;
  if (pose) { axisR = Math.hypot(pose.X - ctr.x, pose.Y - ctr.y); toothZ = pose.Z + p.tipOffset; }
  else { axisR = fin.r; toothZ = Math.max(g.zBottom, p.zTop - shown + 0.5 * P); }
  const toothH = Math.min(rt * 0.6, Math.max(depth * 1.15, 0.3));
  const halfBase = Math.min(P * 0.48, toothH / cot);
  const coreR = rt - toothH, tipZ = toothZ - p.tipOffset;
  const headZ = tipZ + r.stats.headLen, holderZ = tipZ + r.stats.stickOut, shaftR = p.shaftDia / 2;
  const topZ = holderZ + Math.max(4 * P, 6);
  // one side of the cutter outline from the tip up, s = distance from the axis
  const side = [[coreR, tipZ]];
  for (let j = 0; j < p.rows; j++) {
    const zc = toothZ + j * P;
    side.push([coreR, zc - halfBase], [rt, zc - halfBase * 0.08], [rt, zc + halfBase * 0.08], [coreR, zc + halfBase]);
  }
  side.push([coreR, headZ], [shaftR, headZ], [shaftR, holderZ]);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.beginPath();
  side.forEach(([s, z], i) => { const x = X(axisR + s * sgn), y = Y(z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  for (let i = side.length - 1; i >= 0; i--) ctx.lineTo(X(axisR - side[i][0] * sgn), Y(side[i][1]));
  ctx.closePath();
  ctx.globalAlpha = 0.55; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
  // the holder face, wider than the shaft
  const holdR = Math.max(rt, shaftR) * 2.2;
  ctx.fillStyle = c.muted; ctx.globalAlpha = 0.35;
  ctx.fillRect(Math.min(X(axisR - holdR), X(axisR + holdR)), Y(topZ), Math.abs(X(axisR + holdR) - X(axisR - holdR)), Y(holderZ) - Y(topZ));
  ctx.globalAlpha = 1; ctx.strokeStyle = c.text;
  ctx.beginPath(); ctx.moveTo(X(axisR - holdR), Y(holderZ)); ctx.lineTo(X(axisR + holdR), Y(holderZ)); ctx.stroke();
  ctx.setLineDash([6, 3, 1, 3]); ctx.strokeStyle = c.muted;
  ctx.beginPath(); ctx.moveTo(X(axisR), Y(tipZ - 1)); ctx.lineTo(X(axisR), Y(topZ + 1)); ctx.stroke();
  ctx.restore();

  // top face (on the right, clear of the zero mark on the thread axis)
  tag(ctx, c, 'Top Z' + p.zTop.toFixed(2), w - 8, Y(p.zTop) - 10, 'right', c.muted);

  // dimensions for the selected tile
  const near = teeth.filter((zc) => zc <= p.zTop && zc >= zMin).sort((a, b) => b - a);
  if (sel === 'depth') {
    const z = near.length ? near[0] : p.zTop - P;
    dim(ctx, c, X(rStart), Y(z), X(rFinal), Y(z), g.depth.toFixed(3) + ' mm', c.mark);
  }
  if (sel === 'pitch' && near.length > 1) {
    const x = X(rFinal) + sgn * 14;
    dim(ctx, c, x, Y(near[0]), x, Y(near[1]), P.toFixed(3), c.mark);
  }
  if (sel === 'tip') tag(ctx, c, 'Ø' + g.dFinal.toFixed(3), X(rFinal) + sgn * 6, Y(zMin) - 12, internal ? 'left' : 'right', c.mark);
  if (sel === 'prep') tag(ctx, c, 'Ø' + g.dStart.toFixed(2), X(rStart) - sgn * 6, Y(zMin) - 12, internal ? 'right' : 'left', c.mark);

  // program zero on Z, if it is in view (Z0 at the top unless "Top of thread" moves it)
  if (opts.showZero !== false && Y(0) > 10 && Y(0) < h - 10) {
    const zx = X(0);
    if (zx > 10 && zx < w - 10) drawZero(ctx, c, zx, Y(0), [{ letter: 'X', dx: 1, dy: 0 }, { letter: 'Z', dx: 0, dy: -1 }]);
  }
}
