import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  MediaAccessError,
  CallCreateError,
  MediaTrackError,
  PreflightError,
  AuxiliaryLegCancelledError,
  AuxiliaryLegTimeoutError,
  ScreenShareAlreadyActiveError,
} from '@signalwire/js';
import { signalWireService, ClientNotReadyError, type SignalWireCallbacks } from '../services/signalwire';
import { useCallStore } from './useCallStore';
import { useRecentsStore } from './useRecentsStore';
import { callsAPI, describeFetchError } from '../services/api';
import { dialPath, formatPhoneNumber } from '../utils/address';
import { log } from '../utils/log';

// Test seam, dev server only: `?e2e=1` skips the SignalWire connection so the
// Playwright suite (frontend/e2e) runs without credentials. The hook's
// callbacks are still registered on the service, so tests fire them and stub
// the service's methods while driving the store directly.
const E2E_SEAM = import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2e');

// Who this browser is signed in as, stamped on each Recents entry.
const activeSubscriber = () => ({
  subscriberId: signalWireService.getActiveSubscriberId(),
  subscriberName: signalWireService.getActiveSubscriberDisplayName(),
});

// The in-progress Recents entry, if any.
const activeRecent = () => {
  const { entries, activeId } = useRecentsStore.getState();
  return entries.find((entry) => entry.id === activeId);
};

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
    // The SDK wraps the server's refusal; its JSON body (with a `code`) is in
    // the underlying error's message. Observed on a real call to a subscriber
    // in Do Not Disturb: 422 "no_devices_or_registrations".
    const detail = String((err.error as { message?: unknown } | undefined)?.message ?? err.error ?? '');
    if (/no_devices_or_registrations/.test(detail)) {
      return "The destination isn't online: it has no registered devices, or it's in Do Not Disturb.";
    }
    if (/timeout/i.test(err.message)) {
      return 'The call timed out while being set up.';
    }
    return "Couldn't start the call.";
  }
  if (err instanceof PreflightError) {
    return `Connection test failed during the ${err.phase} phase.`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
};

// Screen-share failures, per the SDK's screen-sharing guide. Returns null for
// outcomes that aren't errors from the user's point of view. A share failure
// never affects the call itself.
const describeScreenShareError = (err: unknown): string | null => {
  // The user's own stop beat the share to completion.
  if (err instanceof AuxiliaryLegCancelledError) return null;
  if (err instanceof ScreenShareAlreadyActiveError) return 'A screen share is already active on this call.';
  if (err instanceof AuxiliaryLegTimeoutError) return 'Screen sharing timed out while connecting. Please try again.';
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError': // picker dismissed or permission denied
      case 'AbortError': // call ended before capture started
        return null;
      case 'NotFoundError':
        return 'No screen is available to share.';
      case 'NotReadableError':
        return "Couldn't capture the screen. Try again, or close apps that may be using it.";
      case 'NotSupportedError':
        return "Screen sharing isn't supported in this browser.";
    }
  }
  // The server refused the share leg (e.g. "Must provide a participant
  // invite first" on a 1:1 call). The capability gate should prevent this.
  if (err instanceof Error && err.name === 'JSONRPCError') {
    return "Screen sharing isn't available on this call.";
  }
  return 'Failed to start screen sharing.';
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
        const callbacks: SignalWireCallbacks = {
          onIncomingCall: (remoteNumber, hasVideo, from, callId) => {
            useRecentsStore.getState().start({
              direction: 'inbound',
              destination: from || remoteNumber,
              label: remoteNumber,
              video: hasVideo,
              callId,
              ...activeSubscriber(),
            });
            setCallState({
              isIncoming: true,
              remoteNumber,
              callDirection: 'inbound',
              callStatus: 'ringing',
              isVideoCall: hasVideo,
            });
          },
          onIncomingCallAutoRejected: (remoteNumber, from) => {
            useRecentsStore.getState().addFinished(
              { direction: 'inbound', destination: from || remoteNumber, label: remoteNumber, video: false, ...activeSubscriber() },
              'missed',
            );
          },
          onCallReattached: (remoteNumber, hasVideo) => {
            // The call is already up (reload / reconnect restored it), so jump
            // straight to the in-call screen rather than the dialing states an
            // outbound call passes through. callStatus is left at 'connecting'
            // until the reattached call's own status$ reports 'connected' via
            // onCallConnected -- reattachment isn't instant, and claiming
            // 'connected' early would show a running timer on a dead call if
            // the reattach turns out to have failed.
            log.debug('Call reattached after reload/reconnect:', remoteNumber);
            // Already connected before this page loaded; onCallEnded finishes
            // it as answered.
            useRecentsStore.getState().start({
              direction: 'outbound',
              destination: remoteNumber,
              label: formatPhoneNumber(remoteNumber),
              video: hasVideo,
              connectedAt: Date.now(),
              reattached: true,
              ...activeSubscriber(),
            });
            setCallState({
              isInCall: true,
              isIncoming: false,
              remoteNumber,
              callDirection: 'outbound',
              callStatus: 'connecting',
              isVideoCall: hasVideo,
              isCameraOn: hasVideo,
            });
          },
          onCallEnded: (wasIncoming: boolean) => {
            log.debug('Remote party ended call - returning to idle, wasIncoming:', wasIncoming);

            // Answered if it ever connected; otherwise the caller gave up
            // (missed) or the dial never went through (failed). The hook's
            // own endCall/rejectCall finish their entries first, so this only
            // settles whatever is still in progress.
            const recent = activeRecent();
            useRecentsStore.getState().finish(recent?.connectedAt ? 'answered' : wasIncoming ? 'missed' : 'failed');

            // Get the current call direction before resetting
            const { callDirection } = useCallStore.getState();

            resetCallState();
            setError(null);  // Clear any errors

            // An outbound call is over: have the dialer clear its field (set
            // after the reset, which clears this flag).
            if (!wasIncoming && callDirection === 'outbound') {
              setCallState({ pendingDialClear: true });
            }
          },
          onCallConnected: () => {
            log.debug('Call connected');
            // connectedAt is set once: status$ re-emits 'connected' after a
            // successful ICE restart, which must not restart the timer.
            setCallState({
              callStatus: 'connected',
              connectedAt: useCallStore.getState().connectedAt ?? Date.now(),
            });
            useRecentsStore.getState().markConnected();
          },
          onCallStatusChange: (status) => {
            setCallState({ callStatus: status });
          },
          onRemoteAudioBlocked: () => {
            setCallState({ needsAudioUnlock: true });
          },
          onRecoveryStateChange: (recoveryState) => {
            setCallState({ recoveryState });
          },
          onMediaDisruptionChange: (isMediaDisrupted) => {
            setCallState({ isMediaDisrupted });
          },
          onRegisteredChange: (isRegistered) => {
            setCallState({ isRegistered });
          },
          onClientNotice: (clientNotice) => {
            setCallState({ clientNotice });
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
          onCallMediaError: (err) => {
            // 'acquireLocalMedia' is the receive-only fallback: the call is
            // up but nothing is being sent, so say so explicitly.
            const receiveOnly = err instanceof MediaAccessError && err.operation === 'acquireLocalMedia';
            const message = describeCallError(err);
            setCallState({
              callError: receiveOnly
                ? `${message} The call is continuing, but the other side can't hear${err.media.includes('video') ? ' or see' : ''} you.`
                : message,
            });
          },
          onQualityChange: (state) => {
            setCallState({
              qualityLevel: state.level,
              qualityScore: state.score,
              networkIssueCount: state.networkIssues.length,
            });
          },
        };

        if (E2E_SEAM) {
          signalWireService.setCallbacks(callbacks);
          setIsInitialized(true);
          setCallState({ isClientReady: true, activeSubscriberName: 'e2e' });
          return;
        }

        await signalWireService.initialize(callbacks);

        setIsInitialized(true);

        // The backend resolves this from the reference actually used to mint
        // the token (see auth.py's _resolve_reference) -- already present on
        // currentToken by the time initialize() resolves, no extra request needed.
        setCallState({
          activeSubscriberName: signalWireService.getActiveSubscriberDisplayName() ?? null,
          canSelectAudioOutput: signalWireService.canSelectAudioOutput(),
        });
      } catch (err) {
        log.error('Failed to initialize SignalWire:', err);
        // A failed token request (backend down, wrong key, rate limit) gets
        // its specific message; SDK-side failures keep the generic one.
        const generic = 'Failed to connect to SignalWire';
        setError(axios.isAxiosError(err) ? describeFetchError(err, generic) : generic);
        // App.tsx shows the error screen only once initialization has
        // settled; without this it would show the connecting spinner forever.
        setIsInitialized(true);
      }
    };

    initializeSignalWire();

    return () => {
      // Deliberately no signalWireService.disconnect() here: the singleton
      // must outlive React unmounts/re-renders (StrictMode, CallScreen
      // mounting). Only App.tsx's beforeunload disconnects -- see CLAUDE.md.
    };
    // Intentionally run once on mount: the SignalWire singleton must outlive
    // React unmounts/re-renders (see CLAUDE.md). setCallState/resetCallState are
    // stable Zustand actions, so omitting them from deps is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `label` is the picked resource's display name, when the destination came
  // from the resources panel; typed numbers are formatted for display. `from`
  // is the chosen caller ID, passed only for a phone number (Dialer.tsx; the
  // service checks again).
  const makeCall = async (phoneNumber: string, video: boolean = false, label?: string, from?: string) => {
    try {
      log.debug('useSignalWire.makeCall() called with:', phoneNumber, 'video:', video, 'from:', from);
      setError(null);
      setCallState({ callError: null });
      useRecentsStore.getState().start({
        direction: 'outbound',
        destination: phoneNumber,
        // A typed Fabric address is labeled without its `?channel=` (the
        // entry's video flag says that); the destination keeps it.
        label: label ?? formatPhoneNumber(dialPath(phoneNumber)),
        video,
        ...activeSubscriber(),
      });

      // Log call to backend. Cosmetic (see CLAUDE.md), so it must neither
      // delay the dial nor fail it: awaiting it first left a window where
      // hanging up was a no-op (nothing was dialing yet) and the call was
      // placed anyway once the request returned.
      callsAPI.initiateCall(phoneNumber, from)
        .then((callData) => log.debug('Backend logged call:', callData))
        .catch((err) => log.warn('Backend call log failed (ignored):', err));

      // Make the actual call
      log.debug('Making actual call via SignalWire service...');
      const call = await signalWireService.makeCall(phoneNumber, video, from);
      log.debug('SignalWire service returned call object:', call);
      // The user hung up while the dial was in flight; the UI already reset.
      if (!call) return;
      useRecentsStore.getState().setCallId(call.id);

      // From here call.status$ drives callStatus: 'ringing' once the far end
      // rings (onCallStatusChange), 'connected' when it answers.

      log.debug('Call state updated, call should be active');
    } catch (err) {
      const message = describeCallError(err);
      log.error('Failed to make call:', err);
      // callError (not the hook's full-screen `error`) -- a failed call
      // attempt shouldn't take over the whole app UI, just explain itself on
      // the idle dialer screen via ErrorBanner.
      setCallState({ callError: message });
      useRecentsStore.getState().finish('failed');
      throw err;
    }
  };

  const endCall = async () => {
    try {
      log.debug('Ending call...');
      // Hanging up before the far end answered is a cancelled call. An
      // answered one is finished by onCallEnded, which the service fires
      // synchronously inside endCall().
      if (!activeRecent()?.connectedAt) useRecentsStore.getState().finish('cancelled');
      const { callDirection } = useCallStore.getState();
      await signalWireService.endCall();
      resetCallState();
      setError(null);  // Clear any errors
      // Same as onCallEnded's remote-hangup path (which doesn't fire when the
      // dial was still in flight): an outbound call is over, clear the field.
      if (callDirection === 'outbound') setCallState({ pendingDialClear: true });
    } catch (err) {
      log.error('Failed to end call:', err);
      // Don't set error here as it causes blank screen
      // Just log the error and reset state
      // Reset state even if end call fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      log.debug('End call failed but returning to dialer');
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
        connectedAt: Date.now(),
        isCameraOn: isVideoCall,
      });
    } catch (err) {
      log.error('Failed to answer call:', err);
      // Same as rejectCall/endCall's failure paths below: bail back to the
      // idle dialer rather than leaving the user stuck on an unanswerable
      // incoming-call screen. callError survives resetCallState() and
      // explains what happened once back on the dialer.
      const message = describeCallError(err);
      useRecentsStore.getState().finish('failed');
      resetCallState();
      setCallState({ callError: message });
    }
  };

  const rejectCall = async () => {
    try {
      log.debug('Rejecting incoming call...');
      useRecentsStore.getState().finish('declined');
      await signalWireService.rejectCall();
      resetCallState();
      setError(null);  // Clear any errors
      log.debug('Call rejected and state reset');
    } catch (err) {
      log.error('Failed to reject call:', err);
      // Don't set error here as it causes blank screen
      // Reset state even if reject fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      log.debug('Reject call failed but returning to dialer');
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
      log.warn('Mute toggle warning:', err);
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
      log.warn('Camera toggle failed:', err);
      setCallState({ isCameraOn: !newCameraState, callError: describeCallError(err) });
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
          // Browsers without setSinkId never get here (the control is
          // disabled), so the remaining cause is that no speaker was picked.
          callError: 'Pick a speaker in More → Audio & Video Devices first.',
        });
      }
    } catch (err) {
      log.error('Failed to toggle speaker:', err);
      setCallState({ callError: 'Failed to toggle speaker.' });
    }
  };

  const sendDTMF = async (digit: string) => {
    try {
      await signalWireService.sendDTMF(digit);
    } catch (err) {
      log.error('Failed to send DTMF:', err);
    }
  };

  const toggleHold = async () => {
    const { isOnHold } = useCallStore.getState();
    // Optimistic, like mute/camera -- but reverted on failure (unlike those),
    // since toggleHold() isn't pre-checked against anything and can genuinely
    // fail server-side.
    setCallState({ isOnHold: !isOnHold, callError: null });

    try {
      await signalWireService.toggleHold();
    } catch (err) {
      log.error('Failed to toggle hold:', err);
      setCallState({ isOnHold, callError: describeCallError(err) });
    }
  };

  // Left to throw on failure -- callers with their own inline error display
  // (TransferModal) want the rejection, not a store-wide callError.
  const transferCall = (destination: string) => signalWireService.transferCall(destination);

  // Called straight from the click handler -- see the service's
  // toggleScreenShare() for why nothing may be awaited before it.
  const toggleScreenShare = async (withAudio = false) => {
    try {
      await signalWireService.toggleScreenShare(withAudio);
    } catch (err) {
      const message = describeScreenShareError(err);
      if (message === null) return;
      log.error('Failed to toggle screen share:', err);
      // NotSupportedError: the API is unavailable after all, so hide the control.
      if (err instanceof DOMException && err.name === 'NotSupportedError') {
        setCallState({ canScreenShare: false });
      }
      setCallState({ callError: message });
    }
  };

  // The service only updates the toggle state once the constraint actually
  // reached the mic, so a failure leaves the switch where it was -- surface
  // why instead of leaving it silently unresponsive.
  const toggleEchoCancellation = async () => {
    try {
      await signalWireService.toggleEchoCancellation();
    } catch (err) {
      log.warn('Echo cancellation toggle failed:', err);
      setCallState({ callError: describeCallError(err) });
    }
  };

  const toggleAutoGain = async () => {
    try {
      await signalWireService.toggleAutoGain();
    } catch (err) {
      log.warn('Auto gain toggle failed:', err);
      setCallState({ callError: describeCallError(err) });
    }
  };

  const toggleNoiseSuppression = async () => {
    try {
      await signalWireService.toggleNoiseSuppression();
    } catch (err) {
      log.warn('Noise suppression toggle failed:', err);
      setCallState({ callError: describeCallError(err) });
    }
  };

  // Do Not Disturb (unregister/register). isRegistered follows the SDK's
  // isRegistered$ via onRegisteredChange rather than being set here.
  const setDoNotDisturb = async (enabled: boolean) => {
    try {
      await signalWireService.setDoNotDisturb(enabled);
    } catch (err) {
      log.warn('Do Not Disturb change failed:', err);
      setCallState({ callError: describeCallError(err) });
    }
  };

  // One manual ICE restart, from the call-stats sheet.
  const requestIceRestart = async () => {
    try {
      await signalWireService.requestIceRestart();
    } catch (err) {
      log.warn('ICE restart failed:', err);
      setCallState({ callError: describeCallError(err) });
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
    requestIceRestart,
    setDoNotDisturb,
  };
};