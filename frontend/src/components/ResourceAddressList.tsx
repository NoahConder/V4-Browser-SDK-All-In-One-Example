import { useEffect, useState } from 'react';
import { Loader2, Phone, Video } from 'lucide-react';
import type { DialableAddress } from '../types';

export interface DialableResource {
  id: string;
  addresses: DialableAddress[];
}

export interface ResourcePage<T extends DialableResource> {
  items: T[];
  hasMore: boolean;
}

const PAGE_SIZE = 10;

// One dialable row: a label, the audio dial URL, and the video dial URL when
// the address has a distinct one.
export interface AddressRow {
  key: string;
  label: string;
  audioPath: string;
  videoPath: string | null;
  // Small tag after the label (the Directory tab shows the resource type).
  badge?: { label: string; className: string };
  // Listed but not dialable (the Directory entry for yourself).
  disabled?: boolean;
  disabledReason?: string;
}

// Every address carries one dial URL per channel (audio/video/messaging), each
// already including the right `?channel=...` query string. Default to the
// audio channel; only surface a separate video option when it's a distinct URL.
// (Not exported: a non-component export here would break Fast Refresh.)
function rowsFor<T extends DialableResource>(
  items: T[],
  getRowLabel: (item: T, address: DialableAddress) => string,
): AddressRow[] {
  const rows: AddressRow[] = [];
  for (const item of items) {
    for (const address of item.addresses) {
      const audioPath = address.channels.audio ?? Object.values(address.channels)[0];
      if (!audioPath) continue;
      const videoPath =
        address.channels.video && address.channels.video !== audioPath ? address.channels.video : null;
      rows.push({ key: `${item.id}-${address.id}`, label: getRowLabel(item, address), audioPath, videoPath });
    }
  }
  return rows;
}

interface AddressRowListProps {
  rows: AddressRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectAddress: (path: string, video: boolean) => void;
  emptyMessage: string;
  loadingMessage: string;
  loadMoreLabel?: string;
}

// Presentational list shared by the REST-backed tabs (ResourceAddressList
// below) and the SDK-backed Directory tab, which own their loading state.
export function AddressRowList({
  rows,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onLoadMore,
  onSelectAddress,
  emptyMessage,
  loadingMessage,
  loadMoreLabel = `Load ${PAGE_SIZE} more`,
}: AddressRowListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> {loadingMessage}
      </div>
    );
  }

  if (error) {
    return <div className="py-4 text-sm text-red-400">{error}</div>;
  }

  if (rows.length === 0) {
    return <div className="py-4 text-sm text-gray-400">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg px-2 py-2 transition-colors hover:bg-white/6">
          <div className="mb-1.5 flex flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-white">{row.label}</span>
              {row.badge && (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${row.badge.className}`}
                >
                  {row.badge.label}
                </span>
              )}
            </span>
            <span className="truncate text-xs text-gray-500">{row.audioPath}</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSelectAddress(row.audioPath, false)}
              disabled={row.disabled}
              title={row.disabled ? row.disabledReason : undefined}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-medium text-gray-200 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/2 disabled:text-gray-600 disabled:hover:bg-white/2"
            >
              <Phone size={13} /> Audio
            </button>
            <button
              type="button"
              onClick={() => row.videoPath && onSelectAddress(row.videoPath, true)}
              disabled={!row.videoPath || row.disabled}
              title={row.disabled ? row.disabledReason : undefined}
              aria-label="Dial with video"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-medium text-gray-200 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/2 disabled:text-gray-600 disabled:hover:bg-white/2"
            >
              <Video size={13} /> Video
            </button>
          </div>
        </div>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
          {isLoadingMore ? 'Loading...' : loadMoreLabel}
        </button>
      )}
    </div>
  );
}

interface ResourceAddressListProps<T extends DialableResource> {
  onSelectAddress: (path: string, video: boolean) => void;
  fetchPage: (offset: number, limit: number) => Promise<ResourcePage<T>>;
  getRowLabel: (item: T, address: DialableAddress) => string;
  emptyMessage: string;
  loadingMessage: string;
}

// REST-backed list (SWML Scripts, SIP Credentials): fetches offset/limit
// pages from the backend and renders them with AddressRowList.
function ResourceAddressList<T extends DialableResource>({
  onSelectAddress,
  fetchPage,
  getRowLabel,
  emptyMessage,
  loadingMessage,
}: ResourceAddressListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetches the first page fresh on mount -- this is a testing tool, so we favor
  // freshness over caching. The parent panel remounts this component (via a
  // `key`) whenever the active tab or open state changes, which is what drives
  // "fetch fresh every time the panel/tab opens".
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setHasMore(false);
    setIsLoading(true);
    setError(null);

    fetchPage(0, PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const handleLoadMore = () => {
    setIsLoadingMore(true);
    setError(null);

    fetchPage(items.length, PAGE_SIZE)
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load more');
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  return (
    <AddressRowList
      rows={rowsFor(items, getRowLabel)}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      error={error}
      hasMore={hasMore}
      onLoadMore={handleLoadMore}
      onSelectAddress={onSelectAddress}
      emptyMessage={emptyMessage}
      loadingMessage={loadingMessage}
    />
  );
}

export default ResourceAddressList;
