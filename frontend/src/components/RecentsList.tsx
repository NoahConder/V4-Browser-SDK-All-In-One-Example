import { useState } from 'react';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Trash2, Video } from 'lucide-react';
import { DialButtons } from './ResourceAddressList';
import SearchField from './SearchField';
import { useRecentsStore, type RecentCall } from '../hooks/useRecentsStore';
import { useCallStore } from '../hooks/useCallStore';
import { getDialAddressType } from '../utils/address';
import { matchStatus, normalizeQuery } from '../utils/search';

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

// Label and destination substrings; a needle made only of digits and phone
// punctuation also matches the destination's digits, so "555 123" finds
// (555) 123-4567.
const matchesRecent = (entry: RecentCall, needle: string): boolean => {
  if (entry.label.toLowerCase().includes(needle) || entry.destination.toLowerCase().includes(needle)) return true;
  const digits = needle.replace(/\D/g, '');
  return digits.length > 0 && /^[\d\s()+.-]*$/.test(needle) && entry.destination.replace(/\D/g, '').includes(digits);
};

// Calls made and received in this browser (useRecentsStore), newest first,
// each redialable as audio or video.
function RecentsList({ onSelectAddress }: RecentsListProps) {
  const entries = useRecentsStore((s) => s.entries);
  const clear = useRecentsStore((s) => s.clear);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState('');

  if (entries.length === 0) {
    return <div className="py-4 text-sm text-gray-400">No recent calls.</div>;
  }

  const needle = normalizeQuery(query);
  const visible = needle ? entries.filter((entry) => matchesRecent(entry, needle)) : entries;

  return (
    <div className="space-y-1">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search recents"
        status={needle ? matchStatus(visible.length) : ''}
      />
      {visible.length === 0 && (
        <div className="py-4 text-sm text-gray-400">No matches for &quot;{query.trim()}&quot;.</div>
      )}
      {visible.map((entry) => {
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

            <DialButtons
              audioPath={asAudioDestination(entry.destination)}
              videoPath={canVideo ? entry.destination : null}
              label={entry.label}
              onSelectAddress={onSelectAddress}
            />
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
