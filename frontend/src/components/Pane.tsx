import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CodeRef from './CodeRef';
import type { FeatureKey } from '../codeMap';

type Side = 'left' | 'right';

interface PaneToggleProps {
  label: string;
  side: Side;
  collapsed: boolean;
  onToggle: () => void;
}

// The chevron that folds a workbench pane down to its rail and back. Rendered
// by the pane's tab strip while open, and by the rail while collapsed.
export const PaneToggle: React.FC<PaneToggleProps> = ({ label, side, collapsed, onToggle }) => {
  const pointsLeft = side === 'left' ? !collapsed : collapsed;
  const Icon = pointsLeft ? ChevronLeft : ChevronRight;
  const action = collapsed ? 'Expand' : 'Collapse';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${action} ${label}`}
      title={`${action} ${label}`}
      aria-expanded={!collapsed}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <Icon size={16} />
    </button>
  );
};

interface PaneProps {
  label: string;
  side: Side;
  collapsed: boolean;
  onToggle: () => void;
  // The "where's the code" entry for what the pane currently shows.
  codeRef: FeatureKey;
  children: React.ReactNode;
}

// A workbench side pane: a plain region, never a dialog (useDialog would move
// focus into it and trap Tab, stealing the address input's focus and
// Enter-to-call). Its header row names it, carries the code link for the
// active tab and the fold toggle; the tab strip below is the child's own.
// Collapsed, it shrinks to a rail (Workbench.tsx sets the grid track) but
// keeps its children mounted under `hidden`, so the Inspector's last
// statistics, connection-test result and event-log scroll survive a fold.
export const Pane: React.FC<PaneProps> = ({ label, side, collapsed, onToggle, codeRef, children }) => (
  <section
    role="region"
    aria-label={label}
    className={`flex min-h-0 flex-col bg-canvas ${side === 'left' ? 'border-r' : 'border-l'} border-edge`}
  >
    {!collapsed && (
      <div
        className={`flex h-9 shrink-0 items-center gap-1 border-b border-edge px-3 ${
          side === 'left' ? '' : 'flex-row-reverse'
        }`}
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
        <CodeRef feature={codeRef} align={side === 'left' ? 'left' : 'right'} />
        <span className="flex-1" />
        <PaneToggle label={label} side={side} collapsed={false} onToggle={onToggle} />
      </div>
    )}
    {collapsed && (
      <div className="flex flex-1 flex-col items-center gap-3 py-2">
        <PaneToggle label={label} side={side} collapsed onToggle={onToggle} />
        <span aria-hidden className="text-[11px] font-medium uppercase tracking-wider text-faint [writing-mode:vertical-rl]">
          {label}
        </span>
      </div>
    )}
    <div className={collapsed ? 'hidden' : 'contents'}>{children}</div>
  </section>
);
