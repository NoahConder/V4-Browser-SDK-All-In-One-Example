import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, callStatusText, drainLog, evalInApp, openDialer, setState, stubCallMethods } from './helpers';

// Shared with backend/tests/test_numbers.py so the two normalizers stay in sync.
const normalization = JSON.parse(
  readFileSync(new URL('./fixtures/dial-normalization.json', import.meta.url), 'utf8'),
) as Array<{ input: string; expected: string }>;

test.describe('dial pad on a small phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
  });

  test('formatted number fits the address field', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('5551234567');
    await input.blur();
    await expect(input).toHaveValue('(555) 123-4567');
    const fit = await input.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(fit.sw).toBeLessThanOrEqual(fit.cw);
  });

  test('tap Delete removes one character; hold 0 types +', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('5551234567');
    await page.locator('button[aria-label="Delete"]').tap();
    expect((await input.inputValue()).replace(/\D/g, '')).toBe('555123456');

    await page.locator('button[aria-label="Clear"]').click();
    const zero = page.locator('button[aria-label="0, hold for +"]');
    const box = (await zero.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await expect(input).toHaveValue('+');
    await zero.tap();
    await expect(input).toHaveValue('+0');
  });

  test('clicking a key keeps focus in the address field', async ({ page }) => {
    await page.locator(ADDRESS_INPUT).focus();
    await page.locator('button:has(.dial-button-number:text-is("7"))').click();
    await expect(page.locator(ADDRESS_INPUT)).toBeFocused();
  });

  test('Enter dials only from the address field; Escape closes panels', async ({ page }) => {
    await page.click('button[aria-label="Diagnostics"]');
    const diag = page.locator('input[aria-label="Number or address to test"]');
    await diag.fill('/public/ui-test');
    await diag.press('Enter');
    expect(await drainLog(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(diag).toHaveCount(0);

    const input = page.locator(ADDRESS_INPUT);
    await input.fill('5551234567');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '5551234567', false]]);
  });

  test('Enter honors a video toggle flipped after typing', async ({ page }) => {
    // The Enter listener is bound once per screen state; it must read the
    // current toggle, not the one captured when it was bound.
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('5551234567');
    await page.click('button[aria-label="Video call off"]');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '5551234567', true]]);
    expect(await evalInApp(page, `return store.getState().isVideoCall;`)).toBe(true);
  });

  test('an error banner leaves the Call button on screen', async ({ page }) => {
    await page.locator(ADDRESS_INPUT).fill('5551234567');
    await setState(page, { callError: 'Call failed: destination unreachable (486 Busy Here)' });
    const box = (await page.locator('button[aria-label="Call"]').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(568);
  });

  test('empty field + Call fills in the last outbound destination', async ({ page }) => {
    await evalInApp(page, `recents.getState().start({ direction: 'outbound', destination: '/public/room-a', label: 'Room A', video: true });`);
    await evalInApp(page, `recents.getState().finish('answered');`);
    await page.click('button[aria-label="Call"]');
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/public/room-a');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    expect(await drainLog(page)).toEqual([]);
  });
});

test('normalizes destinations the same way as the backend', async ({ page }) => {
  await openDialer(page);
  const got = await evalInApp<string[]>(
    page,
    `return ${JSON.stringify(normalization.map((c) => c.input))}.map((v) => s.normalizeDestination(v));`,
  );
  expect(got).toEqual(normalization.map((c) => c.expected));
});

test.describe('in a call', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
    await setState(page, {
      isInCall: true,
      isIncoming: false,
      callStatus: 'connecting',
      remoteNumber: '+15551234567',
      callDirection: 'outbound',
    });
    await expect(page.locator('button[aria-label="End call"]')).toBeVisible();
  });

  test('status line follows the call and the timer starts at connect', async ({ page }) => {
    expect(await callStatusText(page)).toContain('Calling');
    await expect(page.locator('div.inline-block.tabular-nums')).toHaveCount(0);
    await setState(page, { callStatus: 'ringing' });
    expect(await callStatusText(page)).toContain('Ringing');
    await setState(page, { callStatus: 'connected', connectedAt: Date.now() - 65_000 });
    expect(await callStatusText(page)).toContain('Connected');
    await expect(page.locator('div.inline-block.tabular-nums')).toHaveText(/01:0[56]/);
    await expect(page.locator('.select-text:has-text("+1 (555) 123-4567")')).toHaveCount(1);
  });

  test('DTMF is dropped until connected, from keyboard and keypad', async ({ page }) => {
    await page.keyboard.press('5');
    expect(await drainLog(page)).toEqual([]);
    await page.click('button[aria-label="Keypad"]');
    const key5 = page.locator('button:has(.dial-button-number:text-is("5"))');
    await expect(key5).toBeDisabled();
    await expect(page.locator('text=Keypad available once connected')).toHaveCount(1);
    await setState(page, { callStatus: 'connected', connectedAt: Date.now() });
    await expect(key5).toBeEnabled();
    await key5.click();
    await page.keyboard.press('7');
    await expect.poll(() => drainLog(page)).toEqual([['dtmf', '5'], ['dtmf', '7']]);
    await page.click('button[aria-label="End call"]');
    await expect.poll(() => drainLog(page)).toEqual([['endCall']]);
  });

  test('typing in the Transfer field sends no DTMF; Escape closes it', async ({ page }) => {
    await setState(page, { callStatus: 'connected', connectedAt: Date.now() });
    await page.click('button[aria-label="More call controls"]');
    await page.click('text=Transfer Call');
    const transfer = page.locator('[role="dialog"] input[placeholder="Number or address"]');
    await transfer.pressSequentially('5551234');
    expect(await drainLog(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(transfer).toHaveCount(0);
  });

  test('M toggles mute; the audio-unlock control calls resumeRemoteAudio', async ({ page }) => {
    await setState(page, { callStatus: 'connected', connectedAt: Date.now() });
    await page.keyboard.press('m');
    await expect.poll(() => drainLog(page)).toEqual([['mute', true]]);
    await setState(page, { needsAudioUnlock: true });
    const unlock = page.locator('button:has-text("Tap to enable audio")');
    await unlock.click();
    await expect.poll(() => drainLog(page)).toEqual([['resumeRemoteAudio']]);
    await expect(unlock).toHaveCount(0);
  });

  test('Speaker is disabled when the browser cannot choose an output', async ({ page }) => {
    await setState(page, { canSelectAudioOutput: false });
    await expect(page.locator('button[aria-label="Speaker"]')).toBeDisabled();
    await setState(page, { canSelectAudioOutput: true });
    await expect(page.locator('button[aria-label="Speaker"]')).toBeEnabled();
  });

  test('the toolbar carries hold, transfer and screen share on phones too', async ({ page }) => {
    await expect(page.locator('button[aria-label="Hold call"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Transfer call"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Start screen share"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="End call"]')).toHaveCount(1);
  });
});
