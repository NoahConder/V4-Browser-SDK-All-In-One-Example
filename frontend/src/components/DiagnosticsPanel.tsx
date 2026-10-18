import React, { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Download, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { LogLevel, PreflightResult } from '@signalwire/js';
import { SheetSection, SheetStat, SheetSwitch } from './SheetPrimitives';
import EventLog from './EventLog';
import { signalWireService } from '../services/signalwire';
import { downloadDiagnostics } from '../services/diagnostics';
import { describeCallError } from '../hooks/useSignalWire';
import { useDialog } from '../hooks/useDialog';
import { LOG_LEVELS, loadSettings, saveSettings, type AudioCodec, type DialerSettings } from '../services/settings';
import { THEME_PREFERENCES, applyTheme, type ThemePreference } from '../services/theme';
import { countDigits, getDialAddressType } from '../utils/address';

const PREFLIGHT_DURATIONS_S = [5, 10, 20];

const CODEC_LABEL: Record<AudioCodec, string> = {
  opus: 'Opus · 48 kHz wideband',
  PCMU: 'PCMU · G.711 µ-law',
  PCMA: 'PCMA · G.711 A-law',
};

const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

const deviceLine = (label: string, ok: boolean, okText: string, badText: string, device: MediaDeviceInfo | null) =>
  `${label}: ${ok ? okText : badText}${device?.label ? ` (${device.label})` : ''}`;

// The tester-facing SDK settings (services/settings.ts), applied live through
// applySettings(): audio codec order, SDK log level, WebSocket tracing,
// relay-only media, this app's debug logs. Rows use the sheet's px-3; the
// parent supplies the section's horizontal margins.
export function SettingsBody() {
  const [settings, setSettings] = useState<DialerSettings>(() => loadSettings());

  const updateSettings = (partial: Partial<DialerSettings>) => {
    const next = saveSettings(partial);
    setSettings(next);
    signalWireService.applySettings(next);
  };

  // Appearance is this app's state, not the SDK's: saved like the others but
  // applied by the theme service, not applySettings().
  const updateTheme = (theme: ThemePreference) => {
    setSettings(saveSettings({ theme }));
    applyTheme(theme);
  };

  const moveCodec = (index: number, delta: -1 | 1) => {
    const order = [...settings.audioCodecOrder];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateSettings({ audioCodecOrder: order });
  };

  return (
    <>
      <SheetSection label="Appearance" />
      <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink">
        <span>
          <span className="block">Theme</span>
          <span className="block text-xs text-faint">System follows your OS; the docs' light and dark looks</span>
        </span>
        <select
          value={settings.theme}
          onChange={(e) => updateTheme(e.target.value as ThemePreference)}
          aria-label="Appearance"
          data-no-autofocus
          className="rounded-lg border border-edge-strong bg-surface-2 px-2 py-1 text-sm text-ink outline-hidden"
        >
          {THEME_PREFERENCES.map((theme) => (
            <option key={theme} value={theme} className="bg-surface text-ink">
              {THEME_LABEL[theme]}
            </option>
          ))}
        </select>
      </label>

      <SheetSection label="SDK Settings" />
      <p className="px-3 pb-2 text-xs text-faint">
        Log settings apply immediately; codec order and relay-only apply to the next call.
      </p>

      <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-faint">Audio codec order</div>
      <ol aria-label="Audio codec order" className="px-3">
        {settings.audioCodecOrder.map((codec, index) => (
          <li key={codec} className="flex items-center justify-between gap-2 py-1 text-sm text-ink">
            <span>
              <span className="mr-2 tabular-nums text-faint">{index + 1}.</span>
              {CODEC_LABEL[codec]}
            </span>
            <span className="flex shrink-0">
              <button
                type="button"
                onClick={() => moveCodec(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${codec} up`}
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveCodec(index, 1)}
                disabled={index === settings.audioCodecOrder.length - 1}
                aria-label={`Move ${codec} down`}
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronDown size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="px-3 pb-2 text-xs text-faint">
        Ranks the codecs this browser offers. Applies to WebRTC and SIP calls; calls to phone numbers use G.711
        (PCMU/PCMA) — SignalWire picks the codec for the carrier, so the order has no effect there.
      </p>

      {/* The selects opt out of useDialog's autofocus (like the test field):
          nothing in the panel wants focus the moment it opens. */}
      <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink">
        <span>SDK log level</span>
        <select
          value={settings.logLevel}
          onChange={(e) => updateSettings({ logLevel: e.target.value as LogLevel })}
          data-no-autofocus
          className="rounded-lg border border-edge-strong bg-surface-2 px-2 py-1 text-sm text-ink outline-hidden"
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level} className="bg-surface text-ink">
              {level}
            </option>
          ))}
        </select>
      </label>
      <SheetSwitch
        label="Log WebSocket traffic"
        hint="Every signaling frame, to the console"
        checked={settings.logWsTraffic}
        onChange={() => updateSettings({ logWsTraffic: !settings.logWsTraffic })}
      />
      <SheetSwitch
        label="Relay only (TURN)"
        hint="Force media through the TURN server"
        checked={settings.relayOnly}
        onChange={() => updateSettings({ relayOnly: !settings.relayOnly })}
      />
      <SheetSwitch
        label="App debug logs"
        hint="This dialer's own console logging"
        checked={settings.debugLogs}
        onChange={() => updateSettings({ debugLogs: !settings.debugLogs })}
      />
    </>
  );
}

// Pre-call network test (client.preflight) with its options and full result.
// Owns the result so it survives the Inspector's tab switches (CLAUDE.md
// records losing a preflight result once already); unmounts with the phone's
// Diagnostics panel like everything else in it.
export function ConnectionTestBody() {
  const [destination, setDestination] = useState('');
  const [skipMediaTest, setSkipMediaTest] = useState(false);
  const [durationS, setDurationS] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The codec order can't influence a call to a phone number (see the note
  // under the codec list), so say so when the test would place one. The digit
  // minimum keeps a half-typed field quiet.
  const testsPhoneNumber =
    !skipMediaTest && countDigits(destination) >= 7 && getDialAddressType(destination.trim()) === 'phone';

  const handleRunTest = async () => {
    const trimmed = destination.trim();
    if (!trimmed) return;

    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const preflightResult = await signalWireService.runPreflight(trimmed, {
        skipMediaTest,
        duration: durationS,
      });
      setResult(preflightResult);
    } catch (err) {
      setError(describeCallError(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <>
      {/* Never prefilled from the dial pad -- unless the media test is
          skipped, this places a real, potentially-billable call to whatever
          address is entered. */}
      <div className="flex gap-2">
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Number or address to test"
          aria-label="Number or address to test"
          disabled={isRunning}
          data-no-autofocus
          className="flex-1 rounded-lg border border-edge-strong bg-surface-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-faint focus:border-accent-edge focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleRunTest}
          disabled={!destination.trim() || isRunning}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : 'Run'}
        </button>
      </div>
      {testsPhoneNumber && (
        <p className="mt-1.5 text-xs text-faint">
          Phone number: the test call uses G.711 (PCMU/PCMA), so the codec order above has no effect on it.
        </p>
      )}

      <div className="-mx-3 mt-1">
        <SheetSwitch
          label="Skip media test"
          hint="Signaling, STUN/TURN and devices only — no test call"
          checked={skipMediaTest}
          onChange={() => setSkipMediaTest((prev) => !prev)}
        />
      </div>
      {!skipMediaTest && (
        <label className="flex items-center justify-between gap-3 py-1 text-sm text-muted">
          <span>Media test length</span>
          <select
            value={durationS}
            onChange={(e) => setDurationS(Number(e.target.value))}
            disabled={isRunning}
            data-no-autofocus
            className="rounded-lg border border-edge-strong bg-surface-2 px-2 py-1 text-sm text-ink outline-hidden"
          >
            {PREFLIGHT_DURATIONS_S.map((seconds) => (
              <option key={seconds} value={seconds} className="bg-surface text-ink">
                {seconds} s
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="mt-2 text-sm text-danger-text">{error}</p>}

      {result && (
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-1.5">
            {result.ok ? (
              <CheckCircle2 size={14} className="text-success-text" />
            ) : (
              <XCircle size={14} className="text-danger-text" />
            )}
            <span className="text-ink">{result.ok ? 'Connection OK' : 'Connection issues found'}</span>
          </div>
          <div className="text-muted">
            Signaling: {result.signaling.reachable ? 'reachable' : 'unreachable'} ({Math.round(result.signaling.rttMs)}ms)
          </div>
          <div className="text-muted">
            Media path: {result.connectivity.type} · STUN {result.connectivity.stunReachable ? 'ok' : 'unreachable'} ·
            TURN {result.connectivity.turnReachable ? 'ok' : 'unreachable'} ({Math.round(result.connectivity.rttMs)}ms)
          </div>
          {result.bandwidth && (
            <div className="text-muted">
              Bandwidth: ↑{Math.round(result.bandwidth.uploadKbps)} / ↓{Math.round(result.bandwidth.downloadKbps)} Kbps
            </div>
          )}
          <div className="text-muted">
            {deviceLine('Mic', result.devices.audioInput.working, 'working', 'not working', result.devices.audioInput.device)}
          </div>
          <div className="text-muted">
            {deviceLine('Camera', result.devices.videoInput.working, 'working', 'not working', result.devices.videoInput.device)}
          </div>
          <div className="text-muted">
            {deviceLine('Speaker', result.devices.audioOutput.available, 'available', 'none', result.devices.audioOutput.device)}
          </div>
          {result.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-warn-text">
              {result.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

// client.exportDiagnostics() as a JSON download (services/diagnostics.ts).
export function ExportDiagnosticsButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={downloadDiagnostics}
      className={`flex w-full items-center gap-2 rounded-lg border border-edge-strong bg-surface-2 px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-hover ${className}`}
    >
      <Download size={14} />
      Export Diagnostics
    </button>
  );
}

// SDK version and the audio codecs this browser offers.
export function SdkFacts() {
  const sdk = signalWireService.getSdkInfo();
  return (
    <>
      <SheetSection label="SDK" />
      <SheetStat label="SDK version" value={sdk.version} />
      <SheetStat label="Browser audio codecs" value={sdk.audioCodecs.length ? sdk.audioCodecs.join(', ') : '—'} />
    </>
  );
}

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// The phone's "Diagnostics & Settings" header panel: settings first (they're
// what gets flipped between calls), then the connection test, the export, the
// in-app event log and the SDK facts. The workbench's Session tab composes the
// same bodies (InspectorPane.tsx).
const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose }) => {
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-title"
      className="glass-panel mx-auto mt-2 max-h-[70dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl px-4 py-3 short:max-h-[calc(100dvh-4.5rem)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span id="diagnostics-title" className="text-xs font-medium uppercase tracking-wider text-muted">
          Diagnostics &amp; Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="-mx-3">
        <SettingsBody />
        <SheetSection label="Test my connection" />
      </div>

      <ConnectionTestBody />

      <ExportDiagnosticsButton className="mt-3" />

      <div className="-mx-3">
        <SheetSection label="Events" />
        <p className="px-3 pb-2 text-xs text-faint">
          What the SDK and this dialer did, newest last. Call Statistics has the live numbers; this is the sequence.
        </p>
        <div className="px-3">
          <EventLog />
        </div>

        <SdkFacts />
      </div>
    </div>
  );
};

export default DiagnosticsPanel;
