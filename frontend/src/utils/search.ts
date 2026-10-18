// Shared by the resources-panel search boxes (Directory, Recents, SWML, SIP).

// What the matchers compare against: trimmed and case-folded.
export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

// Screen-reader status line for a search result count.
export const matchStatus = (count: number): string =>
  count === 0 ? 'No matches' : `${count} ${count === 1 ? 'match' : 'matches'}`;
