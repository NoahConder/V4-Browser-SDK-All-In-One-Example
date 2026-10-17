import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, drainLog, evalInApp, openDialer, stubCallMethods } from './helpers';

// A fake SDK Directory built from real rxjs Observables (borrowed from one the
// service returns, since bare specifiers don't resolve from page.evaluate):
// page 1 loads when hasMore$ is subscribed; loadMore() appends page 2.
const FAKE_DIRECTORY = `
  const Observable = s.getIsNetworkHealthy$().constructor;
  const subject = (initial) => {
    const fns = new Set(); let value = initial;
    return { next(v) { value = v; fns.forEach((f) => f(v)); }, obs: new Observable((sub) => { sub.next(value); const fn = (v) => sub.next(v); fns.add(fn); return () => fns.delete(fn); }) };
  };
  const addr = (id, type, name, channels) => ({ id, type, name, displayName: name, resourceId: 'res-' + id, channels });
  const page1 = [
    addr('a-alice', 'subscriber', 'Alice', { audio: '/private/alice?channel=audio', video: '/private/alice?channel=video' }),
    addr('a-me', 'subscriber', 'swdialer', { audio: '/private/swdialer?channel=audio', video: '/private/swdialer?channel=video' }),
    addr('a-room', 'room', 'Team Room', { audio: '/public/team-room?channel=audio', video: '/public/team-room?channel=video' }),
  ];
  const page2 = [addr('a-app', 'app', 'IVR App', { audio: '/public/ivr?channel=audio' })];
  const addresses = subject([]); const loading = subject(false); const hasMore = subject(true);
  const directory = {
    addresses$: addresses.obs, loading$: loading.obs,
    hasMore$: new Observable((sub) => { log('init'); loading.next(true); setTimeout(() => { addresses.next(page1); loading.next(false); }, 50); const inner = hasMore.obs.subscribe((v) => sub.next(v)); return () => inner.unsubscribe(); }),
    loadMore() { log('loadMore'); loading.next(true); setTimeout(() => { addresses.next([...page1, ...page2]); hasMore.next(false); loading.next(false); }, 50); },
  };
  s.getDirectory$ = () => new Observable((sub) => { sub.next(directory); });
  s.getOwnAddressIds = () => new Set(['a-me']);
`;

const row = (page: import('@playwright/test').Page, label: string) =>
  page.locator(`#resources-tabpanel div:has(> div > span > span:text-is("${label}"))`);

test.describe('Directory tab', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, FAKE_DIRECTORY);
    await page.click('button[aria-label="Dialable Resources"]');
  });

  test('lists the subscriber address book with badges, (you), filter and paging', async ({ page }) => {
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveText(['Directory', 'Recents', 'SWML', 'SIP']);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, 'Alice')).toBeVisible();
    // StrictMode may subscribe twice in dev; the real hasMore$ is shareReplay(1).
    const inits = await drainLog(page);
    expect(inits.length).toBeGreaterThanOrEqual(1);
    expect(inits.every((e) => e[0] === 'init')).toBe(true);

    const panel = page.locator('#resources-tabpanel');
    await expect(panel).toContainText('Subscriber');
    await expect(panel).toContainText('Room');
    await expect(row(page, 'swdialer (you)').locator('button:has-text("Audio")')).toBeDisabled();

    await page.click('button:has-text("Rooms")');
    await expect(row(page, 'Team Room')).toBeVisible();
    await expect(row(page, 'Alice')).toHaveCount(0);
    await page.click('button:has-text("All")');

    await page.click('button:has-text("Load more")');
    await expect.poll(() => drainLog(page)).toEqual([['loadMore']]);
    await expect(row(page, 'IVR App')).toBeVisible();
    await expect(page.locator('button:has-text("Load more")')).toHaveCount(0);
  });

  test('picking Video fills the address, turns video on and closes the panel', async ({ page }) => {
    await row(page, 'Alice').locator('button:has-text("Video")').click();
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/alice?channel=video');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"]')).toHaveCount(0);
    await page.click('button[aria-label="Dialable Resources"]');
    await expect(page.locator('[role="tab"]').first()).toHaveAttribute('aria-selected', 'true');
  });

  test('the REST tabs render pages from the backend API', async ({ page }) => {
    await page.route('**/api/swml/scripts*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [{ id: 's1', addresses: [{ id: 'ad1', name: 'ivr', display_name: 'Main IVR', channels: { audio: '/public/ivr?channel=audio' } }] }],
          total: 1,
          offset: 0,
          limit: 10,
          has_more: false,
        },
      }),
    );
    await page.click('[role="tab"]:has-text("SWML")');
    await expect(row(page, 'Main IVR')).toBeVisible();
    await expect(row(page, 'Main IVR').locator('button:has-text("Video")')).toBeDisabled();
  });
});

test.describe('Recents', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await stubCallMethods(page);
    // endCall tells the hook the call is over, as the real service does.
    await evalInApp(page, `s.endCall = async () => { log('endCall'); s.onCallEnded?.(false); }; s.getActiveSubscriberDisplayName = () => 'e2e';`);
  });

  const entries = (page: import('@playwright/test').Page) =>
    evalInApp<Array<Record<string, unknown>>>(page, `return recents.getState().entries;`);

  test('records outbound, inbound and auto-rejected calls with outcomes', async ({ page }) => {
    const input = page.locator(ADDRESS_INPUT);
    await input.fill('5551234567');
    await page.click('button[aria-label="Call"]');
    await expect.poll(() => entries(page)).toMatchObject([
      { direction: 'outbound', label: '(555) 123-4567', destination: '5551234567', callId: 'sdk-call-1', outcome: 'in-progress' },
    ]);
    await evalInApp(page, `s.onCallConnected();`);
    await page.waitForTimeout(1100);
    await page.click('button[aria-label="End call"]');
    await expect.poll(() => entries(page)).toMatchObject([{ outcome: 'answered' }]);
    const first = (await entries(page))[0] as { connectedAt: number; endedAt: number };
    expect(first.endedAt - first.connectedAt).toBeGreaterThanOrEqual(1000);

    await input.fill('/public/room-a');
    await page.click('button[aria-label="Call"]');
    await page.click('button[aria-label="End call"]');
    await expect.poll(() => entries(page)).toMatchObject([{ outcome: 'cancelled', destination: '/public/room-a' }, {}]);

    await evalInApp(page, `s.onIncomingCall('Alice', true, '/private/alice', 'sdk-call-2'); s.onCallEnded(true);`);
    await expect.poll(() => entries(page)).toMatchObject([
      { direction: 'inbound', outcome: 'missed', video: true, destination: '/private/alice', label: 'Alice' },
      {},
      {},
    ]);

    await evalInApp(page, `s.onIncomingCall('Bob', false, '+15550001111', 'sdk-call-3');`);
    await page.click('button[aria-label="Decline"]');
    await expect.poll(() => entries(page)).toMatchObject([{ outcome: 'declined', label: 'Bob' }, {}, {}, {}]);

    await input.fill('5559876543');
    await page.click('button[aria-label="Call"]');
    await evalInApp(page, `s.onIncomingCallAutoRejected('Carol', '+15550002222');`);
    const topTwo = () => entries(page).then((list) => list.slice(0, 2));
    await expect.poll(topTwo).toMatchObject([
      { outcome: 'missed', label: 'Carol' },
      { outcome: 'in-progress', label: '(555) 987-6543' },
    ]);
    await evalInApp(page, `s.onCallConnected();`);
    await page.click('button[aria-label="End call"]');
    await expect.poll(topTwo).toMatchObject([{ outcome: 'missed' }, { outcome: 'answered' }]);
  });

  test('the Recents tab lists, redials (restoring video), persists and clears', async ({ page }) => {
    await evalInApp(
      page,
      `
      const r = recents.getState();
      r.start({ direction: 'inbound', destination: '/private/alice', label: 'Alice', video: true }); r.finish('missed');
      r.start({ direction: 'inbound', destination: '+15550001111', label: 'Bob', video: false }); r.finish('declined');
      r.start({ direction: 'outbound', destination: '5559876543', label: '(555) 987-6543', video: false }); r.markConnected(); r.finish('answered');
      r.start({ direction: 'outbound', destination: '5550000000', label: 'leftover', video: false });
    `,
    );
    await page.reload();
    await page.locator(ADDRESS_INPUT).waitFor();
    await expect.poll(() => entries(page)).toMatchObject([{ label: 'leftover', outcome: 'cancelled' }, {}, {}, {}]);

    await page.click('button[aria-label="Recent calls"]');
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Recents');
    const panel = page.locator('#resources-tabpanel');
    await expect(panel).toContainText('Missed');
    await expect(panel).toContainText('Declined');
    await expect(panel).toContainText('Answered');
    await expect(panel).toContainText('Cancelled');

    const bob = page.locator('#resources-tabpanel div:has(> div > div > span > span:text-is("Bob"))');
    await expect(bob.locator('button:has-text("Video")')).toBeDisabled();
    const alice = page.locator('#resources-tabpanel div:has(> div > div > span > span:text-is("Alice"))');
    await alice.locator('button:has-text("Video")').click();
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/alice');
    await expect(page.locator('button[aria-label="Video call on"]')).toHaveCount(1);

    await page.locator('button[aria-label="Clear"]').click();
    await page.click('button[aria-label="Recent calls"]');
    await page.click('button:has-text("Clear recents")');
    await expect(page.locator('button:has-text("Tap again to clear all")')).toHaveCount(1);
    expect((await entries(page)).length).toBe(4);
    await page.click('button:has-text("Tap again to clear all")');
    await expect(page.locator('text=No recent calls.')).toHaveCount(1);
    expect((await entries(page)).length).toBe(0);
  });
});
