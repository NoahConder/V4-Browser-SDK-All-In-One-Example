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
  // A bottom sheet by default; 'top' hangs the panel under the status bar.
  anchor?: 'top' | 'bottom';
  // Modal (default): backdrop, tap outside closes, Tab trapped. Non-modal: no
  // backdrop, taps reach what's around the panel, Tab leaves it -- for the
  // call-stats panel, which is read while Mute/End stay in use.
  modal?: boolean;
  // Extra classes for the panel itself; replaces the default max height.
  panelClassName?: string;
}

// Backdrop (tap to close) plus the frosted panel. Rendered only while open,
// so the dialog behavior (Escape, focus move and return, and -- when modal --
// the focus trap) is always on.
export const SheetShell: React.FC<SheetShellProps> = ({
  title,
  onClose,
  children,
  anchor = 'bottom',
  modal = true,
  panelClassName = 'max-h-[calc(100%-2rem)]',
}) => {
  const titleId = useId();
  const dialogRef = useDialog(true, onClose, { trapFocus: modal });
  return (
  <div
    className={`absolute inset-0 z-20 flex flex-col ${anchor === 'top' ? 'justify-start' : 'justify-end'} ${
      modal ? '' : 'pointer-events-none'
    }`}
  >
    {modal && <div className="absolute inset-0 bg-scrim" onClick={onClose} />}

    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      className={`relative z-10 mx-auto w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl px-2 py-2 ${
        anchor === 'top' ? 'mt-2' : 'mb-4'
      } ${
        // Without a backdrop the panel sits over live content, so it's
        // opaque-ish and casts a shadow instead of borrowing glass-panel's
        // near-transparent surface.
        modal
          ? 'glass-panel'
          : 'pointer-events-auto border border-edge-strong bg-surface/95 shadow-card backdrop-blur-lg'
      } ${panelClassName}`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span id={titleId} className="text-xs font-medium uppercase tracking-wider text-muted">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
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
  <div className="mt-1 border-t border-edge-strong px-3 py-2 text-xs font-medium uppercase tracking-wider text-faint">
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
    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
  >
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
      }`}
    >
      <Icon size={18} />
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm text-ink">{label}</span>
    </span>
  </button>
);

interface SheetSwitchProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  // Smaller secondary line under the label.
  hint?: string;
  disabled?: boolean;
}

export const SheetSwitch: React.FC<SheetSwitchProps> = ({ label, checked, onChange, hint, disabled }) => (
  <button
    type="button"
    onClick={onChange}
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
  >
    <span className="min-w-0">
      <span className="block text-sm text-ink">{label}</span>
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </span>
    <span
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-edge-strong'}`}
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
    <span className="shrink-0 text-sm text-muted" title={hint}>
      {label}
    </span>
    <span className="flex min-w-0 items-center gap-1.5 text-right font-mono text-[13px] text-ink tabular-nums">
      <span className="truncate select-text">{value}</span>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          className="-m-1 shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Copy size={13} />
        </button>
      )}
    </span>
  </div>
);
