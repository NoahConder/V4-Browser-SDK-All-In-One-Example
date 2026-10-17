import { expect, test } from '@playwright/test';
import { drainLog, openDialer, setState, stubCallMethods } from './helpers';

const activeDescription = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return 'none';
    const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '';
    return `${el.tagName.toLowerCase()}[${label}]`;
  });

test('installable: manifest, icons, zoomable viewport, theme color', async ({ page, request }) => {
  await openDialer(page);
  for (const [path, type] of [
    ['/manifest.webmanifest', 'json'],
    ['/icon-192.png', 'image/png'],
    ['/icon-512.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain(type);
  }
  const viewport = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
  expect(viewport).not.toContain('user-scalable=no');
  expect(viewport).toContain('viewport-fit=cover');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('.glass-bar.pt-safe')).toHaveCount(1);
});

test('header panels are modal dialogs that trap and return focus', async ({ page }) => {
  await openDialer(page);
  await page.click('button[aria-label="Diagnostics"]');
  const dialog = page.locator('[role="dialog"][aria-labelledby="diagnostics-title"]');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await activeDescription(page)).toBe('input[Number or address to test]');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await activeDescription(page)).toBe('button[Diagnostics]');

  await page.click('button[aria-label="Subscriber"]');
  const subscriberDialog = page.locator('[role="dialog"][aria-labelledby="subscriber-title"]');
  await expect(subscriberDialog).toBeVisible();
  const items = await subscriberDialog.evaluate((el) => el.querySelectorAll('button:not([disabled])').length);
  for (let i = 0; i < items + 1; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
});

test('in-call sheets are modal dialogs; the status line is a live region', async ({ page }) => {
  await openDialer(page);
  await stubCallMethods(page);
  await setState(page, { isInCall: true, callStatus: 'connected', connectedAt: Date.now(), remoteNumber: '+15551234567' });
  await page.click('button[aria-label="More call controls"]');
  const sheet = page.locator('[role="dialog"][aria-modal="true"]:has-text("More Controls")');
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await activeDescription(page)).toBe('button[More call controls]');
  await expect(page.locator('[aria-live="polite"]:has-text("Connected")')).toHaveCount(1);
});

test('incoming call: Enter answers, Escape declines; subscriber caller ids are shown by name', async ({ page }) => {
  await openDialer(page);
  await stubCallMethods(page);
  // A browser-to-browser caller arrives as "subscriber://<name>" (seen on a real call).
  await setState(page, { isInCall: false, isIncoming: true, callStatus: 'ringing', remoteNumber: 'subscriber://noah-test' });
  await expect(page.locator('.select-text:has-text("noah-test")')).toBeVisible();
  await expect(page.locator('text=subscriber://')).toHaveCount(0);
  await setState(page, { isInCall: false, isIncoming: true, callStatus: 'ringing', remoteNumber: '+15551234567' });
  await expect(page.locator('button[aria-label="Accept"]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => drainLog(page)).toEqual([['answer']]);
  await setState(page, { isInCall: false, isIncoming: true, callStatus: 'ringing', remoteNumber: '+15551234567' });
  await page.keyboard.press('Escape');
  await expect.poll(() => drainLog(page)).toEqual([['reject']]);
});
