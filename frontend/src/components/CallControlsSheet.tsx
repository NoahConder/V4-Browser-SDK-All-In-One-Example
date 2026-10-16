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
  canScreenShare: boolean;
  screenShareStatus: 'none' | 'starting' | 'started' | 'stopping';
  onToggleScreenShare: () => void;
  shareScreenAudio: boolean;
  onToggleShareScreenAudio: () => void;
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
  onClick: () => void;
}

const SheetRow: React.FC<SheetRowProps> = ({ icon: Icon, label, active, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
  >
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        active ? 'bg-white text-black' : 'bg-white/6 text-gray-300'
      }`}
    >
      <Icon size={18} />
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm text-white">{label}</span>
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
  canScreenShare,
  screenShareStatus,
  onToggleScreenShare,
  shareScreenAudio,
  onToggleShareScreenAudio,
  isEchoCancellationOn,
  onToggleEchoCancellation,
  isNoiseSuppressionOn,
  onToggleNoiseSuppression,
  isAutoGainOn,
  onToggleAutoGain,
}) => {
  if (!isOpen) return null;

  // 'starting'/'stopping' are busy: the SDK's guide disables the control
  // until the share settles.
  const isScreenShareBusy = screenShareStatus === 'starting' || screenShareStatus === 'stopping';
  const screenShareLabel = {
    none: 'Share Screen',
    starting: 'Starting Screen Share…',
    started: 'Stop Screen Share',
    stopping: 'Stopping Screen Share…',
  }[screenShareStatus];

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="glass-panel relative z-10 mx-auto mb-4 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-2 py-2">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">More Controls</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-full p-3 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <SheetRow
          icon={isOnHold ? Play : Pause}
          label={isOnHold ? 'Resume Call' : 'Hold Call'}
          active={isOnHold}
          onClick={onToggleHold}
        />
        <SheetRow
          icon={PhoneForwarded}
          label="Transfer Call"
          onClick={onOpenTransfer}
        />
        {canScreenShare && (
          <>
            <SheetRow
              icon={screenShareStatus === 'started' ? ScreenShareOff : ScreenShare}
              label={screenShareLabel}
              active={screenShareStatus === 'started'}
              disabled={isScreenShareBusy}
              onClick={onToggleScreenShare}
            />
            {screenShareStatus === 'none' && (
              <SheetSwitch label="Include Tab Audio" checked={shareScreenAudio} onChange={onToggleShareScreenAudio} />
            )}
          </>
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
