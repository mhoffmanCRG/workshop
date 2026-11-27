/*
 * The LinuxCNC link, in layers:
 *   bridge.js   transport to the AXIS Tools tab (linuxcnc/mill/python/web_tab.py)
 *   machine.js  the machine controller every page shares: status, toolbar, Send / Cycle start /
 *               Pause / Stop (started by shared/mount.jsx)
 *   react.js    hooks: useMachine (read the state) and useMachineProgram (offer G-code)
 *   mock.js     dev-only stand-in for web_tab.py (?mock-linuxcnc under npm run dev)
 * Tools import from here.
 */
export {
  isRunning, stateLabel, droEntries, programLoaded, getMachine, subscribeMachine,
  sendProgram, runProgram, pauseOrResume, stopMachine, setFollow, SEND_HINT
} from './machine.js';
export { useMachine, useMachineProgram } from './react.js';
