import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __log: unknown[][];
  }
}

export const ADDRESS_INPUT = 'input[placeholder="Number or address"]';

// Open the dialer through the dev-only `?e2e=1` seam: no SignalWire
// connection, but the hook's callbacks are registered on the service, so tests
// can fire them (e.g. `s.onIncomingCall(...)`) and stub its methods.
export async function openDialer(page: Page, path = '/') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}e2e=1`);
  await page.locator(ADDRESS_INPUT).waitFor();
  await page.evaluate(() => {
    window.__log = [];
  });
}

// Run JS in the page with `s` (the service singleton), `store` (useCallStore),
// `recents` (useRecentsStore) and `log(...entry)` (appends to window.__log)
// in scope. Private service members are reachable at runtime.
export function evalInApp<T = unknown>(page: Page, body: string): Promise<T> {
  return page.evaluate(`(async () => {
    const { signalWireService: s } = await import('/src/services/signalwire.ts');
    const { useCallStore: store } = await import('/src/hooks/useCallStore.ts');
    const { useRecentsStore: recents } = await import('/src/hooks/useRecentsStore.ts');
    const log = (...entry) => window.__log.push(entry);
    ${body}
  })()`) as Promise<T>;
}

export const setState = (page: Page, state: Record<string, unknown>) =>
  evalInApp(page, `store.getState().setCallState(${JSON.stringify(state)});`);

export const drainLog = (page: Page) => page.evaluate(() => window.__log.splice(0));

// Common service stubs: nothing is dialed, everything is recorded.
export const stubCallMethods = (page: Page) =>
  evalInApp(
    page,
    `
    s.makeCall = async (n, video) => { log('makeCall', n, video); return { id: 'sdk-call-1' }; };
    s.sendDTMF = async (d) => { log('dtmf', d); };
    s.endCall = async () => { log('endCall'); };
    s.answerCall = async () => { log('answer'); };
    s.rejectCall = async () => { log('reject'); };
    s.toggleMute = async (m) => { log('mute', m); };
    s.resumeRemoteAudio = () => { log('resumeRemoteAudio'); };
  `,
  );

// The visible status line on the call screen ("Calling…", "Connected", …).
export const callStatusText = (page: Page) => page.locator('[aria-live="polite"]').first().innerText();
