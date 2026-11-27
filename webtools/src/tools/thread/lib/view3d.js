/*
 * 3D preview of the thread job, drawn as a wireframe on a plain 2D canvas (orthographic, orbit
 * with the mouse). No WebGL, so it is quick in the AXIS Tools tab, where GL is software only.
 * Shows the part (a block with the holes, or the bosses), the thread, the whole toolpath, the
 * cutter at the playback or machine position, and the program zero.
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
      const phase = m.kind === 'rapid' ? 'rapid' : m.kind === 'feed' ? 'move' : m.phase;
      const pts = movePoints(from, m);
      if (cur && cur.phase === phase) cur.pts.push(...pts.slice(1));
      else { cur = { phase, pts }; paths.push(cur); }
      from = m;
    });
    // part: a block round all the holes, or one boss per thread
    const cs = g.centres, zTop = p.zTop;
    const part = [], thread = [];
    const rThread = g.dFinal / 2;
    if (g.internal) {
      const deep = p.holeDepth > 0 ? p.holeDepth : p.length + Math.max(4, p.length * 0.3);
      const pad = Math.max(p.holeDia, 8);
      const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
      const x0 = Math.min(...xs) - p.holeDia / 2 - pad, x1 = Math.max(...xs) + p.holeDia / 2 + pad;
      const y0 = Math.min(...ys) - p.holeDia / 2 - pad, y1 = Math.max(...ys) + p.holeDia / 2 + pad;
      const zb = zTop - deep;
      [zTop, zb].forEach((z) => part.push([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]]));
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y]) => part.push([[x, y, zTop], [x, y, zb]]));
      cs.forEach((c) => {
        part.push(circle(c.x, c.y, zTop, p.holeDia / 2, 48));
        part.push(circle(c.x, c.y, zb, p.holeDia / 2, 48));
      });
    } else {
      cs.forEach((c) => {
        const zb = zTop - p.length - Math.max(3, p.pitch * 2);
        part.push(circle(c.x, c.y, zTop, p.stockDia / 2, 48));
        part.push(circle(c.x, c.y, zb, p.stockDia / 2, 48));
        part.push({ cyl: true, cx: c.x, cy: c.y, r: p.stockDia / 2, z0: zb, z1: zTop });
      });
    }
    // the finished thread: a helix on the diameter the cutter tip reaches, over the thread length
    const zLo = Math.max(zTop - p.length, g.zBottom - p.pitch / 2), turns = (zTop - zLo) / p.pitch;
    cs.forEach((c) => {
      const pts = [], n = Math.max(8, Math.ceil(turns * 48));
      const sense = (p.hand === 'left') ? -1 : 1;    // right hand: rises anticlockwise
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * turns * 2 * Math.PI;
        pts.push([c.x + rThread * Math.cos(sense * t), c.y + rThread * Math.sin(sense * t), zLo + (i / n) * turns * p.pitch]);
      }
      thread.push(pts);
    });
    // bounding box for the fit
    const all = [];
    part.forEach((l) => { if (Array.isArray(l)) all.push(...l); else all.push([l.cx - l.r, l.cy - l.r, l.z0], [l.cx + l.r, l.cy + l.r, l.z1]); });
    paths.forEach((s) => all.push(...s.pts));
    all.push([0, 0, 0]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    all.forEach((q) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } });
    const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    // the box's diagonal, so it fits whichever way it is turned
    const size = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);
    const toothSpan = (p.rows - 1) * p.pitch;
    return { paths, part, thread, centre, size, rt, headLen: r.stats.headLen, stickOut: r.stats.stickOut, toothSpan, p, g };
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
      s.thread.forEach((t) => poly(t, c.metal, 1.5));
    }
    if (show.path) {
      const style = { rapid: [c.muted, 1, [4, 4]], move: [c.muted, 1], rough: [c.rough, 1.2], finish: [c.cut, 1.6], spring: [c.finish, 1.2] };
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
        const rt = s.rt, rs = s.p.shaftDia / 2, z0 = at.Z, zh = at.Z + s.headLen, z1 = at.Z + s.stickOut, p = s.p;
        const ring = (z, r) => circle(at.X, at.Y, z, r === undefined ? rt : r, 32);
        // head (teeth) and shaft as two filled cylinders
        const solid = (za, zb, r) => {
          const pts = ring(za, r).concat(ring(zb, r)).map(proj).map((v) => [v[0], v[1]]);
          ctx.beginPath(); hull(pts).forEach((v, i) => { if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); }); ctx.closePath(); ctx.fill();
        };
        ctx.fillStyle = c['cutter-3d']; ctx.globalAlpha = 0.55;
        solid(z0, zh, rt); if (z1 > zh) solid(zh, z1, rs);
        ctx.globalAlpha = 1;
        poly(ring(z0), c.text, 1); poly(ring(zh), c.text, 1);
        for (let j = 0; j < p.rows; j++) poly(ring(z0 + p.tipOffset + j * p.pitch), c.text, 1.5);
        poly(ring(zh, rs), c.text, 1); poly(ring(z1, rs), c.text, 1);
        // the holder face
        poly(ring(z1, Math.max(rt, rs) * 2.2), c.muted, 1, [3, 3]);
      }
    }
  }

  // With no playback, the cutter waits where the full-depth pass meets the thread (end of its lead-in).
  function cutterRest() {
    if (!result) return null;
    const m = result.program.moves.find((q) => q.phase === 'finish' && q.arc);
    return m ? { X: m.X, Y: m.Y, Z: m.Z } : null;
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
