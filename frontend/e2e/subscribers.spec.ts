import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, openDialer } from './helpers';

const SUBSCRIBERS = {
  success: true,
  data: [
    {
      id: 'sub-noah',
      display_name: 'noah.test',
      email: 'noah.test@not-real.com',
      addresses: [{ id: 'a1', name: 'noah-test', display_name: 'noah.test', channels: { audio: '/private/noah-test?channel=audio', video: '/private/noah-test?channel=video' } }],
    },
    {
      id: 'sub-swdialer',
      display_name: 'swdialer',
      email: null,
      addresses: [{ id: 'a2', name: 'swdialer', display_name: 'swdialer', channels: { audio: '/private/swdialer?channel=audio', video: '/private/swdialer?channel=video' } }],
    },
  ],
  total: 2,
  offset: 0,
  limit: 10,
  has_more: false,
};

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[role="dialog"][aria-labelledby="subscriber-title"] div.rounded-xl:has(span.text-sm:has-text("${name}"))`);

test.describe('Subscriber panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/subscribers*', (route) => route.fulfill({ json: SUBSCRIBERS }));
    await openDialer(page);
    await page.click('button[aria-label="Subscriber"]');
    await expect(row(page, 'noah.test')).toBeVisible();
  });

  test('each subscriber shows its Fabric address with Audio/Video call buttons and a Switch action', async ({ page }) => {
    const noah = row(page, 'noah.test');
    await expect(noah).toContainText('/private/noah-test');
    await expect(noah.locator('button:has-text("Audio")')).toBeEnabled();
    await expect(noah.locator('button:has-text("Video")')).toBeEnabled();
    await expect(noah.locator('button:has-text("Switch")')).toHaveCount(1);
  });

  test('Audio fills the dial field with the subscriber address and closes the panel', async ({ page }) => {
    await row(page, 'noah.test').locator('button:has-text("Audio")').click();
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/noah-test?channel=audio');
    await expect(page.locator('button[aria-label="Video call off"]')).toHaveCount(1);
    await expect(page.locator('[role="dialog"][aria-labelledby="subscriber-title"]')).toHaveCount(0);
    await expect(page.locator('text=Fabric address')).toHaveCount(1);
  });

  test('Video fills the video channel and turns the video toggle on', async ({ page }) => {
    await row(page, 'swdialer').locator('button:has-text("Video")').click();
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/swdialer?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
  });
});
