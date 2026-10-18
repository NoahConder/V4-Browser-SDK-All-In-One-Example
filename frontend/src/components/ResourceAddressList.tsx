import { useEffect, useRef, useState } from 'react';
import { Loader2, Phone, Video } from 'lucide-react';
import SearchField from './SearchField';
import { describeFetchError } from '../services/api';
import type { DialableAddress } from '../types';
import { matchStatus } from '../utils/search';

export interface DialableResource {
  id: string;
  addresses: DialableAddress[];
}

export interface ResourcePage<T extends DialableResource> {
  items: T[];
  hasMore: boolean;
}

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 250;

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

const DIAL_BUTTON_CLASS =
  'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-edge-strong bg-surface-2 px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-hover hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:border-edge disabled:bg-surface-2 disabled:text-faint disabled:hover:bg-surface-2';

interface DialButtonsProps {
  audioPath: string;
  videoPath: string | null;
  // Display name passed along to onSelectAddress for the Recents log.
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
}

// The Audio / Video pair under every dialable row (Directory, SWML, SIP,
// Recents, Subscribers). Video is disabled when there's no distinct video
// channel; both are disabled for a row that can't be dialed (yourself).
export function DialButtons({ audioPath, videoPath, label, disabled, disabledReason, onSelectAddress }: DialButtonsProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onSelectAddress(audioPath, false, label)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className={DIAL_BUTTON_CLASS}
      >
        <Phone size={13} /> Audio
      </button>
      <button
        type="button"
        onClick={() => videoPath && onSelectAddress(videoPath, true, label)}
        disabled={!videoPath || disabled}
        title={disabled ? disabledReason : undefined}
        aria-label="Dial with video"
        className={DIAL_BUTTON_CLASS}
      >
        <Video size={13} /> Video
      </button>
    </div>
  );
}

interface AddressRowListProps {
  rows: AddressRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  // Re-fetches after a failed load; without it the error branch is a dead end.
  onRetry?: () => void;
  // `label` is the row's display name, passed along for the Recents log.
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
  emptyMessage: string;
  loadingMessage: string;
  // Shown with the spinner while another page loads (the Directory says
  // "Searching…" while a search is still scanning pages).
  loadingMoreMessage?: string;
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
  onRetry,
  onSelectAddress,
  emptyMessage,
  loadingMessage,
  loadingMoreMessage = 'Loading...',
  loadMoreLabel = `Load ${PAGE_SIZE} more`,
}: AddressRowListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> {loadingMessage}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 py-4 text-sm text-danger-text">
        <span>{error}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-full border border-edge-strong bg-surface-2 px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="py-4 text-sm text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover">
          <div className="mb-1.5 flex flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-ink">{row.label}</span>
              {row.badge && (
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${row.badge.className}`}
                >
                  {row.badge.label}
                </span>
              )}
            </span>
            <span className="truncate font-mono text-[11px] text-faint">{row.audioPath}</span>
          </div>

          <DialButtons
            audioPath={row.audioPath}
            videoPath={row.videoPath}
            label={row.label}
            disabled={row.disabled}
            disabledReason={row.disabledReason}
            onSelectAddress={onSelectAddress}
          />
        </div>
      ))}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
          {isLoadingMore ? loadingMoreMessage : loadMoreLabel}
        </button>
      ) : (
        // A narrowed Directory keeps loading pages without offering the
        // button, so still show that something is happening.
        isLoadingMore && (
          <div className="mt-2 flex items-center justify-center gap-2 py-2.5 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" /> {loadingMoreMessage}
          </div>
        )
      )}
    </div>
  );
}

interface ResourceAddressListProps<T extends DialableResource> {
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
  // `query` is the trimmed search text; the backend filters before paging.
  fetchPage: (offset: number, limit: number, query: string) => Promise<ResourcePage<T>>;
  getRowLabel: (item: T, address: DialableAddress) => string;
  emptyMessage: string;
  loadingMessage: string;
  searchPlaceholder: string;
}

// REST-backed list (SWML Scripts, SIP Credentials): fetches offset/limit
// pages from the backend and renders them with AddressRowList. Search is
// server-side (the backend's `q` filters its cached metadata before paging),
// so `items.length` stays the right offset for "load more" while searching.
function ResourceAddressList<T extends DialableResource>({
  onSelectAddress,
  fetchPage,
  getRowLabel,
  emptyMessage,
  loadingMessage,
  searchPlaceholder,
}: ResourceAddressListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Bumped by Retry to re-run the first-page fetch after a failure.
  const [reloadKey, setReloadKey] = useState(0);
  // Bumped whenever the list is reset (query change, unmount), so a response
  // to an earlier page-0 or load-more request can't land on a newer list.
  const generationRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetches the first page fresh on mount, whenever the debounced query
  // changes, and on Retry -- this is a testing tool, so we favor freshness over caching. The
  // parent panel remounts this component (via a `key`) whenever the active tab
  // or open state changes, which is what drives "fetch fresh every time the
  // panel/tab opens".
  useEffect(() => {
    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setItems([]);
    setHasMore(false);
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);

    fetchPage(0, PAGE_SIZE, debouncedQuery)
      .then((page) => {
        if (!isCurrent()) return;
        setItems(page.items);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (isCurrent()) setError(describeFetchError(err, 'Failed to load'));
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });

    return () => {
      generationRef.current += 1;
    };
  }, [fetchPage, debouncedQuery, reloadKey]);

  const handleLoadMore = () => {
    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setIsLoadingMore(true);
    setError(null);

    fetchPage(items.length, PAGE_SIZE, debouncedQuery)
      .then((page) => {
        if (!isCurrent()) return;
        setItems((prev) => [...prev, ...page.items]);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (isCurrent()) setError(describeFetchError(err, 'Failed to load more'));
      })
      .finally(() => {
        if (isCurrent()) setIsLoadingMore(false);
      });
  };

  const rows = rowsFor(items, getRowLabel);

  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
        status={debouncedQuery && !isLoading && !error ? matchStatus(rows.length) : ''}
      />
      <AddressRowList
        rows={rows}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        error={error}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onRetry={() => setReloadKey((key) => key + 1)}
        onSelectAddress={onSelectAddress}
        emptyMessage={debouncedQuery ? `No matches for "${debouncedQuery}".` : emptyMessage}
        loadingMessage={debouncedQuery ? 'Searching…' : loadingMessage}
      />
    </>
  );
}

export default ResourceAddressList;
