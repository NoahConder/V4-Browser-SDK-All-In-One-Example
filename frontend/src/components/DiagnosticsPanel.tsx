import React, { useState } from 'react';
import { Wifi, Loader2, CheckCircle2, XCircle, Download, X } from 'lucide-react';
import { signalWireService } from '../services/signalwire';
import { downloadDiagnostics } from '../services/diagnostics';
import { describeCallError } from '../hooks/useSignalWire';
import type { PreflightResult } from '@signalwire/js';

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose }) => {
  const [destination, setDestination] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRunTest = async () => {
    const trimmed = destination.trim();
    if (!trimmed) return;

    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const preflightResult = await signalWireService.runPreflight(trimmed);
      setResult(preflightResult);
    } catch (err) {
      setError(describeCallError(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="glass-panel mx-auto mt-2 max-h-80 w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Diagnostics</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
          <Wifi size={13} />
          Test My Connection
        </div>
        {/* Never prefilled from the dial pad -- this places a real,
            potentially-billable call to whatever address is entered. */}
        <div className="flex gap-2">
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Number or address to test"
            disabled={isRunning}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleRunTest}
            disabled={!destination.trim() || isRunning}
            className="shrink-0 rounded-xl bg-gradient-to-b from-emerald-400 to-ios-green px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : 'Run'}
          </button>
        </div>

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
              Media path: {result.connectivity.type} (TURN {result.connectivity.turnReachable ? 'ok' : 'unreachable'})
            </div>
            {result.bandwidth && (
              <div className="text-gray-400">
                Bandwidth: ↑{Math.round(result.bandwidth.uploadKbps)} / ↓{Math.round(result.bandwidth.downloadKbps)} Kbps
              </div>
            )}
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
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
      >
        <Download size={14} />
        Export Diagnostics
      </button>
    </div>
  );
};

export default DiagnosticsPanel;
