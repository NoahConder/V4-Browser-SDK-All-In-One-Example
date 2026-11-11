import { expect, test } from '@playwright/test';
import { callStatusText, evalInApp, openDialer } from './helpers';

// Drives the service's peer-connection monitor with a fake RTCPeerConnection
// (an EventTarget with settable states) attached to a fake current call, and
// a fake client whose recovery preferences shrink the grace window to 5 s.
const HARNESS = `
  class FakePc extends EventTarget {
    iceConnectionState = 'new'; connectionState = 'new';
    getReceivers() { return []; }
    setIce(state) { this.iceConnectionState = state; this.dispatchEvent(new Event('iceconnectionstatechange')); }
  }
  s.client = { preferences: { recoveryDebounceTime: 0, maxRecoveryAttempts: 0, iceRestartTimeout: 0.5 } };
  // A fake SDK Call with real rxjs Observables (borrowed from one the service
  // returns): status$ is drivable, everything else never emits.
  const Observable = s.getNetworkMetrics$().constructor;
  const never = new Observable(() => {});
  window.__fakeCall = (status) => {
    const fns = new Set();
    const call = {
      id: 'sdk-call-x', status, direction: 'outbound', to: '/public/test', toName: 'Test App',
      mediaDirections: { audio: 'sendrecv' }, rtcPeerConnection: undefined, localStream: null, self: null,
      hangup: async () => {},
      status$: new Observable((sub) => { sub.next(call.status); fns.add(sub); return () => fns.delete(sub); }),
      remoteStream$: never, localStream$: never, errors$: never, self$: never,
      qualityLevel$: never, qualityScore$: never, networkIssues$: never, recoveryState$: never, recoveryEvent$: never,
      setStatus(next) { call.status = next; fns.forEach((sub) => sub.next(next)); },
    };
    return call;
  };
  window.__h = {
    begin() {
      const pc = new FakePc();
      const call = { id: 'fake', status: 'connected', rtcPeerConnection: pc, hangups: 0, hangup: async () => { call.hangups++; }, localStream: null, self: null };
      window.__hc = call;
      s.currentCall = call; s.connectedCall = call; s.wasIncomingCall = false; s.lastRecoveryState = 'idle';
      store.getState().setCallState({ isInCall: true, callStatus: 'connected', remoteNumber: '+15551234567', connectedAt: Date.now() });
      s.monitorPeerConnection(pc, call);
      return pc;
    },
    state() { const st = store.getState(); return { inCall: st.isInCall, disrupted: st.isMediaDisrupted, hasCall: s.currentCall !== null, timer: s.mediaDisruptionTimer !== null, listeners: s.pcListenerDisposers.length, hangups: window.__hc?.hangups ?? 0 }; },
  };
`;

declare global {
  interface Window {
    __h: { begin(): unknown; state(): { inCall: boolean; disrupted: boolean; hasCall: boolean; timer: boolean; listeners: number; hangups: number } };
    __hc?: { hangups: number };
    __pc: { setIce(state: string): void };
    __old: { setIce(state: string): void };
    __fakeCall: (status: string) => { setStatus(status: string): void };
    __call: { setStatus(status: string): void };
  }
}

const state = (page: import('@playwright/test').Page) => page.evaluate(() => window.__h.state());

test.describe('media loss vs. call end', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, HARNESS);
  });

  test('a call whose media fails before it ever connected ends at once and hangs up', async ({ page }) => {
    await page.evaluate(() => {
      window.__pc = window.__h.begin() as Window['__pc'];
    });
    // Still "Calling…": the call has not reached connected.
    await evalInApp(page, `s.connectedCall = null; store.getState().setCallState({ callStatus: 'connecting', connectedAt: null });`);
    await page.evaluate(() => window.__pc.setIce('failed'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false, timer: false, listeners: 0, hangups: 1 });
    await expect(page.getByText("The call couldn't connect")).toBeVisible();
    // ICE disconnected alone is not a failure yet, connected or not.
    await page.evaluate(() => {
      window.__pc = window.__h.begin() as Window['__pc'];
    });
    await evalInApp(page, `s.connectedCall = null;`);
    await page.evaluate(() => window.__pc.setIce('disconnected'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: true, hasCall: true, disrupted: true, timer: true });
  });

  test('ICE failed shows Reconnecting… and keeps the call; recovery clears it', async ({ page }) => {
    await page.evaluate(() => {
      window.__pc = window.__h.begin() as Window['__pc'];
      window.__pc.setIce('failed');
    });
    await expect.poll(() => state(page)).toMatchObject({ inCall: true, hasCall: true, disrupted: true, timer: true });
    expect(await callStatusText(page)).toContain('Reconnecting');

    await page.evaluate(() => window.__pc.setIce('connected'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: true, disrupted: false, timer: false });
    expect(await callStatusText(page)).toContain('Connected');
  });

  test('an unrecovered failure ends the call after the grace window', async ({ page }) => {
    await page.evaluate(() => {
      window.__pc = window.__h.begin() as Window['__pc'];
      window.__pc.setIce('failed');
    });
    await page.waitForTimeout(3000);
    expect(await state(page)).toMatchObject({ inCall: true, hasCall: true, disrupted: true, hangups: 0 });
    // Giving up also hangs up, so the platform doesn't hold the far end on a dead call.
    await expect.poll(() => state(page), { timeout: 10_000 }).toMatchObject({ inCall: false, hasCall: false, listeners: 0, hangups: 1 });
    await expect(page.getByText("its media connection was lost and didn't come back")).toBeVisible();

    // Events from the dead connection are ignored once it's over.
    await page.evaluate(() => window.__pc.setIce('closed'));
    expect(await state(page)).toMatchObject({ inCall: false, hasCall: false });
  });

  test("'closed' ends at once, and an old connection can't tear down a newer call", async ({ page }) => {
    await page.evaluate(() => {
      window.__pc = window.__h.begin() as Window['__pc'];
      window.__pc.setIce('closed');
    });
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false });

    await evalInApp(
      page,
      `window.__old = window.__h.begin(); s.handleCallEnded(); window.__h.begin(); window.__old.setIce('closed');`,
    );
    expect(await state(page)).toMatchObject({ inCall: true, hasCall: true });
    await evalInApp(page, `s.handleCallEnded();`);
  });
});

// Hang-ups this app didn't start: the SDK's own hangup()/destroy() emits
// 'disconnecting' then 'destroyed', never 'disconnected'. The connection
// test's media call is the everyday case -- it's dialed and hung up by the
// SDK's PreflightRunner -- and it must not be adopted as a reattached call.
test.describe('SDK-side hang-ups and the connection test', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, HARNESS);
  });

  test("status 'destroyed' ends the call; 'disconnecting' does not", async ({ page }) => {
    await evalInApp(
      page,
      `
      window.__call = window.__fakeCall('connected');
      s.currentCall = window.__call; s.wasIncomingCall = false;
      store.getState().setCallState({ isInCall: true, callStatus: 'connected', remoteNumber: 'Test App', connectedAt: Date.now() });
      s.setupCallSubscriptions(window.__call);
    `,
    );
    await page.evaluate(() => window.__call.setStatus('disconnecting'));
    await page.waitForTimeout(100);
    expect(await state(page)).toMatchObject({ inCall: true, hasCall: true });
    await page.evaluate(() => window.__call.setStatus('destroyed'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false });
  });

  // status$ carries the peer connection's own connectionState too, so
  // 'disconnected'/'failed' can mean media loss (the connection says the
  // same) or the call ending (the far end's bye, connection still up).
  test("a 'disconnected'/'failed' status from the peer connection keeps the call; the far end's bye ends it", async ({ page }) => {
    await evalInApp(
      page,
      `
      window.__call = window.__fakeCall('connected');
      window.__call.rtcPeerConnection = { connectionState: 'connected' };
      s.currentCall = window.__call; s.wasIncomingCall = false;
      store.getState().setCallState({ isInCall: true, callStatus: 'connected', remoteNumber: 'Test App', connectedAt: Date.now() });
      s.setupCallSubscriptions(window.__call);
    `,
    );
    for (const media of ['disconnected', 'failed']) {
      await evalInApp(page, `window.__call.rtcPeerConnection.connectionState = '${media}'; window.__call.setStatus('${media}');`);
      await page.waitForTimeout(100);
      expect(await state(page)).toMatchObject({ inCall: true, hasCall: true });
    }
    await evalInApp(page, `window.__call.rtcPeerConnection.connectionState = 'connected'; window.__call.setStatus('connected');`);
    await evalInApp(page, `window.__call.setStatus('disconnected');`);
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false });
  });

  // status$ delivers asynchronously, so the far end's 'disconnected' can
  // arrive after the SDK destroyed the call, when reading rtcPeerConnection
  // throws. That must still end the call, with nothing thrown.
  test("a far-end 'disconnected' after the call is destroyed still ends it, without an error", async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await evalInApp(
      page,
      `
      window.__call = window.__fakeCall('connected');
      Object.defineProperty(window.__call, 'rtcPeerConnection', {
        get() { throw new Error('Dependency Main peer connection not found is not set or available.'); },
      });
      s.currentCall = window.__call; s.wasIncomingCall = false;
      store.getState().setCallState({ isInCall: true, callStatus: 'connected', remoteNumber: 'Test App', connectedAt: Date.now() });
      s.setupCallSubscriptions(window.__call);
    `,
    );
    await page.evaluate(() => window.__call.setStatus('disconnected'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false });
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  // After early media, status$ can go ringing -> connected (media path up)
  // -> connecting (the far end answers) and stay on 'connecting'. A call that
  // has connected stays connected in the UI, and DTMF still goes out.
  test('after early media a connected call stays connected and sends DTMF', async ({ page }) => {
    await evalInApp(
      page,
      `
      window.__call = window.__fakeCall('trying');
      window.__call.digits = [];
      window.__call.sendDigits = async (d) => { window.__call.digits.push(d); };
      s.currentCall = window.__call; s.wasIncomingCall = false;
      store.getState().setCallState({ isInCall: true, callStatus: 'connecting', remoteNumber: 'Test App' });
      s.setupCallSubscriptions(window.__call);
    `,
    );
    // Before the call has connected, digits are dropped.
    await evalInApp(page, `await s.sendDTMF('1');`);
    for (const status of ['ringing', 'connected', 'connecting']) {
      await page.evaluate((st) => window.__call.setStatus(st), status);
    }
    await page.waitForTimeout(100);
    expect(await evalInApp(page, `return store.getState().callStatus;`)).toBe('connected');
    await evalInApp(page, `await s.sendDTMF('5');`);
    expect(await evalInApp(page, `return window.__call.digits;`)).toEqual(['5']);
  });

  test('the media test call is left alone while preflight runs, and adopted otherwise', async ({ page }) => {
    const adopted = await evalInApp<[boolean, boolean, boolean]>(
      page,
      `
      // runPreflight() holds the flag for exactly the duration of client.preflight().
      let flagDuring = null;
      s.client.preflight = async () => { flagDuring = s.preflightInProgress; return { ok: true }; };
      await s.runPreflight('/public/test', {});
      const flagAfter = s.preflightInProgress;

      window.__call = window.__fakeCall('connected');
      s.preflightInProgress = true;
      s.adoptUntrackedCall([window.__call]);
      const adoptedDuring = s.currentCall !== null;
      s.preflightInProgress = false;
      s.adoptUntrackedCall([window.__call]);
      return [flagDuring && !flagAfter, adoptedDuring, s.currentCall === window.__call];
    `,
    );
    expect(adopted).toEqual([true, false, true]);
    await expect.poll(() => state(page)).toMatchObject({ inCall: true, hasCall: true });
    // ...and once adopted, the SDK's own hang-up still ends it.
    await page.evaluate(() => window.__call.setStatus('destroyed'));
    await expect.poll(() => state(page)).toMatchObject({ inCall: false, hasCall: false });
  });
});
