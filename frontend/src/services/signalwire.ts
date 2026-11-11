import {
  SignalWire,
  TokenRefreshError,
  InvalidCredentialsError,
  MediaAccessError,
  MediaTrackError,
  SelfParticipant,
  setDebugOptions,
  setLogLevel,
  version as sdkVersion,
} from '@signalwire/js';
import type {
  Call,
  CallOptions,
  CallStatus,
  DeviceRecoveryEvent,
  DialOptions,
  Directory,
  ScreenShareStatus,
  PermissionResult,
  PreflightOptions,
  PreflightResult,
  SessionDiagnostics,
  QualityLevel,
  NetworkIssue,
  NetworkMetrics,
  RecoveryEvent,
  RecoveryState,
} from '@signalwire/js';
import { ReplaySubject, combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import type { Observable, Subscription } from 'rxjs';
import type { TokenData } from '../types';
import axios from 'axios';
import { authAPI, describeFetchError, isTransientFetchError } from './api';
import { toneService } from './tones';
import { RemoteAudioMeter } from './remoteAudioMeter';
import { loadSettings, type DialerSettings } from './settings';
import { isDialAddress } from '../utils/address';
import { log, setDebugLogging } from '../utils/log';

// dial()'s public DialOptions doesn't declare a caller ID, but CallOptions
// does, and dial() spreads its options straight into the call session, whose
// `from` is what the verto.invite carries as caller_id_number (its
// dialogParams). The intersection lets makeCall pass it without a cast.
type OutboundDialOptions = DialOptions & Pick<CallOptions, 'from' | 'fromName'>;

// Thrown by makeCall()/answerCall() when client.ready$ is currently false --
// e.g. right after a token refresh or network blip, not just at first mount
// (by the time the app renders, initialize()'s own client.register() await
// has already resolved once).
export class ClientNotReadyError extends Error {
  constructor() {
    super('SignalWire client is still connecting');
    this.name = 'ClientNotReadyError';
  }
}

// The subscriber identity is fixed for the lifetime of the SignalWire client
// singleton (it's baked in at authenticate() time) -- there's no API to
// re-authenticate an existing client as someone else. So switching subscriber
// persists the choice here and reloads the page, giving the app a cold start
// under the new identity. The SDK is always reset by reloading the page, never
// re-initialized in place.
const SELECTED_SUBSCRIBER_KEY = 'dialer_selected_subscriber_id';

export function getSelectedSubscriberId(): string | undefined {
  return localStorage.getItem(SELECTED_SUBSCRIBER_KEY) || undefined;
}

export function switchSubscriber(subscriberId: string | null) {
  if (subscriberId) {
    localStorage.setItem(SELECTED_SUBSCRIBER_KEY, subscriberId);
  } else {
    localStorage.removeItem(SELECTED_SUBSCRIBER_KEY);
  }
  window.location.reload();
}

// How long refresh() keeps asking the backend for a new token before it gives
// the SDK a failure. The SDK asks a second or so before the current token
// expires and disconnects the client after five failures in a row, which
// ends any live call. A session whose token has lapsed carries on meanwhile,
// and a refresh that arrives late is still accepted, so a backend that is
// restarting, unreachable or rate limiting is waited out rather than
// reported at once.
const REFRESH_RETRY_WINDOW_MS = 120_000;
const REFRESH_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

// A Call in one of these is over -- used when deciding whether a call the SDK
// put in session.calls$ is still worth adopting.
const ENDED_CALL_STATUSES: readonly CallStatus[] = [
  'disconnecting',
  'disconnected',
  'failed',
  'destroyed',
];

// call.rtcPeerConnection throws once the call has been destroyed, and status$
// delivers asynchronously, so a handler can run after that. Every read of the
// peer connection goes through here and gets undefined instead.
function peerConnectionOf(call: Call | null | undefined): RTCPeerConnection | undefined {
  if (!call) return undefined;
  try {
    return call.rtcPeerConnection;
  } catch {
    return undefined;
  }
}

export interface AudioProcessingState {
  echoCancellation: boolean;
  autoGain: boolean;
  noiseSuppression: boolean;
}

export interface CallQualityState {
  level: QualityLevel;
  score: number;
  networkIssues: NetworkIssue[];
}

// getStats() record shapes this TypeScript version's lib.dom doesn't declare.
interface IceCandidateStats extends RTCStats {
  candidateType: string;
  protocol?: string;
  relayProtocol?: string;
}

interface CodecStats extends RTCStats {
  mimeType: string;
  clockRate?: number;
  payloadType: number;
}

// What RTCPeerConnection.getStats() says about the transport and codecs in
// use -- see getConnectionStats().
export interface ConnectionStatsSnapshot {
  candidatePair: {
    localType: string;
    remoteType: string;
    protocol: string | null;
    relayProtocol: string | null;
    currentRoundTripTimeMs: number | null;
  } | null;
  audioOutboundCodec: string | null;
  audioInboundCodec: string | null;
  videoOutboundCodec: string | null;
  videoInboundCodec: string | null;
  bytesSent: number;
  bytesReceived: number;
}

// One line of the in-app event log: what the SDK and this app did, in order,
// for a tester reading along -- status$ transitions, errors$/warnings$,
// recovery and ICE, device changes, and the user's own actions. Kept in a
// bounded ReplaySubject here and read straight from getEventLog$() by the
// EventLog component, never through useCallStore (it ticks too often for the
// store).
export type AppEventKind = 'call' | 'media' | 'client' | 'error' | 'warning' | 'user';

export interface AppEvent {
  at: number;
  kind: AppEventKind;
  message: string;
  // Short secondary text: an error message, a call id, a destination.
  detail?: string;
}

const EVENT_LOG_SIZE = 200;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface SignalWireCallbacks {
  // `remoteNumber` is the display caller id (fromName, else from); `from` is
  // the raw address to redial, `callId` the SDK call id -- both for Recents.
  onIncomingCall?: (remoteNumber: string, hasVideo: boolean, from: string | undefined, callId: string) => void;
  // A second incoming call that arrived during a call (or a dial) and was
  // refused automatically -- logged as missed.
  onIncomingCallAutoRejected?: (remoteNumber: string, from: string | undefined) => void;
  // Fired when the SDK restores a call that was already up before a page
  // reload or WebSocket reconnect (see reconnectAttachedCalls in initialize).
  // The call is live by the time this fires -- the UI just has to catch up.
  onCallReattached?: (remoteNumber: string, hasVideo: boolean) => void;
  onCallEnded?: (wasIncoming: boolean) => void;
  onCallConnected?: () => void;
  // Progress of a call before it connects, from call.status$: 'ringing' once
  // the far end is ringing (SIP 180/183), 'connecting' for the SDK's
  // trying/connecting statuses.
  onCallStatusChange?: (status: 'connecting' | 'ringing') => void;
  onRemoteVideoChange?: (hasVideo: boolean) => void;
  // Reflects client.ready$ for the lifetime of the connection, not just the
  // one-shot mount-time init result.
  onReadyChange?: (ready: boolean) => void;
  // Fired for session-ending async errors/warnings arriving on client.errors$
  // /warnings$ (token refresh failures, no-refresh-handler warnings) -- these
  // don't happen inside any user-initiated action's try/catch, so they'd
  // otherwise only ever reach the log (log.error/log.warn).
  onClientError?: (message: string) => void;
  // The session itself is in trouble (the token can't be refreshed) and only
  // a reload fixes it. Separate from onClientError, whose message the next
  // dial replaces: this one has to stay up until it is dismissed.
  onSessionError?: (message: string) => void;
  // Per the SDK's screen-sharing guide: browser support
  // (screenShareApiSupported) AND the server's `screenshare` capability for
  // this call (call.self.capabilities.screenshare$), fired per-call from
  // setupCallSubscriptions. The capability is present on calls into a room or
  // conference and absent on 1:1 calls (browser-to-browser, PSTN, SIP, SWML),
  // where a screen share has no room participant to attach to. Hold and
  // transfer have no equivalent gate: they aren't capabilities at all (see
  // toggleHold()/transferCall()).
  onCanScreenShareChange?: (canScreenShare: boolean) => void;
  onScreenShareStatusChange?: (status: ScreenShareStatus) => void;
  onAudioProcessingChange?: (state: AudioProcessingState) => void;
  onQualityChange?: (state: CallQualityState) => void;
  // Non-fatal local-media problems reported on call.errors$ while the call
  // carries on -- most importantly a mic/camera that couldn't be captured at
  // dial/answer time, which the SDK handles by continuing receive-only
  // instead of failing the call. Fatal errors aren't forwarded here: those
  // already move status$ to 'failed', which ends the call through the
  // normal path.
  onCallMediaError?: (error: MediaAccessError | MediaTrackError) => void;
  // The browser refused to start remote audio (autoplay policy: no user
  // gesture on this page yet, e.g. a call reattached after a reload). The UI
  // shows a tap-to-enable control that calls resumeRemoteAudio().
  onRemoteAudioBlocked?: () => void;
  // call.recoveryState$ for the current call, and whether media is currently
  // down without the call having ended (see monitorPeerConnection). Both are
  // low-frequency and drive the call screen's "Reconnecting…" state.
  onRecoveryStateChange?: (state: RecoveryState) => void;
  onMediaDisruptionChange?: (disrupted: boolean) => void;
  // client.isRegistered$: whether this subscriber is reachable for incoming
  // calls. False under Do Not Disturb (unregister()); ready$ is unaffected.
  onRegisteredChange?: (registered: boolean) => void;
  // Informational, not an error: e.g. the SDK switched devices by itself
  // after one was unplugged (client.deviceRecovered$).
  onClientNotice?: (message: string) => void;
}

const DEVICE_KIND_LABEL: Record<DeviceRecoveryEvent['kind'], string> = {
  audioinput: 'Microphone',
  audiooutput: 'Speaker',
  videoinput: 'Camera',
};

const DEVICE_RECOVERY_REASON: Record<DeviceRecoveryEvent['reason'], string> = {
  device_disconnected: 'the previous one was disconnected',
  device_reconnected: 'it was reconnected',
  session_restored: 'the session was restored',
  fallback_to_default: 'falling back to the default',
  default_changed: 'the system default changed',
  ambiguous_match: 'the previous one could not be matched',
};

function describeDeviceRecovery(event: DeviceRecoveryEvent): string {
  const kind = DEVICE_KIND_LABEL[event.kind];
  const target = event.newDevice?.label ? `"${event.newDevice.label}"` : 'another device';
  return `${kind} switched to ${target}: ${DEVICE_RECOVERY_REASON[event.reason]}.`;
}

// What the browser does when a constraint isn't specified (and what
// getUserMedia applies by default): all three processing stages on. Used when
// a track's getSettings() omits a field, which some browsers do for
// constraints they don't let pages control.
const DEFAULT_AUDIO_PROCESSING: AudioProcessingState = {
  echoCancellation: true,
  autoGain: true,
  noiseSuppression: true,
};

class SignalWireService {
  private client: InstanceType<typeof SignalWire> | null = null;
  private currentCall: Call | null = null;
  private pendingCall: Call | null = null;
  // Who the last token was minted for (the backend's resolved subscriber id
  // and display name). The token itself is handed to the SDK and not kept.
  private activeSubscriber: { id?: string; displayName?: string } | null = null;
  private wasIncomingCall: boolean = false;
  // The current call was adopted after a reload rather than dialed or
  // answered here; only used to word why it ended.
  private wasReattachedCall = false;
  // The last fatal error the current call reported on errors$, which the SDK
  // follows with status 'failed'; says why the call ended.
  private fatalCallError: string | null = null;
  // The call that has reached 'connected' at least once. After early media,
  // status$ can move from 'connected' back to 'connecting' when the far end
  // answers and stay there while the call is up, so once a call has been
  // connected its later pre-answer statuses don't change the UI, and DTMF
  // is gated on this rather than on call.status.
  private connectedCall: Call | null = null;
  // Mic mute for the current call, applied locally to the outgoing audio
  // track -- see toggleMute() for why this isn't the SDK's self.mute().
  private isMicMuted = false;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private isReady: boolean = false;
  // makeCall() attempts whose client.dial() hasn't settled yet. More than one
  // can be in flight: dial() can't be cancelled, so End abandons an attempt
  // without waiting for it and Call can start the next straight away.
  // createOutboundCall() pushes the new Call into session.calls$ before dial()
  // resolves, so while any attempt is in flight (isDialing) the
  // reattach-adoption subscription leaves calls$ alone; it would otherwise
  // adopt our own outbound call a moment before makeCall() assigns currentCall.
  private dialsInFlight = 0;
  // Set for the duration of client.preflight(). Its media test places a real
  // call through client.dial() -- not makeCall(), so isDialing isn't set --
  // and that call lands in session.calls$ too. This flag keeps
  // adoptUntrackedCall() from treating the test call as the user's call.
  private preflightInProgress: boolean = false;
  // Each makeCall() takes the next attempt number, and endCall() while
  // dialing cancels every attempt up to the latest. dial() can stay pending
  // for a long time (the docs call local media acquisition "unbounded" --
  // e.g. a permission prompt), so by the time it settles the UI may be back
  // on the dialer or already showing a newer call. An attempt adopts its call
  // only if it is still the latest and wasn't cancelled; otherwise makeCall()
  // hangs the call up, so no call is ever live without a screen that owns it.
  private dialAttempt = 0;
  private cancelledDialAttempt = 0;
  // Mirrors the local mic's processing state for the controls sheet. Read
  // from the audio track's getSettings() when the local stream arrives, then
  // updated from each successful call.set*() (see toggleEchoCancellation).
  private audioProcessing: AudioProcessingState = { ...DEFAULT_AUDIO_PROCESSING };
  // Whether Speaker is on for the current call: the chosen output device is
  // applied to whichever element plays the remote audio, re-applied when
  // that moves to the remote <video>, and dropped when the call ends (the
  // store's isSpeakerOn resets with every call).
  private isSpeakerOn = false;
  // Set via setPreferredAudioOutputDevice() (called by the device picker);
  // toggleSpeaker() applies it to the remote media sink. Speaker toggling has
  // no effect until a device has been explicitly selected here.
  private preferredOutputDevice: MediaDeviceInfo | null = null;
  // One of the two gates on the screen-share control (see
  // onCanScreenShareChange's declaration). Hides it in browsers where it's
  // guaranteed to fail, e.g. iOS Safari and some embedded WebViews have no
  // getDisplayMedia at all.
  private readonly screenShareApiSupported: boolean =
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  // RxJS subscriptions
  private incomingCallSub: Subscription | null = null;
  private reattachSub: Subscription | null = null;
  private callStatusSub: Subscription | null = null;
  private remoteStreamSub: Subscription | null = null;
  private localStreamSub: Subscription | null = null;
  private errorSub: Subscription | null = null;
  private warningSub: Subscription | null = null;
  private readySub: Subscription | null = null;
  private registeredSub: Subscription | null = null;
  private deviceRecoveredSub: Subscription | null = null;
  private screenShareCapabilitySub: Subscription | null = null;
  private callErrorsSub: Subscription | null = null;
  private screenShareSub: Subscription | null = null;
  private qualitySub: Subscription | null = null;
  private recoveryStateSub: Subscription | null = null;
  private recoveryEventSub: Subscription | null = null;
  private remoteAudioCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Per-call media-disruption tracking (see monitorPeerConnection). The
  // disposers remove our RTCPeerConnection listeners on call end -- the old
  // connection's 'closed' event fires after hangup(), and must not tear down
  // whatever call is current by then.
  private monitoredPc: RTCPeerConnection | null = null;
  private pcListenerDisposers: Array<() => void> = [];
  private mediaDisruptionTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaDisruptionTimerExtended: boolean = false;
  private lastRecoveryState: RecoveryState = 'idle';
  private isMediaDisrupted: boolean = false;
  // Replays the current call's recent recovery events to late subscribers
  // (the call-stats sheet is opened mid-call).
  private recoveryEvents$ = new ReplaySubject<RecoveryEvent>(10);
  // See AppEvent. Bounded replay so a late subscriber (the Events section
  // opening mid-call) gets the recent history.
  private eventLog$ = new ReplaySubject<AppEvent>(EVENT_LOG_SIZE);

  // Video elements attached by CallScreen; may be set before or after streams arrive.
  private localVideoEl: HTMLVideoElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  // True once the remote stream's audio is being played out through remoteVideoEl,
  // so the fallback <audio> sink knows not to also play it (avoids doubled audio).
  private remoteAudioRoutedToVideo: boolean = false;
  // Whether the remote stream carries a video track (set by handleRemoteMedia).
  // Gates relevantIssues()' filter on the SDK's "no inbound video" issue.
  private remoteHasVideo = false;
  // The speaker bar's level source, fed by handleRemoteMedia() with whatever
  // stream reaches the remote sink. See getRemoteAudioLevel$() for why it
  // isn't the SDK's remoteAudioLevel$.
  private readonly remoteAudioMeter = new RemoteAudioMeter();

  // Callbacks
  private onIncomingCall: SignalWireCallbacks['onIncomingCall'] | null = null;
  private onIncomingCallAutoRejected: SignalWireCallbacks['onIncomingCallAutoRejected'] | null = null;
  // Calls already auto-rejected, so a re-emission of incomingCalls$ with the
  // same still-ringing call isn't logged as missed twice.
  private autoRejectedCallIds = new Set<string>();
  private onCallReattached: ((remoteNumber: string, hasVideo: boolean) => void) | null = null;
  private onCallEnded: ((wasIncoming: boolean) => void) | null = null;
  private onCallConnected: (() => void) | null = null;
  private onCallStatusChange: ((status: 'connecting' | 'ringing') => void) | null = null;
  private onRemoteVideoChange: ((hasVideo: boolean) => void) | null = null;
  private onReadyChange: ((ready: boolean) => void) | null = null;
  private onClientError: ((message: string) => void) | null = null;
  private onSessionError: ((message: string) => void) | null = null;
  private onCanScreenShareChange: ((canScreenShare: boolean) => void) | null = null;
  private onScreenShareStatusChange: ((status: ScreenShareStatus) => void) | null = null;
  private onAudioProcessingChange: ((state: AudioProcessingState) => void) | null = null;
  private onQualityChange: ((state: CallQualityState) => void) | null = null;
  private onCallMediaError: ((error: MediaAccessError | MediaTrackError) => void) | null = null;
  private onRemoteAudioBlocked: (() => void) | null = null;
  private onRecoveryStateChange: ((state: RecoveryState) => void) | null = null;
  private onMediaDisruptionChange: ((disrupted: boolean) => void) | null = null;
  private onRegisteredChange: ((registered: boolean) => void) | null = null;
  private onClientNotice: ((message: string) => void) | null = null;

  // Wire the UI's callbacks. initialize() does this itself; the Playwright
  // suite's `?e2e=1` seam (see useSignalWire) calls it directly so the hook's
  // callbacks are registered without connecting to SignalWire.
  setCallbacks(callbacks: SignalWireCallbacks) {
    this.onIncomingCall = callbacks.onIncomingCall || null;
    this.onIncomingCallAutoRejected = callbacks.onIncomingCallAutoRejected || null;
    this.onCallReattached = callbacks.onCallReattached || null;
    this.onCallEnded = callbacks.onCallEnded || null;
    this.onCallConnected = callbacks.onCallConnected || null;
    this.onCallStatusChange = callbacks.onCallStatusChange || null;
    this.onRemoteVideoChange = callbacks.onRemoteVideoChange || null;
    this.onReadyChange = callbacks.onReadyChange || null;
    this.onClientError = callbacks.onClientError || null;
    this.onSessionError = callbacks.onSessionError || null;
    this.onCanScreenShareChange = callbacks.onCanScreenShareChange || null;
    this.onScreenShareStatusChange = callbacks.onScreenShareStatusChange || null;
    this.onAudioProcessingChange = callbacks.onAudioProcessingChange || null;
    this.onQualityChange = callbacks.onQualityChange || null;
    this.onCallMediaError = callbacks.onCallMediaError || null;
    this.onRemoteAudioBlocked = callbacks.onRemoteAudioBlocked || null;
    this.onRecoveryStateChange = callbacks.onRecoveryStateChange || null;
    this.onMediaDisruptionChange = callbacks.onMediaDisruptionChange || null;
    this.onRegisteredChange = callbacks.onRegisteredChange || null;
    this.onClientNotice = callbacks.onClientNotice || null;
  }

  async initialize(callbacks: SignalWireCallbacks = {}) {
    if (this.isInitializing || this.isInitialized) {
      log.debug('SignalWire initialization already in progress or completed, skipping...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    }

    this.isInitializing = true;
    log.debug('Starting SignalWire initialization...');

    try {
      this.setCallbacks(callbacks);

      // Create credential provider with automatic refresh
      const credentialProvider = {
        authenticate: async () => {
          // `context.fingerprint` (DPoP) is available here but unused: this
          // app mints a plain SAT, so the SDK renews it through refresh().
          const tokenData = await this.fetchTokenForSelectedSubscriber();
          this.rememberSubscriber(tokenData);
          this.logEvent('client', 'Token minted', tokenData.subscriber_display_name);
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
        // Takes no context, unlike authenticate(): CredentialProvider.refresh
        // is typed `() => Promise<SDKCredential>`, so the SDK never hands it a
        // fingerprint.
        refresh: async () => {
          // Same selected id as authenticate() -- otherwise refresh would
          // silently fall back to the default subscriber mid-session.
          const tokenData = await this.refreshTokenPatiently();
          this.rememberSubscriber(tokenData);
          this.logEvent('client', 'Token refreshed', tokenData.subscriber_display_name);
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
      };

      // Initialize the v4 client.
      //
      // reconnectAttachedCalls switches on the SDK's AttachManager: each active
      // call is recorded in sessionStorage (written when the invite is answered
      // and refreshed on every verto ping), and the next init() replays those
      // records as verto.invite with `reattaching: true` rather than discarding
      // them. That's what carries an in-progress call across a page reload or a
      // WebSocket reconnect. It defaults to false, in which case init() calls
      // attachManager.flush() and the records are thrown away.
      //
      // persistSession is deliberately NOT enabled alongside it. All it adds is
      // a copy of the credential in localStorage, and resolveCredentials() only
      // ever reads that cache when no CredentialProvider was supplied -- we
      // always supply one, so it would buy nothing here beyond leaving a
      // long-lived SAT on disk. The state reattach actually depends on (the
      // authorization_state/protocol resume pair and the attach records) is
      // written to sessionStorage either way, and sessionStorage survives a
      // reload. It also must not be enabled without re-checking
      // switchSubscriber() above, which relies on authenticate() running again
      // on every page load.
      // Tester settings (codec order, relay-only, SDK logging) come from
      // services/settings.ts; see applySettings() for live changes.
      const settings = loadSettings();
      this.client = new SignalWire(credentialProvider, {
        reconnectAttachedCalls: true,
        logLevel: settings.logLevel,
        debug: { logWsTraffic: settings.logWsTraffic },
      });

      // Codec order defaults to G.711 (PCMU, then PCMA, then Opus). Setting it
      // on the global client preferences applies to both outbound dials and
      // answered inbound calls — RTCPeerConnectionController falls back to
      // these when a call doesn't override preferredAudioCodecs, reordering
      // the SDP so the preferred payload types are offered first.
      this.applyPreferences(settings);

      // Subscribe to errors. Most errors here are transient/best-effort (e.g.
      // the RPCTimeoutError noted in disconnect() below) and already handled
      // where they're thrown, so only session-ending ones are escalated to
      // the UI via onSessionError — everything else is only logged.
      this.errorSub = this.client.errors$.subscribe((error) => {
        log.error('SignalWire error:', error);
        this.logEvent('error', 'Client error', errorText(error));
        if (error instanceof TokenRefreshError || error instanceof InvalidCredentialsError) {
          this.onSessionError?.('Your session could not be refreshed. Please reload the page to reconnect.');
        }
      });

      // Subscribe to non-fatal warnings (new in v4.0.0-rc.0). Because we drive
      // token refresh ourselves via credentialProvider.refresh(), watch for
      // 'credential_refresh_fallback' / 'credential_no_refresh_handler' — these
      // tell us whether our refresh() is actually being used or the session will
      // silently die at SAT expiry.
      this.warningSub = this.client.warnings$.subscribe((warning) => {
        log.warn('SignalWire warning:', warning.code, warning.message);
        this.logEvent('warning', warning.code, warning.message);
        if (warning.code === 'credential_no_refresh_handler') {
          this.onSessionError?.('Your session will expire soon and cannot auto-refresh. Reload the page before it does to stay connected.');
        }
      });

      // Live readiness — can flip false again after this initial registration
      // (token refresh hiccup, network blip), so callers gate call-time actions
      // on isReady rather than only on the one-shot result of this method.
      let lastReady: boolean | null = null;
      this.readySub = this.client.ready$.subscribe((ready) => {
        this.isReady = ready;
        this.onReadyChange?.(ready);
        // The initial false is just "not yet": log the first true and every
        // change after it.
        if (ready !== lastReady && (ready || lastReady !== null)) {
          this.logEvent('client', ready ? 'Connected and ready' : 'Connection lost — reconnecting');
        }
        lastReady = ready;
      });

      // Registration (reachability for incoming calls) is separate from
      // readiness: unregister() -- Do Not Disturb -- flips this alone.
      let lastRegistered: boolean | null = null;
      this.registeredSub = this.client.isRegistered$.subscribe((registered) => {
        this.onRegisteredChange?.(registered);
        if (registered !== lastRegistered && (registered || lastRegistered !== null)) {
          this.logEvent(
            'client',
            registered ? 'Registered — reachable for incoming calls' : 'Unregistered — not receiving calls (Do Not Disturb)',
          );
        }
        lastRegistered = registered;
      });

      // The SDK swaps devices by itself when one is unplugged/replugged or
      // the OS default changes; say so rather than leaving the user to wonder
      // why their audio moved.
      this.deviceRecoveredSub = this.client.deviceRecovered$.subscribe((event) => {
        this.logEvent('media', 'Device switched by the SDK', describeDeviceRecovery(event));
        this.onClientNotice?.(describeDeviceRecovery(event));
      });

      // Register for incoming calls
      await this.client.register();
      log.debug('Client registered and ready for incoming calls');

      // Subscribe to incoming calls. The SDK lists the newest call first;
      // take the oldest first so the call that rang first keeps the screen.
      this.incomingCallSub = this.client.session.incomingCalls$.subscribe((calls) => {
        const ringing = calls.filter((c) => c.status === 'ringing' || c.status === 'new');
        for (const ringingCall of ringing.reverse()) this.handleRingingCall(ringingCall);
      });

      // Adopt a call the SDK reattached to (see reconnectAttachedCalls above).
      // Both reattach paths -- reattachCalls() replaying stored records at
      // init, and the session-level verto.attach handler when the server
      // pushes one for a call this client has no object for -- build the Call
      // and push it straight into session.calls$. Neither goes through dial()
      // or incomingCalls$, so without this the restored call would be live,
      // audio and all, while the UI sat on the dial pad with no way to hang up.
      //
      // Note the SDK derives direction from the presence of an inbound SDP
      // offer, and a reattach doesn't carry one, so a restored call always
      // reports 'outbound' even if it started as an inbound call. That only
      // affects cosmetics here: onCallEnded reports wasIncoming: false for it.
      this.reattachSub = this.client.session.calls$.subscribe((calls) => this.adoptUntrackedCall(calls));

      this.isInitialized = true;
      this.isInitializing = false;
      log.debug('SignalWire service fully initialized');
      this.logEvent('client', 'Signed in', `${this.getActiveSubscriberDisplayName() ?? 'default subscriber'} · SDK ${sdkVersion}`);
      return true;
    } catch (error) {
      log.error('Failed to initialize SignalWire:', error);
      this.isInitializing = false;
      throw error;
    }
  }

  // The subscriber id SignalWire actually resolved us to (from the token
  // response), not just what was requested -- lets the UI confirm/highlight
  // which subscriber this session is really authenticated as. This is
  // auth.py's resolved resources/subscribers id, NOT SignalWire's own
  // Create Subscriber Token response field of the same name (that one lives
  // in a different, unrelated id namespace -- see auth.py's _resolve_reference).
  getActiveSubscriberId(): string | undefined {
    return this.activeSubscriber?.id;
  }

  // Resolved server-side from the reference actually used to mint this
  // token -- avoids a separate lookup round-trip for the header's
  // permanent "who am I" indicator.
  getActiveSubscriberDisplayName(): string | undefined {
    return this.activeSubscriber?.displayName;
  }

  // The refresh request, retried while the failure looks temporary (see
  // REFRESH_RETRY_WINDOW_MS). Same selected id as authenticate(), so a refresh
  // can't fall back to the default subscriber mid-session. A method so the
  // e2e suite can drive it.
  private async refreshTokenPatiently(): Promise<TokenData> {
    const startedAt = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const tokenData = await authAPI.refreshToken(getSelectedSubscriberId());
        if (attempt > 0) {
          this.logEvent('client', 'Token refresh went through', `after ${attempt + 1} attempts`);
          // Replaces the "retrying" notice below.
          this.onClientNotice?.('The session refresh went through after the backend came back.');
        }
        return tokenData;
      } catch (error) {
        const delay = REFRESH_RETRY_DELAYS_MS[Math.min(attempt, REFRESH_RETRY_DELAYS_MS.length - 1)];
        if (!isTransientFetchError(error) || Date.now() - startedAt + delay > REFRESH_RETRY_WINDOW_MS) throw error;
        this.logEvent('warning', 'Token refresh failed — retrying', describeFetchError(error, 'No answer from the backend'));
        if (attempt === 0) {
          this.onClientNotice?.(
            "The backend didn't answer the session refresh. Retrying for a couple of minutes; the session and any call carry on meanwhile.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private rememberSubscriber(tokenData: TokenData) {
    this.activeSubscriber = { id: tokenData.subscriber_id, displayName: tokenData.subscriber_display_name };
  }

  // Whether this browser can route audio to a chosen output device at all
  // (HTMLMediaElement.setSinkId -- missing before Firefox 116 and Safari
  // 18.4). Read once after initialize(); the Speaker control is disabled when
  // false.
  canSelectAudioOutput(): boolean {
    return this.client?.platformCapabilities.audioOutputSelection ?? false;
  }

  // A saved subscriber choice can go stale (the subscriber was deleted since
  // it was picked). The backend then answers 400 "Unknown subscriber", and
  // because the id is resent on every start and Retry just reloads, the app
  // could never start again without clearing localStorage by hand. Fall back
  // to the default subscriber once and forget the saved id.
  private async fetchTokenForSelectedSubscriber(): Promise<TokenData> {
    const selectedId = getSelectedSubscriberId();
    try {
      return await authAPI.getToken(selectedId);
    } catch (error) {
      if (!selectedId || !axios.isAxiosError(error) || error.response?.status !== 400) {
        throw error;
      }
      log.warn('Saved subscriber was rejected by the backend - falling back to the default subscriber');
      this.logEvent('warning', 'Saved subscriber rejected — using the default subscriber');
      localStorage.removeItem(SELECTED_SUBSCRIBER_KEY);
      this.onClientError?.('Your saved subscriber no longer exists, so you were connected as the default subscriber.');
      return authAPI.getToken(undefined);
    }
  }

  // One ringing inbound call from incomingCalls$ -- a method so the e2e suite
  // can drive it with fake calls. This app handles one call at a time: the
  // first ringing call gets the incoming-call screen, and any other that
  // arrives while a call is up, being dialed or already ringing is rejected
  // and reported as missed.
  private handleRingingCall(ringingCall: Call) {
    // Already on screen, or already rejected below: incomingCalls$ re-emits
    // the whole list on every change, and a rejected call stays in it until
    // the SDK has torn it down.
    if (this.pendingCall?.id === ringingCall.id || this.autoRejectedCallIds.has(ringingCall.id)) return;

    // fromName/from are public on the v4 Call type (4.0.0-rc.0)
    const rawName = ringingCall.fromName;
    const callerId = (rawName && rawName !== '_undef_') ? rawName : ringingCall.from || 'Unknown';

    // While dial() is in flight currentCall isn't set yet, but the UI is
    // already on the call screen, so a ringing call would be unreachable. A
    // second ringing call would take the incoming-call screen from the first.
    if (this.currentCall || this.isDialing || this.pendingCall) {
      this.autoRejectedCallIds.add(ringingCall.id);
      log.debug('Busy - auto-rejecting incoming call from', callerId);
      this.logEvent('call', 'Auto-rejected a second incoming call', callerId);
      this.onIncomingCallAutoRejected?.(callerId, ringingCall.from);
      ringingCall.reject();
      return;
    }

    this.pendingCall = ringingCall;
    log.debug('Incoming call from:', callerId);
    this.logEvent('call', 'Incoming call', `${callerId} · ${ringingCall.id}`);

    // Best-effort: mediaDirections reflects the inbound SDP offer, so a
    // video-enabled offer should show as something other than 'inactive'
    // even before we answer. Defaults to false if the SDK hasn't parsed
    // the offer yet -- worst case we just don't show the video badge.
    const hasVideo = ringingCall.mediaDirections?.video != null
      && ringingCall.mediaDirections.video !== 'inactive';

    toneService.playIncomingCallTone();
    this.onIncomingCall?.(callerId, hasVideo, ringingCall.from, ringingCall.id);

    // Watch for the caller hanging up before we answer. This also fires
    // when an answered or declined call ends later; by then it is no
    // longer the pending call, so only the unsubscribe applies.
    const cleanupCanceled = () => {
      if (this.pendingCall?.id === ringingCall.id) {
        log.debug('Incoming call canceled by caller');
        this.logEvent('call', 'Caller hung up before answer', callerId);
        toneService.stopIncomingCallTone();
        this.pendingCall = null;
        this.handleCallEnded();
      }
      pendingSub.unsubscribe();
    };

    const pendingSub = ringingCall.status$.subscribe({
      next: (status) => {
        if (status === 'disconnected' || status === 'failed' || status === 'destroyed') {
          cleanupCanceled();
        }
      },
      // The SDK completes all subjects on destroy() without emitting a
      // terminal status, so we must also handle completion.
      complete: () => {
        if (this.pendingCall?.id === ringingCall.id) {
          cleanupCanceled();
        }
      },
    });
  }

  // The calls$ handler from initialize() -- a method so the e2e suite can
  // drive it with fake calls. This app handles one call at a time: never
  // adopt while a call is already tracked, never mid-dial (see isDialing's
  // declaration), and never while a connection test is running (see
  // preflightInProgress's).
  private get isDialing(): boolean {
    return this.dialsInFlight > 0;
  }

  private adoptUntrackedCall(calls: Call[]) {
    if (this.currentCall || this.pendingCall || this.isDialing || this.preflightInProgress) return;

    const restored = calls.find((call) => {
      if (ENDED_CALL_STATUSES.includes(call.status)) return false;
      // A genuinely ringing inbound call belongs to the incomingCalls$
      // handler in initialize(), which has its own answer/reject UI.
      if (call.direction === 'inbound' && (call.status === 'ringing' || call.status === 'new')) return false;
      return true;
    });
    if (!restored) return;

    log.debug('Adopting reattached call:', restored.id, 'status:', restored.status);
    this.logEvent('call', 'Reattached to a call after reload/reconnect', `${restored.status} · ${restored.id}`);
    this.isMicMuted = false;
    this.remoteHasVideo = false;
    this.currentCall = restored;
    this.wasIncomingCall = false;
    this.wasReattachedCall = true;
    this.setupCallSubscriptions(restored);
    this.setupRemoteAudioFallback(restored);

    // Same '_undef_' guard as the incoming-call path -- that's what the
    // platform sends for an unset display name.
    const rawName = restored.toName;
    const remoteNumber = (rawName && rawName !== '_undef_') ? rawName : restored.to || 'Unknown';
    const hasVideo = restored.mediaDirections?.video != null
      && restored.mediaDirections.video !== 'inactive';
    this.onCallReattached?.(remoteNumber, hasVideo);
  }

  private setupCallSubscriptions(call: Call) {
    this.cleanupCallSubscriptions();

    // Subscribe to call status changes
    this.callStatusSub = call.status$.subscribe((status) => {
      log.debug('Call status:', status);
      this.logEvent('call', `Status: ${status}`);

      // See connectedCall's declaration: a connected call stays connected.
      if ((status === 'trying' || status === 'connecting' || status === 'ringing') && this.connectedCall === call) {
        log.debug(`Call status ${status} after connected - keeping the call connected`);
        return;
      }

      if (status === 'trying' || status === 'connecting') {
        this.onCallStatusChange?.('connecting');
      } else if (status === 'ringing') {
        this.onCallStatusChange?.('ringing');
      } else if (status === 'recovering') {
        // Recovery is normally reported on recoveryState$; handled here too
        // in case status$ reports it.
        this.setMediaDisrupted(true);
      } else if (status === 'connected') {
        this.connectedCall = call;
        if (this.onCallConnected) {
          this.onCallConnected();
        }
      } else if (status === 'disconnected' || status === 'failed' || status === 'destroyed') {
        // status$ also carries the peer connection's own connectionState, so
        // a 'disconnected'/'failed' that the peer connection itself reports is
        // media loss, not the end of the call: monitorPeerConnection() shows
        // "Reconnecting…" and its grace timer hangs up if media never returns.
        // A hang-up from either side still ends here: the SDK's own
        // hangup()/destroy() emits 'destroyed' (after 'disconnecting'), and the
        // far end's bye emits 'disconnected' while the connection is still up.
        if (status !== 'destroyed' && peerConnectionOf(call)?.connectionState === status) {
          if (status === 'failed' && this.endIfNeverConnected(call, 'peer connection failed')) return;
          log.debug(`Call status ${status} comes from the peer connection - treating it as media loss`);
          return;
        }
        toneService.playDisconnectTone();
        // Only clean up if this is still the active call (endCall may have already cleared it)
        if (this.currentCall === call) {
          const reason = this.unexpectedEndReason(call);
          this.handleCallEnded();
          if (reason) this.onClientError?.(reason);
        }
      }
    });

    // Subscribe to remote stream for audio/video playback
    this.remoteStreamSub = call.remoteStream$.subscribe((stream) => {
      if (stream) {
        log.debug('remoteStream$ emitted stream:', stream.id);
        this.handleRemoteMedia(stream);
      }
    });

    // Subscribe to local stream so the self-view <video> (if attached) shows
    // the camera, and to seed the audio-processing toggles from what the mic
    // track is actually running with.
    this.localStreamSub = call.localStream$.subscribe((stream) => {
      if (stream && this.localVideoEl) {
        this.localVideoEl.srcObject = stream;
      }
      // The SDK swaps in a fresh mic track on device changes; keep it muted
      // if the user is muted.
      this.applyMicMute();
      const audioTrack = stream?.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        this.setAudioProcessing({
          echoCancellation: settings.echoCancellation ?? DEFAULT_AUDIO_PROCESSING.echoCancellation,
          autoGain: settings.autoGainControl ?? DEFAULT_AUDIO_PROCESSING.autoGain,
          noiseSuppression: settings.noiseSuppression ?? DEFAULT_AUDIO_PROCESSING.noiseSuppression,
        });
      }
    });

    // call.errors$ (a replay-1 subject, so an error raised inside dial()
    // before this subscription exists is still delivered) is where the SDK
    // reports media failures that don't end the call. The important one is
    // MediaAccessError from 'acquireLocalMedia': the mic/camera couldn't be
    // captured and the SDK carried on receive-only (fallbackToReceiveOnly
    // defaults to true), so without this the user would sit in a call nobody
    // can hear them on. Screen-share and additional-device legs are skipped --
    // toggleScreenShare's caller already reports those from the rejected
    // promise.
    this.callErrorsSub = call.errors$.subscribe((callError) => {
      log.warn('[call.errors$]', callError.kind, 'fatal:', callError.fatal, 'leg:', callError.leg ?? 'main', callError.error);
      this.logEvent(
        'error',
        `Call error (${callError.kind}${callError.leg && callError.leg !== 'main' ? `, ${callError.leg} leg` : ''}${
          callError.fatal ? ', fatal' : ''
        })`,
        errorText(callError.error),
      );
      if (callError.leg && callError.leg !== 'main') return;
      if (callError.fatal) {
        this.fatalCallError = errorText(callError.error);
        return;
      }
      const { error } = callError;
      if (error instanceof MediaAccessError || error instanceof MediaTrackError) {
        this.onCallMediaError?.(error);
      }
    });

    // Screen-share gate (see onCanScreenShareChange's declaration), fired
    // per-call since resetCallState() clears it on every call end. Hidden
    // until the server grants the capability. call.self$ is typed as the
    // CallSelfParticipant interface, which doesn't declare `capabilities`;
    // at runtime it's a SelfParticipant, which does.
    this.onCanScreenShareChange?.(false);
    this.screenShareCapabilitySub = call.self$
      .pipe(
        switchMap((self) => (self instanceof SelfParticipant ? self.capabilities.screenshare$ : of(false))),
        // self is replaced on every call.joined, re-emitting the same value.
        distinctUntilChanged(),
      )
      .subscribe((granted) => {
        log.debug('[screenshare] capability granted:', granted);
        if (granted) this.logEvent('call', 'Screen share capability granted by the server');
        this.onCanScreenShareChange?.(this.screenShareApiSupported && granted);
      });

    // Quality/network observables live directly on Call (not call.self), so
    // this is simpler than the self$ tier below -- no nullable intermediate.
    let lastIssueTypes = new Set<NetworkIssue['type']>();
    this.qualitySub = combineLatest([
      call.qualityLevel$,
      call.qualityScore$,
      call.networkIssues$,
    ]).subscribe(([level, score, networkIssues]) => {
      const issues = this.relevantIssues(networkIssues);
      this.onQualityChange?.({ level, score, networkIssues: issues });
      // Issues ride along with the 1 Hz metrics; log each once as it appears
      // and once as it clears.
      const types = new Set(issues.map((issue) => issue.type));
      for (const issue of issues) {
        if (!lastIssueTypes.has(issue.type)) this.logEvent('warning', `Network issue: ${issue.type} (${issue.severity})`);
      }
      for (const type of lastIssueTypes) {
        if (!types.has(type)) this.logEvent('media', `Network issue cleared: ${type}`);
      }
      lastIssueTypes = types;
    });

    // call.self is replaced wholesale on each call.joined event, so follow
    // whichever self is current. self$ never emits null (it withholds until
    // self exists), so there's no empty case to handle here.
    let lastShareStatus: ScreenShareStatus | null = null;
    this.screenShareSub = call.self$
      .pipe(switchMap((self) => self.screenShareStatus$))
      .subscribe((status) => {
        this.onScreenShareStatusChange?.(status);
        if (lastShareStatus !== null && status !== lastShareStatus) this.logEvent('media', `Screen share: ${status}`);
        lastShareStatus = status;
      });

    // The SDK's own recovery (CallRecoveryManager: debouncing -> recovering
    // -> cooldown -> idle). Note it is driven by the stats monitor, browser
    // offline events and WebSocket re-auth -- NOT by ICE state, so it can be
    // 'idle' while the peer connection is down; monitorPeerConnection's grace
    // timer covers that case.
    this.lastRecoveryState = 'idle';
    this.recoveryEvents$ = new ReplaySubject<RecoveryEvent>(10);
    this.recoveryStateSub = call.recoveryState$.subscribe((state) => {
      log.debug('[recovery] state:', state);
      if (state !== this.lastRecoveryState) this.logEvent('media', `Recovery: ${state}`);
      this.lastRecoveryState = state;
      this.onRecoveryStateChange?.(state);
      this.setMediaDisrupted(state === 'debouncing' || state === 'recovering' || this.isPeerConnectionDown());
    });
    this.recoveryEventSub = call.recoveryEvent$.subscribe((event) => {
      log.debug('[recovery]', event.action, '-', event.reason, event.attempt != null ? `(${event.attempt}/${event.maxAttempts})` : '');
      this.logEvent(
        'media',
        `Recovery ${event.action}${event.attempt != null ? ` (${event.attempt}/${event.maxAttempts})` : ''}`,
        event.reason,
      );
      this.recoveryEvents$.next(event);
      if (this.currentCall !== call) return;
      if (event.action === 'max_attempts_reached') {
        // The SDK follows this with a fatal network error and status$
        // 'failed'; ending here too keeps call-end detection redundant.
        this.handleCallEnded();
        this.onClientError?.("The call was ended: its connection was lost and couldn't be recovered.");
      } else if (event.action === 'reinvite_succeeded') {
        // New transceivers/tracks after an ICE restart or re-invite: re-pick
        // up remote media and re-apply a local mute to the new sender track.
        if (this.monitoredPc) this.checkReceivers(this.monitoredPc);
        this.applyMicMute();
      }
    });
  }

  // Deduped so the store isn't poked on every repeated ICE/recovery event.
  private setMediaDisrupted(disrupted: boolean) {
    if (this.isMediaDisrupted === disrupted) return;
    this.isMediaDisrupted = disrupted;
    this.logEvent('media', disrupted ? 'Media disrupted — waiting for recovery' : 'Media flowing again');
    this.onMediaDisruptionChange?.(disrupted);
  }

  private isPeerConnectionDown(): boolean {
    const state = this.monitoredPc?.iceConnectionState;
    return state === 'disconnected' || state === 'failed';
  }

  // The in-app event log (see AppEvent): replays the last EVENT_LOG_SIZE
  // entries to a new subscriber, then streams.
  getEventLog$(): Observable<AppEvent> {
    return this.eventLog$.asObservable();
  }

  private logEvent(kind: AppEventKind, message: string, detail?: string) {
    this.eventLog$.next({ at: Date.now(), kind, message, detail });
  }

  // Recent recovery events for the current call (replayed on subscribe).
  getRecoveryEvents$(): Observable<RecoveryEvent> {
    return this.recoveryEvents$.asObservable();
  }

  // Live per-call metrics for the call-stats sheet and the audio meter. Read
  // directly by those components, not routed through the store: they tick at
  // 1 Hz / ~30 fps and have a single, transient consumer.
  getNetworkMetrics$(): Observable<NetworkMetrics[]> {
    return this.currentCall?.networkMetrics$ ?? of([]);
  }

  // `no_inbound_video` only means something when the far end sends video, so
  // it is ignored until it does; otherwise a voice call would read as
  // "Health: Degraded" with a warning triangle.
  private relevantIssues(issues: NetworkIssue[]): NetworkIssue[] {
    return this.remoteHasVideo ? issues : issues.filter((issue) => issue.type !== 'no_inbound_video');
  }

  // The SDK's active network issues, minus no_inbound_video while the far end
  // sends no video (relevantIssues()). The call-stats sheet lists them under
  // "Health".
  getNetworkIssues$(): Observable<NetworkIssue[]> {
    return this.currentCall?.networkIssues$.pipe(map((issues) => this.relevantIssues(issues))) ?? of([]);
  }

  // "No active issue", on the same filtered list (isNetworkHealthy$ counts
  // no_inbound_video as well; see relevantIssues()).
  getIsNetworkHealthy$(): Observable<boolean> {
    return this.getNetworkIssues$().pipe(map((issues) => issues.length === 0));
  }

  getLocalAudioLevel$(): Observable<number> {
    return this.currentCall?.localAudioLevel$ ?? of(0);
  }

  getLocalSpeaking$(): Observable<boolean> {
    return this.currentCall?.localSpeaking$ ?? of(false);
  }

  // Not the SDK's call.remoteAudioLevel$, which only sees remoteStream$: the
  // app meters the stream handleRemoteMedia() routes to the sink instead
  // (services/remoteAudioMeter.ts) -- the same RMS as the mic bar, and it
  // also covers media that arrived through the peer-connection fallback.
  getRemoteAudioLevel$(): Observable<number> {
    return this.remoteAudioMeter.level$;
  }

  getCurrentCallId(): string | null {
    return this.currentCall?.id ?? null;
  }

  // One standard ICE restart. The SDK ignores it while its own recovery is
  // already in progress.
  async requestIceRestart(): Promise<void> {
    await this.requireCurrentCall().requestIceRestart();
  }

  // Snapshot of the selected ICE candidate pair and the negotiated codecs --
  // what a tester wants to confirm (did the codec preference take? is media
  // relayed through TURN?). Polled by the stats sheet while it's open.
  async getConnectionStats(): Promise<ConnectionStatsSnapshot | null> {
    const pc = peerConnectionOf(this.currentCall);
    if (!pc) return null;
    const report = await pc.getStats();
    const byId = new Map<string, RTCStats>();
    report.forEach((stat: RTCStats) => byId.set(stat.id, stat));

    // The transport names the pair in use; older/other engines only mark it
    // nominated + succeeded.
    let pair: RTCIceCandidatePairStats | undefined;
    for (const stat of byId.values()) {
      if (stat.type === 'transport') {
        const { selectedCandidatePairId } = stat as RTCTransportStats;
        if (selectedCandidatePairId) pair = byId.get(selectedCandidatePairId) as RTCIceCandidatePairStats | undefined;
      }
    }
    if (!pair) {
      for (const stat of byId.values()) {
        if (stat.type === 'candidate-pair') {
          const candidate = stat as RTCIceCandidatePairStats;
          if (candidate.nominated && candidate.state === 'succeeded') pair = candidate;
        }
      }
    }
    const local = pair ? (byId.get(pair.localCandidateId) as IceCandidateStats | undefined) : undefined;
    const remote = pair ? (byId.get(pair.remoteCandidateId) as IceCandidateStats | undefined) : undefined;

    const codecOf = (codecId?: string): string | null => {
      const codec = codecId ? (byId.get(codecId) as CodecStats | undefined) : undefined;
      if (!codec) return null;
      const name = codec.mimeType.replace(/^(audio|video)\//i, '');
      const rate = codec.clockRate ? ` ${codec.clockRate / 1000}k` : '';
      return `${name}${rate} (pt ${codec.payloadType})`;
    };

    const snapshot: ConnectionStatsSnapshot = {
      candidatePair:
        pair && local && remote
          ? {
              localType: local.candidateType,
              remoteType: remote.candidateType,
              protocol: local.protocol ?? remote.protocol ?? null,
              relayProtocol: local.relayProtocol ?? null,
              currentRoundTripTimeMs:
                pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
            }
          : null,
      audioOutboundCodec: null,
      audioInboundCodec: null,
      videoOutboundCodec: null,
      videoInboundCodec: null,
      bytesSent: 0,
      bytesReceived: 0,
    };
    for (const stat of byId.values()) {
      if (stat.type === 'outbound-rtp') {
        const rtp = stat as RTCOutboundRtpStreamStats;
        snapshot.bytesSent += rtp.bytesSent ?? 0;
        if (rtp.kind === 'audio') snapshot.audioOutboundCodec = codecOf(rtp.codecId);
        else if (rtp.kind === 'video') snapshot.videoOutboundCodec = codecOf(rtp.codecId);
      } else if (stat.type === 'inbound-rtp') {
        const rtp = stat as RTCInboundRtpStreamStats;
        snapshot.bytesReceived += rtp.bytesReceived ?? 0;
        if (rtp.kind === 'audio') snapshot.audioInboundCodec = codecOf(rtp.codecId);
        else if (rtp.kind === 'video') snapshot.videoInboundCodec = codecOf(rtp.codecId);
      }
    }
    return snapshot;
  }

  private setAudioProcessing(state: AudioProcessingState) {
    this.audioProcessing = state;
    this.onAudioProcessingChange?.(state);
  }

  private cleanupCallSubscriptions() {
    this.callStatusSub?.unsubscribe();
    this.callStatusSub = null;
    this.remoteStreamSub?.unsubscribe();
    this.remoteStreamSub = null;
    this.localStreamSub?.unsubscribe();
    this.localStreamSub = null;
    this.screenShareCapabilitySub?.unsubscribe();
    this.screenShareCapabilitySub = null;
    this.qualitySub?.unsubscribe();
    this.qualitySub = null;
    this.callErrorsSub?.unsubscribe();
    this.callErrorsSub = null;
    this.screenShareSub?.unsubscribe();
    this.screenShareSub = null;
    this.recoveryStateSub?.unsubscribe();
    this.recoveryStateSub = null;
    this.recoveryEventSub?.unsubscribe();
    this.recoveryEventSub = null;
    if (this.remoteAudioCheckInterval) {
      clearInterval(this.remoteAudioCheckInterval);
      this.remoteAudioCheckInterval = null;
    }
    this.clearMediaDisruptionTimer();
    this.pcListenerDisposers.forEach((dispose) => dispose());
    this.pcListenerDisposers = [];
    this.monitoredPc = null;
    this.lastRecoveryState = 'idle';
    // Not via setMediaDisrupted() -- the store's own reset covers the UI.
    this.isMediaDisrupted = false;
  }

  private clearMediaDisruptionTimer() {
    if (this.mediaDisruptionTimer) {
      clearTimeout(this.mediaDisruptionTimer);
      this.mediaDisruptionTimer = null;
    }
    this.mediaDisruptionTimerExtended = false;
  }

  // CallScreen calls these with its <video> refs on mount/unmount. If a stream
  // already exists (e.g. attaching after the call already connected), it's
  // applied immediately; otherwise it's picked up by the subscriptions above.
  setLocalVideoElement(el: HTMLVideoElement | null) {
    this.localVideoEl = el;
    if (el && this.currentCall?.localStream) {
      el.srcObject = this.currentCall.localStream;
    }
  }

  setRemoteVideoElement(el: HTMLVideoElement | null) {
    this.remoteVideoEl = el;
    if (el && this.currentCall?.remoteStream) {
      el.srcObject = this.currentCall.remoteStream;
    }
  }

  // Single entry point for remote media, whether it came from remoteStream$ or
  // the RTCPeerConnection fallback below. Routes to the <video> element when the
  // stream carries a video track (and stops the <audio> sink so audio isn't
  // played out of both elements at once), otherwise falls back to audio-only.
  private handleRemoteMedia(stream: MediaStream) {
    // Meter whatever reaches the sink, on both branches below (the audio track
    // rides along in a video stream too).
    this.remoteAudioMeter.setStream(stream);
    const hasVideo = stream.getVideoTracks().length > 0;
    this.remoteHasVideo = hasVideo;

    if (hasVideo && this.remoteVideoEl) {
      // remoteStream$ and the receiver check (which runs on every ICE and
      // connection state change) deliver the same tracks in fresh MediaStream
      // wrappers. A new srcObject makes the element load again from nothing,
      // so only assign one that brings a track it isn't already playing.
      const current = this.remoteVideoEl.srcObject as MediaStream | null;
      const alreadyPlaying = !!current && stream.getTracks().every((track) => current.getTrackById(track.id));
      if (!alreadyPlaying) this.remoteVideoEl.srcObject = stream;
      // The audio now plays from the <video>; carry the Speaker choice over.
      if (!this.remoteAudioRoutedToVideo && this.isSpeakerOn) this.applySpeakerTo(this.remoteVideoEl);
      this.remoteAudioRoutedToVideo = true;
      this.clearAudioSink();
      // The autoplay attribute fails silently under the autoplay policy; an
      // explicit play() lets the refusal be detected and surfaced.
      if (!alreadyPlaying) this.playSink(this.remoteVideoEl);
    } else if (!this.remoteAudioRoutedToVideo) {
      this.playRemoteStream(stream);
    }

    if (this.onRemoteVideoChange) this.onRemoteVideoChange(hasVideo);
  }

  private clearAudioSink() {
    const audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement | null;
    if (audioEl) audioEl.srcObject = null;
  }

  private applySpeakerTo(el: HTMLMediaElement) {
    this.client?.applySelectedAudioOutputDevice(el).catch((error) => {
      log.error('Error applying audio output device:', error);
    });
  }

  // Speaker ends with the call. The <audio> sink lives on document.body
  // across calls and keeps its sinkId, so put it back on the default output.
  private resetSpeaker() {
    if (!this.isSpeakerOn) return;
    this.isSpeakerOn = false;
    this.client?.selectAudioOutputDevice(null);
    const audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement | null;
    if (audioEl && typeof audioEl.setSinkId === 'function' && audioEl.sinkId) {
      audioEl.setSinkId('').catch((error) => log.warn('Resetting the audio output failed:', error));
    }
  }

  // Second path for remote media, alongside remoteStream$: read the peer
  // connection's receivers and track events directly.
  private setupRemoteAudioFallback(call: Call) {
    // rtcPeerConnection is public on the v4 Call type (RTCPeerConnection | undefined)
    const pc = peerConnectionOf(call);
    if (pc) {
      log.debug('PC available immediately, state:', pc.connectionState, 'ice:', pc.iceConnectionState);
      this.monitorPeerConnection(pc, call);
      return;
    }

    // PC may not be ready yet — poll until it is
    let attempts = 0;
    this.remoteAudioCheckInterval = setInterval(() => {
      attempts++;
      const rtcPC = peerConnectionOf(call);
      if (rtcPC) {
        log.debug('PC became available after', attempts, 'checks, state:', rtcPC.connectionState);
        if (this.remoteAudioCheckInterval) {
          clearInterval(this.remoteAudioCheckInterval);
          this.remoteAudioCheckInterval = null;
        }
        this.monitorPeerConnection(rtcPC, call);
      } else if (attempts > 30) {
        log.warn('Gave up waiting for RTCPeerConnection');
        if (this.remoteAudioCheckInterval) {
          clearInterval(this.remoteAudioCheckInterval);
          this.remoteAudioCheckInterval = null;
        }
      }
    }, 500);
  }

  // Remote-media pickup and media-loss handling on the call's peer connection.
  // Every handler checks the call is still current, and the listeners are
  // removed in cleanupCallSubscriptions() (pcListenerDisposers).
  private monitorPeerConnection(pc: RTCPeerConnection, call: Call) {
    this.monitoredPc = pc;
    const listen = <K extends keyof RTCPeerConnectionEventMap>(
      type: K,
      handler: (event: RTCPeerConnectionEventMap[K]) => void,
    ) => {
      const guarded = (event: RTCPeerConnectionEventMap[K]) => {
        if (this.currentCall !== call) return;
        handler(event);
      };
      pc.addEventListener(type, guarded);
      this.pcListenerDisposers.push(() => pc.removeEventListener(type, guarded));
    };

    // Listen for track events (addEventListener doesn't overwrite the SDK's ontrack handler)
    listen('track', (event) => {
      log.debug('PC track event:', event.track.kind, 'streams:', event.streams.length);
      if (event.track.kind === 'audio' || event.track.kind === 'video') {
        const stream = event.streams[0] || new MediaStream([event.track]);
        this.handleRemoteMedia(stream);
      }
    });

    // Check existing receivers — tracks may already be there
    this.checkReceivers(pc);

    // Media state. 'connected'/'completed' also means remote media (re)starts
    // flowing, so re-check receivers. 'disconnected'/'failed' is a media
    // disruption, not a call end: the SDK may be recovering it (ICE restart,
    // then a relay-only restart), so show "Reconnecting…" and give it the
    // grace window below. Only 'closed' -- produced by the SDK's own destroy
    // -- is terminal here; the other end signals are status$ and
    // recoveryEvent$.
    let lastIce: RTCIceConnectionState | null = null;
    const onMediaStateChange = () => {
      const ice = pc.iceConnectionState;
      const conn = pc.connectionState;
      log.debug('PC state:', conn, 'ice:', ice);
      if (ice !== lastIce) this.logEvent('media', `ICE ${ice}`, `peer connection ${conn}`);
      lastIce = ice;
      if (ice === 'closed' || conn === 'closed') {
        log.debug('Peer connection closed - ending call as fallback');
        this.logEvent('call', 'Peer connection closed — ending the call');
        this.handleCallEnded();
        this.onClientError?.('The call ended: its media connection closed.');
      } else if (ice === 'disconnected' || ice === 'failed' || conn === 'failed') {
        if ((ice === 'failed' || conn === 'failed') && this.endIfNeverConnected(call, `ICE ${ice}, peer connection ${conn}`)) return;
        this.setMediaDisrupted(true);
        this.armMediaDisruptionTimer(pc, call);
      } else if (ice === 'connected' || ice === 'completed') {
        this.checkReceivers(pc);
        this.clearMediaDisruptionTimer();
        this.setMediaDisrupted(this.lastRecoveryState === 'debouncing' || this.lastRecoveryState === 'recovering');
      }
    };
    listen('iceconnectionstatechange', onMediaStateChange);
    listen('connectionstatechange', onMediaStateChange);
  }

  // Why a call that reached a terminal status ended, when that needs saying:
  // it never connected, or it ended on an error. A connected call the far end
  // hung up needs no explanation, and a hang-up from here never gets this far
  // (endCall() has already dropped the call). Read before handleCallEnded()
  // clears the call's state; the caller shows it on the dialer's banner.
  private unexpectedEndReason(call: Call): string | null {
    if (this.fatalCallError) return `The call ended on an error: ${this.fatalCallError}`;
    if (this.connectedCall === call) return null;
    if (this.wasReattachedCall) return "The call couldn't be restored after the reload.";
    return this.wasIncomingCall ? 'The call ended before it connected.' : 'The call ended before it was answered.';
  }

  // The grace timer below is for a call that had media and lost it. A call
  // whose connection fails before it ever reached 'connected' has nothing to
  // recover: end it now, hang up so the far end isn't left on it, and say why
  // on the dialer. Returns whether it ended the call.
  private endIfNeverConnected(call: Call, detail: string): boolean {
    if (this.currentCall !== call || this.connectedCall === call) return false;
    log.warn(`Media connection failed before the call connected (${detail}) - ending the call`);
    this.logEvent('error', 'Media connection failed before the call connected — ending the call', detail);
    toneService.playDisconnectTone();
    this.handleCallEnded();
    this.hangUpAbandonedCall(call);
    this.onClientError?.("The call couldn't connect: no media path to the other side could be set up.");
    return true;
  }

  // How long media may stay down before the call is given up on: the SDK's
  // whole recovery budget (debounce + every ICE-restart attempt) plus slack --
  // 2 + 3*5 + 5 = 22 s with the SDK's default preferences. The SDK's recovery
  // is triggered by its stats monitor rather than ICE state, so this timer is
  // what ends a call whose peer connection has died. If the SDK is still
  // mid-'recovering' when the timer fires, it's extended once by one more
  // attempt.
  private armMediaDisruptionTimer(pc: RTCPeerConnection, call: Call) {
    if (this.mediaDisruptionTimer || !this.client) return;
    const prefs = this.client.preferences;
    const attemptMs = prefs.iceRestartTimeout * 1000;
    const graceMs = prefs.recoveryDebounceTime * 1000 + prefs.maxRecoveryAttempts * attemptMs + 5000;
    const onExpiry = () => {
      this.mediaDisruptionTimer = null;
      if (this.currentCall !== call) return;
      const ice = pc.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') return;
      if (this.lastRecoveryState === 'recovering' && !this.mediaDisruptionTimerExtended) {
        log.debug(`Media still down after ${graceMs} ms but the SDK is recovering - waiting one more attempt`);
        this.mediaDisruptionTimerExtended = true;
        this.mediaDisruptionTimer = setTimeout(onExpiry, attemptMs);
        return;
      }
      log.warn(`Media did not recover (ice: ${ice}, recovery: ${this.lastRecoveryState}) - ending call as fallback`);
      this.logEvent('error', 'Media did not recover — ending the call', `ICE ${ice}, recovery ${this.lastRecoveryState}`);
      this.handleCallEnded();
      this.hangUpAbandonedCall(call);
      this.onClientError?.("The call was ended: its media connection was lost and didn't come back.");
    };
    this.mediaDisruptionTimer = setTimeout(onExpiry, graceMs);
  }

  // Ends the server side of a call this app has given up on locally. Without
  // the bye the far end stays on a silent call until the server times the
  // media out. Skipped when the SDK is already tearing the call down, since
  // hangup() always sends a bye.
  private hangUpAbandonedCall(call: Call) {
    if (call.status === 'destroyed' || call.status === 'disconnecting') return;
    this.logEvent('call', 'Hanging up the abandoned call');
    call.hangup().catch((err) => log.warn('Hangup of an abandoned call failed:', err));
  }

  private checkReceivers(pc: RTCPeerConnection) {
    const receivers = pc.getReceivers();
    const liveTracks = receivers
      .map(r => r.track)
      .filter((t): t is MediaStreamTrack => !!t && t.readyState === 'live');

    if (liveTracks.length > 0) {
      log.debug('Live receiver tracks found:', liveTracks.map(t => t.kind).join(', '));
      this.handleRemoteMedia(new MediaStream(liveTracks));
    } else {
      log.debug('No live receivers found, receivers:', receivers.length);
    }
  }

  private playRemoteStream(stream: MediaStream) {
    let audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement;
    // remoteStream$ and the RTCPeerConnection fallback both deliver the same
    // remote track, wrapped in different MediaStream objects. Re-assigning
    // srcObject for a track that's already playing just interrupts playback.
    const current = audioEl?.srcObject as MediaStream | null;
    const incoming = stream.getAudioTracks();
    if (current && incoming.length > 0 && incoming.every((t) => current.getTrackById(t.id))) {
      return;
    }
    log.debug('Playing remote stream:', stream.id, 'tracks:', incoming.length);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'sw-remote-audio';
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    audioEl.volume = 1.0;
    this.playSink(audioEl);
  }

  // play() on a remote-media sink, surfacing an autoplay refusal to the UI.
  private playSink(el: HTMLMediaElement) {
    el.play().catch((err) => {
      // A newer srcObject superseded this play() call; its own play() takes over.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        log.warn('Remote media playback blocked by the autoplay policy - waiting for a user gesture');
        this.onRemoteAudioBlocked?.();
        return;
      }
      log.error('Remote media play() failed:', err);
    });
  }

  // Called from a user gesture (the call screen's "Tap to enable audio"):
  // retries playback on whichever element carries remote media, and resumes
  // the tone service's AudioContext while the gesture is live.
  resumeRemoteAudio() {
    const sinkEl = this.getRemoteMediaSinkElement();
    if (sinkEl) this.playSink(sinkEl);
    void toneService.resume();
  }

  // SIP URIs (sip:user@domain) and Fabric addresses (/public/room-name) are
  // dialed as-is (isDialAddress in utils/address.ts). Only bare phone numbers
  // get E.164 normalization, and formatting characters are stripped first so
  // a pasted "(555) 123-4567" or "+1 555-123-4567" dials correctly. Keep in
  // sync with format_phone_number() in backend/utils/signalwire.py.
  // Shared by makeCall() and transferCall() -- a transfer destination is
  // normalized exactly like a dialed one.
  private normalizeDestination(value: string): string {
    if (isDialAddress(value)) {
      return value.trim();
    }
    // Keep only digits and a leading '+'.
    const digits = value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    if (digits.startsWith('+')) {
      return digits;
    }
    if (digits.length === 10) {
      return '+1' + digits;
    }
    return '+' + digits;
  }

  // Resolves null if the user hung up before dial() settled: the call is hung
  // up instead of adopted, and a failure of a dial nobody is waiting for is
  // not reported (see dialAttempt).
  async makeCall(phoneNumber: string, video: boolean = false, from?: string, cameraOff: boolean = false): Promise<Call | null> {
    if (!this.client) {
      throw new Error('SignalWire client not initialized');
    }
    if (!this.isReady) {
      throw new ClientNotReadyError();
    }

    // Mute intent starts fresh with each call (the store's isMuted is reset on
    // every call end). Reset here, before dial() -- not when the Call object
    // arrives -- so a Mute tapped on the "Calling..." screen is kept.
    this.isMicMuted = false;
    this.remoteHasVideo = false;

    const attempt = ++this.dialAttempt;
    const isAbandoned = () => attempt <= this.cancelledDialAttempt || attempt !== this.dialAttempt;
    this.dialsInFlight += 1;
    try {
      // The field is the dial string: a Fabric address already carries the
      // `?channel=` the Video toggle chose (useDialFieldStore keeps the two in
      // step), and phone numbers and SIP URIs never carry one. receiveVideo is
      // explicit because the SDK otherwise takes it only from `?channel=video`
      // (buildOptionsFromDestination; its preference default is false), which
      // would leave a SIP video call offering sendonly.
      const to = this.normalizeDestination(phoneNumber);
      // The caller ID (one of the space's numbers or a verified caller ID,
      // useCallerIdStore) is a phone-number thing: dropped for SIP URIs and
      // Fabric addresses whatever the caller passed, and left out entirely
      // when none was chosen: the invite then has no caller_id_number and the
      // server picks the number.
      const callerId = from && !isDialAddress(to) ? from : undefined;
      log.debug('Dialing:', to, callerId ? `from ${callerId}` : '');
      this.logEvent('user', video ? (cameraOff ? 'Dialing (video, camera off)' : 'Dialing (video)') : 'Dialing', callerId ? `${to} · from ${callerId}` : to);

      // Camera off on join is receive-only video: no capture at all, and the
      // app's video: false wins over a `?channel=video` destination. Camera
      // adds the track later (toggleCamera's addVideoInputDevice branch).
      // Hidden behind SHOW_CAMERA_OFF_JOIN.
      const options: OutboundDialOptions = {
        audio: true,
        video: video && !cameraOff,
        receiveVideo: video,
        ...(callerId ? { from: callerId } : {}),
      };
      const call = await this.client.dial(to, options);

      // The user hung up while dial() was pending (see dialAttempt). The UI
      // has already moved on, so don't adopt the call -- end it.
      if (isAbandoned()) {
        log.debug('Dial resolved after the user hung up - ending the call');
        this.logEvent('call', 'Dial cancelled before it connected', call.id);
        call.hangup().catch((error) => {
          log.debug('Hangup of cancelled dial (ignored):', error);
        });
        return null;
      }

      this.currentCall = call;
      this.wasIncomingCall = false;
      this.setupCallSubscriptions(call);
      this.setupRemoteAudioFallback(call);

      log.debug('Call initiated successfully');
      this.logEvent('call', 'Call created', call.id);
      return call;
    } catch (error) {
      if (isAbandoned()) {
        // Nobody is waiting on this attempt any more, and the screen may
        // belong to a newer call: its failure must not reset that.
        log.debug('Cancelled dial failed (ignored):', error);
        this.logEvent('call', 'Cancelled dial did not go through', errorText(error));
        return null;
      }
      log.error('Failed to make call:', error);
      this.logEvent('error', 'Dial failed', errorText(error));
      throw error;
    } finally {
      this.dialsInFlight -= 1;
    }
  }

  async endCall() {
    const call = this.currentCall;
    if (!call) {
      // No Call object yet, but dial() may still be in flight -- make
      // makeCall() hang it up when it resolves instead of adopting it.
      if (this.isDialing) {
        this.cancelledDialAttempt = this.dialAttempt;
        this.logEvent('user', 'Hang up while still dialing');
      }
      return;
    }

    // Eagerly clean up state so incoming calls aren't blocked by stale references.
    // Reset the UI now rather than waiting for status$ to reach a terminal
    // state, which can take a while (e.g. mid-ICE negotiation).
    this.logEvent('user', 'Hang up');
    toneService.playDisconnectTone();
    this.handleCallEnded();

    // End an active screen share first: stopScreenShare() ends the share leg
    // explicitly, so its "(Screen)" member leaves the room with the call.
    // Runs after handleCallEnded() so the UI doesn't wait on it.
    const self = call.self;
    if (self && (self.screenShareStatus === 'starting' || self.screenShareStatus === 'started')) {
      try {
        await self.stopScreenShare();
      } catch (error) {
        log.debug('Stopping screen share during endCall (ignored):', error);
      }
    }

    // Best-effort hangup signal to the server
    try {
      await call.hangup();
    } catch (error) {
      log.debug('Hangup during endCall (ignored):', error);
    }
  }

  async answerCall(video: boolean = false, cameraOff: boolean = false) {
    if (!this.pendingCall) {
      throw new Error('No incoming call to answer');
    }
    if (!this.isReady) {
      // The hook sends the UI back to the dialer on this error, so the call
      // must not be left behind still ringing with no screen to answer or
      // decline it from.
      toneService.stopIncomingCallTone();
      const unanswerable = this.pendingCall;
      this.pendingCall = null;
      try {
        unanswerable.reject();
      } catch (error) {
        log.debug('Rejecting unanswerable call (ignored):', error);
      }
      throw new ClientNotReadyError();
    }

    if (this.currentCall) {
      log.warn('Call already in progress, ignoring answer');
      return;
    }
    this.isMicMuted = false;
    this.remoteHasVideo = false;

    try {
      log.debug('Answering incoming call...');
      this.logEvent('user', video ? (cameraOff ? 'Answered (video, camera off)' : 'Answered (video)') : 'Answered');
      toneService.stopIncomingCallTone();

      const call = this.pendingCall;
      this.pendingCall = null;
      this.currentCall = call;
      this.wasIncomingCall = true;

      // Camera off: receive the caller's video, send none (as in makeCall).
      call.answer({ audio: true, video: video && !cameraOff, receiveVideo: video });
      this.setupCallSubscriptions(call);
      this.setupRemoteAudioFallback(call);

      log.debug('Call answered successfully');
    } catch (error) {
      log.error('Failed to answer call:', error);
      this.logEvent('error', 'Answer failed', errorText(error));
      this.pendingCall = null;
      throw error;
    }
  }

  async rejectCall() {
    if (!this.pendingCall) {
      throw new Error('No incoming call to reject');
    }

    try {
      log.debug('Rejecting incoming call...');
      this.logEvent('user', 'Declined incoming call');
      toneService.stopIncomingCallTone();
      this.pendingCall.reject();
      this.pendingCall = null;
      log.debug('Call rejected');
    } catch (error) {
      log.error('Failed to reject call:', error);
      this.pendingCall = null;
      throw error;
    }
  }

  // Mutes by disabling the outgoing audio track rather than via the SDK's
  // self.mute()/unmute(), which depends on the call's capabilities. A
  // disabled track sends silence immediately and re-enables instantly, on
  // every type of call.
  async toggleMute(muted: boolean) {
    // Record the intent even before the Call object exists (Mute is live on
    // the "Calling..." screen while dial() is pending); applyMicMute() runs
    // again once the call's local stream arrives.
    this.isMicMuted = muted;
    this.applyMicMute();
    log.debug(`Audio ${muted ? 'muted' : 'unmuted'}`);
    this.logEvent('user', muted ? 'Muted (local track disabled)' : 'Unmuted');
  }

  // Disables both the local stream's mic track and the outgoing sender track:
  // on answer, localStream$ emits before the track is attached to the
  // RTCRtpSender, so the sender alone can be missed. They're normally the same
  // MediaStreamTrack; when the SDK's local audio pipeline is engaged the sender
  // carries the pipeline output instead, and muting either one silences it.
  private applyMicMute() {
    const call = this.currentCall;
    if (!call) return;
    const tracks = new Set<MediaStreamTrack>(call.localStream?.getAudioTracks() ?? []);
    for (const sender of peerConnectionOf(call)?.getSenders() ?? []) {
      if (sender.track?.kind === 'audio') tracks.add(sender.track);
    }
    tracks.forEach((track) => { track.enabled = !this.isMicMuted; });
  }

  // muteVideo() stops the camera and asks the server to mute the member's
  // video. When the server shows the video as muted (self.videoMuted), Camera
  // on is unmuteVideo(): it re-acquires the camera and sends call.unmute, so
  // the room shows the video again. Otherwise, with no local track (a call
  // that never sent video, or one whose mute the server didn't take),
  // addVideoInputDevice() adds the camera without a call.unmute. All of it
  // needs a call that was set up with video.
  async toggleCamera(cameraOn: boolean) {
    // Errors propagate: the hook applied the new camera state optimistically
    // and reverts it (and says why) when this throws. That includes the
    // "Calling…" screen, where dial() hasn't produced the Call yet.
    const self = this.currentCall?.self;
    if (!this.currentCall || !self) {
      throw new Error('The call is still being set up - try the camera again in a moment.');
    }

    // A call negotiated without video has no video transceiver for a camera
    // to be added to. The toolbar disables Camera on such a call; this keeps
    // any other caller from showing a camera that isn't being sent.
    const pc = peerConnectionOf(this.currentCall);
    if (cameraOn && pc && !pc.getTransceivers().some((t) => t.receiver.track.kind === 'video')) {
      throw new Error("This call was set up without video, so the camera can't be added to it.");
    }

    const hasLocalVideoTrack = !!this.currentCall.localStream?.getVideoTracks().length;

    if (cameraOn && !hasLocalVideoTrack && !self.videoMuted) {
      await self.addVideoInputDevice();
    } else if (cameraOn) {
      await self.unmuteVideo();
    } else {
      await self.muteVideo();
    }
    log.debug(`Camera ${cameraOn ? 'enabled' : 'disabled'}`);
    this.logEvent('user', cameraOn ? 'Camera on' : 'Camera off');
  }

  // No held$/isOnHold observable exists on Call -- the caller tracks hold
  // state optimistically (like isMuted/isCameraOn) and reverts on failure.
  // A refusal of a verto.modify-based request (transfer, hold/unhold) arrives
  // nested inside a successful envelope ({result: {result: {error}}}) and is
  // reported on call.errors$ (kind 'signaling', non-fatal), so the request's
  // promise resolves either way. Runs `request` and returns that refusal, or
  // null.
  //
  // errors$ is a ReplaySubject(1) delivered on the asap (microtask)
  // scheduler, so subscribing replays the call's PREVIOUS error. Let that
  // replay pass before arming, so an earlier failure on this call (a DTMF
  // digit, a past transfer or hold) isn't attributed to this request; then
  // flush once more after the request so a refusal reported during it lands.
  private async refusalOf(call: Call, request: () => Promise<void>): Promise<Error | null> {
    let armed = false;
    let refusal = null as Error | null;
    const sub = call.errors$.subscribe((callError) => {
      if (armed && callError.kind === 'signaling' && !callError.fatal) refusal = callError.error;
    });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      await flush();
      armed = true;
      await request();
      await flush();
    } finally {
      sub.unsubscribe();
    }
    return refusal;
  }

  async toggleHold() {
    log.debug('[hold] Requested');
    this.logEvent('user', 'Hold / resume requested');

    if (!this.currentCall) {
      log.error('[hold] Aborted -- no active call to hold');
      throw new Error('No active call to hold');
    }

    // No pre-flight capability check -- there's nothing to check: 'hold' isn't
    // part of the SDK's Capability vocabulary at all (hold/unhold are call-leg
    // requests, not in-room actions), and toggleHold() doesn't consult
    // capabilities. So just attempt it and let it succeed or fail on its own.
    // The docs say this resolves once the server acknowledged the change, but
    // a server refusal also resolves (see refusalOf), so check for one. The
    // SDK flips its own hold state whether or not the server accepts, so after
    // a refusal the next toggle requests the opposite of what the UI shows.
    const call = this.currentCall;
    let refusal: Error | null;
    try {
      refusal = await this.refusalOf(call, () => call.toggleHold());
    } catch (error) {
      log.error('[hold] call.toggleHold() rejected:', error);
      throw error;
    }
    if (refusal) {
      log.error('[hold] refused by the server:', refusal);
      this.logEvent('error', 'Hold refused by the server', refusal.message);
      throw new Error(`The server refused the hold request (${refusal.message.replace(/\.$/, '')}).`);
    }
    log.debug('[hold] call.toggleHold() resolved -- server acknowledged the state change');
    this.logEvent('call', 'Hold / resume acknowledged by the server');
  }

  async transferCall(destination: string) {
    const formattedDestination = this.normalizeDestination(destination);
    log.debug('[transfer] Requested, raw input:', destination, '-> normalized:', formattedDestination);
    this.logEvent('user', 'Transfer requested', formattedDestination);

    if (!this.currentCall) {
      log.error('[transfer] Aborted -- no active call to transfer');
      throw new Error('No active call to transfer');
    }

    // No pre-flight capability check -- see toggleHold()'s comment above for
    // why. A server refusal resolves rather than rejects (see refusalOf); the
    // rejection below is what TransferModal shows the user.
    const call = this.currentCall;
    let refusal: Error | null;
    try {
      refusal = await this.refusalOf(call, () => call.transfer({ destination: formattedDestination }));
    } catch (error) {
      log.error('[transfer] call.transfer() rejected:', error);
      throw error;
    }
    if (refusal) {
      log.error('[transfer] refused by the server:', refusal);
      this.logEvent('error', 'Transfer refused by the server', refusal.message);
      throw new Error(`The server refused the transfer (${refusal.message.replace(/\.$/, '')}).`);
    }
    // Per the docs, resolving means the server ACCEPTED the request -- not
    // that the destination answered. A successful blind transfer then moves
    // this call to 'disconnected' (status$); if it stays 'connected', the
    // destination didn't take it.
    log.debug('[transfer] call.transfer() resolved -- server accepted the request');
    this.logEvent('call', 'Transfer accepted by the server');
  }

  // start/stopScreenShare() live on call.self, gated by the caller on the
  // canScreenShare flag (onCanScreenShareChange). Must be called straight from
  // a click/keyboard handler: getDisplayMedia() requires a user gesture, so no
  // await may run before startScreenShare(). `withAudio` asks for the shared
  // surface's audio -- best-effort (Chrome/Edge tabs and windows); the share
  // still starts video-only if it isn't granted.
  async toggleScreenShare(withAudio = false) {
    if (!this.screenShareApiSupported) {
      throw new Error('Screen sharing is not supported in this browser');
    }
    const self = this.currentCall?.self;
    if (!self) {
      throw new Error('No active call to screen share on');
    }
    switch (self.screenShareStatus) {
      // Stopping while still 'starting' is supported: it cancels the pending
      // share (the start promise rejects with AuxiliaryLegCancelledError,
      // which the caller treats as benign).
      case 'started':
      case 'starting':
        this.logEvent('user', 'Stop screen share');
        await self.stopScreenShare();
        break;
      // The SDK says to treat 'stopping' as busy -- starting now could hit
      // ScreenShareAlreadyActiveError against the share still tearing down.
      case 'stopping':
        log.debug('Screen share is still stopping - ignoring toggle');
        break;
      case 'none':
        this.logEvent('user', withAudio ? 'Start screen share (with tab audio)' : 'Start screen share');
        await self.startScreenShare(withAudio ? { audio: true } : undefined);
        break;
    }
  }

  // These use the Call-level set*() methods, which apply browser constraints
  // to the local mic track (track.applyConstraints, or re-acquiring the track
  // where runtime constraints aren't honoured, e.g. iOS Safari). NOT the
  // call.self toggle*() methods: those send a server-side call.audioflags.set
  // RPC for the conference mix engine, gated on a self.audioflags.set
  // capability that 1:1 calls aren't granted -- the SDK's own JSDoc points
  // 1:1 WebRTC calls at these instead.
  //
  // set*() resolves false (not reject) when the constraint didn't reach the
  // mic, so that's surfaced as an error and the toggle state is left alone.
  async toggleEchoCancellation() {
    const call = this.requireCurrentCall();
    const next = !this.audioProcessing.echoCancellation;
    if (!(await call.setEchoCancellation(next))) {
      throw new Error("Couldn't change echo cancellation on your microphone.");
    }
    this.setAudioProcessing({ ...this.audioProcessing, echoCancellation: next });
    this.logEvent('user', `Echo cancellation ${next ? 'on' : 'off'}`);
  }

  async toggleAutoGain() {
    const call = this.requireCurrentCall();
    const next = !this.audioProcessing.autoGain;
    if (!(await call.setAutoGainControl(next))) {
      throw new Error("Couldn't change auto gain on your microphone.");
    }
    this.setAudioProcessing({ ...this.audioProcessing, autoGain: next });
    this.logEvent('user', `Auto gain control ${next ? 'on' : 'off'}`);
  }

  async toggleNoiseSuppression() {
    const call = this.requireCurrentCall();
    const next = !this.audioProcessing.noiseSuppression;
    if (!(await call.setNoiseSuppression(next))) {
      throw new Error("Couldn't change noise suppression on your microphone.");
    }
    this.setAudioProcessing({ ...this.audioProcessing, noiseSuppression: next });
    this.logEvent('user', `Noise suppression ${next ? 'on' : 'off'}`);
  }

  private requireCurrentCall(): Call {
    if (!this.currentCall) {
      throw new Error('No active call');
    }
    return this.currentCall;
  }

  // Browsers don't have a phone's earpiece/loudspeaker distinction -- this
  // "toggle" really means "apply (or clear) the user's selected output
  // device to whichever element remote media is currently playing through."
  // Returns false if setSinkId is unsupported by this browser, or no output
  // device has been selected yet (see setPreferredAudioOutputDevice, wired
  // up by the device picker) -- callers should surface that, not silently
  // flip the UI toggle.
  async toggleSpeaker(speakerOn: boolean): Promise<boolean> {
    if (!this.client) return false;

    const sinkEl = this.getRemoteMediaSinkElement();
    if (!sinkEl) {
      log.warn('No remote media element available yet for speaker toggle');
      return false;
    }

    try {
      if (!speakerOn) {
        // "Off" means back to the browser's default output. The SDK's
        // applySelectedAudioOutputDevice() returns false when no device is
        // selected instead of resetting the sink, so reset it directly.
        this.client.selectAudioOutputDevice(null);
        if (typeof sinkEl.setSinkId !== 'function') return false;
        await sinkEl.setSinkId('');
        this.isSpeakerOn = false;
        log.debug('Speaker off (default output)');
        return true;
      }

      this.client.selectAudioOutputDevice(this.preferredOutputDevice);
      const applied = await this.client.applySelectedAudioOutputDevice(sinkEl);
      // The call may have ended while the device was being applied.
      this.isSpeakerOn = applied && this.currentCall !== null;
      if (applied && !this.isSpeakerOn) await sinkEl.setSinkId('');
      log.debug('Speaker on, applied:', applied);
      return applied;
    } catch (error) {
      log.error('Error applying audio output device:', error);
      return false;
    }
  }

  // Set by the device picker when the user picks a speaker/output device.
  setPreferredAudioOutputDevice(device: MediaDeviceInfo | null) {
    this.logEvent('user', 'Speaker selected', device?.label || 'default');
    this.preferredOutputDevice = device;
    this.client?.selectAudioOutputDevice(device);
    // With Speaker on, the new choice replaces the one in use.
    const sinkEl = this.getRemoteMediaSinkElement();
    if (this.isSpeakerOn && device && sinkEl) this.applySpeakerTo(sinkEl);
  }

  // Live settings changes. Log settings are SDK globals and take effect at
  // once; codec order and relay-only are read by the SDK at the next
  // offer/answer and peer-connection creation respectively, so they apply to
  // the next call (no reload).
  applySettings(settings: DialerSettings) {
    this.logEvent(
      'user',
      'Settings applied',
      `codecs ${settings.audioCodecOrder.join(' > ')} · log ${settings.logLevel} · relay-only ${
        settings.relayOnly ? 'on' : 'off'
      } · WS trace ${settings.logWsTraffic ? 'on' : 'off'}`,
    );
    setLogLevel(settings.logLevel);
    setDebugOptions({ logWsTraffic: settings.logWsTraffic });
    setDebugLogging(settings.debugLogs);
    this.applyPreferences(settings);
  }

  private applyPreferences(settings: DialerSettings) {
    if (!this.client) return;
    this.client.preferences.preferredAudioCodecs = settings.audioCodecOrder;
    this.client.preferences.relayOnly = settings.relayOnly;
  }

  getSdkInfo(): { version: string; audioCodecs: readonly string[] } {
    return { version: sdkVersion, audioCodecs: this.client?.platformCapabilities.audioCodecs ?? [] };
  }

  // Do Not Disturb: stay connected but stop receiving calls. unregister()
  // flips isRegistered$ only -- ready$ (and the header dot) stay green.
  // Session-only: every page load registers again in initialize().
  async setDoNotDisturb(enabled: boolean): Promise<void> {
    if (!this.client) throw new Error('SignalWire client not initialized');
    this.logEvent('user', enabled ? 'Do Not Disturb on — unregister()' : 'Do Not Disturb off — register()');
    if (enabled) {
      await this.client.unregister();
    } else {
      await this.client.register();
    }
  }

  // The subscriber's own address book (client.directory$): other subscribers,
  // rooms, apps -- everything this identity can dial, from the SDK rather
  // than the backend's REST listings. undefined until the client is connected.
  // Nothing is fetched until the Directory tab subscribes to it.
  getDirectory$(): Observable<Directory | undefined> {
    return this.client?.directory$ ?? of(undefined);
  }

  // Ids of this subscriber's own fabric addresses, so the Directory tab can
  // mark (and not offer to dial) yourself.
  getOwnAddressIds(): Set<string> {
    return new Set((this.client?.user?.addresses ?? []).map((address) => address.id));
  }

  // Thin passthroughs for the device picker -- nothing outside this file
  // touches `client` directly, so device enumeration/selection is exposed
  // here rather than the picker reaching into a `client` getter itself.
  // Devices lists are read-only outside of this service, so callers get the
  // observable directly rather than yet another set of injected callbacks.
  getAudioInputDevices$(): Observable<MediaDeviceInfo[]> {
    return this.client?.audioInputDevices$ ?? of([]);
  }

  getVideoInputDevices$(): Observable<MediaDeviceInfo[]> {
    return this.client?.videoInputDevices$ ?? of([]);
  }

  getAudioOutputDevices$(): Observable<MediaDeviceInfo[]> {
    return this.client?.audioOutputDevices$ ?? of([]);
  }

  getSelectedAudioInputDevice$(): Observable<MediaDeviceInfo | null> {
    return this.client?.selectedAudioInputDevice$ ?? of(null);
  }

  getSelectedVideoInputDevice$(): Observable<MediaDeviceInfo | null> {
    return this.client?.selectedVideoInputDevice$ ?? of(null);
  }

  getSelectedAudioOutputDevice$(): Observable<MediaDeviceInfo | null> {
    return this.client?.selectedAudioOutputDevice$ ?? of(null);
  }

  selectAudioInputDevice(device: MediaDeviceInfo | null) {
    this.logEvent('user', 'Microphone selected', device?.label || 'default');
    this.client?.selectAudioInputDevice(device);
  }

  selectVideoInputDevice(device: MediaDeviceInfo | null) {
    this.logEvent('user', 'Camera selected', device?.label || 'default');
    this.client?.selectVideoInputDevice(device);
  }

  async refreshDevices(): Promise<void> {
    await this.client?.enumerateDevices();
  }

  // Prompts for permission and populates device labels (empty until granted).
  // Called by the device picker on open, not at app startup -- see
  // App.tsx's own getUserMedia gate, which stays as the audio-only startup
  // check since `client` doesn't exist yet at that point in the app lifecycle.
  async requestMediaPermissions(options?: { audio?: boolean; video?: boolean }): Promise<PermissionResult> {
    if (!this.client) {
      return { audio: false, video: false };
    }
    return this.client.requestMediaPermissions(options);
  }

  // Places a real call to `destination` to test signaling/TURN/bandwidth --
  // idle-only (refused while a call is up, ringing or being dialed; the panel
  // disables Run then), never prefilled from a live dial-pad
  // value since it's a genuine, potentially-billable call attempt.
  async runPreflight(destination: string, options?: PreflightOptions): Promise<PreflightResult> {
    if (!this.client) {
      throw new Error('SignalWire client not initialized');
    }
    if (this.currentCall || this.pendingCall || this.isDialing) {
      throw new Error('End the current call before running the connection test.');
    }
    this.preflightInProgress = true;
    this.logEvent('user', 'Connection test started', destination);
    try {
      const result = await this.client.preflight(destination, options);
      this.logEvent(
        'client',
        result.ok ? 'Connection test passed' : 'Connection test found issues',
        // Defensive: the e2e suite's fake result has no warnings array.
        result.warnings?.length ? result.warnings.join('; ') : undefined,
      );
      return result;
    } catch (error) {
      this.logEvent('error', 'Connection test failed', errorText(error));
      throw error;
    } finally {
      this.preflightInProgress = false;
    }
  }

  exportDiagnostics(): SessionDiagnostics | null {
    return this.client?.exportDiagnostics() ?? null;
  }

  // Whichever element is actually rendering remote media right now: the
  // remote <video> once a video track has routed audio through it (see
  // handleRemoteMedia), otherwise the fallback <audio> sink.
  private getRemoteMediaSinkElement(): HTMLMediaElement | null {
    if (this.remoteAudioRoutedToVideo && this.remoteVideoEl) {
      return this.remoteVideoEl;
    }
    return document.getElementById('sw-remote-audio') as HTMLAudioElement | null;
  }

  // DTMF only has somewhere to go once the call is connected (per the SDK's
  // call-controls guide); digits tapped while it's still ringing are dropped.
  // "Connected" is connectedCall, not call.status (see its declaration).
  async sendDTMF(digit: string) {
    const call = this.currentCall;
    if (call && this.connectedCall === call && !ENDED_CALL_STATUSES.includes(call.status)) {
      this.logEvent('user', `DTMF ${digit}`);
      await call.sendDigits(digit);
    }
  }

  private handleCallEnded() {
    log.debug('handleCallEnded - cleaning up');
    // Guarded so the redundant end paths (endCall(), then status$) log once.
    if (this.currentCall || this.pendingCall) this.logEvent('call', 'Call ended');
    const wasIncoming = this.wasIncomingCall;

    this.cleanupCallSubscriptions();
    this.currentCall = null;
    this.pendingCall = null;
    this.connectedCall = null;
    this.wasIncomingCall = false;
    this.wasReattachedCall = false;
    this.fatalCallError = null;
    // Not via setAudioProcessing() -- the store's own reset covers the UI.
    this.audioProcessing = { ...DEFAULT_AUDIO_PROCESSING };

    // Clean up audio/video sinks and the remote level meter
    this.resetSpeaker();
    this.clearAudioSink();
    this.remoteAudioMeter.setStream(null);
    if (this.localVideoEl) this.localVideoEl.srcObject = null;
    if (this.remoteVideoEl) this.remoteVideoEl.srcObject = null;
    this.remoteAudioRoutedToVideo = false;
    this.remoteHasVideo = false;

    if (this.onCallEnded) {
      log.debug('Notifying UI of call end, wasIncoming:', wasIncoming);
      this.onCallEnded(wasIncoming);
    }
  }

  // Whether a call is currently up. Used by App.tsx's beforeunload handler to
  // decide whether tearing the session down is safe -- disconnect() wipes the
  // attach records a reload would otherwise reattach to.
  hasActiveCall(): boolean {
    return this.currentCall !== null;
  }

  disconnect() {
    if (!this.client) {
      log.debug('Disconnect called but no client exists - ignoring');
      return;
    }

    log.debug('SignalWire service disconnecting...');

    this.cleanupCallSubscriptions();
    this.incomingCallSub?.unsubscribe();
    this.incomingCallSub = null;
    this.reattachSub?.unsubscribe();
    this.reattachSub = null;
    this.errorSub?.unsubscribe();
    this.errorSub = null;
    this.warningSub?.unsubscribe();
    this.warningSub = null;
    this.readySub?.unsubscribe();
    this.readySub = null;
    this.registeredSub?.unsubscribe();
    this.registeredSub = null;
    this.deviceRecoveredSub?.unsubscribe();
    this.deviceRecoveredSub = null;
    this.isReady = false;

    if (this.currentCall) {
      this.currentCall.hangup().catch((error) => {
        log.debug('Hangup error during disconnect (ignored):', error?.message);
      });
      this.currentCall = null;
    }

    this.pendingCall = null;

    // Just close the connection. We deliberately do NOT call unregister() first:
    // disconnect() (invoked from beforeunload) tears down the WebSocket, and the
    // server marks the subscriber offline as soon as that socket drops. Calling
    // unregister() here would race with this teardown: its RPC would get no
    // response and surface an RPCTimeoutError on errors$. unregister() is for
    // going offline while staying connected (Do Not Disturb,
    // setDoNotDisturb()).
    this.client.disconnect().catch((error) => {
      log.debug('Disconnect error (ignored):', error?.message);
    });

    this.client = null;
  }
}

export const signalWireService = new SignalWireService();
