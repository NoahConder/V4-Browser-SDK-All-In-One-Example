import { test, type Page } from '@playwright/test';
import { ADDRESS_INPUT, openDialer, setState, stubCallMethods } from './helpers';

// Non-asserting screenshots of each screen at four viewports, for eyeballing
// layout changes. Only the `shots` project runs this file:
// `npm run test:shots`, then look in e2e/screenshots/.
// Dark is the default run (the devcontainer's Chromium prefers dark); the two
// `-light` entries repeat the phone and the workbench in the light theme.
const VIEWPORTS: Record<string, { width: number; height: number; colorScheme?: 'light' | 'dark' }> = {
  iphone: { width: 390, height: 844 },
  se: { width: 320, height: 568 },
  landscape: { width: 844, height: 390 },
  desktop: { width: 1280, height: 800 },
  'iphone-light': { width: 390, height: 844, colorScheme: 'light' },
  'desktop-light': { width: 1280, height: 800, colorScheme: 'light' },
};

type Shot = (state: string) => Promise<unknown>;

// The call screens are the same flow on every layout.
const callScreens = async (page: Page, shot: Shot) => {
  await setState(page, { callError: 'Call failed: destination unreachable (486 Busy Here)' });
  await shot('07-error');
  await setState(page, { callError: null, isIncoming: true, remoteNumber: '+15551234567' });
  await shot('08-incoming');
  await setState(page, { isIncoming: false, isInCall: true, callStatus: 'ringing', callDirection: 'outbound' });
  await shot('09-ringing');
  await setState(page, { callStatus: 'connected', connectedAt: Date.now() - 83_000, qualityLevel: 'good', qualityScore: 4.2 });
  await shot('10-connected');
  await page.click('button[aria-label="More call controls"]');
  await shot('11-more');
  await page.keyboard.press('Escape');
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`screens at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ colorScheme: viewport.colorScheme ?? 'dark' });
    await openDialer(page);
    await stubCallMethods(page);
    const shot: Shot = (state) => page.screenshot({ path: `e2e/screenshots/${name}-${state}.png` });

    await shot('01-idle');
    await page.fill(ADDRESS_INPUT, '5551234567');
    await page.locator('body').click({ position: { x: 5, y: viewport.height - 5 } });
    await shot('02-number');

    if (name.startsWith('desktop')) {
      // The workbench: panes instead of header panels.
      await page.getByRole('tab', { name: 'Recents' }).click();
      await shot('03-recents');
      await page.getByRole('tab', { name: 'Events' }).click();
      await shot('04-events');
      await page.getByRole('tab', { name: 'Session' }).click();
      await shot('05-session');
      await page.getByRole('tab', { name: 'Directory' }).click();
      await callScreens(page, shot);
      await shot('12-stats');
    } else {
      for (const [label, state] of [
        ['Audio & Video Devices', '03-devices'],
        ['Diagnostics', '04-diagnostics'],
        ['Dialable Resources', '05-resources'],
        ['Subscriber', '06-subscriber'],
      ]) {
        await page.click(`button[aria-label="${label}"]`);
        await page.waitForTimeout(500);
        await shot(state);
        await page.keyboard.press('Escape');
      }
      await callScreens(page, shot);
      await page.click('button[aria-label="Call statistics"]');
      await shot('12-stats');
      await page.keyboard.press('Escape');
    }

    await page.click('button[aria-label="Keypad"]');
    await shot('13-keypad');
  });
}
