/*
 * The imperative core behind the React page: owns the 3D view, the two drawings and the
 * G-code playback. Playback runs at animation-frame rate, so it writes the scrub bar, the
 * playback readout and the line marker straight to their elements instead of going through
 * React state. React is told only when the Play / Stop buttons need to change.
 */
import HTD from './htd.js';
import HTDView3D from './view3d.js';
import { drawPulley, drawGroove } from './drawings.js';

export const IDLE_INFO = 'Play runs the G-code in the 3D preview and on both drawings.';

function stamp(minutes) {
  var s = Math.floor(minutes * 60 + 1e-6), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s % 60).slice(-2);
}

/**
 * el: { view3d, pulley, groove, gcode, lineMark, scrub, playInfo } DOM elements.
 * onPlayState({ on, active }) is called whenever the Play / Stop buttons should change.
 */
export function createEngine(el, onPlayState) {
  var view3d = HTDView3D.create(el.view3d);
  var play = { active: false, on: false, t: 0, last: 0, line: -1, lines: [], pose: null };
  var e = {
    view3d: view3d,
    play: play,
    result: null,
    profiles: null,
    selected: null,
    showZero: true,
    speed: 10,
    machine: { refresh: function () {} }     // replaced by the LinuxCNC panel when it is present
  };

  function good() { return !!(e.result && e.result.gcode); }

  e.redraw2d = function () {
    var r = good() ? e.result : null;
    var opts = { selected: e.selected, showZero: e.showZero, pose: play.pose, profiles: e.profiles };
    // a failing drawing must not stop the other one (or, inside a React effect, blank the page)
    [[drawPulley, el.pulley], [drawGroove, el.groove]].forEach(function (d) {
      try { d[0](d[1], r, opts); } catch (err) { console.error('2D drawing failed:', err); }
    });
  };

  e.setResult = function (r) {
    e.result = r;
    var ok = !r.errors.length;
    play.lines = ok ? r.gcode.split('\n') : [];
    e.profiles = ok ? HTD.passProfiles(r) : null;
    view3d.setResult(ok ? r : null);
    e.redraw2d();
  };

  function buttons() { onPlayState({ on: play.on, active: play.active }); }

  // Highlight bar over the current line of the G-code box.
  e.placeLineMark = function (follow) {
    var box = el.gcode, mark = el.lineMark;
    if (play.line < 0) { mark.hidden = true; return; }
    var cs = getComputedStyle(box);
    var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4, pad = parseFloat(cs.paddingTop) || 0;
    if (follow) box.scrollTop = Math.max(0, pad + play.line * lh - box.clientHeight / 2 + lh / 2);
    mark.style.top = (pad + play.line * lh - box.scrollTop) + 'px';
    mark.style.height = lh + 'px';
    mark.hidden = false;
  };

  e.setInfo = function (text) { el.playInfo.textContent = text; };

  function showPose() {
    var P = e.result.program, mv = P.moves, lo = 0, hi = mv.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (mv[mid].t1 >= play.t) hi = mid; else lo = mid + 1; }
    var m = mv[lo], from = lo ? mv[lo - 1] : P.start;
    var f = m.t1 > m.t0 ? Math.min(1, Math.max(0, (play.t - m.t0) / (m.t1 - m.t0))) : 1;
    function mix(k) { return from[k] + (m[k] - from[k]) * f; }
    view3d.setPose({ L: mix('L'), C: mix('C'), Z: mix('Z'), P: mix('P'), L0: from.L, move: lo });
    el.scrub.value = P.total > 0 ? Math.round(play.t / P.total * 1000) : 0;
    e.setInfo(stamp(play.t) + ' / ' + stamp(P.total) + '   line ' + (m.line + 1) + '   ' + (play.lines[m.line] || ''));
    play.line = m.line;
    // the two drawings follow the playback as well
    play.pose = { move: m, C: mix('C'), Z: mix('Z'), P: mix('P') };
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

  // Show a pose that comes from outside the simulation (the live machine).
  e.showMachinePose = function (pose, move, line) {
    view3d.setPose(pose);
    play.pose = { move: move, C: pose.C, Z: pose.Z, P: pose.P };
    play.line = line;
    e.redraw2d();
    e.placeLineMark(line >= 0);
  };

  var redraw = function () { if (good()) e.redraw2d(); view3d.draw(); };
  window.addEventListener('resize', redraw);
  // The 3D canvas stretches with the layout, so redraw it whenever its box changes.
  var ro = window.ResizeObserver ? new ResizeObserver(function () { view3d.draw(); }) : null;
  if (ro) ro.observe(el.view3d);
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', redraw);

  e.dispose = function () {
    play.on = false;
    window.removeEventListener('resize', redraw);
    if (ro) ro.disconnect();
    if (mq && mq.removeEventListener) mq.removeEventListener('change', redraw);
  };

  return e;
}
