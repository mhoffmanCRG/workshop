/*
 * 3D preview of the keyway job, drawn as a wireframe on a plain 2D canvas (orthographic, orbit
 * with the mouse). No WebGL, so it is quick in the AXIS Tools tab, where GL is software only.
 * Shows the hub with its bore and keyways, the whole toolpath, the slotting tool at the playback
 * or machine position, and the program zero.
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

/** Points along one program move from `from` (all moves are straight). */
export function movePoints(from, m) {
  return [[from.X, from.Y, from.Z], [m.X, m.Y, m.Z]];
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
    const p = r.params, g = r.geom;
    const paths = [];         // [{ pts, phase }]
    let from = r.program.start, cur = null;
    r.program.moves.forEach((m) => {
      const phase = m.kind === 'rapid' ? 'rapid' : m.kind === 'feed' ? 'move' : m.phase;
      const pts = movePoints(from, m);
      if (cur && cur.phase === phase) cur.pts.push(...pts.slice(1));
      else { cur = { phase, pts }; paths.push(cur); }
      from = m;
    });
    const zTop = g.zTop, zb = zTop - p.hubLength, R = g.R, hb = p.width / 2, cx = g.centre.x, cy = g.centre.y;
    const part = [], thread = [];
    const hubR = p.hubDia > 0 ? p.hubDia / 2 : g.rBottom + Math.max(5, R * 0.6);
    part.push(circle(cx, cy, zTop, hubR, 64), circle(cx, cy, zb, hubR, 64));
    part.push({ cyl: true, cx, cy, r: hubR, z0: zb, z1: zTop });
    part.push(circle(cx, cy, zTop, R, 64), circle(cx, cy, zb, R, 64));
    // keyway outlines on the top face and at the bottom (the far face, or the end of a blind keyway)
    const zEnd = p.ends === 'blind' ? zTop - g.keyLen : zb, r0 = Math.sqrt(Math.max(0, R * R - hb * hb));
    g.angles.forEach((deg) => {
      const a = deg * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
      const at = (rr, y, z) => [cx + u[0] * rr + v[0] * y, cy + u[1] * rr + v[1] * y, z];
      [zTop, zEnd].forEach((z) => thread.push([at(r0, -hb, z), at(g.rBottom, -hb, z), at(g.rBottom, hb, z), at(r0, hb, z)]));
      [-hb, hb].forEach((y) => thread.push([at(g.rBottom, y, zTop), at(g.rBottom, y, zEnd)]));
    });
    const all = [];
    part.forEach((l) => { if (Array.isArray(l)) all.push(...l); else all.push([l.cx - l.r, l.cy - l.r, l.z0], [l.cx + l.r, l.cy + l.r, l.z1]); });
    paths.forEach((sg) => all.push(...sg.pts));
    all.push([0, 0, 0], [cx, cy, g.zSafe + Math.max(2 * p.toolWidth, 6)]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    all.forEach((q) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } });
    const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const size = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);
    return { paths, part, thread, centre, size, p, g };
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
      s.thread.forEach((t) => poly(t, c['metal-edge'], 1.6));
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
        const p = s.p, g = s.g, k = pose && pose.move && pose.move.hole >= 0 ? pose.move.hole : 0;
        const a = g.angles[k] * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
        const hw = p.toolWidth / 2, e = p.edgeOffset, headH = Math.max(2 * p.toolWidth, 6);
        const pt = (ru, y, z) => [at.X + u[0] * ru + v[0] * y, at.Y + u[1] * ru + v[1] * y, z];
        // a box from ra back to rb (along u), za to zb
        const box = (ra, rb, za, zb) => {
          const foot = (z) => [pt(ra, -hw, z), pt(ra, hw, z), pt(rb, hw, z), pt(rb, -hw, z), pt(ra, -hw, z)];
          const pts = foot(za).concat(foot(zb)).map(proj).map((q) => [q[0], q[1]]);
          ctx.fillStyle = c['cutter-3d']; ctx.globalAlpha = 0.55;
          ctx.beginPath(); hull(pts).forEach((q, i) => { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          poly(foot(za), c.text, 1); poly(foot(zb), c.text, 1);
          [[ra, -hw], [ra, hw], [rb, hw], [rb, -hw]].forEach(([q, y]) => poly([pt(q, y, za), pt(q, y, zb)], c.text, 0.8));
        };
        box(e, e - p.headDepth, at.Z, at.Z + headH);                                  // head
        box(e - p.headDepth * 0.35, e - p.headDepth, at.Z + headH, at.Z + p.reach);     // bar up to the holder
        poly([pt(e, -hw, at.Z), pt(e, hw, at.Z)], c.cut, 2.5);                          // cutting edge
        poly(circle(at.X, at.Y, at.Z + p.reach, Math.max(p.headDepth, p.toolWidth) * 1.2, 32), c.muted, 1, [3, 3]);   // holder face
      }
    }
  }

  // With no playback, the tool waits on the last stroke of the first keyway, half way down.
  function cutterRest() {
    if (!result) return null;
    const g = result.geom, p = result.params, a = g.angles[0] * Math.PI / 180, ra = g.rBottom - p.edgeOffset;
    return { X: g.centre.x + ra * Math.cos(a), Y: g.centre.y + ra * Math.sin(a), Z: g.zTop - g.keyLen / 2 };
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
