import React from 'react';
import { Pause, Play, PhoneForwarded, ScreenShare, ScreenShareOff, SlidersHorizontal, Download, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { downloadDiagnostics } from '../services/diagnostics';

interface CallControlsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  isOnHold: boolean;
  onToggleHold: () => void;
  onOpenTransfer: () => void;
  onOpenDevicePicker: () => void;
  canHold: boolean;
  canTransfer: boolean;
  canScreenShare: boolean;
  screenShareStatus: 'none' | 'starting' | 'started' | 'stopping';
  onToggleScreenShare: () => void;
  isEchoCancellationOn: boolean;
  onToggleEchoCancellation: () => void;
  isNoiseSuppressionOn: boolean;
  onToggleNoiseSuppression: () => void;
  isAutoGainOn: boolean;
  onToggleAutoGain: () => void;
}

interface SheetRowProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

const SheetRow: React.FC<SheetRowProps> = ({ icon: Icon, label, active, disabled, disabledReason, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={disabled ? disabledReason : undefined}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
  >
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        active ? 'bg-white text-black' : 'bg-white/[0.06] text-gray-300'
      }`}
    >
      <Icon size={18} />
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm text-white">{label}</span>
      {disabled && disabledReason && (
        <span className="block truncate text-xs text-gray-500">{disabledReason}</span>
      )}
    </span>
  </button>
);

interface SheetSwitchProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

const SheetSwitch: React.FC<SheetSwitchProps> = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    aria-pressed={checked}
    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10"
  >
    <span className="text-sm text-white">{label}</span>
    <span
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-ios-green' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  </button>
);

const CallControlsSheet: React.FC<CallControlsSheetProps> = ({
  isOpen,
  onClose,
  isOnHold,
  onToggleHold,
  onOpenTransfer,
  onOpenDevicePicker,
  canHold,
  canTransfer,
  canScreenShare,
  screenShareStatus,
  onToggleScreenShare,
  isEchoCancellationOn,
  onToggleEchoCancellation,
  isNoiseSuppressionOn,
  onToggleNoiseSuppression,
  isAutoGainOn,
  onToggleAutoGain,
}) => {
  if (!isOpen) return null;

  const isScreenSharing = screenShareStatus === 'started' || screenShareStatus === 'starting';

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="glass-panel relative z-10 mx-auto mb-4 w-[calc(100%-2rem)] max-w-sm rounded-2xl px-2 py-2">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">More Controls</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <SheetRow
          icon={isOnHold ? Play : Pause}
          label={isOnHold ? 'Resume Call' : 'Hold Call'}
          active={isOnHold}
          // Never lock the user into an on-hold state they can't exit: only
          // gate the initial "Hold Call" action on the capability, not "Resume".
          disabled={!isOnHold && !canHold}
          disabledReason={!isOnHold && !canHold ? 'Not supported on this call' : undefined}
          onClick={onToggleHold}
        />
        <SheetRow
          icon={PhoneForwarded}
          label="Transfer Call"
          disabled={!canTransfer}
          disabledReason={!canTransfer ? 'Not supported on this call' : undefined}
          onClick={onOpenTransfer}
        />
        {canScreenShare && (
          <SheetRow
            icon={isScreenSharing ? ScreenShareOff : ScreenShare}
            label={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
            active={isScreenSharing}
            onClick={onToggleScreenShare}
          />
        )}
        <SheetRow icon={SlidersHorizontal} label="Audio & Video Devices" onClick={onOpenDevicePicker} />

        <div className="mt-1 border-t border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Audio Processing
        </div>
        <SheetSwitch label="Echo Cancellation" checked={isEchoCancellationOn} onChange={onToggleEchoCancellation} />
        <SheetSwitch label="Noise Suppression" checked={isNoiseSuppressionOn} onChange={onToggleNoiseSuppression} />
        <SheetSwitch label="Auto Gain Control" checked={isAutoGainOn} onChange={onToggleAutoGain} />

        <div className="mt-1 border-t border-white/10 pt-1">
          <SheetRow icon={Download} label="Export Diagnostics" onClick={downloadDiagnostics} />
        </div>
      </div>
    </div>
  );
};

export default CallControlsSheet;
