import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
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
    console.error('ErrorBoundary caught:', error, errorInfo);

    // If it's a DOM manipulation error, try to recover
    if (error.message.includes('removeChild') || error.message.includes('Node')) {
      console.log('DOM manipulation error detected, attempting recovery...');
      // Reset the error state after a brief delay to retry
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 100);
    }
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI - just show loading briefly
      return (
        <div className="flex flex-col h-dvh bg-black items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ios-green mb-4 mx-auto"></div>
            <p className="text-gray-400">Recovering...</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;