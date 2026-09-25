import { Component, type ReactNode } from 'react';

/** Shows a readable message instead of a blank page if rendering crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="auth-card stack">
          <h1 style={{ fontSize: 18 }}>Something went wrong</h1>
          <p className="text-2">The page hit an unexpected error. Reloading usually fixes it.</p>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)', margin: 0 }}>{this.state.error.message}</pre>
          <div className="row">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn" href="/">Go to dashboard</a>
          </div>
        </div>
      </div>
    );
  }
}
