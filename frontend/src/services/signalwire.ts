import {
  SignalWire,
  TokenRefreshError,
  InvalidCredentialsError,
  MediaAccessError,
  MediaTrackError,
  SelfParticipant,
} from '@signalwire/js';
import type {
  AuthenticateContext,
  Call,
  CallStatus,
  ScreenShareStatus,
  PermissionResult,
  PreflightOptions,
  PreflightResult,
  SessionDiagnostics,
  QualityLevel,
  NetworkIssue,
  RecoveryEvent,
  RecoveryState,
} from '@signalwire/js';
import { ReplaySubject, combineLatest, distinctUntilChanged, of, switchMap } from 'rxjs';
import type { Observable, Subscription } from 'rxjs';
import type { TokenData } from '../types';
import axios from 'axios';
import { authAPI } from './api';
import { toneService } from './tones';
import { isDialAddress } from '../utils/address';

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
// under the new identity, same as this file's existing "reload to reset the
// SDK" rule (see CLAUDE.md / disconnect()).
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

// A Call in one of these is over -- used when deciding whether a call the SDK
// put in session.calls$ is still worth adopting.
const ENDED_CALL_STATUSES: readonly CallStatus[] = [
  'disconnecting',
  'disconnected',
  'failed',
  'destroyed',
];

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

export interface SignalWireCallbacks {
  onIncomingCall?: (remoteNumber: string, hasVideo: boolean) => void;
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
  // otherwise only ever reach console.error/console.warn.
  onClientError?: (message: string) => void;
  // Per the SDK's screen-sharing guide: browser support
  // (screenShareApiSupported) AND the server's `screenshare` capability for
  // this call (call.self.capabilities.screenshare$), fired per-call from
  // setupCallSubscriptions. The capability is the server's real answer: it's
  // absent on 1:1 calls (browser-to-browser, PSTN, SIP, SWML), where the
  // server refuses the share leg with "Must provide a participant invite
  // first", and present on calls into a room/conference. Hold/transfer have
  // no equivalent gate: they aren't capabilities at all (see
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
  private currentToken: TokenData | null = null;
  private wasIncomingCall: boolean = false;
  // Set while a transfer() request is in flight (and briefly after, until the
  // resulting status$ change is observed), purely so the "Call status" log
  // line can flag which disconnect/reconnect was caused by a transfer --
  // transfer() resolving only confirms the request was sent, not that it
  // succeeded, so this is the only way to see the real outcome in the console.
  private pendingTransferDestination: string | null = null;
  // Mic mute for the current call, applied locally to the outgoing audio
  // track -- see toggleMute() for why this isn't the SDK's self.mute().
  private isMicMuted = false;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private isReady: boolean = false;
  // Set for the duration of client.dial(). createOutboundCall() pushes the new
  // Call into session.calls$ before dial() resolves, so without this the
  // reattach-adoption subscription would see our own outbound call as an
  // untracked one and adopt it a moment before makeCall() assigns currentCall.
  private isDialing: boolean = false;
  // Set when endCall() runs while client.dial() is still pending. dial() can't
  // be cancelled and can stay pending for a long time (the docs call local
  // media acquisition "unbounded" -- e.g. a permission prompt), so the UI may
  // already have reset to the dialer by the time it resolves. makeCall()
  // checks this and hangs up instead of adopting a call no screen owns.
  private dialCancelled: boolean = false;
  // Mirrors the local mic's processing state for the controls sheet. Read
  // from the audio track's getSettings() when the local stream arrives, then
  // updated from each successful call.set*() (see toggleEchoCancellation).
  private audioProcessing: AudioProcessingState = { ...DEFAULT_AUDIO_PROCESSING };
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
  private capabilitiesSub: Subscription | null = null;
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

  // Video elements attached by CallScreen; may be set before or after streams arrive.
  private localVideoEl: HTMLVideoElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  // True once the remote stream's audio is being played out through remoteVideoEl,
  // so the fallback <audio> sink knows not to also play it (avoids doubled audio).
  private remoteAudioRoutedToVideo: boolean = false;

  // Callbacks
  private onIncomingCall: ((remoteNumber: string, hasVideo: boolean) => void) | null = null;
  private onCallReattached: ((remoteNumber: string, hasVideo: boolean) => void) | null = null;
  private onCallEnded: ((wasIncoming: boolean) => void) | null = null;
  private onCallConnected: (() => void) | null = null;
  private onCallStatusChange: ((status: 'connecting' | 'ringing') => void) | null = null;
  private onRemoteVideoChange: ((hasVideo: boolean) => void) | null = null;
  private onReadyChange: ((ready: boolean) => void) | null = null;
  private onClientError: ((message: string) => void) | null = null;
  private onCanScreenShareChange: ((canScreenShare: boolean) => void) | null = null;
  private onScreenShareStatusChange: ((status: ScreenShareStatus) => void) | null = null;
  private onAudioProcessingChange: ((state: AudioProcessingState) => void) | null = null;
  private onQualityChange: ((state: CallQualityState) => void) | null = null;
  private onCallMediaError: ((error: MediaAccessError | MediaTrackError) => void) | null = null;
  private onRemoteAudioBlocked: (() => void) | null = null;
  private onRecoveryStateChange: ((state: RecoveryState) => void) | null = null;
  private onMediaDisruptionChange: ((disrupted: boolean) => void) | null = null;

  async initialize(callbacks: SignalWireCallbacks = {}) {
    if (this.isInitializing || this.isInitialized) {
      console.log('SignalWire initialization already in progress or completed, skipping...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    }

    this.isInitializing = true;
    console.log('Starting SignalWire initialization...');

    try {
      this.onIncomingCall = callbacks.onIncomingCall || null;
      this.onCallReattached = callbacks.onCallReattached || null;
      this.onCallEnded = callbacks.onCallEnded || null;
      this.onCallConnected = callbacks.onCallConnected || null;
      this.onCallStatusChange = callbacks.onCallStatusChange || null;
      this.onRemoteVideoChange = callbacks.onRemoteVideoChange || null;
      this.onReadyChange = callbacks.onReadyChange || null;
      this.onClientError = callbacks.onClientError || null;
      this.onCanScreenShareChange = callbacks.onCanScreenShareChange || null;
      this.onScreenShareStatusChange = callbacks.onScreenShareStatusChange || null;
      this.onAudioProcessingChange = callbacks.onAudioProcessingChange || null;
      this.onQualityChange = callbacks.onQualityChange || null;
      this.onCallMediaError = callbacks.onCallMediaError || null;
      this.onRemoteAudioBlocked = callbacks.onRemoteAudioBlocked || null;
      this.onRecoveryStateChange = callbacks.onRecoveryStateChange || null;
      this.onMediaDisruptionChange = callbacks.onMediaDisruptionChange || null;

      // Create credential provider with automatic refresh
      const credentialProvider = {
        authenticate: async (context?: AuthenticateContext) => {
          // Diagnostic only -- this app mints a plain SAT (no fingerprint/scope
          // forwarded), so this just tells us whether the SDK hands us a DPoP
          // fingerprint at all in this browser/version. See CLAUDE.md's Client
          // Bound SAT note.
          console.log('[SAT] authenticate() context.fingerprint:', context?.fingerprint ?? '(none)');
          const tokenData = await this.fetchTokenForSelectedSubscriber();
          this.currentToken = tokenData;
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
          const tokenData = await authAPI.refreshToken(this.currentToken?.token, getSelectedSubscriberId());
          this.currentToken = tokenData;
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
      this.client = new SignalWire(credentialProvider, {
        reconnectAttachedCalls: true,
      });

      // Default all calls to G.711 (PCMU first, then PCMA). Setting this on the
      // global client preferences applies to both outbound dials and answered
      // inbound calls — RTCPeerConnectionController falls back to these when a
      // call doesn't override preferredAudioCodecs. The SDK reorders the SDP so
      // these payload types are offered ahead of Opus.
      this.client.preferences.preferredAudioCodecs = ['PCMU', 'PCMA'];

      // Subscribe to errors. Most errors here are transient/best-effort (e.g.
      // the RPCTimeoutError noted in disconnect() below) and already handled
      // where they're thrown, so only session-ending ones are escalated to
      // the UI via onClientError — everything else stays console-only.
      this.errorSub = this.client.errors$.subscribe((error) => {
        console.error('SignalWire error:', error);
        if (error instanceof TokenRefreshError || error instanceof InvalidCredentialsError) {
          this.onClientError?.('Your session could not be refreshed. Please reload the page to reconnect.');
        }
      });

      // Subscribe to non-fatal warnings (new in v4.0.0-rc.0). Because we drive
      // token refresh ourselves via credentialProvider.refresh(), watch for
      // 'credential_refresh_fallback' / 'credential_no_refresh_handler' — these
      // tell us whether our refresh() is actually being used or the session will
      // silently die at SAT expiry.
      this.warningSub = this.client.warnings$.subscribe((warning) => {
        console.warn('SignalWire warning:', warning.code, warning.message);
        if (warning.code === 'credential_no_refresh_handler') {
          this.onClientError?.('Your session will expire soon and cannot auto-refresh. Reload the page before it does to stay connected.');
        }
      });

      // Live readiness — can flip false again after this initial registration
      // (token refresh hiccup, network blip), so callers gate call-time actions
      // on isReady rather than only on the one-shot result of this method.
      this.readySub = this.client.ready$.subscribe((ready) => {
        this.isReady = ready;
        this.onReadyChange?.(ready);
      });

      // Register for incoming calls
      await this.client.register();
      console.log('Client registered and ready for incoming calls');

      // Subscribe to incoming calls
      this.incomingCallSub = this.client.session.incomingCalls$.subscribe((calls) => {
        const ringingCall = calls.find(c => c.status === 'ringing' || c.status === 'new');
        if (!ringingCall) return;

        // Auto-reject if already in a call -- or still placing one: while
        // dial() is in flight currentCall isn't set yet, but the UI is already
        // on the call screen, so a ringing pendingCall would be unreachable.
        if (this.currentCall || this.isDialing) {
          console.log('Already in a call - auto-rejecting incoming call');
          ringingCall.reject();
          return;
        }

        // Don't re-notify for the same pending call
        if (this.pendingCall && this.pendingCall.id === ringingCall.id) return;

        this.pendingCall = ringingCall;

        // fromName/from are public on the v4 Call type (4.0.0-rc.0)
        const rawName = ringingCall.fromName;
        const callerId = (rawName && rawName !== '_undef_') ? rawName : ringingCall.from || 'Unknown';
        console.log('Incoming call from:', callerId);

        // Best-effort: mediaDirections reflects the inbound SDP offer, so a
        // video-enabled offer should show as something other than 'inactive'
        // even before we answer. Defaults to false if the SDK hasn't parsed
        // the offer yet -- worst case we just don't show the video badge.
        const hasVideo = ringingCall.mediaDirections?.video != null
          && ringingCall.mediaDirections.video !== 'inactive';

        toneService.playIncomingCallTone();
        if (this.onIncomingCall) this.onIncomingCall(callerId, hasVideo);

        // Watch for the caller hanging up before we answer
        const cleanupCanceled = () => {
          console.log('Incoming call canceled by caller');
          toneService.stopIncomingCallTone();
          if (this.pendingCall?.id === ringingCall.id) {
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
      this.reattachSub = this.client.session.calls$.subscribe((calls) => {
        // This app handles one call at a time: never adopt while a call is
        // already tracked, and never mid-dial (see isDialing's declaration).
        if (this.currentCall || this.pendingCall || this.isDialing) return;

        const restored = calls.find((call) => {
          if (ENDED_CALL_STATUSES.includes(call.status)) return false;
          // A genuinely ringing inbound call belongs to the incomingCalls$
          // handler above, which has its own answer/reject UI.
          if (call.direction === 'inbound' && (call.status === 'ringing' || call.status === 'new')) return false;
          return true;
        });
        if (!restored) return;

        console.log('Adopting reattached call:', restored.id, 'status:', restored.status);
        this.isMicMuted = false;
        this.currentCall = restored;
        this.wasIncomingCall = false;
        this.setupCallSubscriptions(restored);
        this.setupRemoteAudioFallback(restored);

        // Same '_undef_' guard as the incoming-call path -- that's what the
        // platform sends for an unset display name.
        const rawName = restored.toName;
        const remoteNumber = (rawName && rawName !== '_undef_') ? rawName : restored.to || 'Unknown';
        const hasVideo = restored.mediaDirections?.video != null
          && restored.mediaDirections.video !== 'inactive';
        this.onCallReattached?.(remoteNumber, hasVideo);
      });

      this.isInitialized = true;
      this.isInitializing = false;
      console.log('SignalWire service fully initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize SignalWire:', error);
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
    return this.currentToken?.subscriber_id;
  }

  // Resolved server-side from the reference actually used to mint this
  // token -- avoids a separate lookup round-trip for the header's
  // permanent "who am I" indicator.
  getActiveSubscriberDisplayName(): string | undefined {
    return this.currentToken?.subscriber_display_name;
  }

  // Whether this browser can route audio to a chosen output device at all
  // (HTMLMediaElement.setSinkId -- missing on Firefox and Safari). Read once
  // after initialize(); the Speaker control is disabled when false.
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
      console.warn('Saved subscriber was rejected by the backend - falling back to the default subscriber');
      localStorage.removeItem(SELECTED_SUBSCRIBER_KEY);
      this.onClientError?.('Your saved subscriber no longer exists, so you were connected as the default subscriber.');
      return authAPI.getToken(undefined);
    }
  }

  private setupCallSubscriptions(call: Call) {
    this.cleanupCallSubscriptions();

    // Reset per-call; a stale flag from a previous call must never attribute
    // this call's status changes to a transfer that happened on another call.
    this.pendingTransferDestination = null;

    // Subscribe to call status changes
    this.callStatusSub = call.status$.subscribe((status) => {
      const transferSuffix = this.pendingTransferDestination
        ? ` [transfer] after request to ${this.pendingTransferDestination}`
        : '';
      console.log('Call status:', status + transferSuffix);

      if (status === 'trying' || status === 'connecting') {
        this.onCallStatusChange?.('connecting');
      } else if (status === 'ringing') {
        this.onCallStatusChange?.('ringing');
      } else if (status === 'recovering') {
        // In the CallStatus union but not emitted by rc.5 (recovery is
        // reported on recoveryState$); handled in case a later SDK does.
        this.setMediaDisrupted(true);
      } else if (status === 'connected') {
        if (this.pendingTransferDestination) {
          console.log('[transfer] Call is still connected on this leg -- the transfer did not take the call away, so it likely failed or was not accepted by the destination');
          this.pendingTransferDestination = null;
        }
        if (this.onCallConnected) {
          this.onCallConnected();
        }
      } else if (status === 'disconnected' || status === 'failed') {
        if (this.pendingTransferDestination) {
          console.log(`[transfer] Call ended (status: ${status}) after a transfer request to ${this.pendingTransferDestination} -- this is the expected outcome of a successful blind transfer`);
          this.pendingTransferDestination = null;
        }
        toneService.playDisconnectTone();
        // Only clean up if this is still the active call (endCall may have already cleared it)
        if (this.currentCall === call) {
          this.handleCallEnded();
        }
      }
    });

    // Subscribe to remote stream for audio/video playback
    this.remoteStreamSub = call.remoteStream$.subscribe((stream) => {
      if (stream) {
        console.log('remoteStream$ emitted stream:', stream.id);
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
      console.warn('[call.errors$]', callError.kind, 'fatal:', callError.fatal, 'leg:', callError.leg ?? 'main', callError.error);
      if (callError.fatal) return;
      if (callError.leg && callError.leg !== 'main') return;
      const { error } = callError;
      if (error instanceof MediaAccessError || error instanceof MediaTrackError) {
        this.onCallMediaError?.(error);
      }
    });

    // Diagnostic only -- NOT used to gate the UI (see onCanScreenShareChange's
    // declaration comment for why). Logs the raw server-sent set, which the
    // SDK passes through unchanged from call.joined. Note hold/transfer are
    // not capabilities at all -- the SDK's Capability vocabulary only covers
    // in-room actions (mute, deaf, layout, lock, digit, screenshare, end,
    // device) -- so this can only ever reveal a real 'screenshare' grant.
    this.capabilitiesSub = call.capabilities$.subscribe((capabilities) => {
      console.log('[capabilities] call.capabilities$:', capabilities);
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
        console.log('[screenshare] capability granted:', granted);
        this.onCanScreenShareChange?.(this.screenShareApiSupported && granted);
      });

    // Quality/network observables live directly on Call (not call.self), so
    // this is simpler than the self$ tier below -- no nullable intermediate.
    this.qualitySub = combineLatest([
      call.qualityLevel$,
      call.qualityScore$,
      call.networkIssues$,
    ]).subscribe(([level, score, networkIssues]) => {
      this.onQualityChange?.({ level, score, networkIssues });
    });

    // call.self is replaced wholesale on each call.joined event, so follow
    // whichever self is current. self$ never emits null (it withholds until
    // self exists), so there's no empty case to handle here.
    this.screenShareSub = call.self$
      .pipe(switchMap((self) => self.screenShareStatus$))
      .subscribe((status) => this.onScreenShareStatusChange?.(status));

    // The SDK's own recovery (CallRecoveryManager: debouncing -> recovering
    // -> cooldown -> idle). Note it is driven by the stats monitor, browser
    // offline events and WebSocket re-auth -- NOT by ICE state, so it can be
    // 'idle' while the peer connection is down; monitorPeerConnection's grace
    // timer covers that case.
    this.lastRecoveryState = 'idle';
    this.recoveryEvents$ = new ReplaySubject<RecoveryEvent>(10);
    this.recoveryStateSub = call.recoveryState$.subscribe((state) => {
      console.log('[recovery] state:', state);
      this.lastRecoveryState = state;
      this.onRecoveryStateChange?.(state);
      this.setMediaDisrupted(state === 'debouncing' || state === 'recovering' || this.isPeerConnectionDown());
    });
    this.recoveryEventSub = call.recoveryEvent$.subscribe((event) => {
      console.log('[recovery]', event.action, '-', event.reason, event.attempt != null ? `(${event.attempt}/${event.maxAttempts})` : '');
      this.recoveryEvents$.next(event);
      if (this.currentCall !== call) return;
      if (event.action === 'max_attempts_reached') {
        // The SDK follows this with a fatal network error and status$
        // 'failed'; ending here too keeps call-end detection redundant.
        this.handleCallEnded();
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
    this.onMediaDisruptionChange?.(disrupted);
  }

  private isPeerConnectionDown(): boolean {
    const state = this.monitoredPc?.iceConnectionState;
    return state === 'disconnected' || state === 'failed';
  }

  // Recent recovery events for the current call (replayed on subscribe).
  getRecoveryEvents$(): Observable<RecoveryEvent> {
    return this.recoveryEvents$.asObservable();
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
    this.capabilitiesSub?.unsubscribe();
    this.capabilitiesSub = null;
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
    const hasVideo = stream.getVideoTracks().length > 0;

    if (hasVideo && this.remoteVideoEl) {
      this.remoteVideoEl.srcObject = stream;
      this.remoteAudioRoutedToVideo = true;
      this.clearAudioSink();
      // The autoplay attribute fails silently under the autoplay policy; an
      // explicit play() lets the refusal be detected and surfaced.
      this.playSink(this.remoteVideoEl);
    } else if (!this.remoteAudioRoutedToVideo) {
      this.playRemoteStream(stream);
    }

    if (this.onRemoteVideoChange) this.onRemoteVideoChange(hasVideo);
  }

  private clearAudioSink() {
    const audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement | null;
    if (audioEl) audioEl.srcObject = null;
  }

  // Fallback: directly access RTCPeerConnection receivers when remoteStream$ doesn't emit
  private setupRemoteAudioFallback(call: Call) {
    // rtcPeerConnection is public on the v4 Call type (RTCPeerConnection | undefined)
    const pc = call.rtcPeerConnection;
    if (pc) {
      console.log('PC available immediately, state:', pc.connectionState, 'ice:', pc.iceConnectionState);
      this.monitorPeerConnection(pc, call);
      return;
    }

    // PC may not be ready yet — poll until it is
    let attempts = 0;
    this.remoteAudioCheckInterval = setInterval(() => {
      attempts++;
      const rtcPC = call.rtcPeerConnection;
      if (rtcPC) {
        console.log('PC became available after', attempts, 'checks, state:', rtcPC.connectionState);
        if (this.remoteAudioCheckInterval) {
          clearInterval(this.remoteAudioCheckInterval);
          this.remoteAudioCheckInterval = null;
        }
        this.monitorPeerConnection(rtcPC, call);
      } else if (attempts > 30) {
        console.warn('Gave up waiting for RTCPeerConnection');
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
      console.log('PC track event:', event.track.kind, 'streams:', event.streams.length);
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
    // recoveryEvent$ (see CLAUDE.md's call-ended detection note).
    const onMediaStateChange = () => {
      const ice = pc.iceConnectionState;
      const conn = pc.connectionState;
      console.log('PC state:', conn, 'ice:', ice);
      if (ice === 'closed' || conn === 'closed') {
        console.log('Peer connection closed - ending call as fallback');
        this.handleCallEnded();
      } else if (ice === 'disconnected' || ice === 'failed' || conn === 'failed') {
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

  // How long media may stay down before the call is given up on: the SDK's
  // whole recovery budget (debounce + every ICE-restart attempt) plus slack --
  // 2 + 3*5 + 5 = 22 s on rc.5's defaults. Needed because the SDK's recovery
  // manager doesn't watch ICE state: if its stats trigger never fires, nothing
  // else would ever end a call whose peer connection has died. If the SDK is
  // still mid-'recovering' when the timer fires, it's extended once by one
  // more attempt.
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
        console.log(`Media still down after ${graceMs} ms but the SDK is recovering - waiting one more attempt`);
        this.mediaDisruptionTimerExtended = true;
        this.mediaDisruptionTimer = setTimeout(onExpiry, attemptMs);
        return;
      }
      console.warn(`Media did not recover (ice: ${ice}, recovery: ${this.lastRecoveryState}) - ending call as fallback`);
      this.handleCallEnded();
    };
    this.mediaDisruptionTimer = setTimeout(onExpiry, graceMs);
  }

  private checkReceivers(pc: RTCPeerConnection) {
    const receivers = pc.getReceivers();
    const liveTracks = receivers
      .map(r => r.track)
      .filter((t): t is MediaStreamTrack => !!t && t.readyState === 'live');

    if (liveTracks.length > 0) {
      console.log('Live receiver tracks found:', liveTracks.map(t => t.kind).join(', '));
      this.handleRemoteMedia(new MediaStream(liveTracks));
    } else {
      console.log('No live receivers found, receivers:', receivers.length);
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
    console.log('Playing remote stream:', stream.id, 'tracks:', incoming.length);
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
        console.warn('Remote media playback blocked by the autoplay policy - waiting for a user gesture');
        this.onRemoteAudioBlocked?.();
        return;
      }
      console.error('Remote media play() failed:', err);
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

  // Passing `{ video: true }` to dial()'s media options alone isn't enough to
  // reliably get the video channel -- per the dialable-resources addresses
  // (each pre-suffixed per channel by the server, see CLAUDE.md), the
  // destination itself needs `?channel=video`. Applied here so manually
  // dialed numbers/addresses get the same treatment as picked resources.
  // Replaces rather than skips an existing `channel=` param, so toggling
  // video on after picking an audio-channel resource address still works.
  private withVideoChannel(destination: string, video: boolean): string {
    if (!video) return destination;
    if (/[?&]channel=/i.test(destination)) {
      return destination.replace(/([?&])channel=[^&]*/i, '$1channel=video');
    }
    const separator = destination.includes('?') ? '&' : '?';
    return `${destination}${separator}channel=video`;
  }

  // Resolves null if the user hung up before dial() completed (the call is
  // hung up instead of adopted).
  async makeCall(phoneNumber: string, video: boolean = false): Promise<Call | null> {
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

    try {
      this.isDialing = true;
      this.dialCancelled = false;
      const formattedNumber = this.withVideoChannel(this.normalizeDestination(phoneNumber), video);
      console.log('Dialing:', formattedNumber);

      const call = await this.client.dial(formattedNumber, {
        audio: true,
        video,
      });

      // The user hung up while dial() was pending (see dialCancelled). The UI
      // has already reset, so don't adopt the call -- end it.
      if (this.dialCancelled) {
        console.log('Dial resolved after the user hung up - ending the call');
        call.hangup().catch((error) => {
          console.debug('Hangup of cancelled dial (ignored):', error);
        });
        return null;
      }

      this.currentCall = call;
      this.wasIncomingCall = false;
      this.setupCallSubscriptions(call);
      this.setupRemoteAudioFallback(call);

      console.log('Call initiated successfully');
      return call;
    } catch (error) {
      console.error('Failed to make call:', error);
      throw error;
    } finally {
      this.isDialing = false;
    }
  }

  async endCall() {
    const call = this.currentCall;
    if (!call) {
      // No Call object yet, but dial() may still be in flight -- make
      // makeCall() hang it up when it resolves instead of adopting it.
      if (this.isDialing) this.dialCancelled = true;
      return;
    }

    // Eagerly clean up state so incoming calls aren't blocked by stale references.
    // Don't wait for the SDK's status$ to emit 'disconnected' — it may be delayed
    // or never fire if the call was still in ICE negotiation.
    toneService.playDisconnectTone();
    this.handleCallEnded();

    // End an active screen share first. As of 4.0.0-rc.5, call.hangup() only
    // sends a verto.bye for the main leg; the screen-share leg is torn down
    // locally but never byed, so the server keeps its "(Screen)" member in the
    // room (observed lingering 4+ minutes). stopScreenShare() byes that leg.
    // Runs after handleCallEnded() so the UI doesn't wait on it.
    const self = call.self;
    if (self && (self.screenShareStatus === 'starting' || self.screenShareStatus === 'started')) {
      try {
        await self.stopScreenShare();
      } catch (error) {
        console.debug('Stopping screen share during endCall (ignored):', error);
      }
    }

    // Best-effort hangup signal to the server
    try {
      await call.hangup();
    } catch (error) {
      console.debug('Hangup during endCall (ignored):', error);
    }
  }

  async answerCall(video: boolean = false) {
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
        console.debug('Rejecting unanswerable call (ignored):', error);
      }
      throw new ClientNotReadyError();
    }

    if (this.currentCall) {
      console.warn('Call already in progress, ignoring answer');
      return;
    }
    this.isMicMuted = false;

    try {
      console.log('Answering incoming call...');
      toneService.stopIncomingCallTone();

      const call = this.pendingCall;
      this.pendingCall = null;
      this.currentCall = call;
      this.wasIncomingCall = true;

      call.answer({ audio: true, video });
      this.setupCallSubscriptions(call);
      this.setupRemoteAudioFallback(call);

      console.log('Call answered successfully');
    } catch (error) {
      console.error('Failed to answer call:', error);
      this.pendingCall = null;
      throw error;
    }
  }

  async rejectCall() {
    if (!this.pendingCall) {
      throw new Error('No incoming call to reject');
    }

    try {
      console.log('Rejecting incoming call...');
      toneService.stopIncomingCallTone();
      this.pendingCall.reject();
      this.pendingCall = null;
      console.log('Call rejected');
    } catch (error) {
      console.error('Failed to reject call:', error);
      this.pendingCall = null;
      throw error;
    }
  }

  // Mutes by disabling the outgoing audio track rather than via the SDK's
  // self.mute()/unmute(): as of 4.0.0-rc.5 the server rejects call.mute and
  // call.unmute with 403 on 1:1 calls (no self.mute capability), and the SDK's
  // fallback then stops the mic track and re-acquires it via getUserMedia on
  // unmute -- which measured ~4-5s of silence to the far end after unmuting.
  // A disabled track sends silence immediately and re-enables instantly.
  async toggleMute(muted: boolean) {
    // Record the intent even before the Call object exists (Mute is live on
    // the "Calling..." screen while dial() is pending); applyMicMute() runs
    // again once the call's local stream arrives.
    this.isMicMuted = muted;
    this.applyMicMute();
    console.log(`Audio ${muted ? 'muted' : 'unmuted'}`);
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
    for (const sender of call.rtcPeerConnection?.getSenders() ?? []) {
      if (sender.track?.kind === 'audio') tracks.add(sender.track);
    }
    tracks.forEach((track) => { track.enabled = !this.isMicMuted; });
  }

  // Works whether the call started as audio-only or with video: if there's no
  // local video track yet, addVideoInputDevice() acquires the camera and
  // renegotiates; otherwise it's a plain mute/unmute of the existing track.
  async toggleCamera(cameraOn: boolean) {
    if (!this.currentCall) {
      console.warn('No active call to toggle camera');
      return;
    }

    // Errors propagate: the hook applied the new camera state optimistically
    // and reverts it (and says why) when this throws.
    const self = this.currentCall.self;
    if (!self) {
      throw new Error('The call is still being set up - try the camera again in a moment.');
    }

    const hasLocalVideoTrack = !!this.currentCall.localStream?.getVideoTracks().length;

    if (cameraOn && !hasLocalVideoTrack) {
      await self.addVideoInputDevice();
    } else if (cameraOn) {
      await self.unmuteVideo();
    } else {
      await self.muteVideo();
    }
    console.log(`Camera ${cameraOn ? 'enabled' : 'disabled'}`);
  }

  // No held$/isOnHold observable exists on Call -- the caller tracks hold
  // state optimistically (like isMuted/isCameraOn) and reverts on failure.
  // The SDK resolves verto.modify-based requests (transfer, hold/unhold) even
  // when the server REFUSES them: the refusal comes back nested inside a
  // successful envelope ({result: {result: {error}}}), and the SDK only
  // reports it on call.errors$ (kind 'signaling', non-fatal) instead of
  // rejecting. Runs `request` and returns that refusal, or null.
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
    console.log('[hold] Requested');

    if (!this.currentCall) {
      console.error('[hold] Aborted -- no active call to hold');
      throw new Error('No active call to hold');
    }

    // No pre-flight capability check -- there's nothing to check: 'hold' isn't
    // part of the SDK's Capability vocabulary at all (hold/unhold are call-leg
    // requests, not in-room actions), and toggleHold() doesn't consult
    // capabilities (verified in the 4.0.0-rc.5 SDK source). So just attempt
    // it and let it succeed or fail on its own.
    // The docs say this resolves once the server acknowledged the change, but
    // a server refusal also resolves (see refusalOf), so check for one. Note
    // the SDK flips its internal hold state even on a refusal.
    const call = this.currentCall;
    let refusal: Error | null;
    try {
      refusal = await this.refusalOf(call, () => call.toggleHold());
    } catch (error) {
      console.error('[hold] call.toggleHold() rejected:', error);
      throw error;
    }
    if (refusal) {
      console.error('[hold] refused by the server:', refusal);
      throw new Error(`The server refused the hold request (${refusal.message.replace(/\.$/, '')}).`);
    }
    console.log('[hold] call.toggleHold() resolved -- server acknowledged the state change');
  }

  async transferCall(destination: string) {
    const formattedDestination = this.normalizeDestination(destination);
    console.log('[transfer] Requested, raw input:', destination, '-> normalized:', formattedDestination);

    if (!this.currentCall) {
      console.error('[transfer] Aborted -- no active call to transfer');
      throw new Error('No active call to transfer');
    }

    // No pre-flight capability check -- see toggleHold()'s comment above for
    // why. (The transfer() reference page says to check for a 'transfer'
    // capability, but no such value exists in the SDK's Capability union, so
    // that check could never pass.)
    //
    // A server refusal resolves rather than rejects (see refusalOf). In
    // real-call testing on 4.0.0-rc.5 the server refused every transfer on
    // 1:1 calls (-32002 "Permission Denied."), whichever side initiated it and
    // whatever the destination (SIP URI, Fabric address, PSTN number); the
    // rejection below is what TransferModal shows the user.
    const call = this.currentCall;
    let refusal: Error | null;
    this.pendingTransferDestination = formattedDestination;
    try {
      refusal = await this.refusalOf(call, () => call.transfer({ destination: formattedDestination }));
    } catch (error) {
      console.error('[transfer] call.transfer() rejected:', error);
      this.pendingTransferDestination = null;
      throw error;
    }
    if (refusal) {
      console.error('[transfer] refused by the server:', refusal);
      this.pendingTransferDestination = null;
      throw new Error(`The server refused the transfer (${refusal.message.replace(/\.$/, '')}).`);
    }
    // Per the docs, resolving means the server ACCEPTED the request -- not
    // that the destination answered. This blind transfer then moves the local
    // call to 'disconnected'; watch the "Call status" logs above for the
    // actual outcome.
    console.log('[transfer] call.transfer() resolved -- server accepted the request, watch "Call status" logs for the real outcome');
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
        await self.stopScreenShare();
        break;
      // The SDK says to treat 'stopping' as busy -- starting now could hit
      // ScreenShareAlreadyActiveError against the share still tearing down.
      case 'stopping':
        console.log('Screen share is still stopping - ignoring toggle');
        break;
      case 'none':
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
  }

  async toggleAutoGain() {
    const call = this.requireCurrentCall();
    const next = !this.audioProcessing.autoGain;
    if (!(await call.setAutoGainControl(next))) {
      throw new Error("Couldn't change auto gain on your microphone.");
    }
    this.setAudioProcessing({ ...this.audioProcessing, autoGain: next });
  }

  async toggleNoiseSuppression() {
    const call = this.requireCurrentCall();
    const next = !this.audioProcessing.noiseSuppression;
    if (!(await call.setNoiseSuppression(next))) {
      throw new Error("Couldn't change noise suppression on your microphone.");
    }
    this.setAudioProcessing({ ...this.audioProcessing, noiseSuppression: next });
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
      console.warn('No remote media element available yet for speaker toggle');
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
        console.log('Speaker off (default output)');
        return true;
      }

      this.client.selectAudioOutputDevice(this.preferredOutputDevice);
      const applied = await this.client.applySelectedAudioOutputDevice(sinkEl);
      console.log('Speaker on, applied:', applied);
      return applied;
    } catch (error) {
      console.error('Error applying audio output device:', error);
      return false;
    }
  }

  // Set by the device picker when the user picks a speaker/output device.
  setPreferredAudioOutputDevice(device: MediaDeviceInfo | null) {
    this.preferredOutputDevice = device;
    this.client?.selectAudioOutputDevice(device);
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
    this.client?.selectAudioInputDevice(device);
  }

  selectVideoInputDevice(device: MediaDeviceInfo | null) {
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
  // idle-only (see DiagnosticsPanel), never prefilled from a live dial-pad
  // value since it's a genuine, potentially-billable call attempt.
  async runPreflight(destination: string, options?: PreflightOptions): Promise<PreflightResult> {
    if (!this.client) {
      throw new Error('SignalWire client not initialized');
    }
    return this.client.preflight(destination, options);
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
  async sendDTMF(digit: string) {
    if (this.currentCall?.status === 'connected') {
      await this.currentCall.sendDigits(digit);
    }
  }

  private handleCallEnded() {
    console.log('handleCallEnded - cleaning up');
    const wasIncoming = this.wasIncomingCall;

    this.cleanupCallSubscriptions();
    this.currentCall = null;
    this.pendingCall = null;
    this.wasIncomingCall = false;
    this.pendingTransferDestination = null;
    // Not via setAudioProcessing() -- the store's own reset covers the UI.
    this.audioProcessing = { ...DEFAULT_AUDIO_PROCESSING };

    // Clean up audio/video sinks
    this.clearAudioSink();
    if (this.localVideoEl) this.localVideoEl.srcObject = null;
    if (this.remoteVideoEl) this.remoteVideoEl.srcObject = null;
    this.remoteAudioRoutedToVideo = false;

    if (this.onCallEnded) {
      console.log('Notifying UI of call end, wasIncoming:', wasIncoming);
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
      console.log('Disconnect called but no client exists - ignoring');
      return;
    }

    console.log('SignalWire service disconnecting...');

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
    this.isReady = false;

    if (this.currentCall) {
      this.currentCall.hangup().catch((error) => {
        console.debug('Hangup error during disconnect (ignored):', error?.message);
      });
      this.currentCall = null;
    }

    this.pendingCall = null;

    // Just close the connection. We deliberately do NOT call unregister() first:
    // disconnect() (invoked from beforeunload) tears down the WebSocket, and the
    // server marks the subscriber offline as soon as that socket drops. Calling
    // unregister() races with this teardown — its `subscriber.offline` RPC never
    // gets a response before the transport is destroyed, which surfaces as a
    // noisy RPCTimeoutError on errors$. unregister() is only for going offline
    // while staying connected, which this app never needs.
    this.client.disconnect().catch((error) => {
      console.debug('Disconnect error (ignored):', error?.message);
    });

    this.client = null;
  }
}

export const signalWireService = new SignalWireService();
