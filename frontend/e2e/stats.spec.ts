import { expect, test } from '@playwright/test';
import { drainLog, evalInApp, openDialer, setState } from './helpers';

// Stubs for the service's live-metrics getters. `of` and a tiny subject stand
// in for rxjs (bare specifiers don't resolve from page.evaluate; the sheet
// only needs `.subscribe`).
const STUBS = `
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

declare global {
  interface Window {
    __level: { next(v: number): void };
    __issues: { next(v: unknown[]): void };
  }
}

test.describe('call statistics and audio meter', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, STUBS);
    await setState(page, { isInCall: true, callStatus: 'connected', connectedAt: Date.now() - 5000, remoteNumber: '+15551234567' });
    await expect(page.locator('button[aria-label="Call statistics"]')).toBeVisible();
  });

  test('the meter follows the mic level without re-rendering', async ({ page }) => {
    const bar = page.locator('.bg-ios-green.origin-left');
    await expect(bar).toHaveCSS('transform', /matrix\(0\.2,/);
    await page.evaluate(() => window.__level.next(0.64));
    await expect(bar).toHaveCSS('transform', /matrix\(0\.8,/);
  });

  test('the stats sheet shows metrics, transport, recovery and the call id', async ({ page }) => {
    await page.click('button[aria-label="Call statistics"]');
    const sheet = page.locator('[role="dialog"]:has-text("Call Statistics")');
    await expect(sheet).toBeVisible();
    const text = (await sheet.innerText()).replace(/\s+/g, ' ');
    for (const expected of [
      '42 ms',
      '7 ms',
      '1.0% total · 3.8% recent',
      '512 kbps',
      'PCMU 8k (pt 0)',
      'relay (TURN) → host (direct)',
      'udp via tls · 44 ms',
      '↑ 2.2 MB · ↓ 830 KB',
      'reinvite_started (1/3) — test',
      'call-abc-123',
    ]) {
      expect(text, expected).toContain(expected);
    }

    await page.click('button[aria-label="Copy Call ID"]');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('call-abc-123');

    const restart = sheet.locator('button:has-text("Request ICE Restart")');
    await expect(restart).toBeEnabled();
    await setState(page, { recoveryState: 'recovering' });
    await expect(sheet.locator('button:has-text("Recovery in progress")')).toBeDisabled();
    await setState(page, { recoveryState: 'idle' });
    await restart.click();
    await expect.poll(() => drainLog(page)).toEqual([['iceRestart']]);
    await expect(sheet).toHaveCount(0);
  });

  test('the sheet also opens from the More sheet and closes on Escape', async ({ page }) => {
    await page.click('button[aria-label="More call controls"]');
    await page.click('text=Call Statistics');
    await expect(page.locator('text=Round-trip time')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Round-trip time')).toHaveCount(0);
  });

  test('the badge shows while media is disrupted even before connect', async ({ page }) => {
    await setState(page, { callStatus: 'connecting', connectedAt: null, isMediaDisrupted: true });
    await expect(page.locator('button[aria-label="Call statistics"]')).toHaveCount(1);
    await setState(page, { isMediaDisrupted: false });
    await expect(page.locator('button[aria-label="Call statistics"]')).toHaveCount(0);
  });

  test('Health lists the SDK issues behind a Degraded reading', async ({ page }) => {
    await page.click('button[aria-label="Call statistics"]');
    const sheet = page.locator('[role="dialog"]:has-text("Call Statistics")');
    await expect(sheet).toContainText('Healthy');
    await page.evaluate(() =>
      window.__issues.next([{ type: 'high_jitter', severity: 'warning', value: 9.1, threshold: 8, timestamp: Date.now() }]),
    );
    await expect(sheet).toContainText('Degraded · 1 issue');
    await expect(sheet).toContainText('Jitter spike · warning · 9 ms (threshold 8 ms)');
    await page.evaluate(() =>
      window.__issues.next([
        { type: 'high_packet_loss', severity: 'critical', value: 12.34, threshold: 10, timestamp: Date.now() },
        { type: 'no_inbound_audio', severity: 'critical', value: 2500, threshold: 2000, timestamp: Date.now() },
      ]),
    );
    await expect(sheet).toContainText('Degraded · 2 issues');
    await expect(sheet).toContainText('Packet loss · critical · 12.3% (threshold 10.0%)');
    await expect(sheet).toContainText('No inbound audio · critical · 2500 ms (threshold 2000 ms)');
    await page.evaluate(() => window.__issues.next([]));
    await expect(sheet).toContainText('Healthy');
  });

  test("the SDK's no-inbound-video issue is ignored unless the far end sends video", async ({ page }) => {
    // rc.5's stats monitor reports it on every call without an inbound video
    // track (see relevantIssues() in the service).
    const relevant = (remoteHasVideo: boolean) =>
      evalInApp<string[]>(
        page,
        `s.remoteHasVideo = ${remoteHasVideo};
         return s.relevantIssues([
           { type: 'no_inbound_video', severity: 'warning', timestamp: 0 },
           { type: 'high_rtt', severity: 'critical', timestamp: 0 },
         ]).map((issue) => issue.type);`,
      );
    expect(await relevant(false)).toEqual(['high_rtt']);
    expect(await relevant(true)).toEqual(['no_inbound_video', 'high_rtt']);
  });
});
