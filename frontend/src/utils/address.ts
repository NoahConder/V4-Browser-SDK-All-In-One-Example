export type DialAddressType = 'phone' | 'sip' | 'fabric';

// SIP URIs (sip:user@domain) and Fabric addresses (/public/room-name) are
// dialed as-is instead of being formatted/validated like a phone number.
// Used by both the dialer UI and signalwire.ts's normalizeDestination(); keep
// in sync with is_dial_address() in backend/utils/signalwire.py.
export const getDialAddressType = (value: string): DialAddressType => {
  const trimmed = value.trim();
  if (/^sip:/i.test(trimmed) || trimmed.includes('@')) return 'sip';
  if (trimmed.startsWith('/')) return 'fabric';
  return 'phone';
};

export const isDialAddress = (value: string): boolean => getDialAddressType(value) !== 'phone';

export type DialChannel = 'audio' | 'video';

// A dial URL without its query string (`/private/alice?channel=video` ->
// `/private/alice`), for labels.
export const dialPath = (destination: string): string => destination.split('?')[0];

// The `channel` query param of a dial URL, lowercased, or null when absent.
// Case-insensitive, unlike the SDK's own parser (URLSearchParams compared to
// 'video' exactly) -- one reason makeCall passes receiveVideo explicitly.
export const channelOf = (destination: string): string | null => {
  const match = /[?&]channel=([^&]*)/i.exec(destination);
  return match ? match[1].toLowerCase() : null;
};

// Sets a Fabric address's channel: an existing `channel=` is rewritten, a
// bare address gets `?channel=video` appended, and `audio` leaves a bare
// address bare (the server's default). Phone numbers and SIP URIs come back
// untouched -- they never carry a channel; the dial options say video or not.
// This is how the Video toggle edits the field and how Recents redials as
// audio or video; the server's per-channel URLs already have the right form.
export const withChannel = (destination: string, channel: DialChannel): string => {
  const trimmed = destination.trim();
  if (getDialAddressType(trimmed) !== 'fabric') return destination;
  if (/[?&]channel=/i.test(trimmed)) return trimmed.replace(/([?&])channel=[^&]*/i, `$1channel=${channel}`);
  if (channel === 'audio') return trimmed;
  return `${trimmed}${trimmed.includes('?') ? '&' : '?'}channel=video`;
};

// How many digits a phone-number-looking input holds, ignoring formatting
// such as spaces, dashes and parentheses.
export const countDigits = (value: string): number => (value.match(/\d/g) ?? []).length;

// Display-only formatting (the dial path normalizes separately, to E.164).
// US numbers get (555) 123-4567; anything else is shown as typed.
export const formatPhoneNumber = (number: string): string => {
  // A browser-to-browser caller arrives as "subscriber://<name>" (observed on
  // 4.0.0-rc.5); show the name. Not a dial address, so only for display.
  const subscriber = /^subscriber:\/\/(.+)$/i.exec(number);
  if (subscriber) {
    return subscriber[1];
  }
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
