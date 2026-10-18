import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, drainLog, evalInApp, openDialer, setState } from './helpers';

const PREFLIGHT_RESULT = `{
  ok: false,
  signaling: { reachable: true, rttMs: 31.4 },
  connectivity: { type: 'relay', turnReachable: true, stunReachable: false, rttMs: 58 },
  bandwidth: null,
  devices: { audioInput: { working: true, device: { label: 'Fake Mic' } }, videoInput: { working: false, device: null }, audioOutput: { available: true, device: null } },
  warnings: ['STUN unreachable'],
}`;

test.describe('Diagnostics & Settings', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(
      page,
      `
      s.applySettings = (settings) => { log('apply', settings); };
      s.runPreflight = async (dest, opts) => { log('preflight', dest, opts); return ${PREFLIGHT_RESULT}; };
      s.setDoNotDisturb = async (enabled) => { log('dnd', enabled); store.getState().setCallState({ isRegistered: !enabled }); };
    `,
    );
    await page.click('button[aria-label="Diagnostics"]');
    await expect(page.locator('text=Diagnostics & Settings')).toBeVisible();
  });

  test('settings apply live and persist', async ({ page }) => {
    await page.click('button[aria-label="Move opus up"]');
    await page.click('button[aria-label="Move opus up"]');
    await expect(page.locator('ol[aria-label="Audio codec order"] li').first()).toContainText('Opus');
    await page.click('button[role="switch"]:has-text("Relay only")');
    await page.selectOption('label:has-text("SDK log level") select', 'debug');

    const applied = await drainLog(page);
    expect(applied.length).toBe(4);
    expect(applied.at(-1)).toMatchObject(['apply', { audioCodecOrder: ['opus', 'PCMU', 'PCMA'], relayOnly: true, logLevel: 'debug' }]);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dialer_settings') ?? '{}'));
    expect(stored).toMatchObject({ relayOnly: true, logLevel: 'debug', audioCodecOrder: ['opus', 'PCMU', 'PCMA'] });
    await expect(page.locator('text=SDK version').locator('..')).toContainText(/4\.0\.0/);

    await page.reload();
    await page.locator(ADDRESS_INPUT).waitFor();
    await page.click('button[aria-label="Diagnostics"]');
    await expect(page.locator('button[role="switch"]:has-text("Relay only")')).toHaveAttribute('aria-checked', 'true');
  });

  test('the connection test passes its options and shows the full result', async ({ page }) => {
    await page.click('button[role="switch"]:has-text("Skip media test")');
    await expect(page.locator('text=Media test length')).toHaveCount(0);
    await page.fill('input[aria-label="Number or address to test"]', '/public/test');
    await page.click('button:has-text("Run")');
    await expect.poll(() => drainLog(page)).toEqual([['preflight', '/public/test', { skipMediaTest: true, duration: 10 }]]);
    const panel = page.locator('[role="dialog"][aria-labelledby="diagnostics-title"]');
    await expect(panel).toContainText('STUN unreachable');
    await expect(panel).toContainText('TURN ok (58ms)');
    await expect(panel).toContainText('Mic: working (Fake Mic)');
    await expect(panel).toContainText('Camera: not working');
    await expect(panel).toContainText('Speaker: available');
  });

  test('explains that the codec order does not apply to phone numbers', async ({ page }) => {
    const panel = page.locator('[role="dialog"][aria-labelledby="diagnostics-title"]');
    await expect(panel).toContainText('calls to phone numbers use G.711');
    const hint = panel.getByText('the codec order below has no effect');
    const field = page.locator('input[aria-label="Number or address to test"]');
    await expect(hint).toHaveCount(0);
    await field.fill('5551234567');
    await expect(hint).toHaveCount(1);
    await field.fill('sip:alice@example.com');
    await expect(hint).toHaveCount(0);
    // A signaling-only test places no call, so there is nothing to warn about.
    await field.fill('(555) 123-4567');
    await expect(hint).toHaveCount(1);
    await page.click('button[role="switch"]:has-text("Skip media test")');
    await expect(hint).toHaveCount(0);
  });
});

test('Do Not Disturb toggles registration and shows in the status bar', async ({ page }) => {
  await openDialer(page);
  await evalInApp(page, `s.setDoNotDisturb = async (enabled) => { log('dnd', enabled); store.getState().setCallState({ isRegistered: !enabled }); };`);
  await page.click('button[aria-label="Subscriber"]');
  const dnd = page.locator('button[role="switch"]:has-text("Do Not Disturb")');
  await expect(dnd).toHaveAttribute('aria-checked', 'false');
  await dnd.click();
  await expect.poll(() => drainLog(page)).toEqual([['dnd', true]]);
  await expect(dnd).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[title="Do Not Disturb — not receiving calls"]')).toHaveCount(1);
  await dnd.click();
  await expect.poll(() => drainLog(page)).toEqual([['dnd', false]]);
  await expect(page.locator('[title="Do Not Disturb — not receiving calls"]')).toHaveCount(0);
});

test('device-switch notices appear as dismissible info banners', async ({ page }) => {
  await openDialer(page);
  await setState(page, { clientNotice: 'Microphone switched to "USB Mic": the previous one was disconnected.' });
  const notice = page.locator('[role="status"]:has-text("Microphone switched")');
  await expect(notice).toBeVisible();
  await notice.locator('button[aria-label="Dismiss"]').click();
  await expect(notice).toHaveCount(0);
});
