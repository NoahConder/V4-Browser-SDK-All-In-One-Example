import { useEffect, useRef, useState } from 'react';
import type { Address, Directory } from '@signalwire/js';
import { combineLatest, of, switchMap } from 'rxjs';
import { AddressRowList, type AddressRow } from './ResourceAddressList';
import SearchField from './SearchField';
import { signalWireService } from '../services/signalwire';
import { matchStatus, matchesAddress, normalizeQuery } from '../utils/search';

// 'app' | 'call' | 'room' | 'subscriber' -- the SDK uses this union but
// doesn't export it by name.
type ResourceType = Address['type'];
type TypeFilter = ResourceType | 'all';

const TYPE_META: Record<ResourceType, { label: string; className: string }> = {
  subscriber: { label: 'Subscriber', className: 'bg-grass-soft text-grass-text' },
  room: { label: 'Room', className: 'bg-accent-soft text-accent-text' },
  app: { label: 'App', className: 'bg-accent-soft text-accent-text' },
  call: { label: 'Call', className: 'bg-warn-soft text-warn-text' },
};

const FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'subscriber', label: 'Subscribers' },
  { key: 'room', label: 'Rooms' },
  { key: 'app', label: 'Apps' },
];

interface DirectoryAddressListProps {
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
}

// The signed-in subscriber's address book from the SDK (client.directory$):
// everything this identity can dial, including other subscribers (browser-
// to-browser calls) and video rooms (where screen share is available) --
// which the REST-backed SWML/SIP tabs can't list.
//
// Unlike those tabs, the SDK owns the list: it pages at the server's size
// (name-sorted), subscribing to hasMore$ loads page 1, and loadMore() appends.
// So this doesn't go through ResourceAddressList's offset/limit fetchPage --
// it subscribes directly and renders with the shared AddressRowList. The
// Directory lives for the client's lifetime, so reopening the tab is instant.
function DirectoryAddressList({ onSelectAddress }: DirectoryAddressListProps) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const directoryRef = useRef<Directory | null>(null);
  const needle = normalizeQuery(query);
  const isSearching = needle !== '';
  // Anything that hides rows needs the whole directory loaded (see below).
  const isNarrowing = filter !== 'all' || isSearching;

  useEffect(() => {
    const sub = signalWireService
      .getDirectory$()
      .pipe(
        switchMap((directory) => {
          directoryRef.current = directory ?? null;
          if (!directory) return of(null);
          return combineLatest([directory.addresses$, directory.hasMore$, directory.loading$]);
        }),
      )
      .subscribe((value) => {
        if (!value) {
          setIsAvailable(false);
          setIsLoading(false);
          return;
        }
        const [list, more, loading] = value;
        setIsAvailable(true);
        setAddresses(list);
        setHasMore(more);
        setIsLoading(loading);
      });
    return () => sub.unsubscribe();
  }, []);

  // A type filter or a search is only useful over the whole directory: the SDK
  // pages it 100 at a time sorted by name with no server-side filter or
  // search, and apps dominate (the test space had 387 entries with 2
  // subscribers and 3 rooms, which sat two or three pages deep). So while
  // either narrows the list, keep loading until the SDK says there's no more;
  // an unfiltered "All" keeps manual paging.
  useEffect(() => {
    if (!isNarrowing || !hasMore || isLoading) return;
    directoryRef.current?.loadMore();
  }, [isNarrowing, hasMore, isLoading]);

  const ownAddressIds = signalWireService.getOwnAddressIds();
  const ownSubscriberId = signalWireService.getActiveSubscriberId();

  const rows: AddressRow[] = addresses
    .filter(
      (address) =>
        (filter === 'all' || address.type === filter) && (!isSearching || matchesAddress(address, needle)),
    )
    .flatMap((address) => {
      const audioPath = address.channels.audio ?? address.channels.video ?? address.channels.messaging;
      if (!audioPath) return [];
      const videoPath =
        address.channels.video && address.channels.video !== audioPath ? address.channels.video : null;
      const isSelf = ownAddressIds.has(address.id) || (!!ownSubscriberId && address.resourceId === ownSubscriberId);
      return [
        {
          key: address.id,
          label: `${address.displayName || address.name}${isSelf ? ' (you)' : ''}`,
          audioPath,
          videoPath,
          badge: TYPE_META[address.type] ?? { label: address.type, className: 'bg-surface-2 text-muted' },
          disabled: isSelf,
          disabledReason: "This is the subscriber you're signed in as",
        },
      ];
    });

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? 'entries';
  const emptyMessage = !isAvailable
    ? 'Directory unavailable while disconnected.'
    : isSearching
      ? `No matches for "${query.trim()}"${filter !== 'all' ? ` in ${filterLabel}` : ''}.`
      : filter !== 'all'
        ? `No ${filterLabel} in this directory.`
        : 'Nothing in this directory.';

  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search directory"
        status={isSearching && !isLoading ? matchStatus(rows.length) : ''}
      />
      <div className="mb-2 flex gap-1 overflow-x-auto" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.key ? 'bg-accent-soft text-accent-text' : 'text-muted hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <AddressRowList
        rows={isAvailable ? rows : []}
        // Spinner while nothing is loaded yet, or while a filter or search is
        // still auto-loading pages and hasn't found a match.
        isLoading={isLoading && (addresses.length === 0 || (isNarrowing && rows.length === 0))}
        isLoadingMore={isLoading && addresses.length > 0 && (!isNarrowing || rows.length > 0)}
        error={null}
        hasMore={isAvailable && hasMore && !isNarrowing}
        onLoadMore={() => directoryRef.current?.loadMore()}
        onSelectAddress={onSelectAddress}
        emptyMessage={emptyMessage}
        loadingMessage={isSearching ? 'Searching…' : 'Loading directory...'}
        loadingMoreMessage={isSearching ? 'Searching…' : 'Loading more...'}
        loadMoreLabel="Load more"
      />
    </>
  );
}

export default DirectoryAddressList;
