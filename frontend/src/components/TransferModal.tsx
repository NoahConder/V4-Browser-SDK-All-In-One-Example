import React, { useState } from 'react';
import { X } from 'lucide-react';
import { describeCallError } from '../hooks/useSignalWire';
import { useDialog } from '../hooks/useDialog';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (destination: string) => Promise<void>;
}

const TransferModal: React.FC<TransferModalProps> = ({ isOpen, onClose, onTransfer }) => {
  const [destination, setDestination] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setDestination('');
    setError(null);
    onClose();
  };

  // Focus trap + Escape (ignored while a transfer is mid-flight) + focus return.
  const dialogRef = useDialog(isOpen, () => {
    if (!isSubmitting) handleClose();
  });

  if (!isOpen) return null;

  const handleTransfer = async () => {
    const trimmed = destination.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onTransfer(trimmed);
      handleClose();
    } catch (err) {
      // Shown inline here, not as a full callError banner, so the user can
      // correct the destination and retry without losing this dialog.
      setError(describeCallError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-scrim" onClick={handleClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        className="glass-panel relative z-10 w-full max-w-sm rounded-xl p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="transfer-title" className="text-lg font-medium text-ink">Transfer Call</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTransfer()}
          placeholder="Number or address"
          disabled={isSubmitting}
          className="mb-3 w-full rounded-lg border border-edge-strong bg-surface-2 px-4 py-3 text-ink outline-hidden placeholder:text-faint focus:border-accent-edge focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        />

        {error && <p className="mb-3 text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 rounded-lg border border-edge-strong bg-surface-2 px-4 py-2.5 font-medium text-ink transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!destination.trim() || isSubmitting}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 font-medium text-on-accent transition-all hover:bg-accent-hover disabled:opacity-50"
          >
            {isSubmitting ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
