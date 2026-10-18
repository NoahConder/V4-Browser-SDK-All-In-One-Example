import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, FAKE_DIRECTORY, STATS_STUBS, evalInApp, openDialer, setState, stubCallMethods } from './helpers';

// The desktop workbench (components/Workbench.tsx), which App.tsx renders from
// 1024px up: the bar, then Destinations | the call stage | Inspector. Runs in
// the `desktop` project (1280x800); the phone suite never sees it.
const SUBSCRIBERS = {
  success: true,
  data: [
    {
      id: 'sub-noah',
      display_name: 'noah.test',
      email: 'noah.test@not-real.com',
      addresses: [{ id: 'a1', name: 'noah-test', display_name: 'noah.test', channels: { audio: '/private/noah-test?channel=audio', video: '/private/noah-test?channel=video' } }],
    },
  ],
  total: 1,
  offset: 0,
  limit: 10,
  has_more: false,
};

test.describe('Desktop workbench', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
  });

  test('lays out Destinations, the call stage and the Inspector; the bar has no panel buttons', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Destinations' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible();
    await expect(page.locator('button[aria-label="Diagnostics"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="Dialable Resources"]')).toHaveCount(0);
    // The panes are regions, not dialogs, so they didn't take the focus.
    await expect(page.locator(ADDRESS_INPUT)).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Inspector' })).toContainText('Signed in as');
  });

  test('picking a Directory row fills the address field and the pane stays open', async ({ page }) => {
    await evalInApp(page, FAKE_DIRECTORY);
    const destinations = page.getByRole('region', { name: 'Destinations' });
    // The Directory mounted before the fake was installed; switching tabs
    // remounts it against the fake.
    await destinations.getByRole('tab', { name: 'Recents' }).click();
    await destinations.getByRole('tab', { name: 'Directory' }).click();
    const alice = destinations.locator('div:has(> div > span > span:text-is("Alice"))');
    await alice.locator('button:has-text("Video")').click();
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/alice?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await expect(alice).toBeVisible();
  });

  test('the identity chip selects the Subscribers tab', async ({ page }) => {
    await page.route('**/api/subscribers*', (route) => route.fulfill({ json: SUBSCRIBERS }));
    await page.click('button[title^="Signed in as"]');
    const destinations = page.getByRole('region', { name: 'Destinations' });
    await expect(destinations.getByRole('tab', { name: 'Subscribers' })).toHaveAttribute('aria-selected', 'true');
    await expect(destinations.getByText('noah.test')).toBeVisible();
  });

  test('a call switches the Inspector to Quality, whose numbers stay after hangup', async ({ page }) => {
    await evalInApp(page, STATS_STUBS);
    await setState(page, {
      isInCall: true,
      callStatus: 'connected',
      connectedAt: Date.now() - 5000,
      remoteNumber: '+15551234567',
      qualityLevel: 'good',
      qualityScore: 4.2,
    });
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector.getByRole('tab', { name: 'Quality' })).toHaveAttribute('aria-selected', 'true');
    await expect(inspector).toContainText('good · 4.2 / 5');
    await expect(inspector).toContainText('42 ms');
    await expect(inspector).toContainText('PCMU 8k (pt 0)');
    await expect(inspector).toContainText('call-abc-123');
    await expect(inspector.locator('button:has-text("Request ICE Restart")')).toBeEnabled();

    // Hang up: the stage returns to the dialer, the Inspector keeps the numbers.
    await evalInApp(page, 'store.getState().resetCallState();');
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
    await expect(inspector).toContainText('these are its final readings');
    await expect(inspector).toContainText('good · 4.2 / 5');
    await expect(inspector).toContainText('42 ms');
    await expect(inspector).toContainText('call-abc-123');
    await expect(inspector.locator('button:has-text("Request ICE Restart")')).toBeDisabled();
  });

  test('the Events tab shows what the service logged', async ({ page }) => {
    await page.getByRole('tab', { name: 'Events' }).click();
    await evalInApp(page, "s.logEvent('call', 'Status: ringing');");
    await expect(page.getByRole('region', { name: 'Inspector' })).toContainText('Status: ringing');
  });

  test('the call toolbar carries Hold, Transfer and Share', async ({ page }) => {
    await setState(page, { isInCall: true, callStatus: 'connected', connectedAt: Date.now(), remoteNumber: '+15551234567' });
    await expect(page.locator('button[aria-label="Hold call"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Transfer call"]')).toBeVisible();
    const share = page.locator('button[aria-label="Start screen share"]');
    await expect(share).toBeDisabled();
    await setState(page, { canScreenShare: true });
    await expect(share).toBeEnabled();
    // The quality badge selects the Quality tab rather than opening a sheet.
    await page.getByRole('tab', { name: 'Events' }).click();
    await page.click('button[aria-label="Call statistics"]');
    await expect(page.getByRole('tab', { name: 'Quality' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role="dialog"]:has-text("Call Statistics")')).toHaveCount(0);
  });

  test('a side pane folds to a rail and back', async ({ page }) => {
    const destinations = page.getByRole('region', { name: 'Destinations' });
    await page.click('button[aria-label="Collapse Destinations"]');
    await expect(destinations.getByRole('tab', { name: 'Directory' })).toBeHidden();
    // The fold persists across a reload, and the rail reopens the pane.
    await page.reload();
    await page.locator(ADDRESS_INPUT).waitFor();
    await expect(destinations.getByRole('tab', { name: 'Directory' })).toBeHidden();
    await page.click('button[aria-label="Expand Destinations"]');
    await expect(destinations.getByRole('tab', { name: 'Directory' })).toBeVisible();
    await expect(page.locator(ADDRESS_INPUT)).toBeEditable();
  });

  test("the address field's History button selects the Recents tab", async ({ page }) => {
    await page.click('button[aria-label="Recent calls"]');
    await expect(page.getByRole('region', { name: 'Destinations' }).getByRole('tab', { name: 'Recents' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the Devices tab enables audio processing once a call is up', async ({ page }) => {
    await page.getByRole('tab', { name: 'Devices' }).click();
    const echo = page.locator('button[role="switch"]:has-text("Echo Cancellation")');
    await expect(echo).toBeDisabled();
    await setState(page, { isInCall: true, callStatus: 'connected', connectedAt: Date.now(), remoteNumber: '+15551234567' });
    await expect(echo).toBeEnabled();
  });

  test('a code link opens a popover naming the SDK API and the file, and Escape closes it', async ({ page }) => {
    await page.click('button[aria-label="Where\'s the code: Place a call"]');
    const popover = page.getByRole('group', { name: 'Code for Place a call' });
    await expect(popover).toContainText('client.dial');
    await expect(popover.locator('a[href*="github.com"]').first()).toHaveAttribute('href', /Dialer\.tsx$/);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });
});
