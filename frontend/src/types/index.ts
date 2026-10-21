export interface CallState {
  isClientReady: boolean;
  // Whether this browser can route audio to a chosen output device at all
  // (HTMLMediaElement.setSinkId -- missing before Firefox 116 and Safari
  // 18.4). A fact about the session, preserved across resets like
  // isClientReady.
  canSelectAudioOutput: boolean;
  // client.isRegistered$ -- reachable for incoming calls. False under Do Not
  // Disturb. Session state, preserved across resets like isClientReady.
  isRegistered: boolean;
  callError: string | null;
  // Informational banner (device switched by the SDK, etc.), shown with an
  // info tone. Preserved across resets like callError; dismissed explicitly.
  clientNotice: string | null;
  isInCall: boolean;
  isIncoming: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  remoteNumber: string;
  // Set when an outbound call ends (hung up here or by the far end) so the
  // dialer clears its field; the dialer resets it once handled.
  pendingDialClear: boolean;
  callDirection: 'inbound' | 'outbound' | null;
  // The caller ID sent with an outbound call to a phone number (dial()'s
  // `from`), for the call card; null when the server chose or the
  // destination wasn't a phone number. See useCallerIdStore.
  outboundCallerId: string | null;
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

// The fields of the backend's token response this app reads (it also returns
// expires_in/project_id/space_name, unused here).
export interface TokenData {
  token: string;
  expires_at: string;
  subscriber_id?: string;
  // Resolved server-side from the reference actually used to mint this
  // token -- see auth.py's _resolve_reference for why this can't be
  // recovered from subscriber_id alone.
  subscriber_display_name?: string;
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

// One choice in the Caller ID picker (GET /api/caller-ids): a phone number
// the project owns or an external number it has verified -- the two things
// SignalWire accepts as the caller ID of a call to a phone number.
export interface CallerId {
  id: string;
  number: string;
  name: string | null;
  kind: 'number' | 'verified';
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
  // The subscriber's dialable Fabric addresses (normally one, /private/<name>).
  addresses: DialableAddress[];
}