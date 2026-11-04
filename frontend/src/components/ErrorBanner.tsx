import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  // 'info' for notices that aren't failures (e.g. the SDK switched devices).
  tone?: 'error' | 'info';
  // Positioning/width classes. Defaults to a full-width strip under the header;
  // the idle dialer overrides it to sit inside the address-input column.
  className?: string;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  onDismiss,
  tone = 'error',
  className = 'mx-auto mt-2 w-[calc(100%-2rem)]',
}) => {
  const isError = tone === 'error';
  const Icon = isError ? AlertTriangle : Info;
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`glass-panel relative z-10 flex max-w-xl items-start gap-2 rounded-xl px-4 py-2.5 text-sm ${
        isError ? 'border-danger-text/30 text-danger-text' : 'text-ink'
      } ${className}`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${isError ? 'text-danger-text' : 'text-accent-text'}`} />
      <span className="flex-1 select-text">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`-m-2 shrink-0 rounded-full p-3 transition-colors hover:bg-surface-hover hover:text-ink ${
          isError ? 'text-danger-text/70' : 'text-muted'
        }`}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default ErrorBanner;
