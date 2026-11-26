import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './style.css';

// No StrictMode: the 3D view owns a WebGL context and overlay elements on its canvas,
// and StrictMode's double mount in development would set them up twice.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
