/*
 * The imperative core behind the Threading page: owns the 3D view, the two drawings and the
 * G-code playback. Playback runs at animation-frame rate, so it writes the scrub bar, the
 * playback readout and the line marker straight to their elements instead of going through
 * React state. React is told only when the Play / Stop buttons need to change.
 */
import { createView3d } from './view3d.js';
import { drawTop, drawSection } from './drawings.js';

export const IDLE_INFO = 'Play runs the G-code in the 3D preview and on both drawings.';

function stamp(minutes) {
  const s = Math.floor(minutes * 60 + 1e-6), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s % 60).slice(-2);
}

/** Tool position part way (f, 0 to 1) along move m, which starts at `from`. */
export function poseOn(from, m, f) {
  if (m.arc) {
    const a = m.arc, t = a.a0 + a.turn * f;
    return { X: a.cx + a.r * Math.cos(t), Y: a.cy + a.r * Math.sin(t), Z: a.z0 + a.dz * f };
  }
  return { X: from.X + (m.X - from.X) * f, Y: from.Y + (m.Y - from.Y) * f, Z: from.Z + (m.Z - from.Z) * f };
}

/**
 * el: { view3d, top, section, gcode, lineMark, scrub, playInfo } DOM elements.
 * onPlayState({ on, active }) is called whenever the Play / Stop buttons should change.
 */
export function createEngine(el, onPlayState) {
  const view3d = createView3d(el.view3d);
  const play = { active: false, on: false, t: 0, last: 0, line: -1, lines: [], pose: null };
  const e = { view3d, play, result: null, selected: null, showZero: true, speed: 10 };

  const good = () => !!(e.result && e.result.gcode);

  e.redraw2d = function () {
    const r = good() ? e.result : null;
    const opts = { selected: e.selected, showZero: e.showZero, pose: play.pose };
    // a failing drawing must not stop the other one (or, inside a React effect, blank the page)
    [[drawTop, el.top], [drawSection, el.section]].forEach(([fn, canvas]) => {
      try { fn(canvas, r, opts); } catch (err) { console.error('2D drawing failed:', err); }
    });
  };

  e.setResult = function (r) {
    e.result = r;
    const ok = !r.errors.length;
    play.lines = ok ? r.gcode.split('\n') : [];
    view3d.setResult(ok ? r : null);
    e.redraw2d();
  };

  const buttons = () => onPlayState({ on: play.on, active: play.active });

  // Highlight bar over the current line of the G-code box.
  e.placeLineMark = function (follow) {
    const box = el.gcode, mark = el.lineMark;
    if (play.line < 0) { mark.hidden = true; return; }
    const cs = getComputedStyle(box);
    const pad = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    // the real line pitch: WebKit draws a 13px/1.4 line 18px tall, not the 18.2px CSS reports
    const rows = box.value ? box.value.split('\n').length : 0;
    const lh = rows && box.scrollHeight > box.clientHeight + 1 ? (box.scrollHeight - pad - padB) / rows : (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4);
    if (follow) box.scrollTop = Math.max(0, pad + play.line * lh - box.clientHeight / 2 + lh / 2);
    mark.style.top = (pad + play.line * lh - box.scrollTop) + 'px';
    mark.style.height = lh + 'px';
    mark.hidden = false;
  };

  e.setInfo = function (text) { el.playInfo.textContent = text; };

  function showPose() {
    const P = e.result.program, mv = P.moves;
    let lo = 0, hi = mv.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (mv[mid].t1 >= play.t) hi = mid; else lo = mid + 1; }
    const m = mv[lo], from = lo ? mv[lo - 1] : P.start;
    const f = m.t1 > m.t0 ? Math.min(1, Math.max(0, (play.t - m.t0) / (m.t1 - m.t0))) : 1;
    const q = poseOn(from, m, f);
    view3d.setPose(q);
    el.scrub.value = P.total > 0 ? Math.round(play.t / P.total * 1000) : 0;
    e.setInfo(stamp(play.t) + ' / ' + stamp(P.total) + '   line ' + (m.line + 1) + '   ' + (play.lines[m.line] || ''));
    play.line = m.line;
    play.pose = { ...q, move: m };
    e.redraw2d();
    e.placeLineMark(true);
  }

  function tick(now) {
    if (!play.on) return;
    // Cap the step so a background tab does not jump far ahead when it comes back.
    play.t += Math.min(now - play.last, 100) / 60000 * Number(e.speed);
    play.last = now;
    if (play.t >= e.result.program.total) { play.t = e.result.program.total; play.on = false; }
    showPose();
    buttons();
    if (play.on) requestAnimationFrame(tick);
  }

  e.stopPlayback = function () {
    play.active = play.on = false; play.t = 0; play.line = -1; play.pose = null;
    el.scrub.value = 0;
    e.setInfo(IDLE_INFO);
    el.lineMark.hidden = true;
    view3d.setPose(null);
    if (good()) e.redraw2d();
    buttons();
  };

  e.togglePlay = function () {
    if (!good()) return;
    if (play.on) { play.on = false; buttons(); return; }
    if (!play.active || play.t >= e.result.program.total) play.t = 0;
    play.active = play.on = true;
    play.last = performance.now();
    buttons();
    showPose();
    requestAnimationFrame(tick);
  };

  e.scrubTo = function (value) {
    if (!good()) return;
    play.active = true;
    play.t = e.result.program.total * Number(value) / 1000;
    play.last = performance.now();
    showPose();
    buttons();
  };

  // Show a position that comes from outside the simulation (the live machine).
  // move: the program move it is on (for the drawings' progress), line: G-code line to mark or -1.
  e.showMachinePose = function (q, move, line) {
    view3d.setPose(q);
    play.pose = { ...q, move };
    play.line = line;
    e.redraw2d();
    e.placeLineMark(line >= 0);
  };

  const redraw = () => { if (good()) e.redraw2d(); view3d.draw(); };
  window.addEventListener('resize', redraw);
  // The canvases stretch with the layout, so redraw whenever a box changes.
  const ro = window.ResizeObserver ? new ResizeObserver(redraw) : null;
  if (ro) [el.view3d, el.top, el.section].forEach((c) => ro.observe(c));
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', redraw);

  e.dispose = function () {
    play.on = false;
    window.removeEventListener('resize', redraw);
    if (ro) ro.disconnect();
    if (mq && mq.removeEventListener) mq.removeEventListener('change', redraw);
    view3d.dispose();
  };

  return e;
}
