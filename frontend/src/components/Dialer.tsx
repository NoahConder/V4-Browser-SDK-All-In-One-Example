import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, AtSign, History, List, Phone, Slash, SlidersHorizontal, User, Video, VideoOff, X } from 'lucide-react';
import DialPad from './DialPad';
import StatusBar from './StatusBar';
import CallScreen from './CallScreen';
import IncomingCall from './IncomingCall';
import DialableResourcesPanel, { type ResourceTab } from './DialableResourcesPanel';
import DevicePicker from './DevicePicker';
import DiagnosticsPanel from './DiagnosticsPanel';
import SubscriberPicker from './SubscriberPicker';
import ErrorBanner from './ErrorBanner';
import { useCallStore } from '../hooks/useCallStore';
import { useRecentsStore } from '../hooks/useRecentsStore';
import { useSignalWire } from '../hooks/useSignalWire';
import { type DialAddressType, countDigits, formatPhoneNumber, getDialAddressType, isDialAddress } from '../utils/address';

type HeaderPanel = 'devices' | 'diagnostics' | 'resources' | 'subscriber';

const HEADER_PANEL_BUTTONS: Array<{ panel: HeaderPanel; label: string; icon: typeof Phone }> = [
  { panel: 'devices', label: 'Audio & Video Devices', icon: SlidersHorizontal },
  { panel: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { panel: 'resources', label: 'Dialable Resources', icon: List },
  { panel: 'subscriber', label: 'Subscriber', icon: User },
];

const DIAL_ADDRESS_META: Record<DialAddressType, { icon: typeof Phone; label: string; badgeClass: string }> = {
  phone: { icon: Phone, label: 'Phone number', badgeClass: 'bg-white/10 text-gray-300' },
  sip: { icon: AtSign, label: 'SIP address', badgeClass: 'bg-blue-500/15 text-blue-400' },
  fabric: { icon: Slash, label: 'Fabric address', badgeClass: 'bg-purple-500/15 text-purple-400' },
};

// iOS-style auto-shrink: the largest of these sizes at which the value (or the
// placeholder, when empty) fits the input's actual width. Measured rather than
// guessed from the length, so a phone number stays large on a wide screen yet
// still fits a 320px one; SWML/SIP resource addresses (full URLs with a
// `?channel=...` query string) bottom out at the smallest size and scroll.
const ADDRESS_FONT_SIZES_PX = [24, 20, 18, 16, 14, 12];

let measureContext: CanvasRenderingContext2D | null = null;

const fitAddressFontSize = (input: HTMLInputElement, text: string): number => {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const style = getComputedStyle(input);
  const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (!measureContext || available <= 0) return ADDRESS_FONT_SIZES_PX[0];
  for (const size of ADDRESS_FONT_SIZES_PX) {
    measureContext.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    if (measureContext.measureText(text).width <= available) return size;
  }
  return ADDRESS_FONT_SIZES_PX[ADDRESS_FONT_SIZES_PX.length - 1];
};

const Dialer: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCallingInProgress, setIsCallingInProgress] = useState(false);
  const [isAddressInputFocused, setIsAddressInputFocused] = useState(false);
  const [wantsVideo, setWantsVideo] = useState(false);
  // Only one header panel (device picker, diagnostics, dialable resources, subscriber
  // picker) may be open at a time -- opening any of them covers the center dial pad,
  // so keep them mutually exclusive instead of letting all four stack.
  const [activeHeaderPanel, setActiveHeaderPanel] = useState<HeaderPanel | null>(null);
  const isDevicePickerOpen = activeHeaderPanel === 'devices';
  const isDiagnosticsPanelOpen = activeHeaderPanel === 'diagnostics';
  const isResourcesPanelOpen = activeHeaderPanel === 'resources';
  const isSubscriberPanelOpen = activeHeaderPanel === 'subscriber';
  const toggleHeaderPanel = (panel: HeaderPanel) =>
    setActiveHeaderPanel((prev) => (prev === panel ? null : panel));
  // The resources panel's tab is owned here so shortcuts can open a specific
  // one; it also survives closing and reopening the panel.
  const [resourcesTab, setResourcesTab] = useState<ResourceTab>('directory');
  const addressInputRef = useRef<HTMLInputElement>(null);
  const [addressFontSize, setAddressFontSize] = useState(ADDRESS_FONT_SIZES_PX[0]);
  // The display name of a destination picked from the resources panel, kept
  // only while the field still holds that destination (editing it by hand
  // makes the label stale). Passed to makeCall for the Recents log.
  const [picked, setPicked] = useState<{ destination: string; label: string } | null>(null);
  const pickedLabel = picked && picked.destination === phoneNumber ? picked.label : undefined;

  // Selector-based (not `useCallStore()`) so this component only re-renders
  // when a field it actually reads changes -- not on every call-quality tick
  // (qualityLevel/qualityScore/networkIssueCount update ~1/sec during a call
  // via signalwire.ts's qualitySub). Matches CallScreen.tsx's pattern.
  const isInCall = useCallStore((s) => s.isInCall);
  const isIncoming = useCallStore((s) => s.isIncoming);
  const remoteNumber = useCallStore((s) => s.remoteNumber);
  const isMuted = useCallStore((s) => s.isMuted);
  const isSpeakerOn = useCallStore((s) => s.isSpeakerOn);
  const isVideoCall = useCallStore((s) => s.isVideoCall);
  const isCameraOn = useCallStore((s) => s.isCameraOn);
  const remoteHasVideo = useCallStore((s) => s.remoteHasVideo);
  const callError = useCallStore((s) => s.callError);
  const setCallState = useCallStore((s) => s.setCallState);
  const resetCallState = useCallStore((s) => s.resetCallState);

  const { makeCall, endCall, answerCall, rejectCall, toggleMute, toggleCamera, toggleSpeaker } = useSignalWire();

  const handleKeyInput = (key: string) => {
    if (phoneNumber.length < 128) {  // Long enough for SIP URIs / Fabric addresses
      setPhoneNumber((prev) => prev + key);
    }
  };

  const handleDelete = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleClearAll = () => {
    setPhoneNumber('');
  };

  const handleCall = async () => {
    console.log('📢 handleCall() triggered');
    console.log('Current phoneNumber:', phoneNumber);

    // Prevent multiple simultaneous calls
    if (isCallingInProgress) {
      console.log('⚠️ Call already in progress, ignoring duplicate request');
      return;
    }

    // Empty field + Call, like iOS: fill in the last outbound destination
    // (and whether it was a video call) rather than dialing.
    if (!phoneNumber) {
      const lastOutbound = useRecentsStore.getState().entries.find((entry) => entry.direction === 'outbound');
      if (lastOutbound) {
        console.log('🔄 Populating with last dialed destination:', lastOutbound.destination);
        setPhoneNumber(lastOutbound.destination);
        setWantsVideo(lastOutbound.video);
        setPicked({ destination: lastOutbound.destination, label: lastOutbound.label });
      }
      return;
    }

    // If a number is entered, dial it. SIP URIs and Fabric addresses can be
    // shorter than a phone number, so only phone-number-looking input needs
    // the 7-digit sanity check (digits only -- "555-1234" has 7).
    if (phoneNumber && (isDialAddress(phoneNumber) || countDigits(phoneNumber) >= 7)) {
      console.log('📞 Dialing:', phoneNumber);
      setIsCallingInProgress(true);

      // Immediately set the call state to show the call screen
      // This happens BEFORE the actual call is initiated
      setCallState({
        isInCall: true,
        isIncoming: false,
        remoteNumber: phoneNumber,
        callDirection: 'outbound',
        callStatus: 'connecting',
        isMuted: false,
        isSpeakerOn: false,
        isVideoCall: wantsVideo,
        isCameraOn: wantsVideo,
      });

      try {
        await makeCall(phoneNumber, wantsVideo, pickedLabel);
        console.log('✅ makeCall completed');
      } catch (error) {
        console.error('❌ makeCall failed:', error);
        // Reset state if call fails
        resetCallState();
      } finally {
        // Reset the flag after call attempt completes or fails
        setIsCallingInProgress(false);
      }
    } else {
      console.log('⚠️ Number too short:', phoneNumber?.length || 0, 'digits');
    }
  };

  const handleEndCall = async () => {
    console.log('🔴 handleEndCall called');
    console.log('State before ending - isInCall:', isInCall, 'isIncoming:', isIncoming);

    await endCall();

    // Reset calling flag when call ends
    setIsCallingInProgress(false);

    // Clear the phone number for outgoing calls
    // (callDirection will be 'outbound' for calls we initiated)
    const { callDirection } = useCallStore.getState();
    if (callDirection === 'outbound') {
      setPhoneNumber('');
    }

    console.log('State after ending - isInCall:', useCallStore.getState().isInCall, 'isIncoming:', useCallStore.getState().isIncoming);
  };

  // Handle clearing number when outbound call ends (remote hangup)
  useEffect(() => {
    const handleClearNumber = () => {
      console.log('🗑️ Clearing dialed number after outbound call ended');
      setPhoneNumber('');
      setIsCallingInProgress(false); // Reset calling flag
    };

    window.addEventListener('clearDialedNumber', handleClearNumber);
    return () => window.removeEventListener('clearDialedNumber', handleClearNumber);
  }, []);

  // Enter-to-call, from anywhere on the idle dialer screen (including while
  // the address input is focused, since 'keydown' bubbles up to window).
  // Typing itself is handled by the address input's native onChange, and by
  // DialPad's onKeyPress -- not here, to avoid double-inserting characters.
  // Not from other fields (Enter in the Diagnostics test input would otherwise
  // dial the pad's number) or a focused button (Enter already activates it).
  // Escape closes whichever header panel is open.
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      if (isInCall || isIncoming) return;

      if (e.key === 'Escape') {
        setActiveHeaderPanel(null);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isOtherControl =
        target !== addressInputRef.current && !!target?.closest('input, textarea, select, button');
      if (e.key === 'Enter' && !isOtherControl) {
        handleCall();
      }
    };

    window.addEventListener('keydown', handleKeyboardInput);
    return () => window.removeEventListener('keydown', handleKeyboardInput);
    // Re-bind only when the values the handler gates on change. handleCall is
    // recreated every render, so listing it would re-attach the listener on
    // every render with no behavioral benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneNumber, isInCall, isIncoming]);

  const addressInputValue = isAddressInputFocused ? phoneNumber : formatPhoneNumber(phoneNumber);
  const isDialerShown = !isInCall && !isIncoming;

  // Re-fit on every value change and whenever the input's width changes
  // (rotation, an error banner, the clear button appearing).
  useLayoutEffect(() => {
    const input = addressInputRef.current;
    if (!input) return;
    const fit = () => setAddressFontSize(fitAddressFontSize(input, input.value || input.placeholder));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(input);
    return () => observer.disconnect();
  }, [addressInputValue, isDialerShown]);

  // Show incoming call modal
  if (isIncoming && !isInCall) {
    return (
      <IncomingCall
        phoneNumber={formatPhoneNumber(remoteNumber)}
        isVideoCall={isVideoCall}
        onAnswer={answerCall}
        onReject={rejectCall}
      />
    );
  }

  // Show active call screen
  if (isInCall) {
    return (
      <CallScreen
        phoneNumber={formatPhoneNumber(remoteNumber || phoneNumber)}
        onEndCall={handleEndCall}
        isMuted={isMuted}
        isSpeakerOn={isSpeakerOn}
        isVideoCall={isVideoCall}
        isCameraOn={isCameraOn}
        remoteHasVideo={remoteHasVideo}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
        onToggleCamera={toggleCamera}
      />
    );
  }

  const addressType = getDialAddressType(phoneNumber);
  const addressMeta = DIAL_ADDRESS_META[addressType];
  const AddressIcon = addressMeta.icon;

  // Show dialer
  return (
    <div className="app-shell relative flex flex-col h-dvh">
      {/* Status Bar + header panels. z-30 so the panels (positioned absolutely
          just below the bar) overlay the dial pad instead of pushing it down. */}
      <div className="relative z-30">
        <StatusBar hasIcons>
          {HEADER_PANEL_BUTTONS.map(({ panel, label, icon: Icon }) => {
            const isOpen = activeHeaderPanel === panel;
            return (
              <button
                key={panel}
                type="button"
                onClick={() => toggleHeaderPanel(panel)}
                aria-label={label}
                title={label}
                aria-pressed={isOpen}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white ${
                  isOpen ? 'bg-white/10 text-white' : 'text-gray-400'
                }`}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </StatusBar>

        <div className="absolute inset-x-0 top-full">
          {/* Dims the dial pad behind an open panel; tap outside to close. -z-10
              keeps it under the status bar (inside this z-30 layer) so the header
              icons stay tappable for switching panels. */}
          {activeHeaderPanel && (
            <div className="fixed inset-0 -z-10 bg-black/60" onClick={() => setActiveHeaderPanel(null)} />
          )}

          <SubscriberPicker isOpen={isSubscriberPanelOpen} onClose={() => setActiveHeaderPanel(null)} />

          <DialableResourcesPanel
            isOpen={isResourcesPanelOpen}
            activeTab={resourcesTab}
            onTabChange={setResourcesTab}
            onClose={() => setActiveHeaderPanel(null)}
            onSelectAddress={(path, video, label) => {
              setPhoneNumber(path);
              setWantsVideo(video);
              setPicked(label ? { destination: path, label } : null);
              setActiveHeaderPanel(null);
            }}
          />

          <DevicePicker isOpen={isDevicePickerOpen} onClose={() => setActiveHeaderPanel(null)} />

          <DiagnosticsPanel isOpen={isDiagnosticsPanelOpen} onClose={() => setActiveHeaderPanel(null)} />
        </div>
      </div>

      {/* Main Content Container -- scrolls rather than overlapping if it ever
          outgrows the screen; side-by-side on short (landscape phone) screens. */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto short:flex-row short:items-center">
        {/* To Address Input -- type a number, SIP URI, or Fabric address directly */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 min-[360px]:px-6 short:px-4">
          {/* In this column (not a full-width row above it) so it takes space
              from the address area rather than pushing the dial pad off small
              and landscape screens. */}
          {callError && (
            <ErrorBanner
              message={callError}
              onDismiss={() => setCallState({ callError: null })}
              className="mb-3 w-full"
            />
          )}
          <div
            className={`glass-panel flex w-full max-w-sm items-center gap-2 rounded-2xl px-3 min-[360px]:gap-3 min-[360px]:px-4 py-3 transition-colors ${
              isAddressInputFocused ? 'border-white/25 bg-white/[0.07]' : ''
            }`}
          >
            <span
              title={addressMeta.label}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${addressMeta.badgeClass}`}
            >
              <AddressIcon size={18} />
            </span>

            <input
              ref={addressInputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={addressInputValue}
              onChange={(e) => setPhoneNumber(e.target.value.slice(0, 128))}
              onFocus={() => setIsAddressInputFocused(true)}
              onBlur={() => setIsAddressInputFocused(false)}
              disabled={isInCall || isCallingInProgress}
              placeholder="Number or address"
              aria-label="Number or address"
              style={{ fontSize: addressFontSize }}
              className="w-full min-w-0 bg-transparent font-light text-white outline-hidden border-none placeholder:text-gray-500 disabled:opacity-50"
            />

            {phoneNumber && !isInCall && !isCallingInProgress && (
              <button
                type="button"
                onClick={handleClearAll}
                aria-label="Clear"
                className="-m-1 shrink-0 rounded-full p-2.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            )}

            {/* Shortcut to the Recents tab; takes the Clear button's slot
                while the field is empty. */}
            {!phoneNumber && (
              <button
                type="button"
                onClick={() => {
                  setResourcesTab('recents');
                  setActiveHeaderPanel('resources');
                }}
                aria-label="Recent calls"
                title="Recent calls"
                className="-m-1 shrink-0 rounded-full p-2.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <History size={16} />
              </button>
            )}

            {/* Video toggle -- obeyed by handleCall when placing the next call */}
            <button
              type="button"
              onClick={() => setWantsVideo((prev) => !prev)}
              disabled={isInCall || isCallingInProgress}
              aria-label={wantsVideo ? 'Video call on' : 'Video call off'}
              title={wantsVideo ? 'Video call on' : 'Video call off'}
              aria-pressed={wantsVideo}
              className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                wantsVideo
                  ? 'bg-white text-black border-white'
                  : 'bg-white/6 text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              {wantsVideo ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          </div>

          {/* Dropped while an error is showing: the badge icon already says the
              same thing, and on small phones the banner plus this label push
              the Call button off-screen. */}
          {phoneNumber && !callError && (
            <div className="mt-3 text-xs font-medium uppercase tracking-wider text-gray-500">
              {addressMeta.label}
            </div>
          )}
        </div>

        {/* Dial Pad Container */}
        <div className="pb-6 sm:pb-8 short:flex-1 short:py-2">
          <DialPad
            onKeyPress={handleKeyInput}
            onCall={handleCall}
            onDelete={handleDelete}
            onClearAll={handleClearAll}
            hasNumber={phoneNumber.length > 0}
            disabled={isInCall || isCallingInProgress}
          />
        </div>
      </div>
    </div>
  );
};

export default Dialer;