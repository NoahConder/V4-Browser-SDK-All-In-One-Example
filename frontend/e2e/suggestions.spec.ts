import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, drainLog, evalInApp, openDialer, stubCallMethods } from './helpers';

// Suggestions under the address field (hooks/useAddressSuggestions.ts,
// components/AddressSuggestions.tsx): Recents first, then the loaded
// Directory. Seeded straight into the Recents store.
const SEED_RECENTS = `
  recents.setState({ entries: [
    { id: 'r1', destination: '/private/alice?channel=video', label: 'Alice', direction: 'outbound', outcome: 'answered',
      startedAt: Date.now() - 60000, connectedAt: Date.now() - 59000, endedAt: Date.now() - 1000, video: true },
    { id: 'r2', destination: '+15551234567', label: '+15551234567', direction: 'inbound', outcome: 'missed',
      startedAt: Date.now() - 120000, video: false },
  ] });
`;

test.describe('address suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
    await evalInApp(page, SEED_RECENTS);
  });

  test('typing offers matching Recents; Down and Enter pick one without dialing', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    const listbox = page.getByRole('listbox', { name: 'Suggested destinations' });
    await input.fill('ali');
    await expect(listbox.getByRole('option')).toHaveCount(1);
    await expect(listbox).toContainText('Alice');
    await expect(listbox).toContainText('/private/alice');
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('/private/alice?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await expect(listbox).toHaveCount(0);
    expect(await drainLog(page)).toEqual([]);

    // With the list gone, Enter dials what was picked -- as a video call.
    await page.keyboard.press('Enter');
    await expect.poll(() => drainLog(page)).toEqual([['makeCall', '/private/alice?channel=video', true]]);
  });

  test('digits match a recent number; Escape closes the list; a click picks', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    const listbox = page.getByRole('listbox', { name: 'Suggested destinations' });
    await input.fill('555123');
    await expect(listbox).toContainText('+15551234567');
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);

    await input.fill('5551234');
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option').first().click();
    await expect(input).toHaveValue('+15551234567');
    await expect(listbox).toHaveCount(0);
    await expect(input).toBeFocused();
  });
});
