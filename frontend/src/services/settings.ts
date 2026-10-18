import type { LogLevel } from '@signalwire/js';
import { THEME_PREFERENCES, type ThemePreference } from './theme';

export type AudioCodec = 'opus' | 'PCMU' | 'PCMA';

export const AUDIO_CODECS: readonly AudioCodec[] = ['opus', 'PCMU', 'PCMA'];
export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'silent'];

// Tester-facing SDK settings, persisted in localStorage and applied by
// signalwire.ts at client construction and via applySettings() on change.
export interface DialerSettings {
  // Codec preference order offered in the SDP. Read by the SDK at each
  // offer/answer, so it applies to the next call -- no reload needed.
  audioCodecOrder: AudioCodec[];
  // SDK logger level. Global and immediate (setLogLevel).
  logLevel: LogLevel;
  // Log every WebSocket frame. Global and immediate (setDebugOptions).
  logWsTraffic: boolean;
  // Force media through TURN. Read at each peer-connection creation, so it
  // applies to the next call.
  relayOnly: boolean;
  // This app's own debug logging (utils/log.ts).
  debugLogs: boolean;
  // Light/dark appearance (services/theme.ts). Not SDK state: applied by
  // applyTheme(), never by signalwire.ts.
  theme: ThemePreference;
}

// Matches the behavior before settings existed: G.711 first (PCMU, then
// PCMA), Opus after; SDK logs at 'warn'.
export const DEFAULT_SETTINGS: DialerSettings = {
  audioCodecOrder: ['PCMU', 'PCMA', 'opus'],
  logLevel: 'warn',
  logWsTraffic: false,
  relayOnly: false,
  debugLogs: false,
  theme: 'system',
};

const STORAGE_KEY = 'dialer_settings';

const isValidCodecOrder = (value: unknown): value is AudioCodec[] =>
  Array.isArray(value) &&
  value.length === AUDIO_CODECS.length &&
  AUDIO_CODECS.every((codec) => value.includes(codec));

export function loadSettings(): DialerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof DialerSettings, unknown>>;
    return {
      audioCodecOrder: isValidCodecOrder(parsed.audioCodecOrder)
        ? parsed.audioCodecOrder
        : DEFAULT_SETTINGS.audioCodecOrder,
      logLevel: LOG_LEVELS.includes(parsed.logLevel as LogLevel)
        ? (parsed.logLevel as LogLevel)
        : DEFAULT_SETTINGS.logLevel,
      logWsTraffic: typeof parsed.logWsTraffic === 'boolean' ? parsed.logWsTraffic : DEFAULT_SETTINGS.logWsTraffic,
      relayOnly: typeof parsed.relayOnly === 'boolean' ? parsed.relayOnly : DEFAULT_SETTINGS.relayOnly,
      debugLogs: typeof parsed.debugLogs === 'boolean' ? parsed.debugLogs : DEFAULT_SETTINGS.debugLogs,
      theme: THEME_PREFERENCES.includes(parsed.theme as ThemePreference)
        ? (parsed.theme as ThemePreference)
        : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(partial: Partial<DialerSettings>): DialerSettings {
  const next = { ...loadSettings(), ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota) -- settings still apply for
    // this session.
  }
  return next;
}
