import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { startMachine, setBlocked } from './linuxcnc/machine.js';
import { installMock } from './linuxcnc/mock.js';
import { getMachineKind, unsuitable } from './machineKind.js';
import { toolById } from '../tools.js';
import './theme.css';

/**
 * Start a page of the tool suite: connects the shared LinuxCNC link (inside the AXIS Tools tab),
 * then renders `element` into #root inside the error boundary. Every page's main.jsx calls this,
 * so they all get the shared theme, crash screen and machine toolbar.
 *
 * A tool page passes its id from src/tools.js. If LinuxCNC says the machine does not suit the tool
 * (a mill tool on a lathe, Gear without an A axis) the page still works, under a warning, but its
 * G-code cannot be sent. The landing page does not list such tools; this catches old links.
 *
 * No StrictMode: tools like Gear own a WebGL context and canvas overlays, and StrictMode's
 * double mount in development would set them up twice.
 */
export function mount(element, name, toolId) {
  // dev server only: ?mock-linuxcnc fakes web_tab.py (see linuxcnc/mock.js); dropped from the build
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock-linuxcnc')) installMock();
  const m = getMachineKind();
  const reason = toolId && m.from === 'linuxcnc' ? unsuitable(toolById(toolId), m) : '';
  setBlocked(reason);
  startMachine();
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary name={name}>
      {reason && (
        <p className="machine-mismatch" role="alert">
          {reason} You can work out the G-code here, but it will not be sent to LinuxCNC.
        </p>
      )}
      {element}
    </ErrorBoundary>
  );
}
