export interface CallState {
  isConnected: boolean;
  isClientReady: boolean;
  // Whether this browser can route audio to a chosen output device at all
  // (HTMLMediaElement.setSinkId -- missing on Firefox and Safari). A fact
  // about the session, preserved across resets like isClientReady.
  canSelectAudioOutput: boolean;
  callError: string | null;
  isInCall: boolean;
  isIncoming: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  callDuration: number;
  remoteNumber: string;
  callDirection: 'inbound' | 'outbound' | null;
  // 'connecting' from the moment Call is tapped (and for the SDK's
  // trying/connecting statuses), 'ringing' once the SDK reports the far end
  // ringing, 'connected' when answered.
  callStatus: 'idle' | 'connecting' | 'ringing' | 'connected';
  // When the call was answered (Date.now()), for the in-call timer. Set once
  // per call, so an ICE restart re-emitting 'connected' doesn't reset it.
  connectedAt: number | null;
  // Remote audio playback was refused by the browser's autoplay policy (no
  // user gesture on this page yet -- e.g. a call reattached after a reload).
  // The call screen shows a tap-to-enable control until the user taps it.
  needsAudioUnlock: boolean;
  // The SDK's CallRecoveryManager state for the current call (call.recoveryState$).
  recoveryState: 'idle' | 'debouncing' | 'recovering' | 'cooldown';
  // Media is currently down (ICE disconnected/failed, or the SDK is mid-
  // recovery) but the call hasn't ended -- the call screen shows
  // "Reconnecting…" instead of dropping to the dial pad. See CLAUDE.md's
  // call-ended detection note.
  isMediaDisrupted: boolean;
  isVideoCall: boolean;
  isCameraOn: boolean;
  remoteHasVideo: boolean;
  // Hold has no SDK truth signal (no held$/isOnHold observable) -- tracked
  // optimistically client-side, same as isMuted/isCameraOn.
  isOnHold: boolean;
  // Browser getDisplayMedia support AND no server-reported PSTN/SIP leg on
  // the current call, not a SignalWire call capability -- see signalwire.ts's
  // onCanScreenShareChange comment. Set per-call. Hold and transfer have no
  // equivalent gate at all.
  canScreenShare: boolean;
  screenShareStatus: 'none' | 'starting' | 'started' | 'stopping';
  isEchoCancellationOn: boolean;
  isAutoGainOn: boolean;
  isNoiseSuppressionOn: boolean;
  qualityLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' | null;
  qualityScore: number | null;
  networkIssueCount: number;
  // Display name of whoever this session's token was minted for -- session
  // identity, not call state, so it's preserved across resetCallState() same
  // as isConnected/isClientReady.
  activeSubscriberName: string | null;
}

export interface TokenData {
  token: string;
  expires_at: string;
  expires_in: number;
  subscriber_id?: string;
  // Resolved server-side from the reference actually used to mint this
  // token -- see auth.py's _resolve_reference for why this can't be
  // recovered from subscriber_id alone.
  subscriber_display_name?: string;
  project_id: string;
  space_name: string;
}

export interface CallData {
  id: string;
  to: string;
  from: string;
  direction: 'inbound' | 'outbound';
  status: string;
  started_at: string;
  ended_at?: string;
  duration: number;
}

export interface DialPadKey {
  number: string;
  letters?: string;
  special?: boolean;
}

export interface DialableAddress {
  id: string;
  name: string;
  display_name: string;
  channels: Record<string, string>;
}

export interface SwmlScript {
  id: string;
  script_type?: string;
  version?: string;
  addresses: DialableAddress[];
}

export interface SipCredential {
  id: string;
  display_name: string;
  sip_endpoint: {
    username: string;
  };
  addresses: DialableAddress[];
}

export interface Subscriber {
  id: string;
  display_name: string;
  email: string | null;
}