import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, AtSign, ChevronDown, ChevronUp, History, List, Phone, Slash, SlidersHorizontal, User, Video, VideoOff, X } from 'lucide-react';
import DialPad from './DialPad';
import AppBar from './AppBar';
import CallScreen from './CallScreen';
import IncomingCall from './IncomingCall';
import DialableResourcesPanel, { type ResourceTab } from './DialableResourcesPanel';
import DevicePicker from './DevicePicker';
import DiagnosticsPanel from './DiagnosticsPanel';
import SubscriberPicker from './SubscriberPicker';
import ErrorBanner from './ErrorBanner';
import AddressSuggestions from './AddressSuggestions';
import CodeRef from './CodeRef';
import { useAddressSuggestions, type AddressSuggestion } from '../hooks/useAddressSuggestions';
import { useCallStore } from '../hooks/useCallStore';
import { useDialFieldStore } from '../hooks/useDialFieldStore';
import { useRecentsStore } from '../hooks/useRecentsStore';
import { useSignalWire } from '../hooks/useSignalWire';
import { useWorkbench } from '../hooks/useWorkbench';
import { type DialAddressType, countDigits, formatPhoneNumber, getDialAddressType, isDialAddress } from '../utils/address';
import { log } from '../utils/log';

type HeaderPanel = 'devices' | 'diagnostics' | 'resources' | 'subscriber';

// `label` is the accessible name and tooltip; `short` is the word shown under
// the icon where there's room (the `desk` screen -- tablets and desktop). On
// phones the icons stand alone, which is why they need to be guessable.
const HEADER_PANEL_BUTTONS: Array<{ panel: HeaderPanel; label: string; short: string; icon: typeof Phone }> = [
  { panel: 'devices', label: 'Audio & Video Devices', short: 'Devices', icon: SlidersHorizontal },
  { panel: 'diagnostics', label: 'Diagnostics', short: 'Diagnostics', icon: Activity },
  { panel: 'resources', label: 'Dialable Resources', short: 'Resources', icon: List },
  { panel: 'subscriber', label: 'Subscriber', short: 'Subscriber', icon: User },
];

const DIAL_ADDRESS_META: Record<DialAddressType, { icon: typeof Phone; label: string; badgeClass: string }> = {
  phone: { icon: Phone, label: 'Phone number', badgeClass: 'bg-surface-2 text-muted' },
  sip: { icon: AtSign, label: 'SIP address', badgeClass: 'bg-accent-soft text-accent-text' },
  fabric: { icon: Slash, label: 'Fabric address', badgeClass: 'bg-grass-soft text-grass-text' },
};

// iOS-style auto-shrink: the largest of these sizes at which the value (or the
// placeholder, when empty) fits the input's actual width. Measured rather than
// guessed from the length, so a phone number stays large on a wide screen yet
// still fits a 320px one; SWML/SIP resource addresses (full URLs with a
// `?channel=...` query string) bottom out at the smallest size and scroll.
const ADDRESS_FONT_SIZES_PX = [24, 20, 18, 16, 14, 12];

let measureContext: CanvasRenderingContext2D | null = null;

// Desktop only: the keypad is folded away by default (a tester types or picks
// a destination; the pad is mostly for DTMF once in a call) and the choice
// persists. Phones always show it.
const KEYPAD_PREF_KEY = 'dialer_keypad';

const loadKeypadPref = (): boolean => {
  try {
    return localStorage.getItem(KEYPAD_PREF_KEY) === '1';
  } catch {
    return false;
  }
};

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
  // The field's value, video choice and picked label live in a store so the
  // workbench's Destinations pane -- a sibling, not a child -- can fill them
  // through the same selectAddress path (see useDialFieldStore).
  const phoneNumber = useDialFieldStore((s) => s.phoneNumber);
  const wantsVideo = useDialFieldStore((s) => s.wantsVideo);
  const picked = useDialFieldStore((s) => s.picked);
  const setPhoneNumber = useDialFieldStore((s) => s.setPhoneNumber);
  const appendKey = useDialFieldStore((s) => s.appendKey);
  const deleteLast = useDialFieldStore((s) => s.deleteLast);
  const clearField = useDialFieldStore((s) => s.clear);
  const toggleWantsVideo = useDialFieldStore((s) => s.toggleWantsVideo);
  const selectDestination = useDialFieldStore((s) => s.selectAddress);
  // Non-null inside the desktop workbench (Workbench.tsx): the header panels'
  // contents live in its side panes, so the icons and overlays aren't rendered.
  const workbench = useWorkbench();
  const [isCallingInProgress, setIsCallingInProgress] = useState(false);
  const [isAddressInputFocused, setIsAddressInputFocused] = useState(false);
  const [showKeypad, setShowKeypad] = useState(loadKeypadPref);
  const toggleKeypad = () => {
    setShowKeypad((prev) => {
      try {
        localStorage.setItem(KEYPAD_PREF_KEY, prev ? '0' : '1');
      } catch {
        // Storage unavailable: the choice just doesn't persist.
      }
      return !prev;
    });
  };
  // Suggestions under the field while it has focus and at least two characters
  // (Recents, then the loaded Directory). Picking one fills the field and
  // dismisses the list for that exact value; Escape dismisses it too, until
  // the value changes again. Up/Down move the highlight; Enter on a highlighted
  // row picks it instead of dialing.
  const [suggestionsDismissedFor, setSuggestionsDismissedFor] = useState<string | null>(null);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const suggestions = useAddressSuggestions(phoneNumber, isAddressInputFocused && suggestionsDismissedFor !== phoneNumber);
  const showSuggestions = suggestions.length > 0;
  useEffect(() => setHighlightedSuggestion(-1), [phoneNumber]);
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
  // The picked label counts only while the field still holds that destination
  // (editing it by hand makes the label stale). Passed to makeCall for Recents.
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
  const clientNotice = useCallStore((s) => s.clientNotice);
  const pendingDialClear = useCallStore((s) => s.pendingDialClear);
  const setCallState = useCallStore((s) => s.setCallState);
  const resetCallState = useCallStore((s) => s.resetCallState);

  const { makeCall, endCall, answerCall, rejectCall, toggleMute, toggleCamera, toggleSpeaker } = useSignalWire();

  const handleKeyInput = (key: string) => appendKey(key);
  const handleDelete = () => deleteLast();
  const handleClearAll = () => clearField();

  const handleCall = async () => {
    log.debug('handleCall() triggered');
    log.debug('Current phoneNumber:', phoneNumber);

    // Prevent multiple simultaneous calls
    if (isCallingInProgress) {
      log.debug('Call already in progress, ignoring duplicate request');
      return;
    }

    // Empty field + Call, like iOS: fill in the last outbound destination
    // (and whether it was a video call) rather than dialing.
    if (!phoneNumber) {
      const lastOutbound = useRecentsStore.getState().entries.find((entry) => entry.direction === 'outbound');
      if (lastOutbound) {
        log.debug('Populating with last dialed destination:', lastOutbound.destination);
        selectDestination(lastOutbound.destination, lastOutbound.video, lastOutbound.label);
      }
      return;
    }

    // If a number is entered, dial it. SIP URIs and Fabric addresses can be
    // shorter than a phone number, so only phone-number-looking input needs
    // the 7-digit sanity check (digits only -- "555-1234" has 7).
    if (phoneNumber && (isDialAddress(phoneNumber) || countDigits(phoneNumber) >= 7)) {
      log.debug('Dialing:', phoneNumber);
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
        log.debug('makeCall completed');
      } catch (error) {
        log.error('makeCall failed:', error);
        // Reset state if call fails
        resetCallState();
      } finally {
        // Reset the flag after call attempt completes or fails
        setIsCallingInProgress(false);
      }
    } else {
      log.debug('Number too short:', phoneNumber?.length || 0, 'digits');
    }
  };

  const handleEndCall = async () => {
    await endCall();
    // For an outbound call the hook sets pendingDialClear; the effect below
    // clears the field. The flag is reset here too in case the dial was
    // still in flight (endCall then resolves without a call to tear down).
    setIsCallingInProgress(false);
  };

  // An outbound call ended (hung up here or by the far end): clear the field.
  useEffect(() => {
    if (!pendingDialClear) return;
    clearField();
    setIsCallingInProgress(false);
    setCallState({ pendingDialClear: false });
  }, [pendingDialClear, setCallState, clearField]);

  // Enter-to-call, from anywhere on the idle dialer screen (including while
  // the address input is focused, since 'keydown' bubbles up to window).
  // Typing itself is handled by the address input's native onChange, and by
  // DialPad's onKeyPress -- not here, to avoid double-inserting characters.
  // Not from other fields (Enter in the Diagnostics test input would otherwise
  // dial the pad's number) or a focused button (Enter already activates it).
  // Escape closes whichever header panel is open.
  //
  // The listener is bound once per screen state and reaches handleCall through
  // a ref. handleCall closes over the field value, the video toggle and the
  // picked label, so a copy bound at effect time dialed with stale values --
  // toggling video after typing and pressing Enter placed an audio call.
  const handleCallRef = useRef(handleCall);
  handleCallRef.current = handleCall;
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
        handleCallRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyboardInput);
    return () => window.removeEventListener('keydown', handleKeyboardInput);
  }, [isInCall, isIncoming]);

  const addressInputValue = isAddressInputFocused ? phoneNumber : formatPhoneNumber(phoneNumber);
  const isDialerShown = !isInCall && !isIncoming;

  // A row picked from the resources or subscriber panel: fill the field, sync
  // the video toggle to the channel that was chosen, remember the label for
  // Recents, close the panel. Doesn't auto-dial.
  const selectAddress = (path: string, video: boolean, label?: string) => {
    selectDestination(path, video, label);
    setActiveHeaderPanel(null);
  };

  const pickSuggestion = (suggestion: AddressSuggestion) => {
    selectDestination(suggestion.destination, suggestion.video, suggestion.label);
    setSuggestionsDismissedFor(suggestion.destination);
    setHighlightedSuggestion(-1);
  };

  // Keyboard for the suggestion list. Enter and Escape stop here so the
  // screen-level handlers (Enter-to-call, Escape-closes-panels) don't also act.
  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedSuggestion((index) => (index + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedSuggestion((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (e.key === 'Enter' && highlightedSuggestion >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pickSuggestion(suggestions[highlightedSuggestion]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setSuggestionsDismissedFor(phoneNumber);
    }
  };

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
    <div className={`app-shell relative flex flex-col ${workbench ? 'h-full min-h-0' : 'h-dvh'}`}>
      {/* Top bar + header panels. z-30 so the panels (positioned absolutely
          just below the bar) overlay the dial pad instead of pushing it down.
          Inside the workbench the bar is the workbench's own (Workbench.tsx),
          above all three panes, so the call stage renders none. */}
      <div className="relative z-30">
        {!workbench && (
        <AppBar onIdentityClick={() => toggleHeaderPanel('subscriber')}>
          {HEADER_PANEL_BUTTONS.map(({ panel, label, short, icon: Icon }) => {
            const isOpen = activeHeaderPanel === panel;
            return (
              <button
                key={panel}
                type="button"
                onClick={() => toggleHeaderPanel(panel)}
                aria-label={label}
                title={label}
                aria-pressed={isOpen}
                className={`flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors hover:bg-surface-hover hover:text-ink desk:h-12 desk:w-16 ${
                  isOpen ? 'bg-accent-soft text-accent-text' : 'text-muted'
                }`}
              >
                <Icon size={18} />
                <span aria-hidden className="hidden text-[10px] leading-none desk:block">
                  {short}
                </span>
              </button>
            );
          })}
        </AppBar>
        )}

        {!workbench && (
          <div className="absolute inset-x-0 top-full">
            {/* Dims the dial pad behind an open panel; tap outside to close. -z-10
                keeps it under the status bar (inside this z-30 layer) so the header
                icons stay tappable for switching panels. */}
            {activeHeaderPanel && (
              <div className="fixed inset-0 -z-10 bg-scrim" onClick={() => setActiveHeaderPanel(null)} />
            )}

            <SubscriberPicker
              isOpen={isSubscriberPanelOpen}
              onClose={() => setActiveHeaderPanel(null)}
              onSelectAddress={selectAddress}
            />

            <DialableResourcesPanel
              isOpen={isResourcesPanelOpen}
              activeTab={resourcesTab}
              onTabChange={setResourcesTab}
              onClose={() => setActiveHeaderPanel(null)}
              onSelectAddress={selectAddress}
            />

            <DevicePicker isOpen={isDevicePickerOpen} onClose={() => setActiveHeaderPanel(null)} />

            <DiagnosticsPanel isOpen={isDiagnosticsPanelOpen} onClose={() => setActiveHeaderPanel(null)} />
          </div>
        )}
      </div>

      {/* Main content -- scrolls rather than overlapping if it ever outgrows
          the screen; side-by-side on short (landscape phone) screens. In the
          workbench the stage is top-aligned, like the panes beside it. */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto short:flex-row short:items-center">
        {/* Address field -- type a number, SIP URI, or Fabric address directly */}
        <div
          className={`flex flex-col items-center px-4 py-3 min-[360px]:px-6 short:px-4 ${
            workbench ? 'w-full pt-10' : 'flex-1 justify-center'
          }`}
        >
          {/* In this column (not a full-width row above it) so it takes space
              from the address area rather than pushing the dial pad off small
              and landscape screens. */}
          {callError && (
            <ErrorBanner
              message={callError}
              onDismiss={() => setCallState({ callError: null })}
              className="mb-2 w-full"
            />
          )}
          {clientNotice && (
            <ErrorBanner
              tone="info"
              message={clientNotice}
              onDismiss={() => setCallState({ clientNotice: null })}
              className="mb-2 w-full"
            />
          )}
          <div className="relative w-full max-w-xl">
          <div
            className={`glass-panel flex w-full items-center gap-2 rounded-xl px-3 min-[360px]:gap-3 min-[360px]:px-4 py-3 transition-colors ${
              isAddressInputFocused ? 'border-accent-edge bg-surface' : ''
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
              onChange={(e) => setPhoneNumber(e.target.value)}
              onKeyDown={handleAddressKeyDown}
              onFocus={() => setIsAddressInputFocused(true)}
              onBlur={() => setIsAddressInputFocused(false)}
              disabled={isInCall || isCallingInProgress}
              placeholder="Number or address"
              aria-label="Number or address"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls="address-suggestions"
              aria-activedescendant={highlightedSuggestion >= 0 ? `address-suggestions-${highlightedSuggestion}` : undefined}
              style={{ fontSize: addressFontSize }}
              className="w-full min-w-0 select-text bg-transparent font-display font-medium tracking-tight text-ink outline-hidden border-none placeholder:text-faint disabled:opacity-50"
            />

            {phoneNumber && !isInCall && !isCallingInProgress && (
              <button
                type="button"
                onClick={handleClearAll}
                aria-label="Clear"
                className="-m-1 shrink-0 rounded-full p-2.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
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
                  if (workbench) {
                    workbench.openRecents();
                    return;
                  }
                  setResourcesTab('recents');
                  setActiveHeaderPanel('resources');
                }}
                aria-label="Recent calls"
                title="Recent calls"
                className="-m-1 shrink-0 rounded-full p-2.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <History size={16} />
              </button>
            )}

          </div>

          <AddressSuggestions
            id="address-suggestions"
            suggestions={suggestions}
            highlighted={highlightedSuggestion}
            onPick={pickSuggestion}
            onHover={setHighlightedSuggestion}
          />
          </div>

          {/* The address type, the video choice and Call. The label is dropped
              while an error is showing: the badge icon already says the same
              thing, and on small phones the banner plus the label push the
              keypad down. */}
          <div className="mt-3 flex w-full max-w-xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              {/* No room for it beside Video and Call on 320px phones. */}
              <span className="hidden truncate text-xs font-medium uppercase tracking-wider text-faint min-[360px]:inline">
                {phoneNumber && !callError ? addressMeta.label : ''}
              </span>
              <CodeRef feature="dial" align="left" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Video toggle -- obeyed by handleCall when placing the next call */}
              <button
                type="button"
                onClick={toggleWantsVideo}
                disabled={isInCall || isCallingInProgress}
                aria-label={wantsVideo ? 'Video call on' : 'Video call off'}
                title={wantsVideo ? 'Video call on' : 'Video call off'}
                aria-pressed={wantsVideo}
                className={`flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                  wantsVideo
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-edge-strong bg-surface text-muted hover:bg-surface-hover hover:text-ink'
                }`}
              >
                {wantsVideo ? <Video size={16} /> : <VideoOff size={16} />}
                <span>Video</span>
              </button>
              {/* mousedown is swallowed so the click doesn't take focus from
                  the address input (see DialPad's keepFocus). */}
              <button
                type="button"
                onClick={handleCall}
                onMouseDown={(e) => e.preventDefault()}
                disabled={isInCall || isCallingInProgress}
                aria-label="Call"
                className="flex h-11 items-center gap-2 rounded-lg bg-call px-5 text-sm font-semibold text-on-call shadow-card transition-colors hover:bg-call-hover disabled:opacity-40"
              >
                <Phone size={16} fill="currentColor" />
                <span>Call</span>
              </button>
            </div>
          </div>
        </div>

        {/* First-visit orientation, while there's nothing in the field. */}
        {workbench && !phoneNumber && (
          <p className="mx-auto mb-4 max-w-xl px-4 text-center text-sm text-muted">
            Type a phone number, a SIP URI (<span className="font-mono">sip:user@host</span>) or a Fabric address (
            <span className="font-mono">/public/room</span>), or pick one from Destinations. Typing searches Recents and the
            Directory.
          </p>
        )}

        {/* The keypad: always on phones; folded behind a toggle in the workbench. */}
        {workbench && (
          <button
            type="button"
            onClick={toggleKeypad}
            aria-pressed={showKeypad}
            className="mx-auto mb-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            {showKeypad ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showKeypad ? 'Hide keypad' : 'Show keypad'}
          </button>
        )}
        {(!workbench || showKeypad) && (
          <div className={workbench ? 'px-4 pb-8' : 'px-4 pb-safe sm:pb-8 short:flex-1 short:py-2'}>
            <DialPad
              mode="dial"
              onKeyPress={handleKeyInput}
              onDelete={handleDelete}
              onClearAll={handleClearAll}
              hasNumber={phoneNumber.length > 0}
              disabled={isInCall || isCallingInProgress}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Dialer;