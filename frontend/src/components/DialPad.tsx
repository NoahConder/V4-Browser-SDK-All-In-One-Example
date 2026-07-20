import React, { useRef, useState } from 'react';
import { Phone, Delete } from 'lucide-react';
import { DialPadKey } from '../types';

interface DialPadProps {
  onKeyPress: (key: string) => void;
  onCall: () => void;
  onDelete: () => void;
  onClearAll?: () => void; // Optional callback for clearing all
  hasNumber: boolean;
  disabled?: boolean;
  hideText?: string; // Optional text to show instead of delete icon
  callButtonText?: string; // Optional text to show on call button instead of phone icon
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
  hideText,
  callButtonText
}) => {
  const [isLongPressing, setIsLongPressing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const handleKeyPress = (key: string) => {
    if (!disabled) {
      onKeyPress(key);
      // Play DTMF tone here if needed
      playDTMFTone(key);
    }
  };

  const handleDeleteMouseDown = () => {
    // Start timer for long press (2 seconds)
    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true);
      // Trigger clear all if callback provided
      if (onClearAll) {
        onClearAll();
      } else {
        // If no clear all callback, repeatedly delete
        onDelete();
      }
      // Visual/haptic feedback could go here
    }, 2000);
  };

  const handleDeleteMouseUp = () => {
    // Clear the timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // If it wasn't a long press, do a normal delete
    if (!isLongPressing) {
      onDelete();
    }

    setIsLongPressing(false);
  };

  const handleDeleteMouseLeave = () => {
    // Cancel long press if mouse/finger leaves button
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsLongPressing(false);
  };

  const playDTMFTone = (key: string) => {
    // Simple tone generation using Web Audio API
    const audioContext = new (window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // DTMF frequencies
    const frequencies: { [key: string]: [number, number] } = {
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477],
    };

    if (frequencies[key]) {
      oscillator1.frequency.value = frequencies[key][0];
      oscillator2.frequency.value = frequencies[key][1];

      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(audioContext.destination);

      gainNode.gain.value = 0.1;

      oscillator1.start();
      oscillator2.start();

      setTimeout(() => {
        oscillator1.stop();
        oscillator2.stop();
        audioContext.close();
      }, 200);
    }
  };

  return (
    <div className="flex justify-center items-center w-full px-4">
      <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ maxWidth: '260px' }}>
        {/* Number Keys */}
        {dialPadKeys.map((row, rowIndex) => (
          <React.Fragment key={rowIndex}>
            {row.map((key) => (
              <button
                key={key.number}
                className="dial-button bg-white/[0.06] border border-white/10 backdrop-blur-md hover:bg-white/10 disabled:opacity-40 disabled:active:scale-100"
                onClick={() => handleKeyPress(key.number)}
                disabled={disabled}
              >
                {key.special ? (
                  // Special characters with different sizes and positioning
                  <span className={`font-light leading-none ${
                    key.number === '*'
                      ? 'text-6xl sm:text-7xl relative top-[10px]'  // Asterisk lowered more for proper centering
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

        {/* Bottom Row: Empty, Call Button, Delete */}
        <div className="dial-button invisible"></div>

        <button
          onClick={onCall}
          disabled={disabled}
          className="dial-button bg-gradient-to-b from-emerald-400 to-ios-green shadow-[0_4px_16px_rgba(52,199,89,0.35)] hover:brightness-110 disabled:opacity-40 disabled:active:scale-100"
        >
          {callButtonText ? (
            <span className="text-lg font-normal">{callButtonText}</span>
          ) : (
            <Phone size={32} fill="white" />
          )}
        </button>

        {hasNumber ? (
          <button
            ref={deleteButtonRef}
            onMouseDown={handleDeleteMouseDown}
            onMouseUp={handleDeleteMouseUp}
            onMouseLeave={handleDeleteMouseLeave}
            onTouchStart={handleDeleteMouseDown}
            onTouchEnd={handleDeleteMouseUp}
            onTouchCancel={handleDeleteMouseLeave}
            className={`dial-button border transition-colors ${
              isLongPressing
                ? 'bg-red-500/80 border-red-400/50'
                : 'bg-white/[0.06] border-white/10 backdrop-blur-md hover:bg-white/10'
            }`}
          >
            {hideText ? (
              <span className="text-sm text-gray-300">{hideText}</span>
            ) : (
              <Delete size={24} className={isLongPressing ? 'text-white animate-pulse' : 'text-gray-300'} />
            )}
          </button>
        ) : (
          <div className="dial-button invisible"></div>
        )}
      </div>
    </div>
  );
};

export default DialPad;