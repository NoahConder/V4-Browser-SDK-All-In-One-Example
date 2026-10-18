import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { NetworkIssue, NetworkMetrics, RecoveryEvent } from '@signalwire/js';
import { SheetRow, SheetSection, SheetShell, SheetStat } from './SheetPrimitives';
import { useCallStore } from '../hooks/useCallStore';
import { signalWireService, type ConnectionStatsSnapshot } from '../services/signalwire';

interface CallStatsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestIceRestart: () => void;
}

const STATS_POLL_MS = 2000;
const DASH = '—';

const formatBytes = (bytes: number): string => {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const formatClock = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Audio packet loss as a percentage -- over all packets so far, or over the
// difference between two samples (the SDK's counters are cumulative).
const lossPercent = (lost: number, received: number): number | null => {
  const total = lost + received;
  return total > 0 ? (lost / total) * 100 : null;
};

const CANDIDATE_TYPE_LABEL: Record<string, string> = {
  host: 'host (direct)',
  srflx: 'srflx (STUN)',
  prflx: 'prflx (peer reflexive)',
  relay: 'relay (TURN)',
};

const ISSUE_LABEL: Record<NetworkIssue['type'], string> = {
  no_inbound_audio: 'No inbound audio',
  no_inbound_video: 'No inbound video',
  high_rtt: 'RTT spike',
  high_jitter: 'Jitter spike',
  high_packet_loss: 'Packet loss',
  ice_disconnected: 'ICE disconnected',
};

// The SDK reports value/threshold in ms for RTT, jitter and the no-media
// timers, and as a percentage for loss.
const formatIssueValue = (issue: NetworkIssue, value: number): string =>
  issue.type === 'high_packet_loss' ? `${value.toFixed(1)}%` : `${Math.round(value)} ms`;

// "Jitter spike · warning · 9 ms (threshold 8 ms)"
const describeIssue = (issue: NetworkIssue): string => {
  const parts = [ISSUE_LABEL[issue.type] ?? issue.type, issue.severity];
  if (issue.value != null) {
    const threshold = issue.threshold != null ? ` (threshold ${formatIssueValue(issue, issue.threshold)})` : '';
    parts.push(`${formatIssueValue(issue, issue.value)}${threshold}`);
  }
  return parts.join(' · ');
};

// Live call statistics for testers: the SDK's network metrics (RTT, jitter,
// loss, bandwidth estimate) and active network issues, the negotiated codecs
// and ICE path from
// getStats(), the SDK's recovery state and recent recovery events, and the
// call id. Opened from the quality badge or the More sheet.
//
// Subscribes to the per-second metrics and polls getStats() itself, and only
// while open -- component-local rather than via the store, so nothing else
// re-renders on every tick (see CLAUDE.md's subscription-placement note).
const CallStatsSheet: React.FC<CallStatsSheetProps> = ({ isOpen, onClose, onRequestIceRestart }) => {
  const [metrics, setMetrics] = useState<NetworkMetrics[]>([]);
  const [issues, setIssues] = useState<NetworkIssue[]>([]);
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionStatsSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const qualityLevel = useCallStore((s) => s.qualityLevel);
  const qualityScore = useCallStore((s) => s.qualityScore);
  const recoveryState = useCallStore((s) => s.recoveryState);

  useEffect(() => {
    if (!isOpen) return;
    const subs = [
      signalWireService.getNetworkMetrics$().subscribe(setMetrics),
      signalWireService.getNetworkIssues$().subscribe(setIssues),
      // Replays the call's recent events, then streams new ones.
      signalWireService.getRecoveryEvents$().subscribe((event) => setEvents((prev) => [...prev.slice(-9), event])),
    ];
    let cancelled = false;
    const poll = async () => {
      const snapshot = await signalWireService.getConnectionStats().catch(() => null);
      if (!cancelled) setConnection(snapshot);
    };
    void poll();
    const interval = setInterval(poll, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      subs.forEach((sub) => sub.unsubscribe());
      setEvents([]);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const previous = metrics.length > 1 ? metrics[metrics.length - 2] : null;
  const totalLoss = latest ? lossPercent(latest.audio.packetsLost, latest.audio.packetsReceived) : null;
  const recentLoss =
    latest && previous
      ? lossPercent(
          latest.audio.packetsLost - previous.audio.packetsLost,
          latest.audio.packetsReceived - previous.audio.packetsReceived,
        )
      : null;
  const callId = signalWireService.getCurrentCallId();
  const pair = connection?.candidatePair ?? null;
  const videoCodec = connection ? connection.videoOutboundCodec ?? connection.videoInboundCodec : null;
  const isRecoveryBusy = recoveryState === 'debouncing' || recoveryState === 'recovering';

  const copyCallId = async () => {
    if (!callId) return;
    try {
      await navigator.clipboard.writeText(callId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the value is selectable.
    }
  };

  return (
    <SheetShell title="Call Statistics" onClose={onClose}>
      <SheetSection label="Network" />
      <SheetStat
        label="Quality"
        value={
          qualityLevel ? `${qualityLevel}${qualityScore != null ? ` · ${qualityScore.toFixed(1)} / 5` : ''}` : DASH
        }
        hint="SDK MOS from RTT, jitter and loss over the whole call"
      />
      <SheetStat label="Round-trip time" value={latest ? `${Math.round(latest.roundTripTime)} ms` : DASH} />
      <SheetStat label="Audio jitter" value={latest ? `${Math.round(latest.audio.jitter)} ms` : DASH} />
      <SheetStat
        label="Audio packet loss"
        value={
          totalLoss != null
            ? `${totalLoss.toFixed(1)}% total${recentLoss != null ? ` · ${recentLoss.toFixed(1)}% recent` : ''}`
            : DASH
        }
        hint="Over the whole call, and over the last sample interval"
      />
      <SheetStat
        label="Send bandwidth"
        value={
          latest?.availableOutgoingBitrate != null ? `${Math.round(latest.availableOutgoingBitrate / 1000)} kbps` : DASH
        }
        hint="Browser estimate of available outgoing bitrate"
      />
      <SheetStat
        label="Health"
        value={issues.length === 0 ? 'Healthy' : `Degraded · ${issues.length} issue${issues.length === 1 ? '' : 's'}`}
        hint="SDK issue detector: spikes vs. the first 10 s, per-second loss, stalled inbound media — so it can disagree with Quality"
      />
      {issues.length > 0 && (
        <ul className="px-3 pb-1 text-xs text-gray-400">
          {issues.map((issue) => (
            <li key={issue.type} className="truncate select-text">
              {describeIssue(issue)}
            </li>
          ))}
        </ul>
      )}

      <SheetSection label="Transport" />
      <SheetStat
        label="Audio codec"
        value={connection?.audioOutboundCodec ?? connection?.audioInboundCodec ?? DASH}
        hint="Negotiated audio codec (outbound, else inbound)"
      />
      {videoCodec && <SheetStat label="Video codec" value={videoCodec} />}
      <SheetStat
        label="ICE path"
        value={
          pair
            ? `${CANDIDATE_TYPE_LABEL[pair.localType] ?? pair.localType} → ${
                CANDIDATE_TYPE_LABEL[pair.remoteType] ?? pair.remoteType
              }`
            : DASH
        }
        hint="Selected local → remote candidate types; relay means media goes through TURN"
      />
      <SheetStat
        label="Protocol"
        value={
          pair
            ? `${pair.protocol ?? DASH}${pair.relayProtocol ? ` via ${pair.relayProtocol}` : ''}${
                pair.currentRoundTripTimeMs != null ? ` · ${pair.currentRoundTripTimeMs} ms` : ''
              }`
            : DASH
        }
      />
      <SheetStat
        label="Data"
        value={connection ? `↑ ${formatBytes(connection.bytesSent)} · ↓ ${formatBytes(connection.bytesReceived)}` : DASH}
      />

      <SheetSection label="Recovery" />
      <SheetStat label="State" value={recoveryState} hint="SDK CallRecoveryManager state" />
      {events.length > 0 && (
        <ul className="px-3 pb-1 text-xs text-gray-400">
          {events.map((event, i) => (
            <li key={`${event.timestamp}-${i}`} className="truncate select-text">
              <span className="tabular-nums text-gray-500">{formatClock(event.timestamp)}</span> {event.action}
              {event.attempt != null ? ` (${event.attempt}/${event.maxAttempts})` : ''} — {event.reason}
            </li>
          ))}
        </ul>
      )}
      <SheetRow
        icon={RefreshCw}
        label={isRecoveryBusy ? 'Recovery in progress…' : 'Request ICE Restart'}
        disabled={isRecoveryBusy}
        onClick={() => {
          onRequestIceRestart();
          onClose();
        }}
      />

      <SheetSection label="Call" />
      <SheetStat label="Call ID" value={copied ? 'Copied' : (callId ?? DASH)} onCopy={callId ? copyCallId : undefined} />
    </SheetShell>
  );
};

export default CallStatsSheet;
