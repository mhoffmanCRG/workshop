import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { startMachine } from './linuxcnc/machine.js';
import { installMock } from './linuxcnc/mock.js';
import './theme.css';

/**
 * Start a page of the tool suite: connects the shared LinuxCNC link (inside the AXIS Tools tab),
 * then renders `element` into #root inside the error boundary. Every page's main.jsx calls this,
 * so they all get the shared theme, crash screen and machine toolbar.
 *
 * No StrictMode: tools like Gear own a WebGL context and canvas overlays, and StrictMode's
 * double mount in development would set them up twice.
 */
export function mount(element, name) {
  // dev server only: ?mock-linuxcnc fakes web_tab.py (see linuxcnc/mock.js); dropped from the build
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock-linuxcnc')) installMock();
  startMachine();
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary name={name}>{element}</ErrorBoundary>
  );
}
