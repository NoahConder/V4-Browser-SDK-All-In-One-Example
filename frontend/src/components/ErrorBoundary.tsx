import React, { Component, ReactNode } from 'react';
import { log } from '../utils/log';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  // The DOM-error auto-retry below runs once per mount; a second failure
  // falls through to the reload card instead of looping.
  private retriedDomError = false;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error details for debugging
    log.error('ErrorBoundary caught:', error, errorInfo);

    // A DOM-manipulation error (e.g. a media element removed out from under
    // React) usually clears on re-render -- retry once.
    const isDomError = error.message.includes('removeChild') || error.message.includes('Node');
    if (isDomError && !this.retriedDomError) {
      this.retriedDomError = true;
      log.debug('DOM manipulation error detected, attempting recovery...');
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 100);
    }
  }

  render() {
    if (this.state.hasError) {
      // Same card as App.tsx's connection-error screen.
      return (
        <div className="app-shell flex flex-col h-dvh items-center justify-center p-8">
          <div className="glass-panel w-full max-w-sm rounded-xl p-8 text-center">
            <h1 className="text-2xl font-semibold mb-4 text-danger-text">Something went wrong</h1>
            <p className="text-muted mb-8">The dialer hit an unexpected error. Reload to start over.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-lg border border-edge-strong bg-surface-2 px-6 py-3 font-medium text-ink transition-all hover:bg-surface-hover active:scale-[0.98]"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;