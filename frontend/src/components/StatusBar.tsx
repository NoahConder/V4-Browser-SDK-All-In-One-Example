import React, { useEffect, useState } from 'react';
import { useCallStore } from '../hooks/useCallStore';

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
  // The centered title collides with header icons (and swallows taps meant for
  // them) at phone width -- which, with the desktop column in globals.css, is
  // every layout except landscape phones. Screens with icons set this to show
  // it only there.
  hasIcons?: boolean;
}

// Shared top bar for the dialer and call screens: connection dot (live
// isClientReady -- it can drop after startup on a token-refresh hiccup or
// network blip), title, any per-screen controls, clock, and active subscriber.
const StatusBar: React.FC<StatusBarProps> = ({ children, hasIcons = false }) => {
  const isClientReady = useCallStore((s) => s.isClientReady);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const clock = useClock();

  return (
    <div className="glass-bar relative flex min-h-12 items-center justify-between px-4 py-1 text-sm sm:px-6">
      <span
        role="status"
        title={isClientReady ? 'Connected to SignalWire' : 'Reconnecting to SignalWire…'}
        className="flex h-10 items-center gap-2"
      >
        <span
          className={`h-2 w-2 rounded-full ${isClientReady ? 'bg-ios-green' : 'bg-amber-400 animate-pulse'}`}
        />
        {/* Text only where there's room for it; on phones the pulsing amber dot
            carries it (and the sr-only copy below covers screen readers). */}
        {!isClientReady && <span aria-hidden className="hidden text-xs text-amber-400 sm:inline">Reconnecting…</span>}
        <span className="sr-only">{isClientReady ? 'Connected' : 'Reconnecting'}</span>
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 font-medium tracking-wide text-gray-400 ${
          hasIcons ? 'hidden short:block' : ''
        }`}
      >
        SignalWire
      </span>
      <div className="flex items-center gap-1">
        {children}
        <div className="ml-1 flex flex-col items-end leading-tight">
          <span className="text-gray-400 tabular-nums">{clock}</span>
          {activeSubscriberName && (
            <span className="max-w-24 truncate text-[10px] text-gray-500">{activeSubscriberName}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
