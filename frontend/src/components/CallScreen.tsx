import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Keyboard, Video, VideoOff } from 'lucide-react';
import DialPad from './DialPad';
import { useSignalWire } from '../hooks/useSignalWire';
import { useCallStore } from '../hooks/useCallStore';
import { signalWireService } from '../services/signalwire';

interface CallScreenProps {
  phoneNumber: string;
  onEndCall: () => void;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideoCall: boolean;
  isCameraOn: boolean;
  remoteHasVideo: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onToggleCamera: () => void;
}

const CallScreen: React.FC<CallScreenProps> = ({
  phoneNumber,
  onEndCall,
  isMuted,
  isSpeakerOn,
  isVideoCall,
  isCameraOn,
  remoteHasVideo,
  onToggleMute,
  onToggleSpeaker,
  onToggleCamera,
}) => {
  const [callDuration, setCallDuration] = useState(0);
  const [showDialPad, setShowDialPad] = useState(false);
  const [dialPadInput, setDialPadInput] = useState('');
  const { sendDTMF } = useSignalWire();
  const callStatus = useCallStore((s) => s.callStatus);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Hand our <video> elements to the service so it can attach the SDK's
  // local/remote MediaStreams as they arrive. Must outlive re-renders of this
  // component's children, so this only re-runs on mount/unmount.
  useEffect(() => {
    signalWireService.setLocalVideoElement(localVideoRef.current);
    signalWireService.setRemoteVideoElement(remoteVideoRef.current);
    return () => {
      signalWireService.setLocalVideoElement(null);
      signalWireService.setRemoteVideoElement(null);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Handle keyboard input for DTMF during calls
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      // Only handle DTMF keys during active call
      if ((e.key >= '0' && e.key <= '9') || e.key === '*' || e.key === '#') {
        handleDialPadKey(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyboardInput);
    return () => window.removeEventListener('keydown', handleKeyboardInput);
    // Bind the DTMF key listener once. handleDialPadKey only uses functional
    // setState and the stable sendDTMF delegator, so there's no stale state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDialPadKey = async (key: string) => {
    // Send DTMF tone through the call
    console.log('Sending DTMF:', key);
    setDialPadInput(prev => prev + key);
    await sendDTMF(key);
  };

  // Show the video layer if the call started as video, or either side turned
  // a camera on mid-call (toggleCamera works on calls that started audio-only).
  const showVideoUI = isVideoCall || isCameraOn || remoteHasVideo;

  return (
    <div className="app-shell flex flex-col h-screen">
      {/* Status Bar - always visible */}
      <div className="glass-bar relative flex items-center justify-between px-6 py-2 text-sm">
        <span className="text-ios-green">●</span>
        <span className="absolute left-1/2 transform -translate-x-1/2 font-medium tracking-wide text-gray-400">
          SignalWire
        </span>
        <span className="text-gray-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* Main Content Container */}
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Video layer -- always mounted (regardless of showDialPad/showVideoUI) so
            the service's ref attach survives both toggling mid-call; visibility is
            purely CSS (hidden, not unmounted) so the stream keeps decoding underneath. */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 h-full w-full bg-black object-cover ${showVideoUI ? '' : 'hidden'}`}
        />
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className={`absolute right-4 top-4 h-28 w-20 rounded-xl object-cover ring-1 ring-white/20 shadow-[0_4px_16px_rgba(0,0,0,0.5)] sm:h-36 sm:w-24 ${
            showVideoUI && isCameraOn ? '' : 'hidden'
          }`}
        />

        {showDialPad ? (
          <>
            {/* DTMF Display - matches idle dialer's address input styling */}
            <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-4 min-h-0">
              <div className="glass-panel flex w-full max-w-sm items-center justify-center rounded-2xl px-4 py-3">
                {dialPadInput ? (
                  <div className="text-2xl sm:text-3xl font-light tracking-wide">
                    {dialPadInput}
                  </div>
                ) : (
                  <div className="text-lg sm:text-xl text-gray-500">Enter a number</div>
                )}
              </div>
            </div>

            {/* Dial Pad with Hide button */}
            <div className="relative z-10 pb-6 sm:pb-8">
              <DialPad
                onKeyPress={handleDialPadKey}
                onCall={() => setShowDialPad(false)} // Hide button
                onDelete={() => setDialPadInput(prev => prev.slice(0, -1))} // Delete functionality
                onClearAll={() => setDialPadInput('')} // Clear all functionality
                hasNumber={true}
                disabled={false}
                callButtonText="Hide"
              />
            </div>
          </>
        ) : (
          <>
            {/* Call Info */}
            <div className="relative z-10 flex-1 flex flex-col justify-center items-center px-4 py-4 min-h-0">
              {!showVideoUI && (
                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-b from-white/10 to-white/[0.02] ring-1 ring-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                  <Phone size={36} className="text-gray-300" />
                </div>
              )}
              <div
                className={`text-center ${
                  showVideoUI ? 'mt-auto w-full bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10' : ''
                }`}
              >
                <div className="mb-2 inline-flex items-center gap-2 text-sm text-gray-400">
                  {callStatus !== 'connected' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-ios-green animate-pulse" />
                  )}
                  {callStatus === 'connected' ? 'Connected' : 'Calling…'}
                </div>
                <div className="text-2xl sm:text-3xl font-light mb-4">{phoneNumber}</div>
                <div className="inline-block rounded-full bg-white/5 px-3 py-1 text-lg sm:text-xl text-gray-300 tabular-nums">
                  {formatDuration(callDuration)}
                </div>
              </div>
            </div>

            {/* Call Controls - Bottom buttons */}
            <div className="relative z-10 pb-6 sm:pb-8">
              <div className="flex justify-center items-center w-full px-4">
                <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ maxWidth: '260px' }}>
                  {/* Mute Button */}
                  <button
                    onClick={onToggleMute}
                    className={`dial-button border transition-all ${
                      isMuted
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.06] text-white border-white/10 backdrop-blur-md hover:bg-white/10'
                    }`}
                  >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>

                  {/* Keypad Button */}
                  <button
                    onClick={() => setShowDialPad(true)}
                    className="dial-button border border-white/10 bg-white/[0.06] backdrop-blur-md hover:bg-white/10"
                  >
                    <Keyboard size={24} />
                  </button>

                  {/* Speaker Button */}
                  <button
                    onClick={onToggleSpeaker}
                    className={`dial-button border transition-all ${
                      isSpeakerOn
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.06] text-white border-white/10 backdrop-blur-md hover:bg-white/10'
                    }`}
                  >
                    {isSpeakerOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
                  </button>

                  {/* Camera Button */}
                  <button
                    onClick={onToggleCamera}
                    className={`dial-button border transition-all ${
                      isCameraOn
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.06] text-white border-white/10 backdrop-blur-md hover:bg-white/10'
                    }`}
                  >
                    {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
                  </button>

                  {/* End Call Button */}
                  <button
                    onClick={onEndCall}
                    className="dial-button bg-gradient-to-b from-red-500 to-ios-red shadow-[0_4px_16px_rgba(255,59,48,0.35)] hover:brightness-110"
                  >
                    <PhoneOff size={32} fill="white" />
                  </button>

                  <div></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CallScreen;