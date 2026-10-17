import React from 'react';
import { Activity, SignalHigh, SignalMedium, SignalLow, SignalZero, AlertTriangle } from 'lucide-react';
import { useCallStore } from '../hooks/useCallStore';

const LEVEL_META: Record<
  'excellent' | 'good' | 'fair' | 'poor' | 'critical',
  { icon: React.ElementType; className: string }
> = {
  excellent: { icon: SignalHigh, className: 'text-ios-green' },
  good: { icon: SignalHigh, className: 'text-ios-green' },
  fair: { icon: SignalMedium, className: 'text-yellow-400' },
  poor: { icon: SignalLow, className: 'text-orange-400' },
  critical: { icon: SignalZero, className: 'text-ios-red' },
};

interface CallQualityBadgeProps {
  onClick?: () => void;
}

// Shown once the call is connected or while media is disrupted (see
// CallScreen). Tapping it opens the call-stats sheet; before the SDK has a
// quality reading it shows a neutral icon so the sheet is reachable from the
// first second.
const CallQualityBadge: React.FC<CallQualityBadgeProps> = ({ onClick }) => {
  const qualityLevel = useCallStore((s) => s.qualityLevel);
  const qualityScore = useCallStore((s) => s.qualityScore);
  const networkIssueCount = useCallStore((s) => s.networkIssueCount);

  const { icon: Icon, className } = qualityLevel
    ? LEVEL_META[qualityLevel]
    : { icon: Activity, className: 'text-gray-400' };
  const title = qualityLevel
    ? `Call quality: ${qualityLevel}${qualityScore != null ? ` (${qualityScore.toFixed(1)}/5)` : ''} — tap for statistics`
    : 'Call statistics';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Call statistics"
      title={title}
      className={`flex h-10 items-center gap-1 rounded-full px-2 transition-colors hover:bg-white/10 ${className}`}
    >
      <Icon size={14} />
      {networkIssueCount > 0 && <AlertTriangle size={11} className="text-yellow-400" />}
    </button>
  );
};

export default CallQualityBadge;
