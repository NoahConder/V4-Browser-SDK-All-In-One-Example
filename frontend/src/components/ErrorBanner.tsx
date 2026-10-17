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
      className={`glass-panel relative z-10 flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 text-sm ${
        isError ? 'text-red-300' : 'text-gray-200'
      } ${className}`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${isError ? 'text-red-400' : 'text-blue-400'}`} />
      <span className="flex-1 select-text">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`-m-2 shrink-0 rounded-full p-3 transition-colors hover:bg-white/10 hover:text-white ${
          isError ? 'text-red-300/70' : 'text-gray-400'
        }`}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default ErrorBanner;
