import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this value (for example the pathname) clears a caught error. */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally silent: error details can contain URLs with tokens or customer data.
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="page-message wrap" aria-labelledby="error-boundary-title">
        <h1 id="error-boundary-title" className="page-message__title">
          This page stopped working
        </h1>
        <p className="page-message__body">
          Something unexpected happened while showing this page. Your purchases and progress are not affected.
        </p>
        <div className="page-message__actions">
          <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <button type="button" className="button button--secondary" onClick={() => this.setState({ failed: false })}>
            Try again without reloading
          </button>
          <a className="button button--quiet" href="/">
            Go to the shop
          </a>
        </div>
      </section>
    );
  }
}
