/*
 * The two 2D drawings, both to scale:
 *   drawTop      the bore seen from above: hub, keyways (as cut so far and finished outline),
 *                lanes, stroke radii and the slotting tool
 *   drawSection  a section along the keyway being cut: hub wall, the keyway as cut so far, the
 *                stroke and the tool
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

// Which keyway the drawings show: the one the pose is on, else the first.
function holeIndex(r, pose) {
  if (pose && pose.move && pose.move.hole >= 0) return pose.move.hole;
  return 0;
}

// How far keyway k is cut: { reached, edgeR, zCut } (zCut: depth of the stroke in progress, or null).
function progress(r, k, pose) {
  const g = r.geom;
  if (!pose || !pose.move || pose.move.hole < 0) {
    // no playback: everything cut, except while a machine position before the first keyway is shown
    return pose && pose.move && pose.move.hole < 0 ? { reached: 0, edgeR: 0, zCut: null } : { reached: g.rBottom, edgeR: g.rBottom, zCut: null };
  }
  const m = pose.move;
  if (k < m.hole) return { reached: g.rBottom, edgeR: g.rBottom, zCut: null };
  if (k > m.hole) return { reached: 0, edgeR: 0, zCut: null };
  return { reached: m.reached, edgeR: m.edgeR, zCut: m.kind === 'cut' ? pose.Z : null };
}

// Where the tool is: spindle axis X/Y, tip Z and the keyway it faces.
function toolAt(r, pose) {
  const g = r.geom, p = r.params;
  if (pose) return { X: pose.X, Y: pose.Y, Z: pose.Z, k: holeIndex(r, pose) };
  // at rest: on the last stroke of the first keyway, half way down
  const a = g.angles[0] * Math.PI / 180, ra = g.rBottom - p.edgeOffset;
  return { X: g.centre.x + ra * Math.cos(a), Y: g.centre.y + ra * Math.sin(a), Z: g.zTop - g.keyLen / 2, k: 0 };
}

function frame(r, k) {
  const g = r.geom, a = g.angles[k] * Math.PI / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -u.y, y: u.x };
  return { u, v, at: (rr, y) => ({ x: g.centre.x + u.x * rr + v.x * y, y: g.centre.y + u.y * rr + v.y * y }) };
}

// ---------------------------------------------------------------- top view

export function drawTop(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, sel = opts.selected, pose = opts.pose, R = g.R, hb = p.width / 2;
  const tool = toolAt(r, pose), kSel = tool.k;
  const reach = Math.max(g.rBottom + 1, R) * 1.35;
  const scale = Math.min(w, h) / 2 / reach;
  const ox = w / 2, oy = h / 2;
  const X = (x) => ox + (x - g.centre.x) * scale, Y = (y) => oy - (y - g.centre.y) * scale;
  const path = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { if (i) ctx.lineTo(X(q.x), Y(q.y)); else ctx.moveTo(X(q.x), Y(q.y)); }); ctx.closePath(); };
  // the keyway from the bore out to radius rr (a rectangle; the bore circle is drawn over its inner end)
  const slot = (k, rr, half) => { const f = frame(r, k), r0 = Math.sqrt(Math.max(0, R * R - half * half)) - 0.5; return [f.at(r0, -half), f.at(rr, -half), f.at(rr, half), f.at(r0, half)]; };

  // hub
  ctx.fillStyle = c.metal;
  if (p.hubDia > 0) { ctx.beginPath(); ctx.arc(X(g.centre.x), Y(g.centre.y), p.hubDia / 2 * scale, 0, 2 * Math.PI); ctx.fill(); }
  else ctx.fillRect(0, 0, w, h);
  // keyways as cut so far
  g.angles.forEach((_a, k) => {
    const pr = progress(r, k, pose), rr = Math.max(pr.reached, pr.zCut !== null ? pr.edgeR : 0);
    if (rr > R - hb) { path(slot(k, rr, hb)); ctx.fillStyle = c.panel; ctx.fill(); ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke(); }
  });
  // bore
  ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(X(g.centre.x), Y(g.centre.y), R * scale, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = sel === 'over' ? c.mark : c['metal-edge']; ctx.lineWidth = 1.2; ctx.stroke();
  // finished outline
  ctx.setLineDash([4, 3]);
  g.angles.forEach((_a, k) => {
    const f = frame(r, k), r0 = Math.sqrt(Math.max(0, R * R - hb * hb));
    ctx.strokeStyle = k === kSel ? c.cut : c.rough; ctx.lineWidth = k === kSel ? 1.5 : 1;
    ctx.beginPath();
    [f.at(r0, -hb), f.at(g.rBottom, -hb), f.at(g.rBottom, hb), f.at(r0, hb)].forEach((q, i) => { if (i) ctx.lineTo(X(q.x), Y(q.y)); else ctx.moveTo(X(q.x), Y(q.y)); });
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const f = frame(r, kSel);
  // lanes: where the tool's edges run on each lane
  if (sel === 'lanes') {
    ctx.strokeStyle = c.mark; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    g.lanes.forEach((y) => [y - p.toolWidth / 2, y + p.toolWidth / 2].forEach((e) => {
      const a = f.at(R * 0.5, e), b = f.at(g.rBottom, e);
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    }));
    ctx.setLineDash([]);
  }
  // stroke radii of the first lane
  if (sel === 'strokes' || sel === 'doc') {
    const L = g.laneStrokes[0], gap = L.step * scale, every = Math.max(1, Math.ceil(3 / Math.max(gap, 1e-6)));
    ctx.strokeStyle = c.mark; ctx.lineWidth = 0.8;
    L.radii.forEach((rr, i) => {
      if (i % every && i !== L.radii.length - 1) return;
      const a = f.at(rr, L.y - p.toolWidth / 2), b = f.at(rr, L.y + p.toolWidth / 2);
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    });
  }

  // the tool: a flat edge toolWidth wide, the head running back from it
  const e = p.edgeOffset, ax = { x: tool.X, y: tool.Y };
  const tp = (ru, y) => ({ x: ax.x + f.u.x * ru + f.v.x * y, y: ax.y + f.u.y * ru + f.v.y * y });
  const hw = p.toolWidth / 2;
  path([tp(e, -hw), tp(e, hw), tp(e - p.headDepth, hw), tp(e - p.headDepth, -hw)]);
  ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
  const e0 = tp(e, -hw), e1 = tp(e, hw);
  ctx.strokeStyle = c.cut; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(e0.x), Y(e0.y)); ctx.lineTo(X(e1.x), Y(e1.y)); ctx.stroke();
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(X(ax.x), Y(ax.y), 2.5, 0, 2 * Math.PI); ctx.fill();

  // dimensions for the selected tile
  const out = g.rBottom + Math.max(1.5, 14 / scale);
  if (sel === 'width') { const a = f.at(out, -hb), b = f.at(out, hb); dim(ctx, c, X(a.x), Y(a.y), X(b.x), Y(b.y), p.width.toFixed(3), c.mark); }
  if (sel === 'depth') { const a = f.at(R, 0), b = f.at(g.rBottom, 0); dim(ctx, c, X(a.x), Y(a.y), X(b.x), Y(b.y), p.depth.toFixed(3), c.mark); }
  if (sel === 'over') { const a = f.at(-R, 0), b = f.at(g.rBottom, 0); dim(ctx, c, X(a.x), Y(a.y), X(b.x), Y(b.y), (p.boreDia + p.depth).toFixed(3), c.mark); }

  // labels
  tag(ctx, c, 'Bore Ø' + p.boreDia.toFixed(2), 8, 14, 'left', c.text);
  tag(ctx, c, 'Keyway ' + p.width.toFixed(2) + ' × ' + p.depth.toFixed(2), 8, 32, 'left', c.muted);
  tag(ctx, c, (p.orient ? 'M19 R' + ((((g.angles[kSel] + p.orientOffset) % 360) + 360) % 360).toFixed(1) : 'Spindle locked by hand'), w - 8, 14, 'right', c.muted);
  if (g.angles.length > 1) tag(ctx, c, 'Keyway ' + (kSel + 1) + ' of ' + g.angles.length, w - 8, 32, 'right', c.muted);

  if (opts.showZero !== false) {
    const zx = X(0), zy = Y(0);
    if (zx > 10 && zx < w - 10 && zy > 10 && zy < h - 10) drawZero(ctx, c, zx, zy, [{ letter: 'X', dx: 1, dy: 0 }, { letter: 'Y', dx: 0, dy: -1 }]);
  }
}

// ---------------------------------------------------------------- section along the keyway

export function drawSection(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, sel = opts.selected, pose = opts.pose, R = g.R;
  const tool = toolAt(r, pose), k = tool.k, f = frame(r, k);
  // the tool's edge radius: spindle axis projected on the keyway direction, plus the edge offset
  const rEdge = (tool.X - g.centre.x) * f.u.x + (tool.Y - g.centre.y) * f.u.y + p.edgeOffset;
  const headH = Math.max(2 * p.toolWidth, 6);
  // what to fit: from behind the tool head to past the keyway bottom, from below the stroke to above the head
  const r0 = Math.min(R - p.headDepth, rEdge - p.headDepth) - 1.5, r1 = g.rBottom + Math.max(4, p.depth * 1.5);
  const z0 = g.zBottom - 2, z1 = Math.max(g.zAppr, tool.Z) + headH + 2;
  const scale = Math.min((w - 40) / (r1 - r0), (h - 30) / (z1 - z0));
  const X = (rr) => 20 + (rr - r0) * scale + ((w - 40) - (r1 - r0) * scale) / 2;
  const Y = (z) => h - 15 - (z - z0) * scale - ((h - 30) - (z1 - z0) * scale) / 2;
  const rect = (ra, rb, za, zb) => { ctx.beginPath(); ctx.rect(X(ra), Y(zb), X(rb) - X(ra), Y(za) - Y(zb)); };
  const hubR = p.hubDia > 0 ? p.hubDia / 2 : r1 + 10, zHubBot = g.zTop - p.hubLength;
  const keyBot = p.ends === 'blind' ? g.zTop - g.keyLen : zHubBot;

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  // hub wall cut through the keyway centre line
  rect(R, hubR, zHubBot, g.zTop); ctx.fillStyle = c.metal; ctx.fill();
  // as cut so far
  const pr = progress(r, k, pose);
  if (pr.reached > R) { rect(R, pr.reached, keyBot, g.zTop); ctx.fillStyle = c.panel; ctx.fill(); }
  if (pr.zCut !== null && pr.edgeR > Math.max(R, pr.reached)) {
    rect(Math.max(R, pr.reached), pr.edgeR, Math.max(keyBot, pr.zCut), g.zTop); ctx.fillStyle = c.panel; ctx.fill();
  }
  rect(R, hubR, zHubBot, g.zTop); ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke();
  // finished keyway
  ctx.setLineDash([4, 3]); ctx.strokeStyle = sel === 'depth' ? c.mark : c.cut; ctx.lineWidth = 1.5;
  rect(R, g.rBottom, keyBot, g.zTop); ctx.stroke(); ctx.setLineDash([]);
  // stroke radii of the first lane
  if (sel === 'strokes' || sel === 'doc') {
    const L = g.laneStrokes[0], every = Math.max(1, Math.ceil(3 / Math.max(L.step * scale, 1e-6)));
    ctx.strokeStyle = c.mark; ctx.lineWidth = 0.6;
    L.radii.forEach((rr, i) => { if (i % every) return; ctx.beginPath(); ctx.moveTo(X(rr), Y(g.zAppr)); ctx.lineTo(X(rr), Y(g.zBottom)); ctx.stroke(); });
  }
  // the final stroke: down at the bottom radius, back up pulled clear
  ctx.strokeStyle = c.cut; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(X(g.rBottom), Y(g.zAppr)); ctx.lineTo(X(g.rBottom), Y(g.zBottom)); ctx.stroke();
  ctx.strokeStyle = c.muted; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(X(g.rBottom), Y(g.zBottom)); ctx.lineTo(X(g.rBottom - p.relief), Y(g.zBottom)); ctx.lineTo(X(g.rBottom - p.relief), Y(g.zAppr)); ctx.lineTo(X(g.rBottom), Y(g.zAppr)); ctx.stroke();
  ctx.setLineDash([]);

  // the tool: edge at the front bottom corner, the bottom relieved up toward the back, head then bar to the holder
  const tz = tool.Z, back = rEdge - p.headDepth, top = tz + p.reach;
  ctx.beginPath();
  [[rEdge, tz], [rEdge, tz + headH], [rEdge - p.headDepth * 0.35, tz + headH * 1.4], [rEdge - p.headDepth * 0.35, top],
    [back, top], [back, tz + p.headDepth * 0.15]].forEach(([rr, z], i) => { if (i) ctx.lineTo(X(rr), Y(z)); else ctx.moveTo(X(rr), Y(z)); });
  ctx.closePath();
  ctx.globalAlpha = 0.55; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = c.cut; ctx.beginPath(); ctx.arc(X(rEdge), Y(tz), 3, 0, 2 * Math.PI); ctx.fill();
  // spindle axis
  ctx.setLineDash([6, 3, 1, 3]); ctx.strokeStyle = c.muted;
  ctx.beginPath(); ctx.moveTo(X(rEdge - p.edgeOffset), Y(tz - 1)); ctx.lineTo(X(rEdge - p.edgeOffset), Y(top)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // labels and dimensions
  tag(ctx, c, 'Top Z' + g.zTop.toFixed(2), w - 8, Y(g.zTop) - 10, 'right', c.muted);
  if (sel === 'depth') dim(ctx, c, X(R), Y(g.zTop) + 14, X(g.rBottom), Y(g.zTop) + 14, p.depth.toFixed(3), c.mark);
  if (sel === 'stroke') { const x = Math.min(w - 50, X(g.rBottom) + 30); dim(ctx, c, x, Y(g.zAppr), x, Y(g.zBottom), g.strokeLen.toFixed(1) + ' mm', c.mark); }
  if (sel === 'doc') tag(ctx, c, g.stepDoc.toFixed(3) + ' mm per stroke', X(g.rBottom) + 6, Y(g.zBottom) + 12, 'left', c.mark);
  if (sel === 'feed') tag(ctx, c, 'F' + p.strokeFeed + ' down', X(g.rBottom) + 6, Y((g.zTop + g.zBottom) / 2), 'left', c.mark);
  if (p.ends !== 'blind') tag(ctx, c, 'Bottom Z' + zHubBot.toFixed(2), w - 8, Y(zHubBot) + 12, 'right', c.muted);
  else tag(ctx, c, 'Keyway end Z' + keyBot.toFixed(2), w - 8, Y(keyBot) + 12, 'right', c.muted);
  tag(ctx, c, 'Bore wall', X(R) - 4, Y(z0) - 10 < h - 10 ? h - 12 : Y(z0) - 10, 'right', c.muted);
}
