/*
 * Layer 3 of the LinuxCNC link: React bindings for the shared machine controller (machine.js).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { getMachine, subscribeMachine, setProgram } from './machine.js';

/**
 * Read from the machine state and re-render when the selected part changes, e.g.
 * useMachine((m) => m.status). Pick the smallest part you need: status changes about 10 times
 * a second while the machine moves. The selector must return a stored value, not a new object.
 */
export function useMachine(selector = (m) => m) {
  return useSyncExternalStore(subscribeMachine, () => selector(getMachine()));
}

/**
 * Offer the page's G-code to LinuxCNC: the AXIS toolbar shows Send to LinuxCNC and Cycle start
 * for it while the component is mounted. gcode may be empty (nothing valid yet: Send is greyed).
 *   fileName  name it is saved under in PROGRAM_PREFIX
 *   hint      toolbar text until the first message (defaults to SEND_HINT)
 *   follow    true if the tool draws the machine's live position (adds "Show machine")
 */
export function useMachineProgram({ gcode, fileName, hint, follow = false }) {
  useEffect(() => {
    setProgram({ gcode: gcode || '', fileName: fileName || '', hint: hint || '', follow: !!follow });
  }, [gcode, fileName, hint, follow]);
  useEffect(() => () => setProgram(null), []);
}
