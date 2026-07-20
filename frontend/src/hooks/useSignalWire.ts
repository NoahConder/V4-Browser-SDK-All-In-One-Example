import { useEffect, useState } from 'react';
import { signalWireService } from '../services/signalwire';
import { useCallStore } from './useCallStore';
import { callsAPI } from '../services/api';

export const useSignalWire = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setCallState, resetCallState } = useCallStore();

  useEffect(() => {
    const initializeSignalWire = async () => {
      try {
        await signalWireService.initialize(
          // onIncomingCall callback
          (remoteNumber, hasVideo) => {
            // Handle incoming call
            setCallState({
              isIncoming: true,
              remoteNumber,
              callDirection: 'inbound',
              callStatus: 'ringing',
              isVideoCall: hasVideo,
            });
          },
          // onCallEnded callback - remote party hung up
          (wasIncoming: boolean) => {
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
          // onCallConnected callback - call answered/connected
          () => {
            console.log('🔔 Call connected');
            setCallState({ callStatus: 'connected' });
          },
          // onRemoteVideoChange callback - remote stream started/stopped carrying video
          (hasVideo: boolean) => {
            setCallState({ remoteHasVideo: hasVideo });
          }
        );

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
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ Failed to make call:', err);
      console.error('Error details:', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
        fullError: err
      });
      setError('Failed to make call: ' + message);
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
      setError('Failed to answer call');
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
      await signalWireService.toggleSpeaker(newSpeakerState);
      setCallState({ isSpeakerOn: newSpeakerState });
    } catch (err) {
      console.error('Failed to toggle speaker:', err);
      setError('Failed to toggle speaker');
    }
  };

  const sendDTMF = async (digit: string) => {
    try {
      await signalWireService.sendDTMF(digit);
    } catch (err) {
      console.error('Failed to send DTMF:', err);
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
  };
};