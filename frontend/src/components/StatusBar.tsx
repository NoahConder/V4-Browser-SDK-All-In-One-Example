import React, { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { useCallStore } from '../hooks/useCallStore';
import { useWorkbench } from '../hooks/useWorkbench';

const formatClock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Ticks on the minute boundary, so the header clock doesn't freeze at whatever
// time the screen last happened to re-render.
const useClock = (): string => {
  const [now, setNow] = useState(() => formatClock(new Date()));
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(formatClock(new Date()));
      interval = setInterval(() => setNow(formatClock(new Date())), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  return now;
};

interface StatusBarProps {
  // Right-side controls, rendered just before the clock.
  children?: React.ReactNode;
  // Makes the identity chip (the active subscriber's name) a button; the
  // dialer uses it to open the Subscriber panel. Without it the chip is text.
  onIdentityClick?: () => void;
  // The centered title collides with header icons (and swallows taps meant for
  // them) at phone width -- which, with the desktop column in globals.css, is
  // every layout except landscape phones. Screens with icons set this to show
  // it only there.
  hasIcons?: boolean;
}

// Shared top bar for the dialer and call screens: connection dot (live
// isClientReady -- it can drop after startup on a token-refresh hiccup or
// network blip), the active subscriber as a chip (who you are signed in as
// drives browser-to-browser testing, so it gets more than 10px under the
// clock), title, any per-screen controls, and the clock.
const StatusBar: React.FC<StatusBarProps> = ({ children, onIdentityClick, hasIcons = false }) => {
  const isClientReady = useCallStore((s) => s.isClientReady);
  const isRegistered = useCallStore((s) => s.isRegistered);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const clock = useClock();
  // The clock is phone chrome; on the desktop workbench the OS shows one.
  const workbench = useWorkbench();

  // Hidden on the narrowest phones (320px), where the four header icons and
  // the clock already fill the bar; the Subscriber panel marks "(you)" there.
  const identityClass =
    'hidden min-[360px]:flex h-7 max-w-28 items-center rounded-full bg-surface-2 px-2.5 text-xs text-ink sm:max-w-40';
  const identityTitle = `Signed in as ${activeSubscriberName}`;

  return (
    <div className="glass-bar relative flex min-h-12 items-center justify-between px-4 pb-1 pt-safe text-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
      <span
        role="status"
        title={isClientReady ? 'Connected to SignalWire' : 'Reconnecting to SignalWire…'}
        className="flex h-10 items-center gap-2"
      >
        <span
          className={`h-2 w-2 rounded-full ${isClientReady ? 'bg-success' : 'bg-warn animate-pulse'}`}
        />
        {/* Text only where there's room for it; on phones the pulsing amber dot
            carries it (and the sr-only copy below covers screen readers). */}
        {!isClientReady && <span aria-hidden className="hidden text-xs text-warn-text sm:inline">Reconnecting…</span>}
        <span className="sr-only">{isClientReady ? 'Connected' : 'Reconnecting'}</span>
        {/* Do Not Disturb (unregistered): connected, so the dot stays green,
            but incoming calls won't arrive. Toggled in the Subscriber panel. */}
        {isClientReady && !isRegistered && (
          <span title="Do Not Disturb — not receiving calls" className="flex items-center text-warn-text">
            <BellOff size={12} aria-hidden />
            <span className="sr-only">Do Not Disturb</span>
          </span>
        )}
      </span>
      {activeSubscriberName &&
        (onIdentityClick ? (
          <button
            type="button"
            onClick={onIdentityClick}
            title={`${identityTitle} — open Subscribers`}
            className={`${identityClass} border border-edge-strong transition-colors hover:bg-surface-hover hover:text-ink`}
          >
            <span className="truncate">{activeSubscriberName}</span>
          </button>
        ) : (
          <span title={identityTitle} className={identityClass}>
            <span className="truncate">{activeSubscriberName}</span>
          </span>
        ))}
      </div>
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 font-display font-semibold tracking-tight text-ink-strong ${
          hasIcons ? 'hidden short:block' : ''
        }`}
      >
        SignalWire
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {!workbench && <span className="ml-1 text-muted tabular-nums">{clock}</span>}
      </div>
    </div>
  );
};

export default StatusBar;
