import { useEffect, useRef, useState } from 'react';
import { IDLE_INFO } from '../lib/engine.js';

/*
 * LinuxCNC link. Only shown inside the AXIS "Tools" tab (linuxcnc/mill/python/web_tab.py), which
 * provides window.webkit.messageHandlers.linuxcnc, replies through window.linuxcncReply and
 * sends machine status about 10 times a second through window.linuxcncStatus.
 */
export function linuxcncHandler() {
  return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.linuxcnc;
}

const SEND_INFO = 'Send loads this G-code into AXIS. The preview and drawings then follow the machine while it runs.';

function running(st) { return !!st && st.interp !== 'idle'; }
// Is AXIS holding exactly the G-code now on the page?
function oursLoaded(st, sent, r) { return !!(st && sent && r && sent.gcode === r.gcode && st.file === sent.path); }

// Program move whose G-code line the machine is on (moves are in line order).
function moveAtLine(result, line) {
  const mv = result.program.moves;
  let lo = 0, hi = mv.length - 1;
  if (line < mv[0].line) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mv[mid].line <= line) lo = mid; else hi = mid - 1; }
  return lo;
}

function stateLabel(st) {
  if (st.error) return ['No status: ' + st.error, 'bad'];
  if (st.task === 'estop') return ['E-stop', 'bad'];
  if (st.task !== 'on') return ['Machine off', 'warn'];
  if (st.paused) return ['Paused', 'warn'];
  if (running(st)) return ['Running', 'ok'];
  if (!st.homed) return ['Not homed', 'warn'];
  return ['Ready', 'ok'];
}

export default function MachinePanel({ engineRef, refreshRef, result, fileName }) {
  const [st, setSt] = useState(null);
  const [sent, setSent] = useState(null);
  const [info, setInfo] = useState(SEND_INFO);
  const [followOn, setFollowOn] = useState(true);
  const [sending, setSending] = useState(false);
  const live = useRef({ st: null, sent: null, follow: true, wasRunning: false, showing: false, pending: {}, nextId: 1 });
  live.current.sent = sent;
  live.current.follow = followOn;

  function send(cmd, args) {
    const L = live.current, id = L.nextId++;
    return new Promise((resolve) => {
      L.pending[id] = resolve;
      linuxcncHandler().postMessage(JSON.stringify({ id, cmd, ...(args || {}) }));
    });
  }

  // Draw the machine's live position on the 3D preview and both drawings.
  function follow() {
    const L = live.current, e = engineRef.current;
    if (!e || e.play.active) return;                 // the user is scrubbing the simulation
    const r = e.result, s = L.st;
    const ok = L.follow && s && s.pos && !s.error && r && r.gcode;
    if (!ok) { if (L.showing) { L.showing = false; e.stopPlayback(); } return; }
    const p = r.params, pos = s.pos;
    const Lk = p.rotaryParallel === 'Y' ? 'Y' : 'X', Ck = Lk === 'X' ? 'Y' : 'X', Rk = p.rotaryLetter;
    if (pos[Lk] === undefined || pos.Z === undefined) return;
    const P = r.program, ours = oursLoaded(s, L.sent, r) && running(s) && s.line > 0;
    const i = ours ? moveAtLine(r, s.line - 1) : 0, m = P.moves[i], from = i ? P.moves[i - 1] : P.start;
    const pose = { L: pos[Lk], C: pos[Ck] || 0, Z: pos.Z - (P.zOff || 0), P: -p.topSense * (pos[Rk] || 0), L0: from.L, move: i };
    e.showMachinePose(pose, m, ours ? m.line : -1);
    L.showing = true;
    e.setInfo(ours ? 'Machine   line ' + s.line + '   ' + (e.play.lines[s.line - 1] || '')
      : 'Machine position shown. ' + IDLE_INFO);
  }

  const followFn = useRef(follow);
  followFn.current = follow;

  useEffect(() => {
    const L = live.current;
    window.linuxcncReply = (id, ok, message, extra) => {
      const done = L.pending[id];
      delete L.pending[id];
      if (done) done({ ok, message, extra: extra || {} });
    };
    window.linuxcncStatus = (status) => {
      L.st = status;
      const e = engineRef.current;
      if (!status.error) {
        // a program starting on the machine takes over the preview from the simulation
        if (running(status) && !L.wasRunning && e && e.play.active) e.stopPlayback();
        if (L.wasRunning && !running(status) && e && oursLoaded(status, L.sent, e.result)) setInfo('Program finished or stopped.');
        L.wasRunning = running(status);
      }
      setSt(status);
      followFn.current();
    };
    refreshRef.current = () => { if (L.st) followFn.current(); };
    return () => {
      delete window.linuxcncReply;
      delete window.linuxcncStatus;
      refreshRef.current = () => {};
    };
  }, [engineRef, refreshRef]);

  useEffect(() => { followFn.current(); }, [followOn]);

  const ok = !!(result && result.gcode), ours = oursLoaded(st, sent, result), busy = running(st);
  const [stateText, stateCls] = st ? stateLabel(st) : ['', ''];
  const runTitle = !st ? '' : st.task !== 'on' ? 'Machine is not on' : !st.homed ? 'Home the machine first' :
    !ours ? 'Send this G-code to LinuxCNC first' : '';

  function onSend() {
    if (!ok) return;
    const name = fileName(), gcode = result.gcode;
    setInfo('Sending ' + name + '…');
    setSending(true);
    send('load', { name, gcode }).then((r) => {
      if (!r.ok && r.extra.exists && window.confirm(r.message + '\n\nReplace it?')) return send('load', { name, gcode, overwrite: true });
      return r;
    }).then((r) => {
      if (r.ok || r.extra.path) setSent({ path: r.extra.path, gcode });
      setInfo(r.message);
      setSending(false);
    });
  }
  function onRun() {
    if (!ours) return;
    if (!window.confirm('Start ' + sent.path + ' on the machine now?\n\nCheck the stock, work offset and tool before starting.')) return;
    send('run', { path: sent.path }).then((r) => setInfo(r.message));
  }

  return (
    <section className="panel machine" id="machine" aria-labelledby="machineTitle">
      <div className="machine-head">
        <h2 id="machineTitle">LinuxCNC</h2>
        <span className={'mc-state ' + stateCls}>{stateText}</span>
      </div>
      <div className="dro">
        {st && <>
          {Object.keys(st.pos || {}).map((k) => (
            <span key={k}><b>{k}</b>{st.pos[k].toFixed(3)}{'ABC'.indexOf(k) >= 0 ? '°' : ''}</span>
          ))}
          <span><b>F</b>{(st.vel || 0).toFixed(0)}</span>
          <span><b>S</b>{Math.abs(st.spindle || 0).toFixed(0)}</span>
        </>}
      </div>
      <div className="machine-buttons">
        <button type="button" disabled={!ok || !st || busy || sending} onClick={onSend}>Send to LinuxCNC</button>
        <button type="button" disabled={!st || busy || st.task !== 'on' || !st.homed || !ours} title={runTitle} onClick={onRun}>Cycle start</button>
        <button type="button" className="quiet" disabled={!busy}
          onClick={() => send(st && st.paused ? 'resume' : 'pause').then((r) => setInfo(r.message))}>
          {st && st.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="quiet danger" onClick={() => send('stop').then((r) => setInfo(r.message))}>Stop</button>
        <label className="inline"><input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} /> Show the machine in the preview</label>
      </div>
      <output className="play-info">{info}</output>
    </section>
  );
}
