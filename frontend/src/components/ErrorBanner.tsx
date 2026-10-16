import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  // Positioning/width classes. Defaults to a full-width strip under the header;
  // the idle dialer overrides it to sit inside the address-input column.
  className?: string;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss, className = 'mx-auto mt-2 w-[calc(100%-2rem)]' }) => (
  <div className={`glass-panel relative z-10 flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 text-sm text-red-300 ${className}`}>
    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
    <span className="flex-1">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      className="-m-2 shrink-0 rounded-full p-3 text-red-300/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      <X size={14} />
    </button>
  </div>
);

export default ErrorBanner;
