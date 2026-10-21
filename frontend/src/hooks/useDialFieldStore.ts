import { create } from 'zustand';
import { channelOf, getDialAddressType, withChannel } from '../utils/address';

// Long enough for SIP URIs and Fabric addresses.
const MAX_LENGTH = 128;

// Joining a video call with the camera off (cameraOff below) is hidden: on
// rc.5, turning the camera on after a receive-only dial never reaches the far
// end. Flip to restore the dial-row toggle; cameraOff is ignored while false.
export const SHOW_CAMERA_OFF_JOIN = false;

export interface PickedDestination {
  destination: string;
  label: string;
}

interface DialFieldStore {
  phoneNumber: string;
  // Obeyed when the next call is placed. For a Fabric address it *is* the
  // address's `?channel=` param (bare = audio): toggling rewrites the field
  // and editing the field re-derives it, so the field is always the dial
  // string. Always false for a phone number; a free choice for a SIP URI or
  // an empty field.
  wantsVideo: boolean;
  // Join a video call (placed, or answered) with the camera off: the call
  // receives video but sends none until Camera is tapped. A send-side choice,
  // independent of `?channel=` -- it never touches the field's text, and it's
  // ignored while wantsVideo is off (so it survives toggling Video).
  cameraOff: boolean;
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
  toggleCameraOff: () => void;
  // A row picked from a list: fill the field (a Fabric address rewritten to
  // the chosen channel), sync the video toggle, remember the label. Doesn't
  // dial.
  selectAddress: (path: string, video: boolean, label?: string) => void;
}

// What the toggle must read for the field's text. A Fabric address's toggle
// can't disagree with the `?channel=` it carries, and a phone number can't do
// video at all; SIP URIs and an empty field keep the user's choice (so
// "toggle, then type a SIP URI" works).
const videoFor = (text: string, current: boolean): boolean => {
  if (!text) return current;
  switch (getDialAddressType(text)) {
    case 'fabric':
      return channelOf(text) === 'video';
    case 'phone':
      return false;
    default:
      return current;
  }
};

// The dial field's state, out of Dialer.tsx so the desktop workbench's
// Destinations pane (a sibling of the phone column, not a child) can fill it
// through the same selectAddress the phone's panels use. Low-frequency and
// multi-consumer, which is what the store is for (CLAUDE.md).
export const useDialFieldStore = create<DialFieldStore>((set) => ({
  phoneNumber: '',
  wantsVideo: false,
  cameraOff: false,
  picked: null,
  setPhoneNumber: (value) =>
    set((state) => {
      const phoneNumber = value.slice(0, MAX_LENGTH);
      return { phoneNumber, wantsVideo: videoFor(phoneNumber, state.wantsVideo) };
    }),
  appendKey: (key) =>
    set((state) => {
      if (state.phoneNumber.length >= MAX_LENGTH) return {};
      const phoneNumber = state.phoneNumber + key;
      return { phoneNumber, wantsVideo: videoFor(phoneNumber, state.wantsVideo) };
    }),
  deleteLast: () =>
    set((state) => {
      const phoneNumber = state.phoneNumber.slice(0, -1);
      return { phoneNumber, wantsVideo: videoFor(phoneNumber, state.wantsVideo) };
    }),
  clear: () => set({ phoneNumber: '' }),
  toggleWantsVideo: () =>
    set((state) => {
      const type = getDialAddressType(state.phoneNumber);
      // The button is disabled for phone numbers; belt and braces.
      if (state.phoneNumber && type === 'phone') return {};
      const wantsVideo = !state.wantsVideo;
      if (!state.phoneNumber || type !== 'fabric') return { wantsVideo };
      const phoneNumber = withChannel(state.phoneNumber, wantsVideo ? 'video' : 'audio');
      // The picked label is keyed on the field's text; follow the rewrite so
      // "Alice" survives picking her audio address and then choosing video.
      const picked =
        state.picked && state.picked.destination === state.phoneNumber
          ? { ...state.picked, destination: phoneNumber }
          : state.picked;
      return { phoneNumber, wantsVideo, picked };
    }),
  toggleCameraOff: () => set((state) => ({ cameraOff: !state.cameraOff })),
  selectAddress: (path, video, label) =>
    set(() => {
      // The flag wins: a Recents entry may hold a bare address with video on,
      // and the field has to show the channel that will be dialed.
      const phoneNumber = withChannel(path, video ? 'video' : 'audio');
      return {
        phoneNumber,
        wantsVideo: videoFor(phoneNumber, video),
        picked: label ? { destination: phoneNumber, label } : null,
      };
    }),
}));
