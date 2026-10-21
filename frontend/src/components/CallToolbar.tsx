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
  className?: string;
}

// A flat, labeled in-call control. Stacked icon-over-label on phones,
// tablets and narrow workbench windows; a compact icon-beside-label pill where
// four of those fit a row of the call card (the `wide` screen).
export const ControlButton: React.FC<ControlButtonProps> = ({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
  active,
  danger,
  disabled,
  title,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel ?? label}
    aria-pressed={active}
    className={`flex h-14 min-w-0 flex-col short:h-12 items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 wide:h-11 wide:flex-row wide:gap-2 wide:px-3 wide:text-xs ${
      danger
        ? 'border-hangup bg-hangup text-on-hangup hover:bg-hangup-hover'
        : active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-edge-strong bg-surface text-ink hover:bg-surface-hover'
    } ${className}`}
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

// Every in-call control on one grid, on phones and desktop alike, so the
// SDK's call controls are all visible rather than behind "More". Four columns
// make the eight controls two full rows with End bottom-right, the same on
// every width; landscape phones (`short`) have the width for one row and not
// the height for two. Transfer (SHOW_TRANSFER) makes nine, so five columns.
// On `low` screens an open keypad leaves room for one row: the toolbar keeps
// Mute, Keypad (to close it), Speaker and End until the keypad is closed.
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
  const secondary = isKeypadOpen ? 'low:hidden' : '';
  return (
    <div className={`grid gap-2 ${onOpenTransfer ? 'grid-cols-5 short:grid-cols-9' : 'grid-cols-4 short:grid-cols-8'}`}>
      <ControlButton icon={MicOff} label="Mute" active={isMuted} onClick={onToggleMute} />
      <ControlButton icon={Keyboard} label="Keypad" active={isKeypadOpen} onClick={onToggleKeypad} />
      <ControlButton icon={Video} label="Camera" active={isCameraOn} onClick={onToggleCamera} className={secondary} />
      <ControlButton
        icon={isOnHold ? Play : Pause}
        label={isOnHold ? 'Resume' : 'Hold'}
        ariaLabel={isOnHold ? 'Resume call' : 'Hold call'}
        active={isOnHold}
        onClick={onToggleHold}
        className={secondary}
      />
      {onOpenTransfer && (
        <ControlButton
          icon={PhoneForwarded}
          label="Transfer"
          ariaLabel="Transfer call"
          onClick={onOpenTransfer}
          className={secondary}
        />
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
        className={secondary}
      />
      <ControlButton
        icon={Volume2}
        label="Speaker"
        active={isSpeakerOn}
        onClick={onToggleSpeaker}
        disabled={!canSelectAudioOutput}
        title={canSelectAudioOutput ? undefined : 'Choosing an audio output is not supported in this browser'}
      />
      <ControlButton
        icon={MoreHorizontal}
        label="More"
        ariaLabel="More call controls"
        onClick={onOpenMore}
        className={secondary}
      />
      <ControlButton icon={PhoneOff} label="End" ariaLabel="End call" danger onClick={onEndCall} />
    </div>
  );
};

export default CallToolbar;
