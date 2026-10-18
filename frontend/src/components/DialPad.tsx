import React, { useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { DialPadKey } from '../types';
import { toneService } from '../services/tones';

// Clicking a key shouldn't pull focus off the address input: the caret stays
// put for typing, and Enter-to-call keeps working instead of re-pressing the
// last key the mouse focused.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

interface LongPressOptions {
  holdMs: number;
  onTap: () => void;
  onHold: () => void;
  disabled?: boolean;
}

// Tap vs. hold on one key (Delete: delete / clear all; 0: '0' / '+').
// Pointer (not mouse + touch) events: a tap fires touchend and then the
// compatibility mousedown/mouseup, which used to delete two characters.
function useLongPress({ holdMs, onTap, onHold, disabled }: LongPressOptions) {
  const [isHolding, setIsHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setIsHolding(false);
  };

  return {
    isHolding,
    handlers: {
      onPointerDown: () => {
        if (disabled) return;
        fired.current = false;
        timer.current = setTimeout(() => {
          fired.current = true;
          setIsHolding(true);
          onHold();
        }, holdMs);
      },
      onPointerUp: () => {
        const wasHold = fired.current;
        cancel();
        fired.current = false;
        if (!wasHold && !disabled) onTap();
      },
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // Keyboard activation of a focused key still types once.
      onKeyDown: (e: React.KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          onTap();
        }
      },
      onMouseDown: keepFocus,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

interface DialPadProps {
  onKeyPress: (key: string) => void;
  // 'dial' is the idle dialer's pad: hold 0 for '+', and a Delete key that
  // clears everything when held. 'dtmf' is the in-call pad: digits only --
  // every digit has already been sent, so there is nothing to delete.
  mode: 'dial' | 'dtmf';
  onDelete?: () => void;
  onClearAll?: () => void;
  hasNumber?: boolean;
  disabled?: boolean;
}

const dialPadKeys: DialPadKey[][] = [
  [
    { number: '1', letters: ' ' },  // Space to maintain alignment
    { number: '2', letters: 'ABC' },
    { number: '3', letters: 'DEF' },
  ],
  [
    { number: '4', letters: 'GHI' },
    { number: '5', letters: 'JKL' },
    { number: '6', letters: 'MNO' },
  ],
  [
    { number: '7', letters: 'PQRS' },
    { number: '8', letters: 'TUV' },
    { number: '9', letters: 'WXYZ' },
  ],
  [
    { number: '*', special: true },
    { number: '0', letters: '+' },
    { number: '#', special: true },
  ],
];

// The 12-key pad (globals.css's keypad-grid / key-button), flat and sized by
// its column, plus a Delete row in dial mode. Key tones come from the shared
// tone service.
const DialPad: React.FC<DialPadProps> = ({
  onKeyPress,
  mode,
  onDelete,
  onClearAll,
  hasNumber = false,
  disabled = false,
}) => {
  const isDial = mode === 'dial';

  const handleKeyPress = (key: string) => {
    if (!disabled) {
      onKeyPress(key);
      toneService.playDtmf(key);
    }
  };

  // Hold Delete 2 s to clear everything. Hold 0 to type '+' (idle dialer
  // only -- there's no '+' in DTMF), as the key's label advertises.
  const deleteHold = useLongPress({
    holdMs: 2000,
    disabled: !hasNumber,
    onTap: () => onDelete?.(),
    onHold: () => (onClearAll ? onClearAll() : onDelete?.()),
  });
  const zeroHold = useLongPress({
    holdMs: 600,
    disabled,
    onTap: () => handleKeyPress('0'),
    onHold: () => {
      onKeyPress('+');
      toneService.playDtmf('0');
    },
  });
  const isClearing = deleteHold.isHolding;

  return (
    <div className="keypad-grid mx-auto">
      {dialPadKeys.map((row, rowIndex) => (
        <React.Fragment key={rowIndex}>
          {row.map((key) => (
            <button
              key={key.number}
              className="key-button"
              aria-label={key.number === '0' && isDial ? '0, hold for +' : undefined}
              disabled={disabled}
              {...(key.number === '0' && isDial
                ? zeroHold.handlers
                : { onClick: () => handleKeyPress(key.number), onMouseDown: keepFocus })}
            >
              {key.special ? (
                <span
                  className={`font-display font-medium leading-none tracking-tight ${
                    key.number === '*' ? 'relative top-1.5 text-4xl' : 'text-2xl'
                  }`}
                >
                  {key.number}
                </span>
              ) : (
                <>
                  <span className="dial-button-number">{key.number}</span>
                  {key.letters && (
                    <span className="dial-button-letters">
                      {key.letters.trim() || '\u00A0'} {/* Non-breaking space for alignment */}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}

      {isDial && (
        <button
          aria-label="Delete"
          title="Delete; hold to clear"
          disabled={!hasNumber}
          {...deleteHold.handlers}
          className={`col-span-3 flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors disabled:opacity-40 ${
            isClearing
              ? 'border-hangup/50 bg-hangup/80 text-on-hangup'
              : 'border-edge-strong bg-surface text-muted hover:bg-surface-hover hover:text-ink'
          }`}
        >
          <Delete size={18} className={isClearing ? 'animate-pulse' : ''} />
          <span>{isClearing ? 'Clearing…' : 'Delete'}</span>
        </button>
      )}
    </div>
  );
};

export default DialPad;
