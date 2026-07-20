export interface CallState {
  isConnected: boolean;
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
}

export interface TokenData {
  token: string;
  expires_at: string;
  expires_in: number;
  subscriber_id?: string;
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