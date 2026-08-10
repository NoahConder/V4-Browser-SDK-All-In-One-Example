import { useEffect, useState } from 'react';
import { MediaAccessError, CallCreateError, MediaTrackError, PreflightError } from '@signalwire/js';
import { signalWireService, ClientNotReadyError } from '../services/signalwire';
import { useCallStore } from './useCallStore';
import { callsAPI } from '../services/api';

// Turns an SDK error (or anything else a try/catch might catch) into a
// message a user could actually act on, instead of a raw Error.message.
// Exported so components with their own inline error display (e.g.
// TransferModal) can reuse the same messages.
export const describeCallError = (err: unknown): string => {
  if (err instanceof ClientNotReadyError) {
    return 'Still connecting to SignalWire — try again in a moment.';
  }
  if (err instanceof MediaAccessError) {
    return err.denied
      ? `${err.media} access was denied. Check your browser permissions.`
      : `Couldn't access your ${err.media}.`;
  }
  if (err instanceof MediaTrackError) {
    return `A problem occurred with your ${err.kind} device.`;
  }
  if (err instanceof CallCreateError) {
    return "Couldn't start the call.";
  }
  if (err instanceof PreflightError) {
    return `Connection test failed during the ${err.phase} phase.`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
};

export const useSignalWire = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selector-based, not `useCallStore()` -- this hook is called from App.tsx,
  // Dialer.tsx, AND CallScreen.tsx, so a whole-store subscription here would
  // force all three to re-render on every single setCallState() call anywhere
  // in the app (mute toggles, quality ticks, capability changes, etc.),
  // regardless of what each component actually reads from the store. Both
  // are stable Zustand action references, so this never itself triggers a
  // re-render.
  const setCallState = useCallStore((s) => s.setCallState);
  const resetCallState = useCallStore((s) => s.resetCallState);

  useEffect(() => {
    const initializeSignalWire = async () => {
      try {
        await signalWireService.initialize({
          onIncomingCall: (remoteNumber, hasVideo) => {
            // Handle incoming call
            setCallState({
              isIncoming: true,
              remoteNumber,
              callDirection: 'inbound',
              callStatus: 'ringing',
              isVideoCall: hasVideo,
            });
          },
          onCallEnded: (wasIncoming: boolean) => {
            console.log('🔔 Remote party ended call - returning to idle, wasIncoming:', wasIncoming);

            // Get the current call direction before resetting
            const { callDirection } = useCallStore.getState();

            resetCallState();
            setError(null);  // Clear any errors

            // If it was an outbound call, trigger number clearing
            if (!wasIncoming && callDirection === 'outbound') {
              // We'll use a callback or event to clear the number
              window.dispatchEvent(new CustomEvent('clearDialedNumber'));
            }
          },
          onCallConnected: () => {
            console.log('🔔 Call connected');
            setCallState({ callStatus: 'connected' });
          },
          onRemoteVideoChange: (hasVideo: boolean) => {
            setCallState({ remoteHasVideo: hasVideo });
          },
          onReadyChange: (ready: boolean) => {
            setCallState({ isClientReady: ready });
          },
          onClientError: (message: string) => {
            setCallState({ callError: message });
          },
          onCanScreenShareChange: (canScreenShare: boolean) => {
            setCallState({ canScreenShare });
          },
          onCanTransferChange: (canTransfer: boolean) => {
            setCallState({ canTransfer });
          },
          onCanHoldChange: (canHold: boolean) => {
            setCallState({ canHold });
          },
          onScreenShareStatusChange: (status) => {
            setCallState({ screenShareStatus: status });
          },
          onAudioProcessingChange: (state) => {
            setCallState({
              isEchoCancellationOn: state.echoCancellation,
              isAutoGainOn: state.autoGain,
              isNoiseSuppressionOn: state.noiseSuppression,
            });
          },
          onQualityChange: (state) => {
            setCallState({
              qualityLevel: state.level,
              qualityScore: state.score,
              networkIssueCount: state.networkIssues.length,
            });
          },
        });

        setIsInitialized(true);
        setCallState({ isConnected: true });
      } catch (err) {
        console.error('Failed to initialize SignalWire:', err);
        setError('Failed to connect to SignalWire');
        setCallState({ isConnected: false });
      }
    };

    initializeSignalWire();

    return () => {
      // Only cleanup on actual unmount, not on re-renders
      // The disconnect should only happen when the entire app unmounts
      console.log('⚠️ useSignalWire cleanup triggered - NOT disconnecting to preserve calls');
      // We'll let the service maintain its connection
      // signalWireService.disconnect() should only be called on app unmount
    };
    // Intentionally run once on mount: the SignalWire singleton must outlive
    // React unmounts/re-renders (see CLAUDE.md). setCallState/resetCallState are
    // stable Zustand actions, so omitting them from deps is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const makeCall = async (phoneNumber: string, video: boolean = false) => {
    try {
      console.log('📢 useSignalWire.makeCall() called with:', phoneNumber, 'video:', video);
      setError(null);
      setCallState({ callError: null });

      // Log call to backend
      console.log('📝 Logging call to backend...');
      const callData = await callsAPI.initiateCall(phoneNumber);
      console.log('✅ Backend logged call:', callData);

      // Make the actual call
      console.log('📞 Making actual call via SignalWire service...');
      const call = await signalWireService.makeCall(phoneNumber, video);
      console.log('✅ SignalWire service returned call object:', call);

      // Call has been placed, waiting for remote to answer
      // Actual 'connected' status will come via onCallConnected callback
      setCallState({
        callStatus: 'ringing',
      });

      console.log('✅ Call state updated, call should be active');
      return callData;
    } catch (err) {
      const message = describeCallError(err);
      console.error('❌ Failed to make call:', err);
      console.error('Error details:', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
        fullError: err
      });
      // callError (not the hook's full-screen `error`) -- a failed call
      // attempt shouldn't take over the whole app UI, just explain itself on
      // the idle dialer screen via ErrorBanner.
      setCallState({ callError: message });
      throw err;
    }
  };

  const endCall = async () => {
    try {
      console.log('🔴 Ending call...');
      await signalWireService.endCall();
      resetCallState();
      setError(null);  // Clear any errors
      console.log('✅ Call ended and state reset');
    } catch (err) {
      console.error('Failed to end call:', err);
      // Don't set error here as it causes blank screen
      // Just log the error and reset state
      // Reset state even if end call fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      console.log('⚠️ End call failed but returning to dialer');
    }
  };

  const answerCall = async () => {
    try {
      setCallState({ callError: null });
      const { isVideoCall } = useCallStore.getState();
      await signalWireService.answerCall(isVideoCall);
      setCallState({
        isInCall: true,
        isIncoming: false,
        callStatus: 'connected',
        isCameraOn: isVideoCall,
      });
    } catch (err) {
      console.error('Failed to answer call:', err);
      // Same as rejectCall/endCall's failure paths below: bail back to the
      // idle dialer rather than leaving the user stuck on an unanswerable
      // incoming-call screen. callError survives resetCallState() and
      // explains what happened once back on the dialer.
      const message = describeCallError(err);
      resetCallState();
      setCallState({ callError: message });
    }
  };

  const rejectCall = async () => {
    try {
      console.log('🚫 Rejecting incoming call...');
      await signalWireService.rejectCall();
      resetCallState();
      setError(null);  // Clear any errors
      console.log('✅ Call rejected and state reset');
    } catch (err) {
      console.error('Failed to reject call:', err);
      // Don't set error here as it causes blank screen
      // Reset state even if reject fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      console.log('⚠️ Reject call failed but returning to dialer');
    }
  };

  const toggleMute = async () => {
    const { isMuted } = useCallStore.getState();
    const newMutedState = !isMuted;

    // Always update the UI state optimistically
    setCallState({ isMuted: newMutedState });

    try {
      await signalWireService.toggleMute(newMutedState);
    } catch (err) {
      // Log but don't show error to user since we handle it gracefully
      console.warn('Mute toggle warning:', err);
      // Don't set error state - the mute is handled via WebRTC directly
    }
  };

  const toggleCamera = async () => {
    const { isCameraOn } = useCallStore.getState();
    const newCameraState = !isCameraOn;

    // Always update the UI state optimistically
    setCallState({ isCameraOn: newCameraState });

    try {
      await signalWireService.toggleCamera(newCameraState);
    } catch (err) {
      console.warn('Camera toggle warning:', err);
    }
  };

  const toggleSpeaker = async () => {
    const { isSpeakerOn } = useCallStore.getState();
    const newSpeakerState = !isSpeakerOn;

    try {
      const applied = await signalWireService.toggleSpeaker(newSpeakerState);
      if (applied) {
        setCallState({ isSpeakerOn: newSpeakerState, callError: null });
      } else {
        setCallState({
          callError: "Switching audio output isn't supported in this browser, or no output device is selected.",
        });
      }
    } catch (err) {
      console.error('Failed to toggle speaker:', err);
      setCallState({ callError: 'Failed to toggle speaker.' });
    }
  };

  const sendDTMF = async (digit: string) => {
    try {
      await signalWireService.sendDTMF(digit);
    } catch (err) {
      console.error('Failed to send DTMF:', err);
    }
  };

  const toggleHold = async () => {
    const { isOnHold } = useCallStore.getState();
    // Optimistic, like mute/camera -- but reverted on failure (unlike those).
    // The UI should already gate the hold control on canHold, but this is
    // still reachable directly, so describeCallError surfaces the specific
    // "this call does not support hold" message rather than a generic one.
    setCallState({ isOnHold: !isOnHold, callError: null });

    try {
      await signalWireService.toggleHold();
    } catch (err) {
      console.error('Failed to toggle hold:', err);
      setCallState({ isOnHold, callError: describeCallError(err) });
    }
  };

  // Left to throw on failure -- callers with their own inline error display
  // (TransferModal) want the rejection, not a store-wide callError.
  const transferCall = (destination: string) => signalWireService.transferCall(destination);

  const toggleScreenShare = async () => {
    try {
      await signalWireService.toggleScreenShare();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        return; // User dismissed the browser's screen-share picker -- not an error.
      }
      console.error('Failed to toggle screen share:', err);
      setCallState({ callError: 'Failed to start screen sharing.' });
    }
  };

  const toggleEchoCancellation = async () => {
    try {
      await signalWireService.toggleEchoCancellation();
    } catch (err) {
      console.warn('Echo cancellation toggle warning:', err);
    }
  };

  const toggleAutoGain = async () => {
    try {
      await signalWireService.toggleAutoGain();
    } catch (err) {
      console.warn('Auto gain toggle warning:', err);
    }
  };

  const toggleNoiseSuppression = async () => {
    try {
      await signalWireService.toggleNoiseSuppression();
    } catch (err) {
      console.warn('Noise suppression toggle warning:', err);
    }
  };

  return {
    isInitialized,
    error,
    makeCall,
    endCall,
    answerCall,
    rejectCall,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
    sendDTMF,
    toggleHold,
    transferCall,
    toggleScreenShare,
    toggleEchoCancellation,
    toggleAutoGain,
    toggleNoiseSuppression,
  };
};