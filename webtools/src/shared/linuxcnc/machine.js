/*
 * Layer 2 of the LinuxCNC link: one machine controller shared by every page of the suite.
 * Plain JavaScript (the React hooks in react.js are a thin wrapper), started by shared/mount.jsx.
 *
 * It keeps the machine status and drives the AXIS toolbar on every page: state, DRO, Pause/Resume
 * and Stop are always there. A tool that makes G-code registers it with setProgram() (or the
 * useMachineProgram hook) and the toolbar gains Send to LinuxCNC and Cycle start for it, plus the
 * "Show machine" switch if the tool can draw the machine's position.
 */
import { connect, request, showToolbar } from './bridge.js';

export const SEND_HINT = 'Send loads this G-code into AXIS.';

// ------------------------------------------------------------------ status helpers

export function isRunning(st) {
  return !!st && !st.error && st.interp !== 'idle';
}

/** [text, class] for the machine state; class is ok, warn or bad. */
export function stateLabel(st) {
  if (st.error) return ['No status: ' + st.error, 'bad'];
  if (st.task === 'estop') return ['E-stop', 'bad'];
  if (st.task !== 'on') return ['Machine off', 'warn'];
  if (st.paused) return ['Paused', 'warn'];
  if (isRunning(st)) return ['Running', 'ok'];
  if (!st.homed) return ['Not homed', 'warn'];
  return ['Ready', 'ok'];
}

/** Position readout as [[letter, text], ...]: work coordinates, then feed (mm/min) and spindle (rpm). */
export function droEntries(st) {
  if (!st || st.error) return [];
  const pos = st.pos || {};
  return Object.keys(pos).map((k) => [k, pos[k].toFixed(3) + ('ABC'.indexOf(k) >= 0 ? '°' : '')])
    .concat([['F', (st.vel || 0).toFixed(0)], ['S', Math.abs(st.spindle || 0).toFixed(0)]]);
}

/** Is AXIS holding exactly the G-code the page has registered? */
export function programLoaded(s) {
  return !!(s.status && s.sent && s.program && s.program.gcode && s.sent.gcode === s.program.gcode && s.status.file === s.sent.path);
}

// ------------------------------------------------------------------ store

let state = {
  available: false,   // running inside the AXIS Tools tab with LinuxCNC up
  status: null,       // last status from web_tab.py
  program: null,      // {gcode, fileName, hint, follow} registered by the page's tool
  sent: null,         // {path, gcode} last sent to AXIS
  sending: false,
  info: null,         // last message for the toolbar; null shows the program's hint
  follow: true        // "Show machine": the tool draws the machine's live position
};
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
  publish();
}

export function getMachine() { return state; }

/** Call fn(state) on every change; returns the unsubscribe function. */
export function subscribeMachine(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function startMachine() {
  if (state.available) return;
  if (connect({ status: onStatus, toolbar: onToolbar })) set({ available: true });
}

function onStatus(st) {
  const patch = { status: st };
  if (!st.error && isRunning(state.status) && !isRunning(st) && programLoaded({ ...state, status: st })) {
    patch.info = 'Program finished or stopped.';
  }
  set(patch);
}

// ------------------------------------------------------------------ program and actions

/** Register the page's G-code (null when the page has none). */
export function setProgram(program) {
  const p = state.program;
  if (p === program || (p && program && p.gcode === program.gcode && p.fileName === program.fileName &&
    p.hint === program.hint && p.follow === program.follow)) return;
  set({ program });
}

export function sendProgram() {
  const p = state.program;
  if (!p || !p.gcode || state.sending) return;
  const gcode = p.gcode, name = p.fileName || 'program.ngc';
  set({ info: 'Sending ' + name + '…', sending: true });
  request('load', { name, gcode })
    .then((r) => (!r.ok && r.extra.exists && window.confirm(r.message + '\n\nReplace it?'))
      ? request('load', { name, gcode, overwrite: true }) : r)
    .then((r) => {
      // saved but not opened still counts as sent; a file left as it was (replace declined) does not
      const saved = r.ok || (r.extra.path && !r.extra.exists);
      set({ sending: false, info: r.message, ...(saved ? { sent: { path: r.extra.path, gcode } } : {}) });
    });
}

export function runProgram() {
  if (!programLoaded(state)) return;
  const path = state.sent.path;
  if (!window.confirm('Start ' + path + ' on the machine now?\n\nCheck the stock, work offset and tool before starting.')) return;
  request('run', { path }).then((r) => set({ info: r.message }));
}

export function pauseOrResume() {
  request(state.status && state.status.paused ? 'resume' : 'pause').then((r) => set({ info: r.message }));
}

export function stopMachine() {
  request('stop').then((r) => set({ info: r.message }));
}

export function setFollow(on) {
  set({ follow: !!on });
}

const ACTIONS = { send: sendProgram, run: runProgram, pause: pauseOrResume, stop: stopMachine, follow: setFollow };
function onToolbar(action, arg) {
  const fn = ACTIONS[action];
  if (fn) fn(arg);
}

// ------------------------------------------------------------------ toolbar

function toolbarUi(s) {
  const st = s.status, p = s.program, busy = isRunning(st), ours = programLoaded(s);
  const [stateText, stateClass] = st ? stateLabel(st) : ['', ''];
  return {
    // which of the toolbar's controls this page uses (web_tab.py hides the rest)
    controls: (p ? ['send', 'run'] : []).concat(['pause', 'stop'], p && p.follow ? ['follow'] : []),
    state: stateText,
    stateClass,
    dro: droEntries(st),
    canSend: !!(p && p.gcode && st && !st.error && !busy && !s.sending),
    canRun: !!(st && !busy && st.task === 'on' && st.homed && ours),
    runTitle: !st ? '' : st.task !== 'on' ? 'Machine is not on' : !st.homed ? 'Home the machine first' :
      !ours ? 'Send this G-code to LinuxCNC first' : '',
    canPause: busy,
    paused: !!(st && st.paused),
    follow: s.follow,
    info: s.info !== null ? s.info : p ? p.hint || SEND_HINT : ''
  };
}

function publish() {
  if (state.available) showToolbar(toolbarUi(state));
}
