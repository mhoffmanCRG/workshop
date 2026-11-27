/*
 * The two 2D drawings, both to scale:
 *   drawTop      the pattern seen from above: pitch circle, numbered holes, start angle and the tool
 *   drawSection  a section through the hole being drilled: the part, the hole as deep as it is so
 *                far, R plane, clearance, peck depths and the drill or tap
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


// Which hole the section shows: the one the pose is on, else the first.
function holeIndex(r, pose) {
  if (pose && pose.move && pose.move.hole >= 0) return pose.move.hole;
  if (pose && pose.move && pose.move.done > 0) return Math.min(pose.move.done, r.geom.list.length) - 1;
  return 0;
}

const RAD = Math.PI / 180;

// ---------------------------------------------------------------- top view

export function drawTop(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, sel = opts.selected, pose = opts.pose;
  const R = p.pcd / 2, hr = p.holeDia / 2;
  const reach = R + Math.max(hr, p.toolDia / 2) + Math.max(4, p.pcd * 0.06);
  const scale = Math.min(w, h - 36) / 2 / (reach * 1.08);
  const ox = w / 2, oy = h / 2 + 8;
  const X = (x) => ox + (x - p.cx) * scale, Y = (y) => oy - (y - p.cy) * scale;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // the plate
  const plateR = R + Math.max(p.holeDia * 1.5, 6);
  ctx.fillStyle = c.metal; ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.arc(ox, oy, plateR * scale, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke();

  // pitch circle and centre lines
  ctx.setLineDash([8, 3, 2, 3]); ctx.strokeStyle = sel === 'pcd' ? c.mark : c.muted; ctx.lineWidth = sel === 'pcd' ? 1.8 : 1;
  ctx.beginPath(); ctx.arc(ox, oy, R * scale, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = c.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox - plateR * scale, oy); ctx.lineTo(ox + plateR * scale, oy);
  ctx.moveTo(ox, oy - plateR * scale); ctx.lineTo(ox, oy + plateR * scale); ctx.stroke();
  ctx.setLineDash([]);

  // start angle: from +X round to the first hole
  const a0 = p.startAngle * RAD, ra = Math.min(R * 0.35, 40 / scale + 0) * scale;
  ctx.strokeStyle = c.accent || c.text; ctx.lineWidth = 1.2;
  if (Math.abs(p.startAngle % 360) > 0.01) {
    ctx.beginPath(); ctx.arc(ox, oy, ra, 0, -a0, p.startAngle > 0); ctx.stroke();
    tag(ctx, c, fmtAngle(p.startAngle), ox + (ra + 8) * Math.cos(-a0 / 2), oy + (ra + 8) * Math.sin(-a0 / 2), 'left', c.muted);
  }
  ctx.setLineDash([2, 3]); ctx.strokeStyle = c.muted;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(X(g.holes[0].x), Y(g.holes[0].y)); ctx.stroke(); ctx.setLineDash([]);

  // angle step between holes 1 and 2
  if (sel === 'angle' && g.holes.length > 1) {
    const b0 = -p.startAngle * RAD, b1 = -(p.startAngle + g.step) * RAD, rr = R * 0.6 * scale;
    ctx.strokeStyle = c.mark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(X(g.holes[1].x), Y(g.holes[1].y)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(X(g.holes[0].x), Y(g.holes[0].y)); ctx.stroke();
    ctx.beginPath(); ctx.arc(ox, oy, rr, b0, b1, g.step > 0); ctx.stroke();
    const bm = (b0 + b1) / 2;
    tag(ctx, c, fmtAngle(Math.abs(g.step)), ox + (rr + 10) * Math.cos(bm), oy + (rr + 10) * Math.sin(bm), 'center', c.mark);
  }

  // holes: drilled so far solid (all of them with no playback), still to come outlined, skipped dashed
  const done = pose && pose.move ? pose.move.done : Infinity;
  const cur = pose && pose.move && pose.move.hole >= 0 ? pose.move.hole : -1;
  let k = 0;
  ctx.font = '12px system-ui, sans-serif';
  g.holes.forEach((hole) => {
    const x = X(hole.x), y = Y(hole.y), rr = Math.max(hr * scale, 2.5);
    const idx = hole.skip ? -1 : k++;
    const drilled = !hole.skip && idx < done, now = idx === cur;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI);
    if (hole.skip) {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    } else {
      if (drilled || now) { ctx.fillStyle = c.panel; ctx.fill(); }
      ctx.strokeStyle = sel === 'holes' ? c.mark : drilled ? c.cut : now ? c.cut : c['metal-edge'];
      ctx.lineWidth = drilled || sel === 'holes' ? 1.8 : 1;
      if (!drilled && !now) ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    // number outside the circle, along the radius
    const ang = Math.atan2(hole.y - p.cy, hole.x - p.cx), off = rr + 10;
    tag(ctx, c, String(hole.n), x + off * Math.cos(ang), y - off * Math.sin(ang), 'center',
      hole.skip ? c.muted : sel === 'holes' || (sel === 'first' && hole.n === g.list[0].n) ? c.mark : c.text);
  });

  // direction arrow round the circle just past hole 1
  if (g.holes.length > 1) {
    const sgn = g.step > 0 ? 1 : -1, rr = R * scale - Math.max(hr * scale, 3) - 10;
    if (rr > 12) {
      const t0 = p.startAngle * RAD + sgn * 0.12, t1 = p.startAngle * RAD + sgn * Math.min(Math.abs(g.step) * RAD * 0.6, 0.9);
      ctx.strokeStyle = ctx.fillStyle = c.finish; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ox, oy, rr, -t0, -t1, sgn > 0); ctx.stroke();
      // screen point and direction of travel at angle t1 (math angle, counter-clockwise positive)
      const px = ox + rr * Math.cos(t1), py = oy - rr * Math.sin(t1);
      const dx = -Math.sin(t1) * sgn, dy = -Math.cos(t1) * sgn;
      ctx.beginPath(); ctx.moveTo(px + dx * 7, py + dy * 7);
      ctx.lineTo(px - dx * 4 - dy * 4, py - dy * 4 + dx * 4); ctx.lineTo(px - dx * 4 + dy * 4, py - dy * 4 - dx * 4);
      ctx.closePath(); ctx.fill();
    }
  }

  // chord between neighbours, and the wall left between them
  if ((sel === 'pitch' || sel === 'wall') && g.holes.length > 1) {
    const a = g.holes[0], b = g.holes[1];
    if (sel === 'pitch') dim(ctx, c, X(a.x), Y(a.y), X(b.x), Y(b.y), g.chord.toFixed(3) + ' mm', c.mark);
    else {
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      dim(ctx, c, X(a.x + ux * hr), Y(a.y + uy * hr), X(b.x - ux * hr), Y(b.y - uy * hr), g.wall.toFixed(2) + ' mm', c.mark);
    }
  }
  if (sel === 'pcd') dim(ctx, c, X(p.cx - R * Math.cos(Math.PI / 4)), Y(p.cy - R * Math.sin(Math.PI / 4)), X(p.cx + R * Math.cos(Math.PI / 4)), Y(p.cy + R * Math.sin(Math.PI / 4)), 'Ø' + p.pcd.toFixed(3), c.mark);
  if (sel === 'first') {
    const f = g.list[0];
    ctx.strokeStyle = c.mark; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), Math.max(hr * scale, 3) + 4, 0, 2 * Math.PI); ctx.stroke();
  }

  // the tool
  const at = pose ? { x: pose.X, y: pose.Y } : { x: g.list[0].x, y: g.list[0].y };
  ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d'];
  ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), p.toolDia / 2 * scale, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(X(at.x), Y(at.y), p.toolDia / 2 * scale, 0, 2 * Math.PI); ctx.stroke();

  // labels
  tag(ctx, c, 'PCD Ø' + p.pcd.toFixed(2), 8, 14, 'left', sel === 'pcd' ? c.mark : c.text);
  tag(ctx, c, g.list.length + ' × Ø' + p.holeDia.toFixed(2), 8, 32, 'left', c.muted);
  tag(ctx, c, (g.step >= 0 ? 'Anticlockwise' : 'Clockwise') + ', ' + fmtAngle(Math.abs(g.step)) + ' apart', w - 8, 14, 'right', sel === 'angle' ? c.mark : c.muted);

  if (opts.showZero !== false) {
    const zx = X(0), zy = Y(0);
    if (zx > 10 && zx < w - 10 && zy > 10 && zy < h - 10) drawZero(ctx, c, zx, zy, [{ letter: 'X', dx: 1, dy: 0 }, { letter: 'Y', dx: 0, dy: -1 }]);
  }
}

function fmtAngle(a) { return (Math.round(a * 100) / 100) + '°'; }

// ---------------------------------------------------------------- section

export function drawSection(canvas, r, opts) {
  const { ctx, w, h } = prep(canvas), c = colours();
  if (!(w > 20 && h > 20)) return;
  if (!r) { message(ctx, c, w, h, 'No toolpath: see the errors.'); return; }
  const p = r.params, g = r.geom, sel = opts.selected, pose = opts.pose;
  const hi = holeIndex(r, pose), hole = g.list[hi];
  const hr = p.holeDia / 2, rt = p.toolDia / 2;
  const thick = p.thickness > 0 ? p.thickness : Math.max(g.fullDepth + 5, 10);
  const zBot = Math.min(p.zTop - thick, g.zBottom) - 2;
  // the tool sits at the pose, else at the R plane over the hole
  const toolZ = pose ? pose.Z : g.zR;
  const zMax = Math.max(g.zClear, toolZ) + 2;
  const halfW = Math.max(hr, rt) * 3.2 + 2;
  const zView = zMax + 2;
  const scale = Math.min((w - 20) / (2 * halfW), (h - 24) / (zView - zBot));
  const ox = w / 2;
  const X = (s) => ox + s * scale, Y = (z) => 12 + (zView - z) * scale;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // how deep this hole is so far: the deepest the tip has been on it (all the way with no playback)
  const done = pose && pose.move ? pose.move.done : Infinity;
  let deepZ;
  if (!pose) deepZ = g.zBottom;
  else if (hi < done) deepZ = g.zBottom;
  else if (pose.move && pose.move.hole === hi) deepZ = Math.min(pose.move.deep, pose.Z);
  else deepZ = p.zTop;
  deepZ = Math.min(p.zTop, deepZ);
  const cut = p.zTop - deepZ;

  // part, both sides of the hole
  const holeR = g.tap ? hr : rt;
  // the part, with the hole cut out of it (a cone for a drill or spot, flat bottomed for a tap)
  const zb = p.zTop - thick;
  const rect = [X(-halfW), Y(p.zTop), X(halfW) - X(-halfW), Y(zb) - Y(p.zTop)];
  ctx.fillStyle = c.metal; ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
  if (cut > 1e-6) {
    const hw = g.tap ? hr : Math.min(holeR, cut * Math.tan(p.pointAngle / 2 * RAD));
    const cz = g.tap ? deepZ : Math.min(p.zTop, deepZ + hw / Math.tan(p.pointAngle / 2 * RAD));
    ctx.save();
    ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(X(-hw), Y(p.zTop + 1)); ctx.lineTo(X(-hw), Y(cz));
    if (g.tap) { ctx.lineTo(X(-hw), Y(deepZ)); ctx.lineTo(X(hw), Y(deepZ)); } else ctx.lineTo(X(0), Y(deepZ));
    ctx.lineTo(X(hw), Y(cz)); ctx.lineTo(X(hw), Y(p.zTop + 1)); ctx.closePath();
    ctx.fillStyle = c.panel; ctx.fill();
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
  // a tapped hole: thread hint lines on the walls as deep as the tap has gone
  if (g.tap && cut > 0) {
    ctx.strokeStyle = c.cut; ctx.lineWidth = 1;
    for (let z = p.zTop - p.tapPitch / 2; z > deepZ; z -= p.tapPitch) {
      [-1, 1].forEach((s) => { ctx.beginPath(); ctx.moveTo(X(s * hr), Y(z + p.tapPitch / 2)); ctx.lineTo(X(s * rt), Y(z)); ctx.lineTo(X(s * hr), Y(z - p.tapPitch / 2)); ctx.stroke(); });
    }
  }

  // levels: clearance, R plane, peck depths
  const level = (z, text, colour, dash) => {
    ctx.setLineDash(dash || [5, 4]); ctx.strokeStyle = colour; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(-halfW), Y(z)); ctx.lineTo(X(halfW), Y(z)); ctx.stroke(); ctx.setLineDash([]);
    if (text) tag(ctx, c, text, w - 8, Y(z) - 9, 'right', colour);
  };
  level(g.zClear, 'Clear Z' + g.zClear.toFixed(2), c.muted);
  level(g.zR, 'R Z' + g.zR.toFixed(2), c.finish);
  tag(ctx, c, 'Top Z' + p.zTop.toFixed(2), w - 8, Y(p.zTop) + 10, 'right', c.muted);
  if (g.peckLevels.length > 1) {
    g.peckLevels.slice(0, -1).forEach((z) => {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = sel === 'pecks' ? c.mark : c.rough; ctx.lineWidth = sel === 'pecks' ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(X(-holeR - 6), Y(z)); ctx.lineTo(X(holeR + 6), Y(z)); ctx.stroke(); ctx.setLineDash([]);
    });
  }
  // bottom of the hole
  ctx.setLineDash([2, 3]); ctx.strokeStyle = sel === 'depth' ? c.mark : c.cut;
  ctx.beginPath(); ctx.moveTo(X(-halfW), Y(g.zBottom)); ctx.lineTo(X(halfW), Y(g.zBottom)); ctx.stroke(); ctx.setLineDash([]);
  tag(ctx, c, 'Z' + g.zBottom.toFixed(3), w - 8, Y(g.zBottom) + 10, 'right', sel === 'depth' ? c.mark : c.cut);

  // the tool
  const tz = toolZ, bodyTop = Math.max(zMax + 10, tz + 4 * p.toolDia);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.beginPath();
  if (g.tap) {
    const ch = Math.min(p.tapPitch * 1.5, rt * 0.4);
    ctx.moveTo(X(-rt + ch), Y(tz)); ctx.lineTo(X(rt - ch), Y(tz)); ctx.lineTo(X(rt), Y(tz + ch));
    ctx.lineTo(X(rt), Y(bodyTop)); ctx.lineTo(X(-rt), Y(bodyTop)); ctx.lineTo(X(-rt), Y(tz + ch));
  } else {
    ctx.moveTo(X(0), Y(tz)); ctx.lineTo(X(rt), Y(tz + g.tipLen)); ctx.lineTo(X(rt), Y(bodyTop));
    ctx.lineTo(X(-rt), Y(bodyTop)); ctx.lineTo(X(-rt), Y(tz + g.tipLen));
  }
  ctx.closePath();
  ctx.globalAlpha = 0.6; ctx.fillStyle = c['cutter-3d']; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
  // flutes (drill) or thread (tap), as a few slanted lines
  ctx.strokeStyle = c.text; ctx.globalAlpha = 0.5;
  const stepZ = g.tap ? p.tapPitch * 2 : p.toolDia * 0.9;
  for (let z = tz + g.tipLen + stepZ * 0.5; z < bodyTop; z += stepZ) {
    ctx.beginPath(); ctx.moveTo(X(-rt), Y(z)); ctx.lineTo(X(rt), Y(z + stepZ * 0.5)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 3, 1, 3]); ctx.strokeStyle = c.muted;
  ctx.beginPath(); ctx.moveTo(X(0), Y(zBot)); ctx.lineTo(X(0), Y(bodyTop)); ctx.stroke();
  ctx.restore();

  // dimensions for the selected tile
  if (sel === 'depth') {
    dim(ctx, c, X(-halfW + 10), Y(p.zTop), X(-halfW + 10), Y(g.zBottom), (p.zTop - g.zBottom).toFixed(2) + ' mm', c.mark);
    if (!g.tap && g.tipLen > 0) dim(ctx, c, X(-holeR - 14), Y(p.zTop), X(-holeR - 14), Y(p.zTop - g.fullDepth), g.fullDepth.toFixed(2), c.mark);
  }
  if (sel === 'cycle' && g.spot) {
    const sz = Math.max(g.zBottom, p.zTop);
    dim(ctx, c, X(-g.spotDia / 2), Y(sz) - 14, X(g.spotDia / 2), Y(sz) - 14, 'Ø' + g.spotDia.toFixed(2), c.mark);
  }

  tag(ctx, c, 'Hole ' + hole.n + (pose && pose.move && pose.move.hole === hi ? (g.tap ? ', tapping' : g.spot ? ', spotting' : ', drilling') : ''), 8, 14, 'left', c.text);

  if (opts.showZero !== false && Y(0) > 10 && Y(0) < h - 10) {
    const zx = X(-halfW * 0.7);
    drawZero(ctx, c, zx, Y(0), [{ letter: 'Z', dx: 0, dy: -1 }]);
  }
}
