import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, MicOff, Volume2, Keyboard, Video, MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import DialPad from './DialPad';
import ErrorBanner from './ErrorBanner';
import StatusBar from './StatusBar';
import CallControlsSheet from './CallControlsSheet';
import TransferModal from './TransferModal';
import DevicePicker from './DevicePicker';
import CallQualityBadge from './CallQualityBadge';
import CallStatsSheet from './CallStatsSheet';
import AudioLevelMeter from './AudioLevelMeter';
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

interface CallControlProps {
  icon: LucideIcon;
  label: string;
  // Accessible name when the short visible label isn't descriptive enough.
  ariaLabel?: string;
  onClick: () => void;
  // Toggles: highlighted (white) while the feature is on. The icon stays the
  // same either way, like iOS -- swapping it (Mic/MicOff, Volume2/VolumeX) made
  // the off state read as "muted".
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  // Tooltip, mainly to explain a disabled control.
  title?: string;
}

const CallControl: React.FC<CallControlProps> = ({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
  active,
  danger,
  disabled,
  title,
}) => (
  <div className="flex flex-col items-center gap-1.5 short:gap-0.5">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      className={`dial-button transition-all disabled:opacity-40 disabled:active:scale-100 ${
        danger
          ? 'bg-linear-to-b from-red-500 to-ios-red shadow-[0_4px_16px_rgba(255,59,48,0.35)] hover:brightness-110'
          : active
            ? 'border border-white bg-white text-black'
            : 'border border-white/10 bg-white/6 text-white backdrop-blur-md hover:bg-white/10'
      }`}
    >
      {danger ? <Icon size={32} fill="white" /> : <Icon size={24} />}
    </button>
    <span aria-hidden className="text-xs text-gray-300 short:text-[10px]">{label}</span>
  </div>
);

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
  const [now, setNow] = useState(() => Date.now());
  const [showDialPad, setShowDialPad] = useState(false);
  const [dialPadInput, setDialPadInput] = useState('');
  const [isControlsSheetOpen, setIsControlsSheetOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [isStatsSheetOpen, setIsStatsSheetOpen] = useState(false);
  // Kept here (not in the sheet, which unmounts on close) so it survives
  // reopening the sheet. Best-effort: Chrome/Edge tabs and windows only.
  const [shareScreenAudio, setShareScreenAudio] = useState(false);
  const {
    sendDTMF,
    toggleHold,
    transferCall,
    toggleScreenShare,
    toggleEchoCancellation,
    toggleAutoGain,
    toggleNoiseSuppression,
    requestIceRestart,
  } = useSignalWire();
  const callStatus = useCallStore((s) => s.callStatus);
  const callError = useCallStore((s) => s.callError);
  const isOnHold = useCallStore((s) => s.isOnHold);
  const canScreenShare = useCallStore((s) => s.canScreenShare);
  const screenShareStatus = useCallStore((s) => s.screenShareStatus);
  const isEchoCancellationOn = useCallStore((s) => s.isEchoCancellationOn);
  const isAutoGainOn = useCallStore((s) => s.isAutoGainOn);
  const isNoiseSuppressionOn = useCallStore((s) => s.isNoiseSuppressionOn);
  const canSelectAudioOutput = useCallStore((s) => s.canSelectAudioOutput);
  const connectedAt = useCallStore((s) => s.connectedAt);
  const needsAudioUnlock = useCallStore((s) => s.needsAudioUnlock);
  const isMediaDisrupted = useCallStore((s) => s.isMediaDisrupted);
  const setCallState = useCallStore((s) => s.setCallState);
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

  // The timer runs from connectedAt (not from mount), so it starts at 00:00
  // when the far end answers and survives a reattach/re-mount mid-call.
  useEffect(() => {
    if (!connectedAt) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);
  const callDuration = connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;

  // Handle keyboard input for DTMF during calls. Escape closes the sheet /
  // device picker (TransferModal handles its own).
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsControlsSheetOpen(false);
        setIsDevicePickerOpen(false);
        setIsStatsSheetOpen(false);
        return;
      }
      // Not while typing in a field (e.g. the Transfer destination -- those
      // digits were being sent to the far end as DTMF), or for shortcuts.
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // DTMF has nowhere to go until the call is connected.
      if (useCallStore.getState().callStatus !== 'connected') return;
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
    <div className="app-shell flex flex-col h-dvh">
      {/* Status Bar - always visible */}
      <StatusBar>
        {(callStatus === 'connected' || isMediaDisrupted) && (
          <CallQualityBadge onClick={() => setIsStatsSheetOpen(true)} />
        )}
      </StatusBar>

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

        {callError && (
          <ErrorBanner message={callError} onDismiss={() => setCallState({ callError: null })} />
        )}

        {/* The browser refused to start remote audio without a gesture (see
            onRemoteAudioBlocked); this tap is that gesture. */}
        {needsAudioUnlock && (
          <button
            type="button"
            onClick={() => {
              signalWireService.resumeRemoteAudio();
              setCallState({ needsAudioUnlock: false });
            }}
            className="glass-panel relative z-10 mx-auto mt-2 flex w-[calc(100%-2rem)] max-w-sm items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            <Volume2 size={16} /> Tap to enable audio
          </button>
        )}

        {showDialPad ? (
          <div className="relative z-10 flex flex-1 flex-col min-h-0 overflow-y-auto short:flex-row short:items-center">
            {/* DTMF Display - matches idle dialer's address input styling */}
            <div className="flex-1 flex items-center justify-center px-6 py-4 short:px-4">
              <div className="glass-panel flex w-full max-w-sm items-center justify-center rounded-2xl px-4 py-3">
                {dialPadInput ? (
                  <div className="min-w-0 text-2xl sm:text-3xl font-light tracking-wide wrap-anywhere">
                    {dialPadInput}
                  </div>
                ) : (
                  <div className="text-lg sm:text-xl text-gray-500">
                    {callStatus === 'connected' ? 'Enter digits to send' : 'Keypad available once connected'}
                  </div>
                )}
              </div>
            </div>

            {/* Dial Pad with End and Hide buttons */}
            <div className="pb-6 sm:pb-8 short:flex-1 short:py-2">
              <DialPad
                onKeyPress={handleDialPadKey}
                onCall={onEndCall}
                onHide={() => setShowDialPad(false)}
                disabled={callStatus !== 'connected'}
              />
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex flex-1 flex-col min-h-0 overflow-y-auto short:flex-row short:items-center">
            {/* Call Info */}
            <div className="flex-1 flex flex-col justify-center items-center px-4 py-4 short:self-stretch">
              {!showVideoUI && (
                <div className="mb-6 flex h-24 w-24 short:hidden items-center justify-center rounded-full bg-linear-to-b from-white/10 to-white/2 ring-1 ring-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                  <Phone size={36} className="text-gray-300" />
                </div>
              )}
              <div
                className={`max-w-full text-center ${
                  showVideoUI ? 'mt-auto w-full bg-linear-to-t from-black/70 to-transparent px-4 pb-4 pt-10' : ''
                }`}
              >
                <div className="mb-2 inline-flex items-center gap-2 text-sm text-gray-400">
                  {/* Media down but the call not over (ICE disconnected/failed
                      or the SDK mid-recovery) -- the StatusBar dot stays bound
                      to signaling (isClientReady); this one is about media. */}
                  {(callStatus !== 'connected' || isMediaDisrupted) && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full motion-safe:animate-pulse ${
                        isMediaDisrupted ? 'bg-amber-400' : 'bg-ios-green'
                      }`}
                    />
                  )}
                  {isOnHold
                    ? 'On Hold'
                    : isMediaDisrupted
                      ? 'Reconnecting…'
                      : callStatus === 'connected'
                        ? 'Connected'
                        : callStatus === 'ringing'
                          ? 'Ringing…'
                          : 'Calling…'}
                </div>
                <div className="text-2xl sm:text-3xl font-light mb-4 wrap-anywhere">{phoneNumber}</div>
                {/* Like iOS, the timer appears once the call is answered. */}
                {connectedAt && (
                  <div className="inline-block rounded-full bg-white/5 px-3 py-1 text-lg sm:text-xl text-gray-300 tabular-nums">
                    {formatDuration(callDuration)}
                  </div>
                )}
                {callStatus === 'connected' && <AudioLevelMeter isMuted={isMuted} />}
              </div>
            </div>

            {/* Call Controls - Bottom buttons */}
            <div className="pb-6 sm:pb-8 short:flex-1 short:py-2">
              <div className="flex justify-center items-center w-full px-4">
                <div className="grid grid-cols-3 gap-3 sm:gap-4 short:gap-2" style={{ maxWidth: '260px' }}>
                  <CallControl icon={MicOff} label="Mute" active={isMuted} onClick={onToggleMute} />
                  <CallControl icon={Keyboard} label="Keypad" onClick={() => setShowDialPad(true)} />
                  <CallControl
                    icon={Volume2}
                    label="Speaker"
                    active={isSpeakerOn}
                    onClick={onToggleSpeaker}
                    disabled={!canSelectAudioOutput}
                    title={canSelectAudioOutput ? undefined : 'Choosing an audio output is not supported in this browser'}
                  />
                  <CallControl icon={Video} label="Camera" active={isCameraOn} onClick={onToggleCamera} />
                  <CallControl icon={PhoneOff} label="End" ariaLabel="End call" danger onClick={onEndCall} />
                  <CallControl
                    icon={MoreHorizontal}
                    label="More"
                    ariaLabel="More call controls"
                    onClick={() => setIsControlsSheetOpen(true)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <CallControlsSheet
          isOpen={isControlsSheetOpen}
          onClose={() => setIsControlsSheetOpen(false)}
          isOnHold={isOnHold}
          onToggleHold={toggleHold}
          onOpenTransfer={() => {
            setIsControlsSheetOpen(false);
            setIsTransferModalOpen(true);
          }}
          onOpenDevicePicker={() => {
            setIsControlsSheetOpen(false);
            setIsDevicePickerOpen(true);
          }}
          onOpenStats={() => {
            setIsControlsSheetOpen(false);
            setIsStatsSheetOpen(true);
          }}
          canScreenShare={canScreenShare}
          screenShareStatus={screenShareStatus}
          onToggleScreenShare={() => toggleScreenShare(shareScreenAudio)}
          shareScreenAudio={shareScreenAudio}
          onToggleShareScreenAudio={() => setShareScreenAudio((prev) => !prev)}
          isEchoCancellationOn={isEchoCancellationOn}
          onToggleEchoCancellation={toggleEchoCancellation}
          isNoiseSuppressionOn={isNoiseSuppressionOn}
          onToggleNoiseSuppression={toggleNoiseSuppression}
          isAutoGainOn={isAutoGainOn}
          onToggleAutoGain={toggleAutoGain}
        />

        <CallStatsSheet
          isOpen={isStatsSheetOpen}
          onClose={() => setIsStatsSheetOpen(false)}
          onRequestIceRestart={requestIceRestart}
        />

        <TransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          onTransfer={transferCall}
        />

        {isDevicePickerOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setIsDevicePickerOpen(false)} />
            <DevicePicker isOpen onClose={() => setIsDevicePickerOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default CallScreen;