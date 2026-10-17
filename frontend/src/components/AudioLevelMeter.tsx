import React, { useEffect, useRef } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { signalWireService } from '../services/signalwire';

interface AudioLevelMeterProps {
  isMuted: boolean;
}

// RMS 0..1 reads tiny for normal speech; a square root spreads the useful
// range across the bar.
const perceptual = (level: number) => Math.min(1, Math.sqrt(Math.max(0, level)));

// Mic and remote audio levels, written straight to the DOM from the SDK's
// ~30 fps observables (never through React state -- see CLAUDE.md's
// subscription-placement note). Confirms at a glance that the mic is live,
// that mute really silences it, and that audio is arriving from the far end.
const AudioLevelMeter: React.FC<AudioLevelMeterProps> = ({ isMuted }) => {
  const micRowRef = useRef<HTMLDivElement>(null);
  const micBarRef = useRef<HTMLDivElement>(null);
  const remoteBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scale = (el: HTMLDivElement | null, level: number) => {
      if (el) el.style.transform = `scaleX(${perceptual(level)})`;
    };
    const subs = [
      signalWireService.getLocalAudioLevel$().subscribe((level) => scale(micBarRef.current, level)),
      signalWireService.getRemoteAudioLevel$().subscribe((level) => scale(remoteBarRef.current, level)),
      signalWireService
        .getLocalSpeaking$()
        .subscribe((speaking) => micRowRef.current?.classList.toggle('text-white', speaking)),
    ];
    return () => subs.forEach((sub) => sub.unsubscribe());
  }, []);

  return (
    <div className="mx-auto mt-4 flex w-44 flex-col gap-1.5 text-gray-500 short:hidden" aria-hidden>
      <div ref={micRowRef} className={`flex items-center gap-2 transition-colors ${isMuted ? 'opacity-40' : ''}`}>
        <Mic size={12} className="shrink-0" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            ref={micBarRef}
            className="h-full w-full origin-left rounded-full bg-ios-green transition-transform duration-75"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Volume2 size={12} className="shrink-0" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            ref={remoteBarRef}
            className="h-full w-full origin-left rounded-full bg-blue-400 transition-transform duration-75"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
      </div>
    </div>
  );
};

export default AudioLevelMeter;
