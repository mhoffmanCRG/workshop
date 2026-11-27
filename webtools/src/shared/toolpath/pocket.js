/*
 * Clearing a pocket shaped as a rounded rectangle (rectangles, circles and slots are all rounded
 * rectangles), level by level: in at the middle by helix, ramp or plunge, along the spine (the middle
 * line of the long axis), then offset loops out to the rough wall. A finish loop on the wall at full
 * depth comes last. Used by Pocket and Slot.
 */
import { roundedRect, placePath, emitPath, samplePath } from './geometry.js';

const TAU = 2 * Math.PI;

/**
 * Plan the pocket without cutting: the frame, the loops and how the cutter gets in.
 * region: { cx, cy, w, h, r, rot }   (rot in radians)
 * o: { rt, allow, step, entry: 'helix' | 'ramp' | 'plunge', climb, finish }
 */
export function planPocket(region, o) {
  let w = region.w, h = region.h, rot = region.rot || 0;
  if (h > w) { const t = w; w = h; h = t; rot += Math.PI / 2; }
  const r = Math.min(region.r, h / 2);
  const d0 = o.rt + o.allow, half = h / 2;
  const offsets = [];
  for (let d = d0; d < half - 1e-6; d += o.step) offsets.push(d);
  offsets.reverse();                           // inside out
  const e = Math.max(0, (w - h) / 2);           // half length of the spine
  const room = offsets.length ? half - d0 : 0;  // free half-width round the middle for a helix
  const minHelix = 0.25 * o.rt, minRamp = 0.5 * o.rt;
  let entry = o.entry;
  if (entry === 'helix' && room < minHelix) entry = e >= minRamp ? 'ramp' : 'plunge';
  else if (entry === 'ramp' && e < minRamp) entry = room >= minHelix ? 'helix' : 'plunge';
  const rh = entry === 'helix' ? Math.min(0.5 * o.rt, room) : 0;
  const finishable = o.finish && half - o.rt > 0.005;
  const local = (d) => roundedRect(w - 2 * d, h - 2 * d, Math.max(r - d, 0), o.climb);
  return {
    w, h, r, rot, e, offsets, rh, entry, wanted: o.entry, finishable, climb: !!o.climb,
    toWorld(x, y) {
      const c = Math.cos(rot), s = Math.sin(rot);
      return [region.cx + x * c - y * s, region.cy + x * s + y * c];
    },
    loop(d) { return placePath(local(d), region.cx, region.cy, rot); },
    // the wall the finish pass leaves (the pocket outline), for the drawings
    outline() { return samplePath(placePath(roundedRect(w, h, r, true), region.cx, region.cy, rot), true); }
  };
}

/**
 * Cut the planned pocket. o: { rt, levels: [z...], zTop, zApproach (where the first entry starts),
 * rampAngle (deg), feed, plungeFeed, lift } . The builder starts anywhere above; it ends on the wall
 * (or the spine) at the bottom, so the caller lifts away.
 */
export function cutPocket(b, plan, o) {
  const P = (x, y, z) => { const q = plan.toWorld(x, y); return { X: q[0], Y: q[1], Z: z }; };
  const tanA = Math.tan(o.rampAngle * Math.PI / 180), e = plan.e;
  const c = plan.toWorld(0, 0);
  let zPrev = o.zTop;
  o.levels.forEach((z, k) => {
    // get over the entry point just above the floor of the level before
    const zs = k === 0 ? o.zTop + 0.5 : zPrev + o.lift;
    const start = plan.entry === 'helix' ? [plan.rh, 0] : plan.entry === 'ramp' ? null : [e, 0];
    let rampN = 0, rampFirst = e;
    if (plan.entry === 'ramp') {
      rampN = Math.max(1, Math.ceil((zs - z) / (2 * e * tanA) - 1e-9));
      rampFirst = rampN % 2 ? -e : e;         // so that the last ramp ends at +e
    }
    const sx = start ? start[0] : rampFirst, sy = 0;
    b.phase = 'move';
    if (k === 0) {
      b.rapid(P(sx, sy, undefined));
      b.rapid({ Z: o.zApproach });
      b.line({ Z: zs }, o.plungeFeed);
    } else {
      b.rapid({ Z: zs });
      b.rapid(P(sx, sy, zs));
    }
    b.phase = 'entry';
    if (plan.entry === 'helix') {
      const n = Math.max(1, Math.ceil((zs - z) / (TAU * plan.rh * tanA) - 1e-9));
      for (let i = 1; i <= n; i++) b.arc(c[0], c[1], plan.climb ? TAU : -TAU, zs - (zs - z) * i / n, o.feed);
      b.arc(c[0], c[1], plan.climb ? TAU : -TAU, z, o.feed);
    } else if (plan.entry === 'ramp') {
      let x = rampFirst;
      for (let i = 1; i <= rampN; i++) { x = -x; b.line(P(x, 0, zs - (zs - z) * i / rampN), o.feed); }
    } else {
      b.line({ Z: z }, o.plungeFeed);
    }
    b.phase = 'rough';
    // the spine, end to end at the level (which also flattens a ramp)
    if (e > 1e-6 && (plan.entry !== 'helix' || e > plan.rh)) {
      if (plan.entry !== 'ramp') b.line(P(e, 0, z), o.feed);
      b.line(P(-e, 0, z), o.feed);
    }
    plan.offsets.forEach((d) => {
      const a = (plan.w - 2 * d) / 2;
      b.line(P(a, 0, z), o.feed);
      emitPath(b, plan.loop(d), z, o.feed);
    });
    zPrev = z;
  });
  if (plan.finishable) {
    const zb = o.levels[o.levels.length - 1], a = (plan.w - 2 * o.rt) / 2;
    b.phase = 'finish';
    b.line(P(a, 0, zb), o.feed);
    emitPath(b, plan.loop(o.rt), zb, o.feed);
    b.phase = 'move';
    b.line(P(Math.max(0, a - Math.min(1, a)), 0, zb), o.feed);
  }
}
