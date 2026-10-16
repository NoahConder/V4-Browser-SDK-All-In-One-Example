export interface CallState {
  isConnected: boolean;
  isClientReady: boolean;
  callError: string | null;
  isInCall: boolean;
  isIncoming: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  callDuration: number;
  remoteNumber: string;
  callDirection: 'inbound' | 'outbound' | null;
  callStatus: 'idle' | 'connecting' | 'dialing' | 'ringing' | 'connected' | 'ended';
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