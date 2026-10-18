import React, { useState, useEffect, useRef } from 'react';
import { Check, Copy, Volume2 } from 'lucide-react';
import DialPad from './DialPad';
import ErrorBanner from './ErrorBanner';
import AppBar from './AppBar';
import CallToolbar from './CallToolbar';
import CallControlsSheet from './CallControlsSheet';
import TransferModal from './TransferModal';
import DevicePicker from './DevicePicker';
import CallQualityBadge from './CallQualityBadge';
import CallStatsSheet from './CallStatsSheet';
import AudioLevelMeter from './AudioLevelMeter';
import { useSignalWire } from '../hooks/useSignalWire';
import { useCallStore } from '../hooks/useCallStore';
import { useWorkbench } from '../hooks/useWorkbench';
import { signalWireService } from '../services/signalwire';
import { log } from '../utils/log';

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
  // The SDK's call id for the status strip (the stats sheet and the Inspector
  // show it too). Polled: the Call exists only once dial() resolves.
  const [callId, setCallId] = useState<string | null>(null);
  const [copiedCallId, setCopiedCallId] = useState(false);
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
  const clientNotice = useCallStore((s) => s.clientNotice);
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
  // Inside the desktop workbench the stats live in the Inspector pane (so the
  // badge and the More sheet select its Call tab instead of opening the
  // sheet), and the control grid gains a row for Hold, Transfer and Share.
  const workbench = useWorkbench();
  const openStats = workbench ? workbench.openCallStats : () => setIsStatsSheetOpen(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  // The key handler below is bound once; this keeps it on the latest prop.
  const onToggleMuteRef = useRef(onToggleMute);
  onToggleMuteRef.current = onToggleMute;

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

  useEffect(() => {
    const poll = () => setCallId(signalWireService.getCurrentCallId());
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  const copyCallId = async () => {
    if (!callId) return;
    try {
      await navigator.clipboard.writeText(callId);
      setCopiedCallId(true);
      setTimeout(() => setCopiedCallId(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the id is selectable.
    }
  };

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
      // M toggles mute.
      if (e.key === 'm' || e.key === 'M') {
        onToggleMuteRef.current();
        return;
      }
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
    log.debug('Sending DTMF:', key);
    setDialPadInput(prev => prev + key);
    await sendDTMF(key);
  };

  // Show the video layer if the call started as video, or either side turned
  // a camera on mid-call (toggleCamera works on calls that started audio-only).
  const showVideoUI = isVideoCall || isCameraOn || remoteHasVideo;

  // Shared by the main view and the in-call keypad. Hold wins over media loss
  // because the SDK still reports the held call as connected.
  const statusText = isOnHold
    ? 'On Hold'
    : isMediaDisrupted
      ? 'Reconnecting…'
      : callStatus === 'connected'
        ? 'Connected'
        : callStatus === 'ringing'
          ? 'Ringing…'
          : 'Calling…';

  return (
    <div className={`app-shell flex flex-col ${workbench ? 'h-full min-h-0' : 'h-dvh'}`}>
      {/* Inside the workbench the bar is the workbench's own, above the panes. */}
      {!workbench && <AppBar />}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {callError && (
          <ErrorBanner message={callError} onDismiss={() => setCallState({ callError: null })} />
        )}
        {clientNotice && (
          <ErrorBanner tone="info" message={clientNotice} onDismiss={() => setCallState({ clientNotice: null })} />
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
            className="glass-panel relative z-10 mx-auto mt-2 flex w-[calc(100%-2rem)] max-w-xl items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            <Volume2 size={16} /> Tap to enable audio
          </button>
        )}

        {/* The call card: status strip, media (or the DTMF pad), meters and the
            toolbar. It fills a phone's screen; in the workbench it is a card in
            the center column. */}
        <div
          className={`relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto ${
            workbench ? 'items-center px-6 py-4' : ''
          }`}
        >
          <div className={`flex min-h-0 flex-col ${workbench ? 'glass-panel w-full max-w-3xl rounded-xl' : 'flex-1'}`}>
            {/* Status strip. The status line is the first polite live region on
                the screen (the e2e helpers read it). Media down but the call not
                over (ICE disconnected/failed or the SDK mid-recovery): the bar's
                dot stays bound to signaling (isClientReady); this one is media. */}
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-6">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-sm text-muted" aria-live="polite">
                  {(callStatus !== 'connected' || isMediaDisrupted) && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full motion-safe:animate-pulse ${
                        isMediaDisrupted ? 'bg-warn' : 'bg-success'
                      }`}
                    />
                  )}
                  {statusText}
                </div>
                <div className="mt-1 font-display text-2xl font-medium tracking-tight wrap-anywhere select-text sm:text-3xl">
                  {phoneNumber}
                </div>
                {callId && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-faint">
                    <span className="truncate font-mono select-text" title="Call ID">
                      {callId}
                    </span>
                    <button
                      type="button"
                      onClick={copyCallId}
                      aria-label="Copy Call ID"
                      className="-m-1 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-ink"
                    >
                      {copiedCallId ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* The timer appears once the far end answers. */}
                {connectedAt && (
                  <div className="inline-block rounded-md bg-surface-2 px-2.5 py-1 font-mono text-lg tabular-nums text-ink sm:text-xl">
                    {formatDuration(callDuration)}
                  </div>
                )}
                {(callStatus === 'connected' || isMediaDisrupted) && <CallQualityBadge onClick={openStats} />}
              </div>
            </div>

            {/* Video layer -- always mounted (regardless of showDialPad/showVideoUI)
                so the service's ref attach survives both toggling mid-call;
                visibility is purely CSS (hidden, not unmounted) so the stream keeps
                decoding underneath. */}
            <div
              className={`relative overflow-hidden bg-black ${
                showVideoUI && !showDialPad ? (workbench ? 'aspect-video' : 'min-h-0 flex-1') : 'hidden'
              }`}
            >
              <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={`absolute bottom-3 right-3 h-28 w-20 rounded-lg object-cover ring-1 ring-edge-strong shadow-card sm:h-36 sm:w-24 ${
                  isCameraOn ? '' : 'hidden'
                }`}
              />
            </div>

            {/* The DTMF pad: the far end and the statistics don't pause for it,
                so the status strip stays in view above. */}
            {showDialPad && (
              <div className="flex flex-col items-center gap-3 px-4 py-3 sm:px-6">
                <div className="flex w-full max-w-sm items-center justify-center rounded-lg border border-edge-strong bg-surface-2 px-4 py-3">
                  {dialPadInput ? (
                    <div className="min-w-0 font-mono text-2xl font-medium tracking-wide wrap-anywhere sm:text-3xl">
                      {dialPadInput}
                    </div>
                  ) : (
                    <div className="text-base text-faint">
                      {callStatus === 'connected' ? 'Enter digits to send' : 'Keypad available once connected'}
                    </div>
                  )}
                </div>
                {/* Smaller in the workbench card so End stays above the fold. */}
                <div className={workbench ? 'w-full max-w-[13rem]' : 'w-full'}>
                  <DialPad mode="dtmf" onKeyPress={handleDialPadKey} disabled={callStatus !== 'connected'} />
                </div>
              </div>
            )}

            {/* Audio-only on a phone: the toolbar sits at the bottom. */}
            {!showDialPad && !showVideoUI && !workbench && <div className="flex-1" />}

            {callStatus === 'connected' && <AudioLevelMeter isMuted={isMuted} />}

            <div className={`px-4 pt-4 sm:px-6 ${workbench ? 'pb-5' : 'pb-safe'}`}>
              <CallToolbar
                isMuted={isMuted}
                onToggleMute={onToggleMute}
                isKeypadOpen={showDialPad}
                onToggleKeypad={() => setShowDialPad((prev) => !prev)}
                isCameraOn={isCameraOn}
                onToggleCamera={onToggleCamera}
                isOnHold={isOnHold}
                onToggleHold={toggleHold}
                onOpenTransfer={() => setIsTransferModalOpen(true)}
                canScreenShare={canScreenShare}
                screenShareStatus={screenShareStatus}
                /* Straight from the click, no await first: getDisplayMedia
                   needs the user gesture (see toggleScreenShare). */
                onToggleScreenShare={() => toggleScreenShare(shareScreenAudio)}
                isSpeakerOn={isSpeakerOn}
                canSelectAudioOutput={canSelectAudioOutput}
                onToggleSpeaker={onToggleSpeaker}
                onOpenMore={() => setIsControlsSheetOpen(true)}
                onEndCall={onEndCall}
              />
            </div>
          </div>
        </div>

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
            openStats();
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
            <div className="absolute inset-0 bg-scrim" onClick={() => setIsDevicePickerOpen(false)} />
            <DevicePicker isOpen onClose={() => setIsDevicePickerOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default CallScreen;