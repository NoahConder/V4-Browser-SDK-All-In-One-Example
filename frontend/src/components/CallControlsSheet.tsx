import React from 'react';
import { Activity, Pause, Play, PhoneForwarded, ScreenShare, ScreenShareOff, SlidersHorizontal, Download } from 'lucide-react';
import { SheetRow, SheetSection, SheetShell, SheetSwitch } from './SheetPrimitives';
import { downloadDiagnostics } from '../services/diagnostics';

interface CallControlsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  isOnHold: boolean;
  onToggleHold: () => void;
  // Omitted: no Transfer row is rendered (SHOW_TRANSFER in CallScreen.tsx).
  onOpenTransfer?: () => void;
  onOpenDevicePicker: () => void;
  onOpenStats: () => void;
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

const CallControlsSheet: React.FC<CallControlsSheetProps> = ({
  isOpen,
  onClose,
  isOnHold,
  onToggleHold,
  onOpenTransfer,
  onOpenDevicePicker,
  onOpenStats,
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
    <SheetShell title="More Controls" onClose={onClose}>
      <SheetRow
        icon={isOnHold ? Play : Pause}
        label={isOnHold ? 'Resume Call' : 'Hold Call'}
        active={isOnHold}
        onClick={onToggleHold}
      />
      {onOpenTransfer && <SheetRow icon={PhoneForwarded} label="Transfer Call" onClick={onOpenTransfer} />}
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
      <SheetRow icon={Activity} label="Call Statistics" onClick={onOpenStats} />

      <SheetSection label="Audio Processing" />
      <SheetSwitch label="Echo Cancellation" checked={isEchoCancellationOn} onChange={onToggleEchoCancellation} />
      <SheetSwitch label="Noise Suppression" checked={isNoiseSuppressionOn} onChange={onToggleNoiseSuppression} />
      <SheetSwitch label="Auto Gain Control" checked={isAutoGainOn} onChange={onToggleAutoGain} />

      <div className="mt-1 border-t border-edge-strong pt-1">
        <SheetRow icon={Download} label="Export Diagnostics" onClick={downloadDiagnostics} />
      </div>
    </SheetShell>
  );
};

export default CallControlsSheet;
