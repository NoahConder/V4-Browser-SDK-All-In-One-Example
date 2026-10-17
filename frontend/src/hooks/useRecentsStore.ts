import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecentOutcome = 'in-progress' | 'answered' | 'missed' | 'declined' | 'failed' | 'cancelled';

export interface RecentCall {
  id: string;
  // SDK call id, once known.
  callId?: string;
  // What to redial: the raw input / picked address URL for outbound, the
  // caller's address for inbound.
  destination: string;
  // Human-readable: picked resource name, caller id, or formatted number.
  label: string;
  direction: 'inbound' | 'outbound';
  outcome: RecentOutcome;
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  video: boolean;
  // Which subscriber this browser was signed in as at the time.
  subscriberId?: string;
  subscriberName?: string;
  // Restored by the SDK after a reload/reconnect rather than dialed here.
  reattached?: boolean;
}

type NewRecent = Omit<RecentCall, 'id' | 'startedAt' | 'outcome'> & Partial<Pick<RecentCall, 'startedAt'>>;

interface RecentsStore {
  // Newest first, capped at MAX_RECENTS.
  entries: RecentCall[];
  // The entry for the call currently in progress (not persisted).
  activeId: string | null;
  // Begin tracking a call; it becomes the active entry.
  start: (entry: NewRecent) => string;
  // Add an already-finished entry without touching the active call (e.g. a
  // second incoming call auto-rejected while another call is up).
  addFinished: (entry: NewRecent, outcome: Exclude<RecentOutcome, 'in-progress'>) => void;
  setCallId: (callId: string) => void;
  // Idempotent: status$ re-emits 'connected' after an ICE restart.
  markConnected: () => void;
  // Finalize the active entry (only if still in progress) and forget it.
  finish: (outcome: Exclude<RecentOutcome, 'in-progress'>) => void;
  clear: () => void;
}

export const MAX_RECENTS = 50;
const STORAGE_KEY = 'dialer_recents';

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Entries left 'in-progress' by a reload mid-call can't be finished anymore;
// treat them as answered if they had connected, else cancelled.
const settleLeftovers = (entries: RecentCall[]): RecentCall[] =>
  entries.map((entry) =>
    entry.outcome !== 'in-progress'
      ? entry
      : {
          ...entry,
          outcome: entry.connectedAt ? 'answered' : 'cancelled',
          endedAt: entry.endedAt ?? entry.connectedAt ?? entry.startedAt,
        },
  );

// Client-side call log (this browser only -- the backend's /api/calls store is
// cosmetic and in-memory, see CLAUDE.md). Recorded from useSignalWire, which
// is where direction and outcome are already known.
export const useRecentsStore = create<RecentsStore>()(
  persist(
    (set, get) => {
      const updateActive = (update: (entry: RecentCall) => RecentCall) => {
        const { activeId } = get();
        if (!activeId) return;
        set((state) => ({ entries: state.entries.map((entry) => (entry.id === activeId ? update(entry) : entry)) }));
      };

      return {
        entries: [],
        activeId: null,

        start: (entry) => {
          const id = newId();
          const record: RecentCall = { startedAt: Date.now(), ...entry, id, outcome: 'in-progress' };
          set((state) => ({ entries: [record, ...state.entries].slice(0, MAX_RECENTS), activeId: id }));
          return id;
        },

        addFinished: (entry, outcome) => {
          const now = Date.now();
          const record: RecentCall = { startedAt: now, ...entry, id: newId(), outcome, endedAt: now };
          set((state) => ({ entries: [record, ...state.entries].slice(0, MAX_RECENTS) }));
        },

        setCallId: (callId) => updateActive((entry) => ({ ...entry, callId })),

        markConnected: () => updateActive((entry) => (entry.connectedAt ? entry : { ...entry, connectedAt: Date.now() })),

        finish: (outcome) => {
          const { activeId } = get();
          if (!activeId) return;
          set((state) => ({
            activeId: null,
            entries: state.entries.map((entry) =>
              entry.id === activeId && entry.outcome === 'in-progress'
                ? { ...entry, outcome, endedAt: Date.now() }
                : entry,
            ),
          }));
        },

        clear: () => set({ entries: [], activeId: null }),
      };
    },
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => ({
        ...current,
        entries: settleLeftovers((persisted as { entries?: RecentCall[] } | undefined)?.entries ?? []),
      }),
    },
  ),
);
