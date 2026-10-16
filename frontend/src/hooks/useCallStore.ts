import { create } from 'zustand';
import { CallState } from '../types';

interface CallStore extends CallState {
  setCallState: (state: Partial<CallState>) => void;
  resetCallState: () => void;
}

const initialState: CallState = {
  isConnected: false,  // Keep false - connection status shouldn't change
  isClientReady: false,  // Preserved across resets, same as isConnected -- see resetCallState
  callError: null,
  isInCall: false,
  isIncoming: false,
  isMuted: false,
  isSpeakerOn: false,
  callDuration: 0,
  remoteNumber: '',
  callDirection: null,
  callStatus: 'idle',
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
    console.log('🔄 Resetting call state to initial state');
    // Keep the connection status but reset everything else
    set((state) => {
      const newState = {
        ...initialState,
        isConnected: state.isConnected,  // Preserve connection status
        isClientReady: state.isClientReady,  // Preserve live readiness across call resets
        activeSubscriberName: state.activeSubscriberName,  // Session identity, not call state
        // Preserve callError -- a failed call attempt resets straight back to
        // idle (see Dialer.tsx's handleCall), and the whole point of the error
        // banner is to explain why on that idle screen. Cleared explicitly by
        // ErrorBanner's dismiss button or the start of the next call attempt.
        callError: state.callError,
      };
      console.log('✅ State after reset:', newState);
      return newState;
    });
  },
}));