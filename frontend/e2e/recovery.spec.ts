import { expect, test } from '@playwright/test';
import { callStatusText, evalInApp, openDialer } from './helpers';

// Drives the service's peer-connection monitor with a fake RTCPeerConnection
// (an EventTarget with settable states) attached to a fake current call, and
// a fake client whose recovery preferences shrink the grace window to ~5.5 s.
const HARNESS = `
  class FakePc extends EventTarget {
    iceConnectionState = 'new'; connectionState = 'new';
    getReceivers() { return []; }
    setIce(state) { this.iceConnectionState = state; this.dispatchEvent(new Event('iceconnectionstatechange')); }
  }
  s.client = { preferences: { recoveryDebounceTime: 0, maxRecoveryAttempts: 0, iceRestartTimeout: 0.5 } };
  window.__h = {
    begin() {
      const pc = new FakePc();
      const call = { id: 'fake', status: 'connected', rtcPeerConnection: pc, hangup: async () => {}, localStream: null, self: null };
      s.currentCall = call; s.wasIncomingCall = false; s.lastRecoveryState = 'idle';
      store.getState().setCallState({ isInCall: true, callStatus: 'connected', remoteNumber: '+15551234567', connectedAt: Date.now() });
      s.monitorPeerConnection(pc, call);
      return pc;
    },
    state() { const st = store.getState(); return { inCall: st.isInCall, disrupted: st.isMediaDisrupted, hasCall: s.currentCall !== null, timer: s.mediaDisruptionTimer !== null, listeners: s.pcListenerDisposers.length }; },
  };
`;

declare global {
  interface Window {
    __h: { begin(): unknown; state(): { inCall: boolean; disrupted: boolean; hasCall: boolean; timer: boolean; listeners: number } };
    __pc: { setIce(state: string): void };
    __old: { setIce(state: string): void };
  }
}

const state = (page: import('@playwright/test').Page) => page.evaluate(() => window.__h.state());

test.describe('media loss vs. call end', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, HARNESS);
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
    expect(await state(page)).toMatchObject({ inCall: true, hasCall: true, disrupted: true });
    await expect.poll(() => state(page), { timeout: 10_000 }).toMatchObject({ inCall: false, hasCall: false, listeners: 0 });

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
