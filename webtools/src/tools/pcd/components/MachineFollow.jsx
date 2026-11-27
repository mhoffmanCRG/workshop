import { useEffect } from 'react';
import { IDLE_INFO } from '../lib/engine.js';
import { getMachine, subscribeMachine, isRunning, programLoaded } from '../../../shared/linuxcnc/index.js';

/*
 * The PCD page's part of the LinuxCNC link: draws the machine's live position on the 3D preview and
 * both drawings, and follows the running G-code line. Status, the AXIS toolbar and Send / Cycle
 * start come from the shared layer (src/shared/linuxcnc); App registers its G-code with
 * useMachineProgram. Renders nothing, and works straight on the engine so status at 10 Hz
 * doesn't re-render the page.
 */

// Program move whose G-code line the machine is on (moves are in line order).
function moveAtLine(result, line) {
  const mv = result.program.moves;
  let lo = 0, hi = mv.length - 1;
  if (line < mv[0].line) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mv[mid].line <= line) lo = mid; else hi = mid - 1; }
  return lo;
}

export default function MachineFollow({ engineRef, refreshRef }) {
  useEffect(() => {
    let showing = false, wasRunning = false;

    function follow() {
      const m = getMachine(), e = engineRef.current, st = m.status;
      if (!e || !m.available) return;
      // a program starting on the machine takes over the preview from the simulation
      if (st && !st.error) {
        const now = isRunning(st);
        if (now && !wasRunning && e.play.active) e.stopPlayback();
        wasRunning = now;
      }
      if (e.play.active) return;                       // the user is scrubbing the simulation
      const r = e.result;
      const ok = m.follow && st && st.pos && !st.error && r && r.gcode;
      if (!ok) { if (showing) { showing = false; e.stopPlayback(); } return; }
      const pos = st.pos;
      if (pos.X === undefined || pos.Y === undefined || pos.Z === undefined) return;
      const ours = programLoaded(m) && m.sent.gcode === r.gcode && isRunning(st) && st.line > 0;
      const mv = r.program.moves[ours ? moveAtLine(r, st.line - 1) : 0];
      e.showMachinePose({ X: pos.X, Y: pos.Y, Z: pos.Z }, mv, ours ? mv.line : -1);
      showing = true;
      e.setInfo(ours ? 'Machine   line ' + st.line + '   ' + (e.play.lines[st.line - 1] || '')
        : 'Machine position shown. ' + IDLE_INFO);
    }

    refreshRef.current = follow;        // App calls it after regenerating and after Stop
    const off = subscribeMachine(follow);
    follow();
    return () => { off(); refreshRef.current = () => {}; };
  }, [engineRef, refreshRef]);

  return null;
}
