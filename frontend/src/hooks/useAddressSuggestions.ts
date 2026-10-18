import { useEffect, useMemo, useState } from 'react';
import type { Address } from '@signalwire/js';
import { of, switchMap } from 'rxjs';
import { signalWireService } from '../services/signalwire';
import { useRecentsStore } from './useRecentsStore';
import { addressPath, matchesAddress, matchesRecent, normalizeQuery } from '../utils/search';

export interface AddressSuggestion {
  key: string;
  label: string;
  // What goes in the field: a recent's own destination (channel included),
  // or a directory address's audio dial URL.
  destination: string;
  video: boolean;
  // The destination without its `?channel=` suffix, for display.
  path: string;
  kind: 'recent' | Address['type'];
}

const MAX_SUGGESTIONS = 6;
const MIN_QUERY_LENGTH = 2;

// Suggestions for the address field from what the browser already has:
// Recents, then the Directory pages the SDK has loaded so far. Only
// addresses$ is subscribed -- hasMore$ is what triggers a fetch, and typing
// in the field shouldn't request anything -- so on phones the directory
// contributes once the Directory tab has been opened; on the workbench it's
// loaded from the start. Your own address is left out, as is whatever the
// field already holds exactly.
export function useAddressSuggestions(query: string, enabled: boolean): AddressSuggestion[] {
  const entries = useRecentsStore((s) => s.entries);
  const [addresses, setAddresses] = useState<Address[]>([]);

  useEffect(() => {
    const sub = signalWireService
      .getDirectory$()
      .pipe(switchMap((directory) => (directory ? directory.addresses$ : of([] as Address[]))))
      .subscribe(setAddresses);
    return () => sub.unsubscribe();
  }, []);

  return useMemo(() => {
    const needle = normalizeQuery(query);
    if (!enabled || needle.length < MIN_QUERY_LENGTH) return [];

    const seen = new Set<string>();
    const out: AddressSuggestion[] = [];
    const push = (suggestion: AddressSuggestion) => {
      const dedupeKey = suggestion.path.toLowerCase();
      if (seen.has(dedupeKey) || suggestion.destination.toLowerCase() === needle) return;
      seen.add(dedupeKey);
      out.push(suggestion);
    };

    for (const entry of entries) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (!matchesRecent(entry, needle)) continue;
      push({
        key: `recent-${entry.id}`,
        label: entry.label,
        destination: entry.destination,
        video: entry.video,
        path: entry.destination.split('?')[0],
        kind: 'recent',
      });
    }

    const ownIds = signalWireService.getOwnAddressIds();
    for (const address of addresses) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (ownIds.has(address.id) || !matchesAddress(address, needle)) continue;
      const destination = address.channels.audio ?? address.channels.video ?? address.channels.messaging;
      if (!destination) continue;
      push({
        key: `directory-${address.id}`,
        label: address.displayName || address.name,
        destination,
        video: false,
        path: addressPath(address),
        kind: address.type,
      });
    }

    return out;
  }, [query, enabled, entries, addresses]);
}
