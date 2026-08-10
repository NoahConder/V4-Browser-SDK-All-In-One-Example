import React, { useEffect, useState } from 'react';
import { Activity, AtSign, List, Phone, Slash, SlidersHorizontal, User, Video, VideoOff, X } from 'lucide-react';
import DialPad from './DialPad';
import CallScreen from './CallScreen';
import IncomingCall from './IncomingCall';
import DialableResourcesPanel from './DialableResourcesPanel';
import DevicePicker from './DevicePicker';
import DiagnosticsPanel from './DiagnosticsPanel';
import SubscriberPicker from './SubscriberPicker';
import ErrorBanner from './ErrorBanner';
import { useCallStore } from '../hooks/useCallStore';
import { useSignalWire } from '../hooks/useSignalWire';

type DialAddressType = 'phone' | 'sip' | 'fabric';

// SIP URIs (sip:user@domain) and Fabric addresses (/public/room-name) are
// dialed as-is instead of being formatted/validated like a phone number.
// Keep in sync with signalwire.ts's makeCall and backend's is_dial_address().
const getDialAddressType = (value: string): DialAddressType => {
  const trimmed = value.trim();
  if (/^sip:/i.test(trimmed) || trimmed.includes('@')) return 'sip';
  if (trimmed.startsWith('/')) return 'fabric';
  return 'phone';
};

const isDialAddress = (value: string): boolean => getDialAddressType(value) !== 'phone';

const DIAL_ADDRESS_META: Record<DialAddressType, { icon: typeof Phone; label: string; badgeClass: string }> = {
  phone: { icon: Phone, label: 'Phone number', badgeClass: 'bg-white/10 text-gray-300' },
  sip: { icon: AtSign, label: 'SIP address', badgeClass: 'bg-blue-500/15 text-blue-400' },
  fabric: { icon: Slash, label: 'Fabric address', badgeClass: 'bg-purple-500/15 text-purple-400' },
};

// iOS-style auto-shrink: the dial-pad input starts at its normal large size for
// a phone number, then steps down as the value grows past that -- SWML/SIP
// resource addresses (full URLs with a `?channel=...` query string) run far
// longer than any phone number.
const ADDRESS_INPUT_SIZE_STEPS: Array<{ maxLength: number; className: string }> = [
  { maxLength: 18, className: 'text-xl sm:text-2xl' },
  { maxLength: 28, className: 'text-lg sm:text-xl' },
  { maxLength: 40, className: 'text-base sm:text-lg' },
  { maxLength: 60, className: 'text-sm sm:text-base' },
];
const SMALLEST_ADDRESS_INPUT_SIZE = 'text-xs sm:text-sm';

const getAddressInputSizeClass = (value: string): string =>
  ADDRESS_INPUT_SIZE_STEPS.find((step) => value.length <= step.maxLength)?.className ?? SMALLEST_ADDRESS_INPUT_SIZE;

const Dialer: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCallingInProgress, setIsCallingInProgress] = useState(false);
  const [isAddressInputFocused, setIsAddressInputFocused] = useState(false);
  const [wantsVideo, setWantsVideo] = useState(false);
  // Only one header panel (device picker, diagnostics, dialable resources, subscriber
  // picker) may be open at a time -- opening any of them covers the center dial pad,
  // so keep them mutually exclusive instead of letting all four stack.
  const [activeHeaderPanel, setActiveHeaderPanel] = useState<
    'devices' | 'diagnostics' | 'resources' | 'subscriber' | null
  >(null);
  const isDevicePickerOpen = activeHeaderPanel === 'devices';
  const isDiagnosticsPanelOpen = activeHeaderPanel === 'diagnostics';
  const isResourcesPanelOpen = activeHeaderPanel === 'resources';
  const isSubscriberPanelOpen = activeHeaderPanel === 'subscriber';
  const toggleHeaderPanel = (panel: 'devices' | 'diagnostics' | 'resources' | 'subscriber') =>
    setActiveHeaderPanel((prev) => (prev === panel ? null : panel));
  const [lastDialedNumber, setLastDialedNumber] = useState(() => {
    // Load last dialed number from localStorage
    return localStorage.getItem('lastDialedNumber') || '';
  });

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

  // Save last dialed number to localStorage whenever it changes
  useEffect(() => {
    if (lastDialedNumber) {
      localStorage.setItem('lastDialedNumber', lastDialedNumber);
    }
  }, [lastDialedNumber]);

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
    console.log('Last dialed number:', lastDialedNumber);

    // Prevent multiple simultaneous calls
    if (isCallingInProgress) {
      console.log('⚠️ Call already in progress, ignoring duplicate request');
      return;
    }

    // If no number is entered but we have a last dialed number, just populate it
    if (!phoneNumber && lastDialedNumber) {
      console.log('🔄 Populating with last dialed number:', lastDialedNumber);
      setPhoneNumber(lastDialedNumber);
      return; // Don't dial, just populate
    }

    // If a number is entered, dial it. SIP URIs and Fabric addresses can be
    // shorter than a phone number, so only phone-number-looking input needs
    // the length-7 sanity check.
    if (phoneNumber && (isDialAddress(phoneNumber) || phoneNumber.length >= 7)) {
      console.log('📞 Dialing:', phoneNumber);
      setLastDialedNumber(phoneNumber);
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
        await makeCall(phoneNumber, wantsVideo);
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
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      if (isInCall || isIncoming) return;

      if (e.key === 'Enter') {
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

  const formatPhoneNumber = (number: string): string => {
    // SIP URIs and Fabric addresses aren't phone numbers -- display as typed.
    if (isDialAddress(number)) {
      return number;
    }

    // If number starts with +, keep it as international
    if (number.startsWith('+')) {
      return number;
    }

    // Remove all non-digit characters except + at the beginning
    const cleaned = number.replace(/[^\d+]/g, '').replace(/\+(?!^)/g, '');

    // For numbers with only digits
    const digitsOnly = cleaned.replace(/^\+/, '');

    if (digitsOnly.length === 10) {
      return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
    } else if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
      return `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
    }

    // Return as-is for other formats (including * and #)
    return number;
  };

  // Show incoming call modal
  if (isIncoming && !isInCall) {
    return (
      <IncomingCall
        phoneNumber={remoteNumber}
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
        phoneNumber={remoteNumber || phoneNumber}
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
  const addressInputValue = isAddressInputFocused ? phoneNumber : formatPhoneNumber(phoneNumber);

  // Show dialer
  return (
    <div className="app-shell relative flex flex-col h-screen">
      {/* Status Bar */}
      <div className="glass-bar relative flex items-center justify-between px-6 py-2 text-sm">
        <span className="text-ios-green">●</span>
        <span className="absolute left-1/2 transform -translate-x-1/2 font-medium tracking-wide text-gray-400">SignalWire</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleHeaderPanel('devices')}
            aria-label="Audio & Video Devices"
            aria-pressed={isDevicePickerOpen}
            className={`rounded-full p-1 transition-colors hover:bg-white/10 hover:text-white ${
              isDevicePickerOpen ? 'text-white' : 'text-gray-400'
            }`}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            type="button"
            onClick={() => toggleHeaderPanel('diagnostics')}
            aria-label="Diagnostics"
            aria-pressed={isDiagnosticsPanelOpen}
            className={`rounded-full p-1 transition-colors hover:bg-white/10 hover:text-white ${
              isDiagnosticsPanelOpen ? 'text-white' : 'text-gray-400'
            }`}
          >
            <Activity size={16} />
          </button>
          <button
            type="button"
            onClick={() => toggleHeaderPanel('resources')}
            aria-label="Dialable Resources"
            aria-pressed={isResourcesPanelOpen}
            className={`rounded-full p-1 transition-colors hover:bg-white/10 hover:text-white ${
              isResourcesPanelOpen ? 'text-white' : 'text-gray-400'
            }`}
          >
            <List size={16} />
          </button>
          <button
            type="button"
            onClick={() => toggleHeaderPanel('subscriber')}
            aria-label="Subscriber"
            aria-pressed={isSubscriberPanelOpen}
            className={`rounded-full p-1 transition-colors hover:bg-white/10 hover:text-white ${
              isSubscriberPanelOpen ? 'text-white' : 'text-gray-400'
            }`}
          >
            <User size={16} />
          </button>
          <span className="text-gray-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      <SubscriberPicker isOpen={isSubscriberPanelOpen} onClose={() => setActiveHeaderPanel(null)} />

      <DialableResourcesPanel
        isOpen={isResourcesPanelOpen}
        onClose={() => setActiveHeaderPanel(null)}
        onSelectAddress={(path, video) => {
          setPhoneNumber(path);
          setWantsVideo(video);
          setActiveHeaderPanel(null);
        }}
      />

      <DevicePicker isOpen={isDevicePickerOpen} onClose={() => setActiveHeaderPanel(null)} />

      <DiagnosticsPanel isOpen={isDiagnosticsPanelOpen} onClose={() => setActiveHeaderPanel(null)} />

      {callError && (
        <ErrorBanner message={callError} onDismiss={() => setCallState({ callError: null })} />
      )}

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* To Address Input -- type a number, SIP URI, or Fabric address directly */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 min-h-0">
          <div
            className={`glass-panel flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 transition-colors ${
              isAddressInputFocused ? 'border-white/25 bg-white/[0.07]' : ''
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${addressMeta.badgeClass}`}>
              <AddressIcon size={18} />
            </span>

            <input
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
              className={`w-full min-w-0 bg-transparent font-light text-white outline-none border-none placeholder:text-gray-500 disabled:opacity-50 ${getAddressInputSizeClass(addressInputValue)}`}
            />

            {phoneNumber && !isInCall && !isCallingInProgress && (
              <button
                type="button"
                onClick={handleClearAll}
                aria-label="Clear"
                className="shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            )}

            {/* Video toggle -- obeyed by handleCall when placing the next call */}
            <button
              type="button"
              onClick={() => setWantsVideo((prev) => !prev)}
              disabled={isInCall || isCallingInProgress}
              aria-label={wantsVideo ? 'Video call on' : 'Video call off'}
              aria-pressed={wantsVideo}
              className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                wantsVideo
                  ? 'bg-white text-black border-white'
                  : 'bg-white/[0.06] text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              {wantsVideo ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          </div>

          {phoneNumber && (
            <div className="mt-3 text-xs font-medium uppercase tracking-wider text-gray-500">
              {addressMeta.label}
            </div>
          )}
        </div>

        {/* Dial Pad Container */}
        <div className="pb-6 sm:pb-8">
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