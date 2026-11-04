import { loadSettings } from '../services/settings';

// This app's own logging (the SDK's is separate: Settings → SDK log level).
// debug/info trace call flow and are off unless Diagnostics & Settings →
// "App debug logs" is on; warn/error always print.
let debugEnabled: boolean | null = null;

const isDebugEnabled = (): boolean => {
  if (debugEnabled === null) debugEnabled = loadSettings().debugLogs;
  return debugEnabled;
};

// Called by signalwire.ts's applySettings() when the setting changes.
export const setDebugLogging = (enabled: boolean) => {
  debugEnabled = enabled;
};

export const log = {
  debug: (...args: unknown[]) => {
    if (isDebugEnabled()) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (isDebugEnabled()) console.info(...args);
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
