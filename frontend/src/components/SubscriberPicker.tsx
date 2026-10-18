import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { SheetSwitch } from './SheetPrimitives';
import { DialButtons } from './ResourceAddressList';
import { describeFetchError, subscribersAPI } from '../services/api';
import { signalWireService, switchSubscriber } from '../services/signalwire';
import { useCallStore } from '../hooks/useCallStore';
import { describeCallError } from '../hooks/useSignalWire';
import { useDialog } from '../hooks/useDialog';
import type { Subscriber } from '../types';

type SelectAddress = (path: string, video: boolean, label?: string) => void;

const PAGE_SIZE = 10;

// Do Not Disturb = unregistered. The switch reflects the SDK's isRegistered$
// (via the store), not an optimistic flag; inert while toggling or
// disconnected. Shown at the top of the phone's Subscriber panel and in the
// workbench's Session tab.
export function DoNotDisturbSwitch() {
  const [isToggling, setIsToggling] = useState(false);
  const isRegistered = useCallStore((s) => s.isRegistered);
  const isClientReady = useCallStore((s) => s.isClientReady);
  const setCallState = useCallStore((s) => s.setCallState);

  const toggle = async () => {
    setIsToggling(true);
    try {
      await signalWireService.setDoNotDisturb(isRegistered);
    } catch (err) {
      setCallState({ callError: describeCallError(err) });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className={isToggling || !isClientReady ? 'pointer-events-none opacity-50' : ''}>
      <SheetSwitch
        label="Do Not Disturb"
        hint={isRegistered ? 'Stay connected but stop receiving calls' : 'Not receiving calls (this session only)'}
        checked={!isRegistered}
        onChange={toggle}
      />
    </div>
  );
}

// The space's subscribers, two things each: *call* it (Audio/Video fill the
// dial field with its /private/<name> address) or *become* it ("Switch").
// Switching persists the choice and reloads the page (see switchSubscriber in
// signalwire.ts) -- the SignalWire client authenticates as a fixed identity at
// construction time and is never re-initialized in place, so there's no
// in-session way to "become" someone else. Fetches fresh on mount; shared by
// the phone's Subscriber panel and the workbench's Destinations pane.
export function SubscriberList({ onSelectAddress }: { onSelectAddress: SelectAddress }) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry to re-run the first-page load after a failure.
  const [reloadKey, setReloadKey] = useState(0);

  const activeId = signalWireService.getActiveSubscriberId();

  useEffect(() => {
    let cancelled = false;
    setSubscribers([]);
    setHasMore(false);
    setIsLoading(true);
    setError(null);

    subscribersAPI
      .list(0, PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setSubscribers(page.subscribers);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (!cancelled) setError(describeFetchError(err, 'Failed to load subscribers'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleLoadMore = () => {
    setIsLoadingMore(true);
    setError(null);

    subscribersAPI
      .list(subscribers.length, PAGE_SIZE)
      .then((page) => {
        setSubscribers((prev) => [...prev, ...page.subscribers]);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        setError(describeFetchError(err, 'Failed to load more'));
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Loading subscribers...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-4 text-sm text-danger-text">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="shrink-0 rounded-full border border-edge-strong bg-surface-2 px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (subscribers.length === 0) {
    return <div className="px-3 py-4 text-sm text-muted">No subscribers found in this space.</div>;
  }

  return (
    <div className="space-y-0.5">
      {subscribers.map((subscriber) => {
        const isActive = subscriber.id === activeId;
        // A subscriber normally has one address with audio and video channels.
        const address = subscriber.addresses.find((a) => a.channels.audio) ?? subscriber.addresses[0];
        const audioPath = address?.channels.audio ?? null;
        const videoPath = address?.channels.video && address.channels.video !== audioPath ? address.channels.video : null;
        return (
          <div key={subscriber.id} className="rounded-lg px-3 py-2 transition-colors hover:bg-surface-hover">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {subscriber.display_name}
                  {isActive && <span className="text-faint"> (you)</span>}
                </span>
                <span className="block truncate font-mono text-[11px] text-faint">
                  {audioPath ? audioPath.replace(/\?channel=.*$/, '') : subscriber.email ?? ''}
                </span>
              </span>
              {isActive ? (
                <Check size={16} className="shrink-0 text-accent-text" aria-label="Signed in as this subscriber" />
              ) : (
                <button
                  type="button"
                  onClick={() => switchSubscriber(subscriber.id)}
                  title="Reload the dialer signed in as this subscriber"
                  className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  Switch
                </button>
              )}
            </div>
            {audioPath && (
              <div className="mt-1.5">
                <DialButtons
                  audioPath={audioPath}
                  videoPath={videoPath}
                  label={subscriber.display_name}
                  disabled={isActive}
                  disabledReason="This is the subscriber you're signed in as"
                  onSelectAddress={onSelectAddress}
                />
              </div>
            )}
          </div>
        );
      })}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
          {isLoadingMore ? 'Loading...' : 'Load 10 more'}
        </button>
      )}
    </div>
  );
}

interface SubscriberPickerProps {
  isOpen: boolean;
  onClose: () => void;
  // Fills the dial field with a subscriber's address (browser-to-browser
  // call); same handler as the resources panel.
  onSelectAddress: SelectAddress;
}

// The phone's Subscriber header panel: Do Not Disturb, then the list.
const SubscriberPicker: React.FC<SubscriberPickerProps> = ({ isOpen, onClose, onSelectAddress }) => {
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscriber-title"
      className="glass-panel relative z-10 mx-auto mt-2 max-h-[60dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl px-2 py-2 short:max-h-[calc(100dvh-4.5rem)]"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span id="subscriber-title" className="text-xs font-medium uppercase tracking-wider text-muted">Subscribers</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <DoNotDisturbSwitch />
      <div className="mx-3 my-1 border-t border-edge-strong" />
      <SubscriberList onSelectAddress={onSelectAddress} />
    </div>
  );
};

export default SubscriberPicker;
