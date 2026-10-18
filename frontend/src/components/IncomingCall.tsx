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
  // Enter answers, Escape declines.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Enter') onAnswer();
      else if (e.key === 'Escape') onReject();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAnswer, onReject]);

  return (
    <div className="app-shell flex flex-col h-dvh overflow-y-auto short:flex-row short:items-center">
      {/* Caller Info */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 short:self-stretch">
        <div className="max-w-full text-center">
          <div className="mb-4 inline-flex items-center gap-2 text-sm text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            {isVideoCall ? 'Incoming video call' : 'Incoming call'}
          </div>
          <div className="text-3xl font-display font-medium tracking-tight mb-8 wrap-anywhere select-text short:mb-0">{phoneNumber}</div>

          {/* Avatar placeholder */}
          <div className="relative mx-auto mb-8 flex h-32 w-32 short:hidden items-center justify-center rounded-full bg-surface ring-1 ring-edge-strong shadow-card">
            <span className="absolute inset-0 rounded-full ring-1 ring-call/30 motion-safe:animate-ping" />
            {isVideoCall ? <Video size={48} className="text-muted" /> : <Phone size={48} className="text-muted" />}
          </div>
        </div>
      </div>

      {/* Action Buttons - using same size as dial pad */}
      <div className="flex justify-center items-center w-full px-4 pb-safe sm:pb-8 short:w-auto short:flex-1 short:py-2">
        <div className="flex gap-8">
          {/* Reject Button */}
          <div className="flex flex-col items-center">
            <button
              onClick={onReject}
              aria-label="Decline"
              className="dial-button bg-hangup text-on-hangup hover:bg-hangup-hover"
            >
              <PhoneOff size={32} fill="currentColor" />
            </button>
            <span className="text-xs text-muted mt-2">Decline</span>
          </div>

          {/* Answer Button */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-call/40 motion-safe:animate-ping" />
              <button
                onClick={onAnswer}
                aria-label="Accept"
                className="dial-button relative bg-call text-on-call hover:bg-call-hover"
              >
                <Phone size={32} fill="currentColor" />
              </button>
            </div>
            <span className="text-xs text-muted mt-2">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;