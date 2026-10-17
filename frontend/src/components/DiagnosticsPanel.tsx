import React, { useState } from 'react';
import { Wifi, Loader2, CheckCircle2, XCircle, Download, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { LogLevel, PreflightResult } from '@signalwire/js';
import { SheetSection, SheetStat, SheetSwitch } from './SheetPrimitives';
import { signalWireService } from '../services/signalwire';
import { downloadDiagnostics } from '../services/diagnostics';
import { describeCallError } from '../hooks/useSignalWire';
import { useDialog } from '../hooks/useDialog';
import { LOG_LEVELS, loadSettings, saveSettings, type AudioCodec, type DialerSettings } from '../services/settings';

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PREFLIGHT_DURATIONS_S = [5, 10, 20];

const CODEC_LABEL: Record<AudioCodec, string> = {
  opus: 'Opus · 48 kHz wideband',
  PCMU: 'PCMU · G.711 µ-law',
  PCMA: 'PCMA · G.711 A-law',
};

const deviceLine = (label: string, ok: boolean, okText: string, badText: string, device: MediaDeviceInfo | null) =>
  `${label}: ${ok ? okText : badText}${device?.label ? ` (${device.label})` : ''}`;

// Pre-call network test (client.preflight) with its options and full result,
// SDK session export, and the tester-facing SDK settings (services/settings.ts).
const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose }) => {
  const [destination, setDestination] = useState('');
  const [skipMediaTest, setSkipMediaTest] = useState(false);
  const [durationS, setDurationS] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DialerSettings>(() => loadSettings());
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  const updateSettings = (partial: Partial<DialerSettings>) => {
    const next = saveSettings(partial);
    setSettings(next);
    signalWireService.applySettings(next);
  };

  const moveCodec = (index: number, delta: -1 | 1) => {
    const order = [...settings.audioCodecOrder];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateSettings({ audioCodecOrder: order });
  };

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

  const sdk = signalWireService.getSdkInfo();

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-title"
      className="glass-panel mx-auto mt-2 max-h-[70dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-4 py-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <span id="diagnostics-title" className="text-xs font-medium uppercase tracking-wider text-gray-400">
          Diagnostics &amp; Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Wifi size={13} />
          Test My Connection
        </div>
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
            className="flex-1 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-hidden placeholder:text-gray-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleRunTest}
            disabled={!destination.trim() || isRunning}
            className="shrink-0 rounded-xl bg-linear-to-b from-emerald-400 to-ios-green px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : 'Run'}
          </button>
        </div>

        <div className="-mx-3 mt-1">
          <SheetSwitch
            label="Skip media test"
            hint="Signaling, STUN/TURN and devices only — no test call"
            checked={skipMediaTest}
            onChange={() => setSkipMediaTest((prev) => !prev)}
          />
        </div>
        {!skipMediaTest && (
          <label className="flex items-center justify-between gap-3 py-1 text-sm text-gray-300">
            <span>Media test length</span>
            <select
              value={durationS}
              onChange={(e) => setDurationS(Number(e.target.value))}
              disabled={isRunning}
              className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-sm text-white outline-hidden"
            >
              {PREFLIGHT_DURATIONS_S.map((seconds) => (
                <option key={seconds} value={seconds} className="bg-neutral-900">
                  {seconds} s
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        {result && (
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center gap-1.5">
              {result.ok ? (
                <CheckCircle2 size={14} className="text-ios-green" />
              ) : (
                <XCircle size={14} className="text-ios-red" />
              )}
              <span className="text-white">{result.ok ? 'Connection OK' : 'Connection issues found'}</span>
            </div>
            <div className="text-gray-400">
              Signaling: {result.signaling.reachable ? 'reachable' : 'unreachable'} ({Math.round(result.signaling.rttMs)}ms)
            </div>
            <div className="text-gray-400">
              Media path: {result.connectivity.type} · STUN {result.connectivity.stunReachable ? 'ok' : 'unreachable'} ·
              TURN {result.connectivity.turnReachable ? 'ok' : 'unreachable'} ({Math.round(result.connectivity.rttMs)}ms)
            </div>
            {result.bandwidth && (
              <div className="text-gray-400">
                Bandwidth: ↑{Math.round(result.bandwidth.uploadKbps)} / ↓{Math.round(result.bandwidth.downloadKbps)} Kbps
              </div>
            )}
            <div className="text-gray-400">
              {deviceLine('Mic', result.devices.audioInput.working, 'working', 'not working', result.devices.audioInput.device)}
            </div>
            <div className="text-gray-400">
              {deviceLine('Camera', result.devices.videoInput.working, 'working', 'not working', result.devices.videoInput.device)}
            </div>
            <div className="text-gray-400">
              {deviceLine('Speaker', result.devices.audioOutput.available, 'available', 'none', result.devices.audioOutput.device)}
            </div>
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-4 text-yellow-400">
                {result.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={downloadDiagnostics}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
      >
        <Download size={14} />
        Export Diagnostics
      </button>

      <div className="-mx-3">
        <SheetSection label="SDK Settings" />
        <p className="px-3 pb-2 text-xs text-gray-500">
          Log settings apply immediately; codec order and relay-only apply to the next call.
        </p>

        <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-gray-500">Audio codec order</div>
        <ol aria-label="Audio codec order" className="px-3">
          {settings.audioCodecOrder.map((codec, index) => (
            <li key={codec} className="flex items-center justify-between gap-2 py-1 text-sm text-white">
              <span>
                <span className="mr-2 tabular-nums text-gray-500">{index + 1}.</span>
                {CODEC_LABEL[codec]}
              </span>
              <span className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => moveCodec(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${codec} up`}
                  className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => moveCodec(index, 1)}
                  disabled={index === settings.audioCodecOrder.length - 1}
                  aria-label={`Move ${codec} down`}
                  className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>

        <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-white">
          <span>SDK log level</span>
          <select
            value={settings.logLevel}
            onChange={(e) => updateSettings({ logLevel: e.target.value as LogLevel })}
            className="rounded-lg border border-white/10 bg-white/6 px-2 py-1 text-sm text-white outline-hidden"
          >
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level} className="bg-neutral-900">
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
        <SheetStat label="SDK version" value={sdk.version} />
        <SheetStat label="Browser audio codecs" value={sdk.audioCodecs.length ? sdk.audioCodecs.join(', ') : '—'} />
      </div>
    </div>
  );
};

export default DiagnosticsPanel;
