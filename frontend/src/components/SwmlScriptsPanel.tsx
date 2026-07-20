import React, { useEffect, useState } from 'react';
import { List, Loader2, X } from 'lucide-react';
import { swmlAPI } from '../services/api';
import type { SwmlScript } from '../types';

interface SwmlScriptsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAddress: (path: string) => void;
}

const PAGE_SIZE = 10;

interface AddressRow {
  scriptId: string;
  address: SwmlScript['addresses'][number];
  basePath: string;
}

// All channels on an address share the same base path, just differing in
// the `?channel=...` query string -- pick any one and strip the query.
const basePathFor = (channels: Record<string, string>): string | null => {
  const path = Object.values(channels)[0];
  return path ? path.split('?')[0] : null;
};

const SwmlScriptsPanel: React.FC<SwmlScriptsPanelProps> = ({ isOpen, onClose, onSelectAddress }) => {
  const [scripts, setScripts] = useState<SwmlScript[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset and fetch the first page fresh every time the panel opens -- this
  // is a testing tool, so we favor freshness over caching.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setScripts([]);
    setHasMore(false);
    setIsLoading(true);
    setError(null);

    swmlAPI
      .listScripts(0, PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setScripts(page.scripts);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load SWML scripts');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleLoadMore = () => {
    setIsLoadingMore(true);
    setError(null);

    swmlAPI
      .listScripts(scripts.length, PAGE_SIZE)
      .then((page) => {
        setScripts((prev) => [...prev, ...page.scripts]);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load more SWML scripts');
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  if (!isOpen) return null;

  const rows: AddressRow[] = scripts.flatMap((script) =>
    script.addresses
      .map((address) => ({ scriptId: script.id, address, basePath: basePathFor(address.channels) }))
      .filter((row): row is AddressRow => row.basePath !== null)
  );

  return (
    <div className="glass-panel mx-4 mt-2 max-h-64 overflow-y-auto rounded-2xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <List size={14} /> SWML Scripts
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading scripts...
        </div>
      )}

      {!isLoading && error && <div className="py-4 text-sm text-red-400">{error}</div>}

      {!isLoading && !error && rows.length === 0 && (
        <div className="py-4 text-sm text-gray-400">No SWML scripts found in this space.</div>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="space-y-1">
          {rows.map(({ scriptId, address, basePath }) => (
            <button
              key={`${scriptId}-${address.id}`}
              type="button"
              onClick={() => onSelectAddress(basePath)}
              className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10"
            >
              <span className="truncate text-sm font-medium text-white">
                {address.display_name || address.name}
              </span>
              <span className="truncate text-xs text-gray-500">{basePath}</span>
            </button>
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
      )}
    </div>
  );
};

export default SwmlScriptsPanel;
