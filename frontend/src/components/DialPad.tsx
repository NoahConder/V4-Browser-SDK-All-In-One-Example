import React, { useRef, useState } from 'react';
import { Phone, PhoneOff, Delete } from 'lucide-react';
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
  onCall: () => void;
  onDelete?: () => void;
  onClearAll?: () => void; // Optional callback for clearing all
  hasNumber?: boolean;
  disabled?: boolean;
  // In-call (DTMF) keypad, like iOS: the bottom row becomes [ ][End][Hide] --
  // onCall is the red End button, and there's no delete since every digit has
  // already been sent.
  onHide?: () => void;
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

const DialPad: React.FC<DialPadProps> = ({
  onKeyPress,
  onCall,
  onDelete,
  onClearAll,
  hasNumber,
  disabled = false,
  onHide,
}) => {
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
  const isLongPressing = deleteHold.isHolding;

  return (
    <div className="flex justify-center items-center w-full px-4">
      <div className="grid grid-cols-3 gap-3 sm:gap-4 short:gap-2" style={{ maxWidth: '260px' }}>
        {/* Number Keys */}
        {dialPadKeys.map((row, rowIndex) => (
          <React.Fragment key={rowIndex}>
            {row.map((key) => (
              <button
                key={key.number}
                className="dial-button bg-white/6 border border-white/10 backdrop-blur-md hover:bg-white/10 disabled:opacity-40 disabled:active:scale-100"
                aria-label={key.number === '0' && !onHide ? '0, hold for +' : undefined}
                disabled={disabled}
                {...(key.number === '0' && !onHide
                  ? zeroHold.handlers
                  : { onClick: () => handleKeyPress(key.number), onMouseDown: keepFocus })}
              >
                {key.special ? (
                  // Special characters with different sizes and positioning
                  <span className={`font-light leading-none ${
                    key.number === '*'
                      ? 'text-6xl sm:text-7xl relative top-2.5'  // Asterisk lowered more for proper centering
                      : 'text-3xl sm:text-4xl'  // Hash stays normal
                  }`}>{key.number}</span>
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

        {/* Bottom Row: Empty, Call (or End), Delete (or Hide) */}
        <div className="dial-button invisible"></div>

        {onHide ? (
          <button
            onClick={onCall}
            onMouseDown={keepFocus}
            aria-label="End call"
            className="dial-button bg-linear-to-b from-red-500 to-ios-red shadow-[0_4px_16px_rgba(255,59,48,0.35)] hover:brightness-110"
          >
            <PhoneOff size={32} fill="white" />
          </button>
        ) : (
          <button
            onClick={onCall}
            onMouseDown={keepFocus}
            disabled={disabled}
            aria-label="Call"
            className="dial-button bg-linear-to-b from-emerald-400 to-ios-green shadow-[0_4px_16px_rgba(52,199,89,0.35)] hover:brightness-110 disabled:opacity-40 disabled:active:scale-100"
          >
            <Phone size={32} fill="white" />
          </button>
        )}

        {onHide ? (
          <button
            onClick={onHide}
            onMouseDown={keepFocus}
            className="dial-button text-base text-gray-300 transition-colors hover:text-white shadow-none"
          >
            Hide
          </button>
        ) : hasNumber ? (
          <button
            aria-label="Delete"
            {...deleteHold.handlers}
            className={`dial-button border transition-colors ${
              isLongPressing
                ? 'bg-red-500/80 border-red-400/50'
                : 'bg-white/6 border-white/10 backdrop-blur-md hover:bg-white/10'
            }`}
          >
            <Delete size={24} className={isLongPressing ? 'text-white animate-pulse' : 'text-gray-300'} />
          </button>
        ) : (
          <div className="dial-button invisible"></div>
        )}
      </div>
    </div>
  );
};

export default DialPad;