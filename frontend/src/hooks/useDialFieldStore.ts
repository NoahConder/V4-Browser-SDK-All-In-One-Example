import { create } from 'zustand';

// Long enough for SIP URIs and Fabric addresses.
const MAX_LENGTH = 128;

export interface PickedDestination {
  destination: string;
  label: string;
}

interface DialFieldStore {
  phoneNumber: string;
  // Obeyed when the next call is placed; synced to the channel a picked
  // address came with.
  wantsVideo: boolean;
  // The display name of a destination picked from a list (resources panel,
  // Destinations pane, Subscribers), so the Recents log reads "Alice", not a
  // URL. Only meaningful while the field still holds that destination --
  // Dialer.tsx checks before using it.
  picked: PickedDestination | null;
  setPhoneNumber: (value: string) => void;
  appendKey: (key: string) => void;
  deleteLast: () => void;
  clear: () => void;
  toggleWantsVideo: () => void;
  // A row picked from a list: fill the field, sync the video toggle to the
  // channel that was chosen, remember the label. Doesn't dial.
  selectAddress: (path: string, video: boolean, label?: string) => void;
}

// The dial field's state, out of Dialer.tsx so the desktop workbench's
// Destinations pane (a sibling of the phone column, not a child) can fill it
// through the same selectAddress the phone's panels use. Low-frequency and
// multi-consumer, which is what the store is for (CLAUDE.md).
export const useDialFieldStore = create<DialFieldStore>((set) => ({
  phoneNumber: '',
  wantsVideo: false,
  picked: null,
  setPhoneNumber: (value) => set({ phoneNumber: value.slice(0, MAX_LENGTH) }),
  appendKey: (key) =>
    set((state) => (state.phoneNumber.length < MAX_LENGTH ? { phoneNumber: state.phoneNumber + key } : {})),
  deleteLast: () => set((state) => ({ phoneNumber: state.phoneNumber.slice(0, -1) })),
  clear: () => set({ phoneNumber: '' }),
  toggleWantsVideo: () => set((state) => ({ wantsVideo: !state.wantsVideo })),
  selectAddress: (path, video, label) =>
    set({ phoneNumber: path, wantsVideo: video, picked: label ? { destination: path, label } : null }),
}));
