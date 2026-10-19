import React, { useEffect, useState } from 'react';
import { Loader2, Phone, Server } from 'lucide-react';
import { SheetRow, SheetSection, SheetShell } from './SheetPrimitives';
import { useCallerIdStore } from '../hooks/useCallerIdStore';
import { callerIdsAPI, describeFetchError } from '../services/api';
import type { CallerId } from '../types';
import { formatPhoneNumber } from '../utils/address';

interface CallerIdSheetProps {
  onClose: () => void;
}

// A verified caller ID's name defaults to its own number on the server; that
// isn't a name worth showing twice.
const digitsOf = (value: string) => value.replace(/\D/g, '');
const nameOf = (item: CallerId): string | null =>
  item.name && digitsOf(item.name) !== digitsOf(item.number) ? item.name : null;

// A source the backend couldn't list, in the words a tester reads.
const SOURCE_LABELS: Record<string, string> = {
  numbers: 'phone numbers',
  verified: 'verified caller IDs',
};

// The Caller ID picker: Default (the server chooses), then the space's phone
// numbers and its verified caller IDs -- the two things SignalWire accepts as
// the caller ID of a call to a phone number, so there is no free-text entry.
// Fetched when the sheet opens (it is mounted only while open; the backend
// caches the listing for a minute). A source the backend couldn't list is
// named in a note under the rows it did get, so a token without the Numbers
// scope still shows the verified caller IDs.
const CallerIdSheet: React.FC<CallerIdSheetProps> = ({ onClose }) => {
  const callerId = useCallerIdStore((s) => s.callerId);
  const setCallerId = useCallerIdStore((s) => s.setCallerId);
  const [items, setItems] = useState<CallerId[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError(null);
    callerIdsAPI
      .list()
      .then((page) => {
        if (!isCurrent) return;
        setItems(page.items);
        setFailed(page.failed);
      })
      .catch((err: unknown) => {
        if (!isCurrent) return;
        setError(describeFetchError(err, 'Failed to load caller IDs'));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  const pick = (value: string | null, name: string | null = null) => {
    setCallerId(value, name);
    onClose();
  };

  const numbers = items.filter((item) => item.kind === 'number');
  const verified = items.filter((item) => item.kind === 'verified');

  const rowsFor = (list: CallerId[]) =>
    list.map((item) => (
      <SheetRow
        key={item.id}
        icon={Phone}
        label={formatPhoneNumber(item.number)}
        hint={nameOf(item) ?? undefined}
        active={callerId === item.number}
        onClick={() => pick(item.number, nameOf(item))}
      />
    ));

  return (
    <SheetShell title="Caller ID" onClose={onClose}>
      <SheetRow icon={Server} label="Default (server chooses)" active={callerId === null} onClick={() => pick(null)} />
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading caller IDs...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 px-3 py-4 text-sm text-danger-text">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="shrink-0 rounded-full border border-edge-strong bg-surface-2 px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            Retry
          </button>
        </div>
      )}
      {!isLoading && !error && (
        <>
          {numbers.length > 0 && (
            <>
              <SheetSection label="Phone numbers" />
              {rowsFor(numbers)}
            </>
          )}
          {verified.length > 0 && (
            <>
              <SheetSection label="Verified caller IDs" />
              {rowsFor(verified)}
            </>
          )}
          {items.length === 0 && failed.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted">This space has no phone numbers or verified caller IDs yet.</p>
          )}
          {failed.length > 0 && (
            <p className="px-3 py-2 text-xs text-faint">
              Couldn&apos;t load {failed.map((source) => SOURCE_LABELS[source] ?? source).join(' or ')} (see the
              backend log).
            </p>
          )}
        </>
      )}
    </SheetShell>
  );
};

export default CallerIdSheet;
