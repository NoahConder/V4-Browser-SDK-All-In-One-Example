import { SignalWire } from '@signalwire/js';
import type { Call } from '@signalwire/js';
import type { Subscription } from 'rxjs';
import type { TokenData } from '../types';
import { authAPI } from './api';
import { toneService } from './tones';

class SignalWireService {
  private client: InstanceType<typeof SignalWire> | null = null;
  private currentCall: Call | null = null;
  private pendingCall: Call | null = null;
  private currentToken: TokenData | null = null;
  private wasIncomingCall: boolean = false;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;

  // RxJS subscriptions
  private incomingCallSub: Subscription | null = null;
  private callStatusSub: Subscription | null = null;
  private remoteStreamSub: Subscription | null = null;
  private localStreamSub: Subscription | null = null;
  private errorSub: Subscription | null = null;
  private warningSub: Subscription | null = null;
  private remoteAudioCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Video elements attached by CallScreen; may be set before or after streams arrive.
  private localVideoEl: HTMLVideoElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  // True once the remote stream's audio is being played out through remoteVideoEl,
  // so the fallback <audio> sink knows not to also play it (avoids doubled audio).
  private remoteAudioRoutedToVideo: boolean = false;

  // Callbacks
  private onIncomingCall: ((remoteNumber: string, hasVideo: boolean) => void) | null = null;
  private onCallEnded: ((wasIncoming: boolean) => void) | null = null;
  private onCallConnected: (() => void) | null = null;
  private onRemoteVideoChange: ((hasVideo: boolean) => void) | null = null;

  async initialize(
    onIncomingCall?: (remoteNumber: string, hasVideo: boolean) => void,
    onCallEnded?: (wasIncoming: boolean) => void,
    onCallConnected?: () => void,
    onRemoteVideoChange?: (hasVideo: boolean) => void
  ) {
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
      this.onIncomingCall = onIncomingCall || null;
      this.onCallEnded = onCallEnded || null;
      this.onCallConnected = onCallConnected || null;
      this.onRemoteVideoChange = onRemoteVideoChange || null;

      // Create credential provider with automatic refresh
      const credentialProvider = {
        authenticate: async () => {
          const tokenData = await authAPI.getToken();
          this.currentToken = tokenData;
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
        refresh: async () => {
          const tokenData = await authAPI.refreshToken(this.currentToken?.token);
          this.currentToken = tokenData;
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
      };

      // Initialize the v4 client
      this.client = new SignalWire(credentialProvider);

      // Default all calls to G.711 (PCMU first, then PCMA). Setting this on the
      // global client preferences applies to both outbound dials and answered
      // inbound calls — RTCPeerConnectionController falls back to these when a
      // call doesn't override preferredAudioCodecs. The SDK reorders the SDP so
      // these payload types are offered ahead of Opus.
      this.client.preferences.preferredAudioCodecs = ['PCMU', 'PCMA'];

      // Subscribe to errors
      this.errorSub = this.client.errors$.subscribe((error) => {
        console.error('SignalWire error:', error);
      });

      // Subscribe to non-fatal warnings (new in v4.0.0-rc.0). Because we drive
      // token refresh ourselves via credentialProvider.refresh(), watch for
      // 'credential_refresh_fallback' / 'credential_no_refresh_handler' — these
      // tell us whether our refresh() is actually being used or the session will
      // silently die at SAT expiry.
      this.warningSub = this.client.warnings$.subscribe((warning) => {
        console.warn('SignalWire warning:', warning.code, warning.message);
      });

      // Register for incoming calls
      await this.client.register();
      console.log('Client registered and ready for incoming calls');

      // Subscribe to incoming calls
      this.incomingCallSub = this.client.session.incomingCalls$.subscribe((calls) => {
        const ringingCall = calls.find(c => c.status === 'ringing' || c.status === 'new');
        if (!ringingCall) return;

        // Auto-reject if already in a call
        if (this.currentCall) {
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

  private setupCallSubscriptions(call: Call) {
    this.cleanupCallSubscriptions();

    // Subscribe to call status changes
    this.callStatusSub = call.status$.subscribe((status) => {
      console.log('Call status:', status);
      if (status === 'connected') {
        if (this.onCallConnected) {
          this.onCallConnected();
        }
      } else if (status === 'disconnected' || status === 'failed') {
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

    // Subscribe to local stream so the self-view <video> (if attached) shows the camera
    this.localStreamSub = call.localStream$.subscribe((stream) => {
      if (stream && this.localVideoEl) {
        this.localVideoEl.srcObject = stream;
      }
    });
  }

  private cleanupCallSubscriptions() {
    this.callStatusSub?.unsubscribe();
    this.callStatusSub = null;
    this.remoteStreamSub?.unsubscribe();
    this.remoteStreamSub = null;
    this.localStreamSub?.unsubscribe();
    this.localStreamSub = null;
    if (this.remoteAudioCheckInterval) {
      clearInterval(this.remoteAudioCheckInterval);
      this.remoteAudioCheckInterval = null;
    }
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
      this.monitorPeerConnection(pc);
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
        this.monitorPeerConnection(rtcPC);
      } else if (attempts > 30) {
        console.warn('Gave up waiting for RTCPeerConnection');
        if (this.remoteAudioCheckInterval) {
          clearInterval(this.remoteAudioCheckInterval);
          this.remoteAudioCheckInterval = null;
        }
      }
    }, 500);
  }

  private monitorPeerConnection(pc: RTCPeerConnection) {
    // Listen for track events (addEventListener doesn't overwrite the SDK's ontrack handler)
    pc.addEventListener('track', (event) => {
      console.log('PC track event:', event.track.kind, 'streams:', event.streams.length);
      if (event.track.kind === 'audio' || event.track.kind === 'video') {
        const stream = event.streams[0] || new MediaStream([event.track]);
        this.handleRemoteMedia(stream);
      }
    });

    // Check existing receivers — tracks may already be there
    this.checkReceivers(pc);

    // Also re-check when ICE connects (remote media starts flowing)
    // and detect call end as fallback when status$ doesn't fire
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.checkReceivers(pc);
      } else if (pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'failed') {
        console.log('ICE closed/failed - triggering call cleanup as fallback');
        if (this.currentCall) {
          this.handleCallEnded();
        }
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      console.log('PC connection state:', pc.connectionState);
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        console.log('PC closed/failed - triggering call cleanup as fallback');
        if (this.currentCall) {
          this.handleCallEnded();
        }
      }
    });
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
    console.log('Playing remote stream:', stream.id, 'tracks:', stream.getAudioTracks().length);
    let audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'sw-remote-audio';
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    audioEl.volume = 1.0;
    audioEl.play().catch(err => {
      console.error('Remote audio play() failed:', err);
    });
  }

  async makeCall(phoneNumber: string, video: boolean = false): Promise<Call> {
    if (!this.client) {
      throw new Error('SignalWire client not initialized');
    }

    try {
      // SIP URIs (sip:user@domain) and Fabric addresses (/public/room-name)
      // are dialed as-is. Only bare phone numbers get E.164 normalization.
      // Keep this check in sync with is_dial_address() in backend/utils/signalwire.py.
      const isDialAddress =
        /^sip:/i.test(phoneNumber.trim()) ||
        phoneNumber.trim().startsWith('/') ||
        phoneNumber.includes('@');

      let formattedNumber = phoneNumber;
      if (isDialAddress) {
        formattedNumber = phoneNumber.trim();
      } else if (!formattedNumber.startsWith('+')) {
        if (formattedNumber.length === 10) {
          formattedNumber = '+1' + formattedNumber;
        } else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) {
          formattedNumber = '+' + formattedNumber;
        } else {
          formattedNumber = '+' + formattedNumber;
        }
      }
      console.log('Dialing:', formattedNumber);

      const call = await this.client.dial(formattedNumber, {
        audio: true,
        video,
      });

      this.currentCall = call;
      this.wasIncomingCall = false;
      this.setupCallSubscriptions(call);
      this.setupRemoteAudioFallback(call);

      console.log('Call initiated successfully');
      return call;
    } catch (error) {
      console.error('Failed to make call:', error);
      throw error;
    }
  }

  async endCall() {
    const call = this.currentCall;
    if (!call) return;

    // Eagerly clean up state so incoming calls aren't blocked by stale references.
    // Don't wait for the SDK's status$ to emit 'disconnected' — it may be delayed
    // or never fire if the call was still in ICE negotiation.
    toneService.playDisconnectTone();
    this.handleCallEnded();

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

    if (this.currentCall) {
      console.warn('Call already in progress, ignoring answer');
      return;
    }

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

  async toggleMute(muted: boolean) {
    if (!this.currentCall) {
      console.warn('No active call to mute/unmute');
      return;
    }

    try {
      const self = this.currentCall.self;
      if (!self) {
        console.warn('Self participant not available yet');
        return;
      }
      if (muted) {
        await self.mute();
      } else {
        await self.unmute();
      }
      console.log(`Audio ${muted ? 'muted' : 'unmuted'}`);
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  }

  // Works whether the call started as audio-only or with video: if there's no
  // local video track yet, addVideoInputDevice() acquires the camera and
  // renegotiates; otherwise it's a plain mute/unmute of the existing track.
  async toggleCamera(cameraOn: boolean) {
    if (!this.currentCall) {
      console.warn('No active call to toggle camera');
      return;
    }

    try {
      const self = this.currentCall.self;
      if (!self) {
        console.warn('Self participant not available yet');
        return;
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
    } catch (error) {
      console.error('Error toggling camera:', error);
    }
  }

  async toggleSpeaker(speakerOn: boolean) {
    console.log('Speaker toggle:', speakerOn);
  }

  async sendDTMF(digit: string) {
    if (this.currentCall) {
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

  disconnect() {
    if (!this.client) {
      console.log('Disconnect called but no client exists - ignoring');
      return;
    }

    console.log('SignalWire service disconnecting...');

    this.cleanupCallSubscriptions();
    this.incomingCallSub?.unsubscribe();
    this.incomingCallSub = null;
    this.errorSub?.unsubscribe();
    this.errorSub = null;
    this.warningSub?.unsubscribe();
    this.warningSub = null;

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
