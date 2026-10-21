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
    s.makeCall = async (n, video, from, cameraOff) => { log('makeCall', n, video, ...(from === undefined ? [] : [from]), ...(cameraOff ? ['camera off'] : [])); return { id: 'sdk-call-1' }; };
    s.sendDTMF = async (d) => { log('dtmf', d); };
    s.endCall = async () => { log('endCall'); };
    s.answerCall = async (video, cameraOff) => { log('answer', ...(cameraOff ? ['camera off'] : [])); };
    s.rejectCall = async () => { log('reject'); };
    s.toggleMute = async (m) => { log('mute', m); };
    s.resumeRemoteAudio = () => { log('resumeRemoteAudio'); };
  `,
  );

// The visible status line on the call screen ("Calling…", "Connected", …).
export const callStatusText = (page: Page) => page.locator('[aria-live="polite"]').first().innerText();

// A fake SDK Directory built from real rxjs Observables (borrowed from one the
// service returns, since bare specifiers don't resolve from page.evaluate):
// page 1 loads when hasMore$ is subscribed; loadMore() appends page 2.
export const FAKE_DIRECTORY = `
  const Observable = s.getIsNetworkHealthy$().constructor;
  const subject = (initial) => {
    const fns = new Set(); let value = initial;
    return { next(v) { value = v; fns.forEach((f) => f(v)); }, obs: new Observable((sub) => { sub.next(value); const fn = (v) => sub.next(v); fns.add(fn); return () => fns.delete(fn); }) };
  };
  const addr = (id, type, name, channels) => ({ id, type, name, displayName: name, resourceId: 'res-' + id, channels });
  const page1 = [
    addr('a-alice', 'subscriber', 'Alice', { audio: '/private/alice?channel=audio', video: '/private/alice?channel=video' }),
    addr('a-me', 'subscriber', 'swdialer', { audio: '/private/swdialer?channel=audio', video: '/private/swdialer?channel=video' }),
    addr('a-room', 'room', 'Team Room', { audio: '/public/team-room?channel=audio', video: '/public/team-room?channel=video' }),
  ];
  const page2 = [addr('a-app', 'app', 'IVR App', { audio: '/public/ivr?channel=audio' })];
  const addresses = subject([]); const loading = subject(false); const hasMore = subject(true);
  const directory = {
    addresses$: addresses.obs, loading$: loading.obs,
    hasMore$: new Observable((sub) => { log('init'); loading.next(true); setTimeout(() => { addresses.next(page1); loading.next(false); }, 50); const inner = hasMore.obs.subscribe((v) => sub.next(v)); return () => inner.unsubscribe(); }),
    loadMore() { log('loadMore'); loading.next(true); setTimeout(() => { addresses.next([...page1, ...page2]); hasMore.next(false); loading.next(false); }, 50); },
  };
  s.getDirectory$ = () => new Observable((sub) => { sub.next(directory); });
  s.getOwnAddressIds = () => new Set(['a-me']);
`;

// Stubs for the service's live-metrics getters. `of` and a tiny subject stand
// in for rxjs (bare specifiers don't resolve from page.evaluate; the sheet
// only needs `.subscribe`).
export const STATS_STUBS = `
  const of = (value) => ({ subscribe: (fn) => { fn(value); return { unsubscribe() {} }; } });
  const subject = (initial) => { const fns = new Set(); return { value: initial, next(v) { this.value = v; fns.forEach((f) => f(v)); }, asObservable() { return { subscribe: (fn) => { fn(this.value); fns.add(fn); return { unsubscribe: () => fns.delete(fn) }; } }; } }; };
  window.__level = subject(0.04);
  const sample = (i, lost) => ({ timestamp: Date.now() - (5 - i) * 1000, audio: { packetsReceived: 1000 + i * 50, packetsLost: lost, jitter: 7.4 }, video: { packetsReceived: 0, packetsLost: 0 }, roundTripTime: 42.3, availableOutgoingBitrate: 512000 });
  s.getNetworkMetrics$ = () => of([sample(0, 10), sample(1, 10), sample(2, 10), sample(3, 10), sample(4, 12)]);
  window.__issues = subject([]);
  s.getNetworkIssues$ = () => window.__issues.asObservable();
  s.getLocalAudioLevel$ = () => window.__level.asObservable();
  s.getLocalSpeaking$ = () => of(false);
  s.getRemoteAudioLevel$ = () => of(0.25);
  s.getCurrentCallId = () => 'call-abc-123';
  s.requestIceRestart = async () => { log('iceRestart'); };
  s.getConnectionStats = async () => ({
    candidatePair: { localType: 'relay', remoteType: 'host', protocol: 'udp', relayProtocol: 'tls', currentRoundTripTimeMs: 44 },
    audioOutboundCodec: 'PCMU 8k (pt 0)', audioInboundCodec: 'PCMU 8k (pt 0)', videoOutboundCodec: null, videoInboundCodec: null,
    bytesSent: 2300000, bytesReceived: 850000,
  });
  s.recoveryEvents$.next({ action: 'reinvite_started', reason: 'test', attempt: 1, maxAttempts: 3, timestamp: Date.now() });
`;

// The caller ID picker's backend listing (GET /api/caller-ids): one owned
// number and one verified caller ID.
export const CALLER_IDS = {
  success: true,
  data: [
    { id: 'n1', number: '+15550000001', name: 'Main line', kind: 'number' },
    { id: 'v1', number: '+15558675309', name: "Noah's mobile", kind: 'verified' },
  ],
  total: 2,
  failed: [] as string[],
};

export const stubCallerIds = (page: Page, body: unknown = CALLER_IDS) =>
  page.route('**/api/caller-ids*', (route) => route.fulfill({ json: body }));
