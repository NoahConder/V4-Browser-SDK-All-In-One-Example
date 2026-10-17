import { log } from '../utils/log';

// Standard DTMF pairs (low, high) in Hz.
const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

class ToneService {
  private audioContext: AudioContext | null = null;
  private incomingCallInterval: ReturnType<typeof setInterval> | null = null;
  private currentRingtoneOscillators: OscillatorNode[] = [];

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    }

    // Resume context if it's suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
      }).catch(err => {
        log.error('Failed to resume AudioContext:', err);
      });
    }

    return this.audioContext;
  }

  // Browsers keep an AudioContext suspended until the page has had a user
  // gesture, so a tab nobody has tapped yet would ring silently (and the
  // resume() in getAudioContext() can't help). Create and resume the context
  // from the first pointer/keyboard gesture on the page. Called once from
  // App.tsx.
  primeOnFirstGesture() {
    const prime = () => {
      void this.resume();
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
    window.addEventListener('pointerdown', prime);
    window.addEventListener('keydown', prime);
  }

  // Resume the shared AudioContext; only succeeds inside a user gesture.
  async resume(): Promise<void> {
    const context = this.getAudioContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
  }

  // Short dual-tone feedback for a dial-pad key, on the shared context (one
  // AudioContext per keypress was wasteful and runs into the browser's
  // context limit on long numbers).
  playDtmf(key: string) {
    const frequencies = DTMF_FREQUENCIES[key];
    if (!frequencies) return;
    const context = this.getAudioContext();
    const gainNode = context.createGain();
    gainNode.gain.value = 0.1;
    gainNode.connect(context.destination);
    const now = context.currentTime;
    for (const freq of frequencies) {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = freq;
      oscillator.connect(gainNode);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    }
  }

  // Play a repeating whimsical ringtone for incoming calls
  playIncomingCallTone() {

    // Clear any existing ringtone
    this.stopIncomingCallTone();

    const context = this.getAudioContext();

    // Play initial ring immediately
    this.playWhimsicalRing(context);

    // Repeat the ring pattern every 2 seconds
    this.incomingCallInterval = setInterval(() => {
      this.playWhimsicalRing(context);
    }, 2000);

  }

  // Stop the incoming call ringtone
  stopIncomingCallTone() {
    if (this.incomingCallInterval) {
      clearInterval(this.incomingCallInterval);
      this.incomingCallInterval = null;
    }

    // Stop any currently playing oscillators
    this.currentRingtoneOscillators.forEach(osc => {
      try {
        osc.stop();
      } catch {
        // Oscillator might already be stopped
      }
    });
    this.currentRingtoneOscillators = [];
  }

  private playWhimsicalRing(context: AudioContext) {
    const currentTime = context.currentTime;

    // Create a more whimsical pattern with ascending notes
    // Like a cheerful doorbell: ding-dong-ding!
    const notes = [
      { freq: 523, time: 0, duration: 0.15 },     // C5 - ding
      { freq: 659, time: 0.2, duration: 0.15 },   // E5 - dong
      { freq: 784, time: 0.4, duration: 0.2 },    // G5 - ding!
      { freq: 659, time: 0.65, duration: 0.1 },   // E5 - quick note
      { freq: 523, time: 0.8, duration: 0.15 },   // C5 - resolution
    ];

    notes.forEach(note => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.frequency.value = note.freq;
      oscillator.type = 'sine';

      // Slightly louder for ringtone but still pleasant
      const volume = 0.15;

      // Smooth envelope
      gainNode.gain.setValueAtTime(0, currentTime + note.time);
      gainNode.gain.linearRampToValueAtTime(volume, currentTime + note.time + 0.01);
      gainNode.gain.linearRampToValueAtTime(volume, currentTime + note.time + note.duration - 0.01);
      gainNode.gain.linearRampToValueAtTime(0, currentTime + note.time + note.duration);

      oscillator.start(currentTime + note.time);
      oscillator.stop(currentTime + note.time + note.duration);

      // Keep track of oscillators so stopIncomingCallTone() can cut them
      // short; each removes itself once it has finished on its own.
      this.currentRingtoneOscillators.push(oscillator);
      oscillator.onended = () => {
        this.currentRingtoneOscillators = this.currentRingtoneOscillators.filter((o) => o !== oscillator);
      };
    });
  }

  // Play a gentle, whimsical disconnect tone when remote party hangs up
  playDisconnectTone() {
    const context = this.getAudioContext();
    const currentTime = context.currentTime;

    // Create a gentle descending melody - like a soft goodbye
    // Using a minor progression for a slightly melancholic but pleasant sound
    const notes = [
      { freq: 659, time: 0, duration: 0.18 },      // E5 - soft start
      { freq: 523, time: 0.2, duration: 0.18 },    // C5 - step down
      { freq: 440, time: 0.4, duration: 0.18 },    // A4 - continue down
      { freq: 392, time: 0.6, duration: 0.25 },    // G4 - gentle resolution
    ];

    notes.forEach(note => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.frequency.value = note.freq;
      oscillator.type = 'triangle';  // Softer, more mellow than sine

      // Very gentle volume for a demure sound
      const volume = 0.08;

      // Extra smooth envelope for a gentle fade
      gainNode.gain.setValueAtTime(0, currentTime + note.time);
      gainNode.gain.linearRampToValueAtTime(volume, currentTime + note.time + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(volume * 0.8, currentTime + note.time + note.duration - 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + note.time + note.duration);

      oscillator.start(currentTime + note.time);
      oscillator.stop(currentTime + note.time + note.duration);
    });
  }

}

export const toneService = new ToneService();