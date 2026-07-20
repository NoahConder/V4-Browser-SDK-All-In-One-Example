import React, { useEffect } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';

interface IncomingCallProps {
  phoneNumber: string;
  isVideoCall: boolean;
  onAnswer: () => void;
  onReject: () => void;
}

const IncomingCall: React.FC<IncomingCallProps> = ({
  phoneNumber,
  isVideoCall,
  onAnswer,
  onReject,
}) => {
  useEffect(() => {
    // Play ringtone
    const audio = new Audio('/ringtone.mp3');
    audio.loop = true;
    audio.play().catch(console.error);

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  return (
    <div className="app-shell flex flex-col h-screen">
      {/* Caller Info */}
      <div className="flex-1 flex flex-col justify-center items-center px-6">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 text-sm text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-ios-green animate-pulse" />
            {isVideoCall ? 'Incoming video call' : 'Incoming call'}
          </div>
          <div className="text-3xl font-light mb-8">{phoneNumber}</div>

          {/* Avatar placeholder */}
          <div className="relative mx-auto mb-8 flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-b from-white/10 to-white/[0.02] ring-1 ring-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <span className="absolute inset-0 rounded-full ring-1 ring-ios-green/30 animate-ping" />
            {isVideoCall ? <Video size={48} className="text-gray-300" /> : <Phone size={48} className="text-gray-300" />}
          </div>
        </div>
      </div>

      {/* Action Buttons - using same size as dial pad */}
      <div className="flex justify-center items-center w-full px-4 pb-6 sm:pb-8">
        <div className="flex gap-8">
          {/* Reject Button */}
          <div className="flex flex-col items-center">
            <button
              onClick={onReject}
              className="dial-button bg-gradient-to-b from-red-500 to-ios-red shadow-[0_4px_16px_rgba(255,59,48,0.35)] hover:brightness-110"
            >
              <PhoneOff size={32} fill="white" />
            </button>
            <span className="text-xs text-gray-400 mt-2">Decline</span>
          </div>

          {/* Answer Button */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-ios-green/40 animate-ping" />
              <button
                onClick={onAnswer}
                className="dial-button relative bg-gradient-to-b from-emerald-400 to-ios-green shadow-[0_4px_16px_rgba(52,199,89,0.4)] hover:brightness-110"
              >
                <Phone size={32} fill="white" />
              </button>
            </div>
            <span className="text-xs text-gray-400 mt-2">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;