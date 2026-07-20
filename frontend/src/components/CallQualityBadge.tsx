import React from 'react';
import { SignalHigh, SignalMedium, SignalLow, SignalZero, AlertTriangle } from 'lucide-react';
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

// Shown only once callStatus === 'connected' (see CallScreen) -- quality
// observables have nothing meaningful to report before then.
const CallQualityBadge: React.FC = () => {
  const qualityLevel = useCallStore((s) => s.qualityLevel);
  const qualityScore = useCallStore((s) => s.qualityScore);
  const networkIssueCount = useCallStore((s) => s.networkIssueCount);

  if (!qualityLevel) return null;

  const { icon: Icon, className } = LEVEL_META[qualityLevel];

  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      title={`Call quality: ${qualityLevel}${qualityScore != null ? ` (${qualityScore.toFixed(1)}/5)` : ''}`}
    >
      <Icon size={14} />
      {networkIssueCount > 0 && <AlertTriangle size={11} className="text-yellow-400" />}
    </span>
  );
};

export default CallQualityBadge;
