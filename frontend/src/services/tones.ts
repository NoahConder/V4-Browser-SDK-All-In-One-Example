class ToneService {
  private audioContext: AudioContext | null = null;
  private incomingCallInterval: ReturnType<typeof setInterval> | null = null;
  private currentRingtoneOscillators: OscillatorNode[] = [];

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
      console.log('🔊 AudioContext created, state:', this.audioContext.state);
    }

    // Resume context if it's suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      console.log('🔊 AudioContext is suspended, attempting to resume...');
      this.audioContext.resume().then(() => {
        console.log('🔊 AudioContext resumed successfully');
      }).catch(err => {
        console.error('🔊 Failed to resume AudioContext:', err);
      });
    }

    return this.audioContext;
  }

  // Play a repeating whimsical ringtone for incoming calls
  playIncomingCallTone() {
    console.log('🎵 playIncomingCallTone() called');

    // Clear any existing ringtone
    this.stopIncomingCallTone();

    const context = this.getAudioContext();
    console.log('🎵 AudioContext state:', context.state);

    // Play initial ring immediately
    this.playWhimsicalRing(context);

    // Repeat the ring pattern every 2 seconds
    this.incomingCallInterval = setInterval(() => {
      console.log('🎵 Playing repeat ring...');
      this.playWhimsicalRing(context);
    }, 2000);

    console.log('🎵 Ringtone started, interval ID:', this.incomingCallInterval);
  }

  // Stop the incoming call ringtone
  stopIncomingCallTone() {
    console.log('🎵 stopIncomingCallTone() called');
    if (this.incomingCallInterval) {
      console.log('🎵 Clearing interval:', this.incomingCallInterval);
      clearInterval(this.incomingCallInterval);
      this.incomingCallInterval = null;
    }

    // Stop any currently playing oscillators
    this.currentRingtoneOscillators.forEach(osc => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator might already be stopped
      }
    });
    this.currentRingtoneOscillators = [];
  }

  private playWhimsicalRing(context: AudioContext) {
    console.log('🎶 playWhimsicalRing() called, context state:', context.state);
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

      // Keep track of oscillators so we can stop them if needed
      this.currentRingtoneOscillators.push(oscillator);
    });

    // Clean up old oscillators after they finish
    setTimeout(() => {
      this.currentRingtoneOscillators = this.currentRingtoneOscillators.filter(() => {
        try {
          // If the oscillator is still valid, keep it
          return true;
        } catch (e) {
          // If it throws, it's already stopped, remove it
          return false;
        }
      });
    }, 1000);
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