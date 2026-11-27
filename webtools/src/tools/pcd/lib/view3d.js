/*
 * 3D preview of the pitch circle job, drawn as a wireframe on a plain 2D canvas (orthographic, orbit
 * with the mouse). No WebGL, so it is quick in the AXIS Tools tab, where GL is software only.
 * Shows the part (a round plate with the holes), the whole toolpath, the drill or tap at the
 * playback or machine position, and the program zero.
 *
 * Coordinates are program coordinates (mm): X right, Y away, Z up.
 */

function colours() {
  const cs = getComputedStyle(document.documentElement), c = {};
  ['metal', 'metal-edge', 'cut', 'finish', 'rough', 'muted', 'text', 'panel', 'line', 'mark', 'cutter-3d', 'axis-x', 'axis-y', 'axis-z'].forEach((k) => {
    c[k] = cs.getPropertyValue('--' + k).trim();
  });
  return c;
}

// Convex hull of 2D points (monotone chain), for filling the cutter's silhouette.
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  p.forEach((q) => { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function circle(cx, cy, z, r, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]); }
  return out;
}

/** Points along one program move from `from` (sampled finely on arcs). */
export function movePoints(from, m) {
  if (!m.arc) return [[from.X, from.Y, from.Z], [m.X, m.Y, m.Z]];
  const a = m.arc, n = Math.max(4, Math.ceil(Math.abs(a.turn) / (2 * Math.PI) * 64)), out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, t = a.a0 + a.turn * f;
    out.push([a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t), a.z0 + a.dz * f]);
  }
  return out;
}

const DEFAULT_VIEW = { yaw: -0.6, pitch: 0.55, zoom: 1, panX: 0, panY: 0 };

export function createView3d(canvas) {
  const view = { ...DEFAULT_VIEW };
  const show = { path: true, cutter: true, part: true, zero: true };
  let result = null, pose = null, scene = null, frame = 0;
  const box = canvas.parentElement;
  const labels = ['x', 'y', 'z'].map((k) => {
    const el = document.createElement('span');
    el.className = 'axis-label axis-' + k;
    el.textContent = k.toUpperCase();
    el.style.display = 'none';
    box.appendChild(el);
    return el;
  });

  // Everything that does not move, worked out once per result.
  function build(r) {
    const p = r.params, g = r.geom, rt = p.toolDia / 2;
    const paths = [];         // [{ pts, phase }]
    let from = r.program.start, cur = null;
    r.program.moves.forEach((m) => {
      if (m.kind === 'dwell') return;
      const phase = m.kind === 'rapid' ? 'rapid' : m.kind === 'feed' ? 'move' : 'cut';
      const pts = movePoints(from, m);
      if (cur && cur.phase === phase) cur.pts.push(...pts.slice(1));
      else { cur = { phase, pts }; paths.push(cur); }
      from = m;
    });
    // part: a round plate under the pattern, with the holes
    const zTop = p.zTop, thick = p.thickness > 0 ? p.thickness : Math.max(g.fullDepth + 5, 10);
    const zb = zTop - thick, plateR = p.pcd / 2 + Math.max(p.holeDia * 1.5, 6);
    const part = [
      circle(p.cx, p.cy, zTop, plateR, 96), circle(p.cx, p.cy, zb, plateR, 96),
      { cyl: true, cx: p.cx, cy: p.cy, r: plateR, z0: zb, z1: zTop }
    ];
    const hz = Math.max(zb, zTop - g.fullDepth);
    const holes = g.holes.map((h) => ({ h, top: circle(h.x, h.y, zTop, p.holeDia / 2, 32), bottom: circle(h.x, h.y, hz, p.holeDia / 2, 32) }));
    // the PCD itself, on the top face
    const pitch = circle(p.cx, p.cy, zTop, p.pcd / 2, 96);
    // bounding box for the fit
    const all = [[p.cx - plateR, p.cy - plateR, zb], [p.cx + plateR, p.cy + plateR, g.zClear], [0, 0, 0]];
    paths.forEach((s) => all.push(...s.pts));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    all.forEach((q) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } });
    const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const size = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);
    const fluteLen = Math.max(g.fullDepth + 2 * p.toolDia, 4 * p.toolDia);
    return { paths, part, holes, pitch, centre, size, rt, tipLen: g.tipLen, fluteLen, p, g };
  }

  function draw() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  function render() {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) return;               // not laid out yet (AXIS tab at first load)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    labels.forEach((el) => { el.style.display = 'none'; });
    if (!scene) return;
    const c = colours(), s = scene;
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const scale = Math.min(w, h) / s.size * 0.95 * view.zoom;
    // orthographic: turn about Z (yaw), then tip toward the viewer (pitch)
    const proj = (q) => {
      const x = q[0] - s.centre[0], y = q[1] - s.centre[1], z = q[2] - s.centre[2];
      const xr = x * cy - y * sy, yr = x * sy + y * cy;
      const up = z * cp + yr * sp, depth = yr * cp - z * sp;
      return [w / 2 + view.panX + xr * scale, h / 2 + view.panY - up * scale, depth];
    };
    const poly = (pts, colour, width, dash) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath();
      pts.forEach((q, i) => { const v = proj(q); if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); });
      ctx.stroke();
    };
    // silhouette lines of an upright cylinder: the two sides square to the view
    const cylSides = (cx0, cy0, r, z0, z1) => {
      [1, -1].forEach((sg) => {
        const x = cx0 + sg * r * cy, y = cy0 - sg * r * sy;
        poly([[x, y, z0], [x, y, z1]], c['metal-edge'], 1);
      });
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (show.part) {
      s.part.forEach((l) => {
        if (Array.isArray(l)) poly(l, c['metal-edge'], 1);
        else cylSides(l.cx, l.cy, l.r, l.z0, l.z1);
      });
      poly(s.pitch, c.muted, 1, [4, 4]);
      // holes drilled so far (all of them with no playback) solid, the rest and skipped ones dashed
      const done = pose && pose.move ? pose.move.done : Infinity;
      let k = 0;
      s.holes.forEach((o) => {
        if (o.h.skip) { poly(o.top, c.muted, 1, [2, 3]); return; }
        const drilled = k++ < done;
        poly(o.top, drilled ? c.cut : c['metal-edge'], drilled ? 1.5 : 1, drilled ? null : [3, 3]);
        if (drilled) poly(o.bottom, c.metal, 1);
      });
    }
    if (show.path) {
      const style = { rapid: [c.muted, 1, [4, 4]], move: [c.finish, 1.2], cut: [c.cut, 1.8] };
      s.paths.forEach((seg) => { const st = style[seg.phase] || style.move; poly(seg.pts, st[0], st[1], st[2]); });
    }
    if (show.zero) {
      const o = proj([0, 0, 0]), len = s.size * 0.12;
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach((d, k) => {
        const e = proj([d[0] * len, d[1] * len, d[2] * len]);
        const colour = c['axis-' + 'xyz'[k]];
        ctx.setLineDash([]); ctx.strokeStyle = colour; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
        const el = labels[k], dx = e[0] - o[0], dy = e[1] - o[1], dl = Math.hypot(dx, dy) || 1;
        el.style.display = '';
        el.style.left = (e[0] + dx / dl * 10) + 'px';
        el.style.top = (e[1] + dy / dl * 10) + 'px';
      });
      ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(o[0], o[1], 3, 0, 2 * Math.PI); ctx.fill();
    }
    if (show.cutter) {
      const at = pose || cutterRest();
      if (at) {
        // drill: cone up from the tip, then the body; a tap is a plain cylinder
        const rt = s.rt, p = s.p, z0 = at.Z, zc = z0 + s.tipLen, z1 = z0 + s.fluteLen;
        const ring = (z) => circle(at.X, at.Y, z, rt, 32);
        const pts = ring(zc).concat(ring(z1)).concat([[at.X, at.Y, z0]]).map(proj).map((v) => [v[0], v[1]]);
        ctx.fillStyle = c['cutter-3d']; ctx.globalAlpha = 0.55;
        ctx.beginPath(); hull(pts).forEach((v, i) => { if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); }); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        poly(ring(zc), c.text, 1); poly(ring(z1), c.text, 1);
        if (s.g.tap) for (let z = z0 + p.tapPitch; z < z0 + Math.min(s.fluteLen, 12 * p.tapPitch); z += p.tapPitch * 2) poly(ring(z), c.text, 0.8);
        const x = at.X, y = at.Y;
        poly([[x, y, z1], [x, y, z1 + s.size * 0.15]], c.muted, 1, [3, 3]);
      }
    }
  }

  // With no playback, the tool waits over the first hole at the R plane.
  function cutterRest() {
    if (!result) return null;
    const h = result.geom.list[0];
    return { X: h.x, Y: h.y, Z: result.geom.zR };
  }

  // ---- orbit, pan and zoom
  let drag = null;
  function onDown(e) {
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.button === 2 || e.shiftKey };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) { view.panX += dx; view.panY += dy; }
    else {
      view.yaw -= dx * 0.01;
      view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch + dy * 0.01));
    }
    draw();
  }
  function onUp() { drag = null; }
  function onWheel(e) {
    e.preventDefault();
    view.zoom = Math.max(0.2, Math.min(40, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    draw();
  }
  function onReset() { Object.assign(view, DEFAULT_VIEW); draw(); }
  const noMenu = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onReset);
  canvas.addEventListener('contextmenu', noMenu);

  return {
    show,
    supported: true,
    setResult(r) { result = r; scene = r ? build(r) : null; draw(); },
    setPose(q) { pose = q; draw(); },
    draw,
    dispose() {
      cancelAnimationFrame(frame);
      labels.forEach((el) => el.remove());
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onReset);
      canvas.removeEventListener('contextmenu', noMenu);
    }
  };
}
