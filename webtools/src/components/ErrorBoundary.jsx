import { Component } from 'react';

// React unmounts the whole tree when a render or effect throws, which leaves the AXIS Tools
// tab blank with no hint why. Show the error and a way to reload instead.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Pulley G-code crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>The page hit an error and stopped. Reloading usually fixes it; your settings are kept.</p>
        <pre>{String(error && (error.stack || error.message || error))}</pre>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
