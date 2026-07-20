import React, { useState } from 'react';
import { X } from 'lucide-react';
import { describeCallError } from '../hooks/useSignalWire';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (destination: string) => Promise<void>;
}

const TransferModal: React.FC<TransferModalProps> = ({ isOpen, onClose, onTransfer }) => {
  const [destination, setDestination] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setDestination('');
    setError(null);
    onClose();
  };

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
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} />

      <div className="glass-panel relative z-10 w-full max-w-sm rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">Transfer Call</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
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
          className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none placeholder:text-gray-500 disabled:opacity-50"
        />

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!destination.trim() || isSubmitting}
            className="flex-1 rounded-xl bg-gradient-to-b from-emerald-400 to-ios-green px-4 py-2.5 font-medium text-white transition-all hover:brightness-110 disabled:opacity-50"
          >
            {isSubmitting ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
