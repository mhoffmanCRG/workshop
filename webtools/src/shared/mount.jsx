import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './theme.css';

/**
 * Start a page of the tool suite: renders `element` into #root inside the error boundary.
 * Every page's main.jsx calls this, so they all get the shared theme and crash screen.
 *
 * No StrictMode: tools like Gear own a WebGL context and canvas overlays, and StrictMode's
 * double mount in development would set them up twice.
 */
export function mount(element, name) {
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary name={name}>{element}</ErrorBoundary>
  );
}
