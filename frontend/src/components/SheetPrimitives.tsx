import React, { useId } from 'react';
import { Copy, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';

// Building blocks for the bottom sheets over the call screen (More controls,
// Call statistics) and the idle-screen settings.

interface SheetShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Backdrop (tap to close) plus the frosted bottom panel. Rendered only while
// open, so the dialog behavior (focus trap, Escape, focus return) is always on.
export const SheetShell: React.FC<SheetShellProps> = ({ title, onClose, children }) => {
  const titleId = useId();
  const dialogRef = useDialog(true, onClose);
  return (
  <div className="absolute inset-0 z-20 flex flex-col justify-end">
    <div className="absolute inset-0 bg-black/60" onClick={onClose} />

    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="glass-panel relative z-10 mx-auto mb-4 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-2 py-2"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span id={titleId} className="text-xs font-medium uppercase tracking-wider text-gray-400">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
  </div>
  );
};

// Divider with a small caps label above a group of rows.
export const SheetSection: React.FC<{ label: string }> = ({ label }) => (
  <div className="mt-1 border-t border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
    {label}
  </div>
);

interface SheetRowProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const SheetRow: React.FC<SheetRowProps> = ({ icon: Icon, label, active, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
  >
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        active ? 'bg-white text-black' : 'bg-white/6 text-gray-300'
      }`}
    >
      <Icon size={18} />
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm text-white">{label}</span>
    </span>
  </button>
);

interface SheetSwitchProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  // Smaller secondary line under the label.
  hint?: string;
}

export const SheetSwitch: React.FC<SheetSwitchProps> = ({ label, checked, onChange, hint }) => (
  <button
    type="button"
    onClick={onChange}
    role="switch"
    aria-checked={checked}
    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10"
  >
    <span className="min-w-0">
      <span className="block text-sm text-white">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </span>
    <span
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-ios-green' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </span>
  </button>
);

interface SheetStatProps {
  label: string;
  value: React.ReactNode;
  // Tooltip on the label explaining the figure.
  hint?: string;
  onCopy?: () => void;
}

// A label/value line. The value is selectable (the body disables selection)
// and optionally copyable.
export const SheetStat: React.FC<SheetStatProps> = ({ label, value, hint, onCopy }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-1.5">
    <span className="shrink-0 text-sm text-gray-400" title={hint}>
      {label}
    </span>
    <span className="flex min-w-0 items-center gap-1.5 text-right text-sm text-white tabular-nums">
      <span className="truncate select-text">{value}</span>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          className="-m-1 shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Copy size={13} />
        </button>
      )}
    </span>
  </div>
);
