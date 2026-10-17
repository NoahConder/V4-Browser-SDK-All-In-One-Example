export type DialAddressType = 'phone' | 'sip' | 'fabric';

// SIP URIs (sip:user@domain) and Fabric addresses (/public/room-name) are
// dialed as-is instead of being formatted/validated like a phone number.
// Keep in sync with signalwire.ts's makeCall and backend's is_dial_address().
export const getDialAddressType = (value: string): DialAddressType => {
  const trimmed = value.trim();
  if (/^sip:/i.test(trimmed) || trimmed.includes('@')) return 'sip';
  if (trimmed.startsWith('/')) return 'fabric';
  return 'phone';
};

export const isDialAddress = (value: string): boolean => getDialAddressType(value) !== 'phone';

// Display-only formatting (the dial path normalizes separately, to E.164).
// US numbers get (555) 123-4567; anything else is shown as typed.
export const formatPhoneNumber = (number: string): string => {
  // SIP URIs and Fabric addresses aren't phone numbers -- display as typed.
  if (isDialAddress(number)) {
    return number;
  }

  // E.164 US number (+1 and ten digits) -- how remote numbers usually arrive.
  if (/^\+1\d{10}$/.test(number)) {
    return `+1 (${number.slice(2, 5)}) ${number.slice(5, 8)}-${number.slice(8)}`;
  }

  // Any other international number is kept as-is.
  if (number.startsWith('+')) {
    return number;
  }

  // Remove all non-digit characters except + at the beginning
  const cleaned = number.replace(/[^\d+]/g, '').replace(/\+(?!^)/g, '');

  // For numbers with only digits
  const digitsOnly = cleaned.replace(/^\+/, '');

  if (digitsOnly.length === 10) {
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  } else if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
    return `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
  }

  // Return as-is for other formats (including * and #)
  return number;
};
