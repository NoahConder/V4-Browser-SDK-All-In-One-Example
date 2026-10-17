import { useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Trash2, Video } from 'lucide-react';
import { useRecentsStore, type RecentCall } from '../hooks/useRecentsStore';
import { useCallStore } from '../hooks/useCallStore';
import { getDialAddressType } from '../utils/address';

interface RecentsListProps {
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
}

const OUTCOME_LABEL: Record<RecentCall['outcome'], string> = {
  'in-progress': 'In progress',
  answered: 'Answered',
  missed: 'Missed',
  declined: 'Declined',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const relativeTime = (timestamp: number): string => {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

const durationOf = (entry: RecentCall): string | null => {
  if (!entry.connectedAt || !entry.endedAt) return null;
  const seconds = Math.max(0, Math.round((entry.endedAt - entry.connectedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// A picked address URL remembers its channel (`?channel=video`); redialing
// as audio must not quietly keep the video channel.
const asAudioDestination = (destination: string): string =>
  destination.replace(/([?&])channel=[^&]*/i, '$1channel=audio');

const DIAL_BUTTON_CLASS =
  'flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-medium text-gray-200 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/2 disabled:text-gray-600 disabled:hover:bg-white/2';

// Calls made and received in this browser (useRecentsStore), newest first,
// each redialable as audio or video.
function RecentsList({ onSelectAddress }: RecentsListProps) {
  const entries = useRecentsStore((s) => s.entries);
  const clear = useRecentsStore((s) => s.clear);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const [confirmClear, setConfirmClear] = useState(false);

  if (entries.length === 0) {
    return <div className="py-4 text-sm text-gray-400">No recent calls.</div>;
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const missed = entry.outcome === 'missed';
        const Icon = entry.direction === 'outbound' ? PhoneOutgoing : missed ? PhoneMissed : PhoneIncoming;
        // Video only makes sense for Fabric/SIP destinations, not PSTN.
        const canVideo = getDialAddressType(entry.destination) !== 'phone';
        const duration = durationOf(entry);
        const details = [
          relativeTime(entry.startedAt),
          OUTCOME_LABEL[entry.outcome],
          duration,
          entry.subscriberName && entry.subscriberName !== activeSubscriberName ? `as ${entry.subscriberName}` : null,
          entry.reattached ? 'reattached' : null,
        ]
          .filter(Boolean)
          .join(' · ');

        return (
          <div key={entry.id} className="rounded-lg px-2 py-2 transition-colors hover:bg-white/6">
            <div className="mb-1.5 flex items-start gap-2">
              <Icon size={14} className={`mt-0.5 shrink-0 ${missed ? 'text-ios-red' : 'text-gray-400'}`} />
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`truncate text-sm font-medium ${missed ? 'text-ios-red' : 'text-white'}`}>
                    {entry.label}
                  </span>
                  {entry.video && <Video size={12} className="shrink-0 text-gray-400" aria-label="Video call" />}
                </span>
                <span className="block truncate text-xs text-gray-500">{details}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSelectAddress(asAudioDestination(entry.destination), false, entry.label)}
                className={DIAL_BUTTON_CLASS}
              >
                <Phone size={13} /> Audio
              </button>
              <button
                type="button"
                onClick={() => canVideo && onSelectAddress(entry.destination, true, entry.label)}
                disabled={!canVideo}
                aria-label="Dial with video"
                className={DIAL_BUTTON_CLASS}
              >
                <Video size={13} /> Video
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => {
          if (confirmClear) {
            clear();
            setConfirmClear(false);
          } else {
            setConfirmClear(true);
          }
        }}
        onBlur={() => setConfirmClear(false)}
        className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium transition-colors hover:bg-white/10 ${
          confirmClear ? 'text-red-300' : 'text-gray-400 hover:text-white'
        }`}
      >
        <Trash2 size={13} /> {confirmClear ? 'Tap again to clear all' : 'Clear recents'}
      </button>
    </div>
  );
}

export default RecentsList;
