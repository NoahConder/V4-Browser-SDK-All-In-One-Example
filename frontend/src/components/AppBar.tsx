import React, { useEffect, useState } from 'react';
import { BellOff, Moon, Sun } from 'lucide-react';
import { useCallStore } from '../hooks/useCallStore';
import { saveSettings } from '../services/settings';
import { applyTheme, currentTheme } from '../services/theme';

interface AppBarProps {
  // Right-side controls: the phone layout's panel buttons.
  children?: React.ReactNode;
  // Makes the identity chip (the active subscriber's name) a button: the
  // workbench selects its Subscribers tab, the phone layout opens the
  // Subscriber panel. Without it the chip is text.
  onIdentityClick?: () => void;
}

// Follows <html data-theme>, which the Appearance setting and the toggle
// here both write through services/theme.ts.
const useResolvedTheme = () => {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
};

// The top bar of every layout: wordmark, the connection pill (live
// isClientReady -- it can drop after startup on a token-refresh hiccup or
// network blip -- plus Do Not Disturb), the active subscriber as a chip (who
// you are signed in as drives browser-to-browser testing), per-layout
// controls, and the theme toggle. The only `glass-bar pt-safe` element on
// the phone layout (the a11y spec counts it).
const AppBar: React.FC<AppBarProps> = ({ children, onIdentityClick }) => {
  const isClientReady = useCallStore((s) => s.isClientReady);
  const isRegistered = useCallStore((s) => s.isRegistered);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const theme = useResolvedTheme();

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    saveSettings({ theme: next });
    applyTheme(next);
  };

  // Hidden on the narrowest phones (320px), where the four panel buttons
  // already fill the bar; the Subscriber panel marks "(you)" there.
  const identityClass =
    'hidden min-[360px]:flex h-7 max-w-28 items-center rounded-md bg-surface-2 px-2.5 text-xs text-ink sm:max-w-44';
  const identityTitle = `Signed in as ${activeSubscriberName}`;

  return (
    <div className="glass-bar relative flex min-h-12 items-center justify-between gap-2 px-2 pb-1 pt-safe text-sm min-[360px]:px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="font-display text-base font-semibold tracking-tight text-ink-strong">SignalWire</span>
          <span className="hidden text-xs text-muted desk:inline">Browser SDK reference</span>
        </span>
        <span
          role="status"
          title={isClientReady ? 'Connected to SignalWire' : 'Reconnecting to SignalWire…'}
          className="flex h-7 shrink-0 items-center gap-2 rounded-md bg-surface-2 px-2 text-xs"
        >
          <span className={`h-2 w-2 rounded-full ${isClientReady ? 'bg-success' : 'bg-warn animate-pulse'}`} />
          {/* Text where there's room; on phones the dot carries it. */}
          <span className={`hidden sm:inline ${isClientReady ? 'text-muted' : 'text-warn-text'}`}>
            {isClientReady ? 'Connected' : 'Reconnecting…'}
          </span>
          <span className="sr-only sm:hidden">{isClientReady ? 'Connected' : 'Reconnecting'}</span>
          {/* Do Not Disturb (unregistered): connected, so the dot stays green,
              but incoming calls won't arrive. */}
          {isClientReady && !isRegistered && (
            <span title="Do Not Disturb — not receiving calls" className="flex items-center gap-1 text-warn-text">
              <BellOff size={12} aria-hidden />
              <span className="hidden sm:inline">DND</span>
              <span className="sr-only sm:hidden">Do Not Disturb</span>
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
      <div className="flex shrink-0 items-center gap-1">
        {children}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="hidden h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink desk:flex"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </div>
  );
};

export default AppBar;
