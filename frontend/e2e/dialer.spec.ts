import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, CALLER_IDS, callStatusText, drainLog, evalInApp, openDialer, setState, stubCallMethods, stubCallerIds } from './helpers';

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

  test('the From, Video and Call buttons fit beside each other', async ({ page }) => {
    for (const label of ['Caller ID: default', 'Video call off', 'Call']) {
      const box = (await page.locator(`button[aria-label="${label}"]`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
  });

  // Skipped while SHOW_CAMERA_OFF_JOIN (src/hooks/useDialFieldStore.ts) is
  // false: Video on keeps From. Restore test() with the flag.
  test.skip('Video on swaps From for the camera-off toggle, which fits', async ({ page }) => {
    await page.click('button[aria-label="Video call off"]');
    await expect(page.locator('button[aria-label^="Caller ID"]')).toHaveCount(0);
    for (const label of ['Start with camera on', 'Video call on', 'Call']) {
      const box = (await page.locator(`button[aria-label="${label}"]`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
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
    await input.fill('/public/room');
    await page.click('button[aria-label="Video call off"]');
    await expect(input).toHaveValue('/public/room?channel=video');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '/public/room?channel=video', true]]);
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
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/public/room-a?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    expect(await drainLog(page)).toEqual([]);
  });
});

// The Video toggle is the channel of a Fabric address (useDialFieldStore): the
// field is the dial string, so the two can't disagree. Default viewport -- the
// type label under the field is hidden below 360px.
test.describe('video toggle', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
  });

  test('rewrites a Fabric address\'s channel, and follows a typed one', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('/private/alice?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await expect(page.getByText('Fabric address · video')).toBeVisible();
    await page.click('button[aria-label="Video call on"]');
    await expect(input).toHaveValue('/private/alice?channel=audio');
    await expect(page.locator('button[aria-label="Video call off"]')).toHaveCount(1);
    await expect(page.getByText('Fabric address · audio')).toBeVisible();

    // A typed channel sets the toggle (case-insensitively); editing re-derives it.
    await input.fill('/private/alice?channel=VIDEO');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await input.press('Backspace');
    await expect(page.locator('button[aria-label="Video call off"]')).toHaveCount(1);

    // A bare address is the server's default channel (audio); on appends.
    await input.fill('/public/room');
    await expect(page.locator('button[aria-label="Video call off"]')).toHaveCount(1);
    await page.click('button[aria-label="Video call off"]');
    await expect(input).toHaveValue('/public/room?channel=video');
  });

  test('is disabled for phone numbers and never leaks into their dial', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('/public/room');
    await page.click('button[aria-label="Video call off"]');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await input.fill('5551234567');
    const toggle = page.locator('button[aria-label="Video call off"]');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('title', "Video isn't available for phone numbers");
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '5551234567', false]]);
    expect(await evalInApp(page, `return store.getState().isVideoCall;`)).toBe(false);
  });

  test('is a free camera choice for a SIP URI, with no channel added', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('sip:bob@example.com');
    const toggle = page.locator('button[aria-label="Video call off"]');
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(input).toHaveValue('sip:bob@example.com');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', 'sip:bob@example.com', true]]);
  });

  test('keeps the picked label through a toggle, and Recents stores the dialed string', async ({ page }) => {
    await page.evaluate(
      `import('/src/hooks/useDialFieldStore.ts').then((m) => m.useDialFieldStore.getState().selectAddress('/private/alice?channel=audio', false, 'Alice'))`,
    );
    const input = page.locator(ADDRESS_INPUT);
    await expect(input).toHaveValue('/private/alice?channel=audio');
    await page.click('button[aria-label="Video call off"]');
    await expect(input).toHaveValue('/private/alice?channel=video');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '/private/alice?channel=video', true]]);
    await expect
      .poll(() => evalInApp(page, `return recents.getState().entries[0];`))
      .toMatchObject({ label: 'Alice', destination: '/private/alice?channel=video', video: true });
  });

  // While SHOW_CAMERA_OFF_JOIN (src/hooks/useDialFieldStore.ts) is false the
  // toggle never renders and the dial row keeps From with Video on.
  test('the camera-off toggle is hidden', async ({ page }) => {
    await page.locator(ADDRESS_INPUT).fill('/public/room');
    await page.click('button[aria-label="Video call off"]');
    await expect(page.locator('button[aria-label^="Start with camera"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label^="Caller ID"]')).toHaveCount(1);
  });

  // Skipped while SHOW_CAMERA_OFF_JOIN is false (the toggle isn't rendered).
  // Restore test() with the flag, and drop the hidden-toggle test above.
  test.skip('camera off: shown only with Video on, joins receiving video but not sending', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('/public/room');
    await expect(page.locator('button[aria-label="Start with camera on"]')).toHaveCount(0);
    await page.click('button[aria-label="Video call off"]');
    await page.click('button[aria-label="Start with camera on"]');
    const toggle = page.locator('button[aria-label="Start with camera off"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // A send-side choice: the dial string keeps its video channel.
    await expect(input).toHaveValue('/public/room?channel=video');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '/public/room?channel=video', true, 'camera off']]);
    expect(await evalInApp(page, `const st = store.getState(); return [st.isVideoCall, st.isCameraOn];`)).toEqual([true, false]);
  });

  test.skip('camera off is ignored with Video off, and survives toggling Video', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('/public/room');
    await page.click('button[aria-label="Video call off"]');
    await page.click('button[aria-label="Start with camera on"]');
    await page.click('button[aria-label="Video call on"]');
    await expect(page.locator('button[aria-label="Start with camera off"]')).toHaveCount(0);
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '/public/room?channel=audio', false]]);

    await setState(page, { isInCall: false, callStatus: 'idle' });
    await page.click('button[aria-label="Video call off"]');
    await expect(page.locator('button[aria-label="Start with camera off"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test.skip('answering a video call honors camera off', async ({ page }) => {
    await page.locator(ADDRESS_INPUT).fill('/public/room');
    await page.click('button[aria-label="Video call off"]');
    await page.click('button[aria-label="Start with camera on"]');
    await setState(page, { isInCall: false, isIncoming: true, isVideoCall: true, callStatus: 'ringing', remoteNumber: '+15551234567' });
    await page.click('button[aria-label="Accept"]');
    await expect.poll(() => drainLog(page)).toEqual([['answer', 'camera off']]);
    expect(await evalInApp(page, `const st = store.getState(); return [st.isVideoCall, st.isCameraOn];`)).toEqual([true, false]);
  });

  test('withChannel and channelOf follow the truth table', async ({ page }) => {
    const got = await page.evaluate(`import('/src/utils/address.ts').then((m) => [
      m.withChannel('/public/room', 'video'),
      m.withChannel('/public/room', 'audio'),
      m.withChannel('/public/room?channel=audio', 'video'),
      m.withChannel('/public/room?channel=video', 'audio'),
      m.withChannel('/public/room?foo=1', 'video'),
      m.withChannel(' /public/room ', 'video'),
      m.withChannel('sip:bob@example.com', 'video'),
      m.withChannel('5551234567', 'video'),
      m.channelOf('/public/room?channel=VIDEO'),
      m.channelOf('/public/room?foo=1&channel=audio'),
      m.channelOf('/public/room'),
    ])`);
    expect(got).toEqual([
      '/public/room?channel=video',
      '/public/room',
      '/public/room?channel=video',
      '/public/room?channel=audio',
      '/public/room?foo=1&channel=video',
      '/public/room?channel=video',
      'sip:bob@example.com',
      '5551234567',
      'video',
      'audio',
      null,
    ]);
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

test.describe('caller ID picker', () => {
  test.beforeEach(async ({ page }) => {
    await stubCallerIds(page);
    await openDialer(page);
    await stubCallMethods(page);
  });

  test('picks a number, sends it for phone numbers only, and remembers it', async ({ page }) => {
    const from = page.locator('button[aria-label^="Caller ID"]');
    await expect(from).toHaveAttribute('aria-label', 'Caller ID: default');
    await from.click();
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toContainText('Default (server chooses)');
    await expect(sheet.getByText('Phone numbers', { exact: true })).toHaveCount(1);
    await expect(sheet.getByText('Verified caller IDs', { exact: true })).toHaveCount(1);
    await expect(sheet).toContainText("Noah's mobile");
    await sheet.locator('button:has-text("+1 (555) 000-0001")').click();
    await expect(sheet).toHaveCount(0);
    await expect(from).toHaveAttribute('aria-label', 'Caller ID: +1 (555) 000-0001');
    await expect(from).toContainText('Main line');
    // Picking hands focus back to the address field, so Enter still dials.
    const input = page.locator(ADDRESS_INPUT);
    await expect(input).toBeFocused();

    await input.fill('5551234567');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '5551234567', false, '+15550000001']]);
    expect(await evalInApp(page, `return store.getState().outboundCallerId;`)).toBe('+15550000001');
    await expect(page.getByText('From +1 (555) 000-0001')).toBeVisible();
    await evalInApp(page, `store.getState().resetCallState();`);

    // Not for a SIP URI or a Fabric address: the button is locked out and
    // nothing is sent.
    await input.fill('sip:bob@example.com');
    await expect(from).toBeDisabled();
    await expect(from).toHaveAttribute('title', 'Caller ID applies to phone numbers only');
    await input.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', 'sip:bob@example.com', false]]);
    await evalInApp(page, `store.getState().resetCallState();`);
    await input.fill('/public/room');
    await expect(from).toBeDisabled();

    // The choice survives a reload; Default clears it.
    await openDialer(page);
    await stubCallMethods(page);
    await expect(from).toHaveAttribute('aria-label', 'Caller ID: +1 (555) 000-0001');
    await from.click();
    await sheet.locator('button:has-text("Default (server chooses)")').click();
    await expect(from).toHaveAttribute('aria-label', 'Caller ID: default');
  });

  test('shows the backend error with Retry, and names a source that failed', async ({ page }) => {
    // Fails until the test says otherwise (a "fail once" counter would be
    // consumed by StrictMode's double effect in the dev server).
    let failing = true;
    await page.route('**/api/caller-ids*', (route) => {
      if (failing) {
        return route.fulfill({ status: 500, json: { success: false, error: 'Failed to list caller IDs' } });
      }
      return route.fulfill({ json: { ...CALLER_IDS, data: [CALLER_IDS.data[1]], total: 1, failed: ['numbers'] } });
    });
    await page.click('button[aria-label^="Caller ID"]');
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toContainText("The backend couldn't complete the request");
    failing = false;
    await sheet.locator('button:has-text("Retry")').click();
    await expect(sheet.getByText('Verified caller IDs', { exact: true })).toHaveCount(1);
    await expect(sheet.getByText('Phone numbers', { exact: true })).toHaveCount(0);
    await expect(sheet).toContainText("Couldn't load phone numbers");
  });
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

  // Skipped while SHOW_TRANSFER (src/components/CallScreen.tsx) is false: the
  // More sheet has no Transfer row to open. Restore test() with the flag.
  test.skip('typing in the Transfer field sends no DTMF; Escape closes it', async ({ page }) => {
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

  test('the toolbar carries hold and screen share on phones too; transfer is hidden', async ({ page }) => {
    await expect(page.locator('button[aria-label="Hold call"]')).toBeVisible();
    // Hidden behind SHOW_TRANSFER (src/components/CallScreen.tsx).
    await expect(page.locator('button[aria-label="Transfer call"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="Start screen share"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="End call"]')).toHaveCount(1);
    await page.click('button[aria-label="More call controls"]');
    await expect(page.locator('[role="dialog"] >> text=Hold Call')).toHaveCount(1);
    await expect(page.locator('[role="dialog"] >> text=Transfer Call')).toHaveCount(0);
  });
});
