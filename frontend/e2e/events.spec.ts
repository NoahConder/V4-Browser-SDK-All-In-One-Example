import { expect, test } from '@playwright/test';
import { evalInApp, openDialer } from './helpers';

// The in-app event log (signalwire.ts's getEventLog$ -> EventLog.tsx), shown
// as a section of the Diagnostics panel. The service's private logEvent() is
// reachable at runtime, so the test feeds it directly.
test('the Events section lists what the service logged, filters by kind, copies and clears', async ({ page }) => {
  await openDialer(page);
  await page.click('button[aria-label="Diagnostics"]');
  const panel = page.locator('[role="dialog"][aria-labelledby="diagnostics-title"]');
  const log = panel.locator('[role="log"]');
  await expect(log.getByText('No events yet.')).toBeVisible();

  await evalInApp(
    page,
    `
    s.logEvent('user', 'Dialing', '+15551234567');
    s.logEvent('call', 'Status: ringing');
    s.logEvent('error', 'Dial failed', '486 Busy Here');
  `,
  );
  await expect(log.locator('li')).toHaveCount(3);
  await expect(log).toContainText('Dialing');
  await expect(log).toContainText('+15551234567');
  await expect(log).toContainText('486 Busy Here');

  // A kind filter narrows the rows and what Copy puts on the clipboard.
  await panel.getByRole('button', { name: 'Errors', exact: true }).click();
  await expect(log.locator('li')).toHaveCount(1);
  await expect(log).toContainText('Dial failed');
  await panel.getByRole('button', { name: 'Copy event log' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('[error] Dial failed — 486 Busy Here');
  expect(copied).not.toContain('Dialing');

  // Clear hides what's there; later entries still arrive.
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.getByRole('button', { name: 'Clear event log' }).click();
  await expect(log.getByText('No events yet.')).toBeVisible();
  await page.waitForTimeout(5);
  await evalInApp(page, `s.logEvent('client', 'Connected and ready');`);
  await expect(log.locator('li')).toHaveCount(1);
  await expect(log).toContainText('Connected and ready');
});
