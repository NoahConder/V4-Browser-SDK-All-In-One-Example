import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The caller ID presented on calls to phone numbers: one of the space's own
// numbers or a verified caller ID (what SignalWire accepts), chosen in the
// Caller ID sheet, or null to let the server pick. Dialer.tsx reads it when
// Call is pressed and hands it to dial() as `from` for phone numbers only;
// the service drops it for SIP URIs and Fabric addresses. The name is kept
// for the From button's label ("Main line" beats a truncated number).
//
// Its own persisted store rather than a DialerSettings field: those are SDK
// settings applySettings() pushes into the client, while this is a per-dial
// option the service never applies. Not in useDialFieldStore either, which
// isn't persisted and is cleared when a call ends.
interface CallerIdStore {
  callerId: string | null;
  callerName: string | null;
  setCallerId: (callerId: string | null, callerName?: string | null) => void;
}

const STORAGE_KEY = 'dialer_caller_id';

// Anything stored by hand that isn't an E.164 number is ignored.
const isE164 = (value: unknown): value is string => typeof value === 'string' && /^\+\d{7,15}$/.test(value);

export const useCallerIdStore = create<CallerIdStore>()(
  persist(
    (set) => ({
      callerId: null,
      callerName: null,
      setCallerId: (callerId, callerName = null) => set({ callerId, callerName: callerId ? callerName : null }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ callerId: state.callerId, callerName: state.callerName }),
      merge: (persisted, current) => {
        const stored = (persisted as { callerId?: unknown; callerName?: unknown } | undefined) ?? {};
        const callerId = isE164(stored.callerId) ? stored.callerId : null;
        const callerName = callerId && typeof stored.callerName === 'string' ? stored.callerName : null;
        return { ...current, callerId, callerName };
      },
    },
  ),
);
