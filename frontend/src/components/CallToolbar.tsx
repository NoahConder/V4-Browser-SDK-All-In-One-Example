import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Keyboard,
  MicOff,
  MoreHorizontal,
  Pause,
  PhoneForwarded,
  PhoneOff,
  Play,
  ScreenShare,
  ScreenShareOff,
  Video,
  Volume2,
} from 'lucide-react';

type ScreenShareStatus = 'none' | 'starting' | 'started' | 'stopping';

interface ControlButtonProps {
  icon: LucideIcon;
  label: string;
  // Accessible name when the short visible label isn't descriptive enough.
  ariaLabel?: string;
  onClick: () => void;
  // Toggles: filled with the accent while the feature is on. The icon stays
  // the same either way -- swapping it (Mic/MicOff) made the off state read
  // as "muted".
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  // Tooltip, mainly to explain a disabled control.
  title?: string;
}

// A flat, labeled in-call control. Stacked icon-over-label on phones; a
// compact icon-beside-label pill on desktop (the `desk` screen).
export const ControlButton: React.FC<ControlButtonProps> = ({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
  active,
  danger,
  disabled,
  title,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel ?? label}
    aria-pressed={active}
    className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 desk:h-11 desk:min-w-24 desk:flex-row desk:gap-2 desk:px-3 desk:text-xs ${
      danger
        ? 'border-hangup bg-hangup text-on-hangup hover:bg-hangup-hover'
        : active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-edge-strong bg-surface text-ink hover:bg-surface-hover'
    }`}
  >
    <Icon size={18} />
    <span aria-hidden>{label}</span>
  </button>
);

interface CallToolbarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  isKeypadOpen: boolean;
  onToggleKeypad: () => void;
  isCameraOn: boolean;
  onToggleCamera: () => void;
  isOnHold: boolean;
  onToggleHold: () => void;
  // Omitted: no Transfer control is rendered (SHOW_TRANSFER in CallScreen.tsx).
  onOpenTransfer?: () => void;
  canScreenShare: boolean;
  screenShareStatus: ScreenShareStatus;
  // Must run straight from the click: getDisplayMedia needs the user gesture.
  onToggleScreenShare: () => void;
  isSpeakerOn: boolean;
  canSelectAudioOutput: boolean;
  onToggleSpeaker: () => void;
  onOpenMore: () => void;
  onEndCall: () => void;
}

// Every in-call control in one row (wrapping), on phones and desktop alike,
// so the SDK's call controls are all visible rather than behind "More".
const CallToolbar: React.FC<CallToolbarProps> = ({
  isMuted,
  onToggleMute,
  isKeypadOpen,
  onToggleKeypad,
  isCameraOn,
  onToggleCamera,
  isOnHold,
  onToggleHold,
  onOpenTransfer,
  canScreenShare,
  screenShareStatus,
  onToggleScreenShare,
  isSpeakerOn,
  canSelectAudioOutput,
  onToggleSpeaker,
  onOpenMore,
  onEndCall,
}) => {
  const isScreenShareBusy = screenShareStatus === 'starting' || screenShareStatus === 'stopping';
  return (
    <div className="grid grid-cols-3 gap-2 min-[360px]:grid-cols-4 sm:grid-cols-5 desk:flex desk:flex-wrap desk:items-center desk:justify-center">
      <ControlButton icon={MicOff} label="Mute" active={isMuted} onClick={onToggleMute} />
      <ControlButton icon={Keyboard} label="Keypad" active={isKeypadOpen} onClick={onToggleKeypad} />
      <ControlButton icon={Video} label="Camera" active={isCameraOn} onClick={onToggleCamera} />
      <ControlButton
        icon={isOnHold ? Play : Pause}
        label={isOnHold ? 'Resume' : 'Hold'}
        ariaLabel={isOnHold ? 'Resume call' : 'Hold call'}
        active={isOnHold}
        onClick={onToggleHold}
      />
      {onOpenTransfer && (
        <ControlButton icon={PhoneForwarded} label="Transfer" ariaLabel="Transfer call" onClick={onOpenTransfer} />
      )}
      <ControlButton
        icon={screenShareStatus === 'started' ? ScreenShareOff : ScreenShare}
        label="Share"
        ariaLabel={screenShareStatus === 'started' ? 'Stop screen share' : 'Start screen share'}
        active={screenShareStatus === 'started'}
        disabled={!canScreenShare || isScreenShareBusy}
        title={
          canScreenShare ? undefined : 'Screen share is granted on video room and conference calls, not on 1:1 calls'
        }
        onClick={onToggleScreenShare}
      />
      <ControlButton
        icon={Volume2}
        label="Speaker"
        active={isSpeakerOn}
        onClick={onToggleSpeaker}
        disabled={!canSelectAudioOutput}
        title={canSelectAudioOutput ? undefined : 'Choosing an audio output is not supported in this browser'}
      />
      <ControlButton icon={MoreHorizontal} label="More" ariaLabel="More call controls" onClick={onOpenMore} />
      <ControlButton icon={PhoneOff} label="End" ariaLabel="End call" danger onClick={onEndCall} />
    </div>
  );
};

export default CallToolbar;
