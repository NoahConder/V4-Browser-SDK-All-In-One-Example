// Shared by the resources-panel search boxes (Directory, Recents, SWML, SIP)
// and the address field's suggestions.
import type { Address } from '@signalwire/js';
import type { RecentCall } from '../hooks/useRecentsStore';

// What the matchers compare against: trimmed and case-folded.
export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

// Screen-reader status line for a search result count.
export const matchStatus = (count: number): string =>
  count === 0 ? 'No matches' : `${count} ${count === 1 ? 'match' : 'matches'}`;

// An address's dial path without its `?channel=` suffix (otherwise "audio"
// would match everything); lets "private" narrow to subscribers.
export const addressPath = (address: Address): string =>
  (address.channels.audio ?? address.channels.video ?? address.channels.messaging ?? '').split('?')[0];

// Case-insensitive substring match over an SDK Address's raw fields (not a
// rendered label, so " (you)" isn't searchable).
export const matchesAddress = (address: Address, needle: string): boolean =>
  [address.displayName, address.name, addressPath(address)].some(
    (field) => !!field && field.toLowerCase().includes(needle),
  );

// Label and destination substrings; a needle made only of digits and phone
// punctuation also matches the destination's digits, so "555 123" finds
// (555) 123-4567.
export const matchesRecent = (entry: RecentCall, needle: string): boolean => {
  if (entry.label.toLowerCase().includes(needle) || entry.destination.toLowerCase().includes(needle)) return true;
  const digits = needle.replace(/\D/g, '');
  return digits.length > 0 && /^[\d\s()+.-]*$/.test(needle) && entry.destination.replace(/\D/g, '').includes(digits);
};
