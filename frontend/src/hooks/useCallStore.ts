import { create } from 'zustand';
import { CallState } from '../types';

interface CallStore extends CallState {
  setCallState: (state: Partial<CallState>) => void;
  resetCallState: () => void;
}

const initialState: CallState = {
  isClientReady: false,  // Preserved across resets -- see resetCallState
  canSelectAudioOutput: true,  // Session fact (platformCapabilities), preserved like isClientReady
  isRegistered: true,  // Session state (Do Not Disturb), preserved like isClientReady
  callError: null,
  clientNotice: null,
  isInCall: false,
  isIncoming: false,
  isMuted: false,
  isSpeakerOn: false,
  remoteNumber: '',
  pendingDialClear: false,
  callDirection: null,
  outboundCallerId: null,
  callStatus: 'idle',
  connectedAt: null,
  needsAudioUnlock: false,
  recoveryState: 'idle',
  isMediaDisrupted: false,
  isVideoCall: false,
  isCameraOn: false,
  remoteHasVideo: false,
  isOnHold: false,
  canScreenShare: false,
  screenShareStatus: 'none',
  isEchoCancellationOn: false,
  isAutoGainOn: false,
  isNoiseSuppressionOn: false,
  qualityLevel: null,
  qualityScore: null,
  networkIssueCount: 0,
  activeSubscriberName: null,
};

export const useCallStore = create<CallStore>((set) => ({
  ...initialState,

  setCallState: (state) =>
    set((prev) => ({
      ...prev,
      ...state,
    })),

  resetCallState: () => {
    // Keep the session's facts but reset everything about the call
    set((state) => {
      const newState = {
        ...initialState,
        isClientReady: state.isClientReady,  // Preserve live readiness across call resets
        canSelectAudioOutput: state.canSelectAudioOutput,  // Browser capability, not call state
        isRegistered: state.isRegistered,  // Do Not Disturb is session state, not call state
        clientNotice: state.clientNotice,  // Dismissed explicitly, like callError
        activeSubscriberName: state.activeSubscriberName,  // Session identity, not call state
        // Preserve callError -- a failed call attempt resets straight back to
        // idle (see Dialer.tsx's handleCall), and the whole point of the error
        // banner is to explain why on that idle screen. Cleared explicitly by
        // ErrorBanner's dismiss button or the start of the next call attempt.
        callError: state.callError,
      };
      return newState;
    });
  },
}));