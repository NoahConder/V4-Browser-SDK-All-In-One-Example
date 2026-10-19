import { interval, map } from 'rxjs';
import type { Observable } from 'rxjs';
import { toneService } from './tones';
import { log } from '../utils/log';

// The SDK's own poll rate for its level observables.
const POLL_INTERVAL_MS = 33;

// RMS level of the remote audio, 0..1, for the speaker bar.
//
// Why this exists: on @signalwire/js 4.0.0-rc.5 `call.remoteAudioLevel$`
// emits 0 for the whole call (its analyser is never fed the remote stream),
// so the speaker bar never moved. This meter taps the stream signalwire.ts
// routes to the remote sink (handleRemoteMedia), whichever path delivered it.
// It is a read-only tap -- MediaStreamAudioSourceNode -> AnalyserNode, nothing
// connected to the destination -- so the <audio>/<video> element stays the
// only thing playing the audio (connecting the analyser onward would double
// it). Same analyser settings and RMS as the SDK's mic pipeline, so the two
// bars read alike.
//
// Uses the tone service's shared AudioContext: one fewer context per page
// (Chrome caps them), and it is the one primeOnFirstGesture() and
// resumeRemoteAudio() resume on a gesture, which a call reattached after a
// reload may need before this reads anything.
export class RemoteAudioMeter {
  private analyser: AnalyserNode | null = null;
  private buffer: Uint8Array<ArrayBuffer> | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private trackIds: string[] = [];

  // Emits ~30 times a second while subscribed (the meter is only mounted
  // while a call is connected); 0 while no stream is attached.
  readonly level$: Observable<number> = interval(POLL_INTERVAL_MS).pipe(map(() => this.computeLevel()));

  // Attach (or replace) the stream being metered; null detaches.
  setStream(stream: MediaStream | null) {
    if (!stream) {
      this.detach();
      return;
    }
    const tracks = stream.getAudioTracks();
    // The peer-connection fallback's track listener can deliver a video-only
    // wrapper; keep metering the audio we already have.
    if (tracks.length === 0) return;
    // remoteStream$ and the fallback deliver the same track in different
    // MediaStream wrappers (see playRemoteStream); don't rebuild the tap for it.
    const ids = tracks.map((track) => track.id);
    if (this.source && ids.length === this.trackIds.length && ids.every((id) => this.trackIds.includes(id))) {
      return;
    }
    this.detach();
    try {
      const context = toneService.getAudioContext();
      if (!this.analyser) {
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.3;
        this.buffer = new Uint8Array(this.analyser.fftSize);
      }
      this.source = context.createMediaStreamSource(new MediaStream(tracks));
      this.source.connect(this.analyser);
      this.trackIds = ids;
      log.debug('Remote audio meter attached to track(s):', ids.join(', '));
    } catch (err) {
      log.warn('Remote audio meter could not attach to the stream:', err);
      this.source = null;
      this.trackIds = [];
    }
  }

  private detach() {
    if (!this.source) return;
    try {
      this.source.disconnect();
    } catch {
      // Already disconnected.
    }
    this.source = null;
    this.trackIds = [];
    log.debug('Remote audio meter detached');
  }

  private computeLevel(): number {
    if (!this.source || !this.analyser || !this.buffer) return 0;
    this.analyser.getByteTimeDomainData(this.buffer);
    let sum = 0;
    for (const sample of this.buffer) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / this.buffer.length);
  }
}
