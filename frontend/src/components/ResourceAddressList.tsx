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

interface ResourceAddressListProps<T extends DialableResource> {
  onSelectAddress: (path: string, video: boolean) => void;
  fetchPage: (offset: number, limit: number) => Promise<ResourcePage<T>>;
  getRowLabel: (item: T, address: DialableAddress) => string;
  emptyMessage: string;
  loadingMessage: string;
}

const PAGE_SIZE = 10;

interface AddressRow<T extends DialableResource> {
  item: T;
  address: DialableAddress;
  audioPath: string;
  videoPath: string | null;
}

// Every address carries one dial URL per channel (audio/video/messaging), each
// already including the right `?channel=...` query string. Default to the
// audio channel; only surface a separate video option when it's a distinct URL.
function rowsFor<T extends DialableResource>(items: T[]): Array<AddressRow<T>> {
  const rows: Array<AddressRow<T>> = [];
  for (const item of items) {
    for (const address of item.addresses) {
      const audioPath = address.channels.audio ?? Object.values(address.channels)[0];
      if (!audioPath) continue;
      const videoPath =
        address.channels.video && address.channels.video !== audioPath ? address.channels.video : null;
      rows.push({ item, address, audioPath, videoPath });
    }
  }
  return rows;
}

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

  const rows = rowsFor(items);

  if (rows.length === 0) {
    return <div className="py-4 text-sm text-gray-400">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map(({ item, address, audioPath, videoPath }) => (
        <div key={`${item.id}-${address.id}`} className="rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.06]">
          <div className="mb-1.5 flex flex-col">
            <span className="truncate text-sm font-medium text-white">{getRowLabel(item, address)}</span>
            <span className="truncate text-xs text-gray-500">{audioPath}</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSelectAddress(audioPath, false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-gray-200 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white active:scale-[0.97]"
            >
              <Phone size={13} /> Audio
            </button>
            <button
              type="button"
              onClick={() => videoPath && onSelectAddress(videoPath, true)}
              disabled={!videoPath}
              aria-label="Dial with video"
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors active:scale-[0.97] ${
                videoPath
                  ? 'border-white/10 bg-white/[0.06] text-gray-200 hover:bg-white/15 hover:text-white'
                  : 'cursor-not-allowed border-white/5 bg-white/[0.02] text-gray-600'
              }`}
            >
              <Video size={13} /> Video
            </button>
          </div>
        </div>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
          {isLoadingMore ? 'Loading...' : 'Load 10 more'}
        </button>
      )}
    </div>
  );
}

export default ResourceAddressList;
