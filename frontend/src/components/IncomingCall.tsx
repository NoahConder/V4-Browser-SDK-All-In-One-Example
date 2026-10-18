import React, { useEffect } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import AppBar from './AppBar';
import { useWorkbench } from '../hooks/useWorkbench';

interface IncomingCallProps {
  phoneNumber: string;
  isVideoCall: boolean;
  onAnswer: () => void;
  onReject: () => void;
}

// A ringing inbound call (client.incomingCalls$): who is calling and two
// wide buttons. Enter answers, Escape declines. Inside the workbench the bar
// is the workbench's own, above all three panes.
const IncomingCall: React.FC<IncomingCallProps> = ({
  phoneNumber,
  isVideoCall,
  onAnswer,
  onReject,
}) => {
  const workbench = useWorkbench();

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
    <div className={`app-shell flex flex-col ${workbench ? 'h-full min-h-0' : 'h-dvh'}`}>
      {!workbench && <AppBar />}

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6">
        <div className={`w-full max-w-xl ${workbench ? 'glass-panel rounded-xl p-6' : 'px-2'}`}>
          <div className="inline-flex items-center gap-2 text-sm text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            {isVideoCall ? 'Incoming video call' : 'Incoming call'}
            {isVideoCall && <Video size={14} className="text-faint" />}
          </div>
          <div className="mt-2 font-display text-3xl font-medium tracking-tight wrap-anywhere select-text sm:text-4xl">
            {phoneNumber}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onReject}
              aria-label="Decline"
              className="flex h-14 items-center justify-center gap-2 rounded-lg bg-hangup text-sm font-semibold text-on-hangup shadow-card transition-colors hover:bg-hangup-hover"
            >
              <PhoneOff size={22} fill="currentColor" />
              <span>Decline</span>
            </button>
            <button
              type="button"
              onClick={onAnswer}
              aria-label="Accept"
              className="flex h-14 items-center justify-center gap-2 rounded-lg bg-call text-sm font-semibold text-on-call shadow-card transition-colors hover:bg-call-hover"
            >
              <Phone size={22} fill="currentColor" />
              <span>Accept</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;
