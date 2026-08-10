import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { subscribersAPI } from '../services/api';
import { signalWireService, switchSubscriber } from '../services/signalwire';
import type { Subscriber } from '../types';

interface SubscriberPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 10;

// Picking a subscriber persists the choice and reloads the page (see
// switchSubscriber in signalwire.ts) -- the SignalWire client authenticates
// as a fixed identity at construction time and is never re-initialized in
// place, so there's no in-session way to "become" someone else.
const SubscriberPicker: React.FC<SubscriberPickerProps> = ({ isOpen, onClose }) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = signalWireService.getActiveSubscriberId();

  useEffect(() => {
    if (!isOpen) return;
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load subscribers');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

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
        setError(err instanceof Error ? err.message : 'Failed to load more');
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const handleSelect = (subscriber: Subscriber) => {
    if (subscriber.id === activeId) return;
    switchSubscriber(subscriber.id);
  };

  return (
    <div className="glass-panel relative z-10 mx-auto mt-2 max-h-64 w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-2 py-2">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Subscriber</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading subscribers...
        </div>
      ) : error ? (
        <div className="px-3 py-4 text-sm text-red-400">{error}</div>
      ) : subscribers.length === 0 ? (
        <div className="px-3 py-4 text-sm text-gray-400">No subscribers found in this space.</div>
      ) : (
        <div className="space-y-0.5">
          {subscribers.map((subscriber) => {
            const isActive = subscriber.id === activeId;
            return (
              <button
                key={subscriber.id}
                type="button"
                onClick={() => handleSelect(subscriber)}
                disabled={isActive}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{subscriber.display_name}</span>
                  {subscriber.email && (
                    <span className="block truncate text-xs text-gray-500">{subscriber.email}</span>
                  )}
                </span>
                {isActive && <Check size={16} className="shrink-0 text-ios-green" />}
              </button>
            );
          })}

          {hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
              {isLoadingMore ? 'Loading...' : 'Load 10 more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SubscriberPicker;
