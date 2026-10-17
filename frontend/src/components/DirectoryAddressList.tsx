import { useEffect, useRef, useState } from 'react';
import type { Address, Directory } from '@signalwire/js';
import { combineLatest, of, switchMap } from 'rxjs';
import { AddressRowList, type AddressRow } from './ResourceAddressList';
import { signalWireService } from '../services/signalwire';

// 'app' | 'call' | 'room' | 'subscriber' -- the SDK uses this union but
// doesn't export it by name.
type ResourceType = Address['type'];
type TypeFilter = ResourceType | 'all';

const TYPE_META: Record<ResourceType, { label: string; className: string }> = {
  subscriber: { label: 'Subscriber', className: 'bg-emerald-500/15 text-emerald-400' },
  room: { label: 'Room', className: 'bg-purple-500/15 text-purple-400' },
  app: { label: 'App', className: 'bg-blue-500/15 text-blue-400' },
  call: { label: 'Call', className: 'bg-amber-500/15 text-amber-400' },
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
  const directoryRef = useRef<Directory | null>(null);

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

  const ownAddressIds = signalWireService.getOwnAddressIds();
  const ownSubscriberId = signalWireService.getActiveSubscriberId();

  const rows: AddressRow[] = addresses
    .filter((address) => filter === 'all' || address.type === filter)
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
          badge: TYPE_META[address.type] ?? { label: address.type, className: 'bg-white/10 text-gray-300' },
          disabled: isSelf,
          disabledReason: "This is the subscriber you're signed in as",
        },
      ];
    });

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? 'entries';

  return (
    <>
      <div className="mb-2 flex gap-1 overflow-x-auto" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.key ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <AddressRowList
        rows={isAvailable ? rows : []}
        isLoading={isLoading && addresses.length === 0}
        isLoadingMore={isLoading && addresses.length > 0}
        error={null}
        hasMore={isAvailable && hasMore}
        onLoadMore={() => directoryRef.current?.loadMore()}
        onSelectAddress={onSelectAddress}
        emptyMessage={
          isAvailable
            ? filter === 'all'
              ? 'Nothing in this directory.'
              : `No ${filterLabel} in this directory.`
            : 'Directory unavailable while disconnected.'
        }
        loadingMessage="Loading directory..."
        loadMoreLabel="Load more"
      />
    </>
  );
}

export default DirectoryAddressList;
