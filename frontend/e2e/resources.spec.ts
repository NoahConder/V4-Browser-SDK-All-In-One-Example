import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, FAKE_CALL, FAKE_DIRECTORY, drainLog, evalInApp, openDialer, stubCallMethods } from './helpers';

const row = (page: import('@playwright/test').Page, label: string) =>
  page.locator(`#resources-tabpanel div:has(> div > span > span:text-is("${label}"))`);

test.describe('Directory tab', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, FAKE_DIRECTORY);
    await page.click('button[aria-label="Dialable Resources"]');
  });

  test('lists the address book with badges and (you); filters load the whole directory', async ({ page }) => {
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
    // Page 1 only so far: "All" offers manual paging.
    await expect(page.locator('button:has-text("Load more")')).toHaveCount(1);

    // A type filter keeps loading pages until the directory is exhausted
    // (the real one pages 100 at a time, sorted by name, with no type filter).
    await page.click('button:has-text("Rooms")');
    await expect.poll(() => drainLog(page)).toEqual([['loadMore']]);
    await expect(row(page, 'Team Room')).toBeVisible();
    await expect(row(page, 'Alice')).toHaveCount(0);
    await expect(row(page, 'IVR App')).toHaveCount(0);

    await page.click('button:has-text("Subscribers")');
    await expect(row(page, 'Alice')).toBeVisible();
    await expect(row(page, 'swdialer (you)')).toBeVisible();
    await expect(row(page, 'Team Room')).toHaveCount(0);

    // Everything is loaded now, so "All" shows page 2 with nothing left to load.
    await page.click('button:has-text("All")');
    await expect(row(page, 'IVR App')).toBeVisible();
    await expect(page.locator('button:has-text("Load more")')).toHaveCount(0);
  });

  test('a filter stops loading when pages stop arriving, and offers Retry', async ({ page }) => {
    await expect(row(page, 'Alice')).toBeVisible();
    await drainLog(page); // the init entries
    // The next page fails: loading starts and ends, nothing is added and more
    // is still expected, which is what the SDK reports for a failed fetch.
    await evalInApp(
      page,
      `const { directory, loading } = window.__directory;
      directory.loadMore = () => { log('loadMore'); loading.next(true); setTimeout(() => loading.next(false), 30); };`,
    );
    await page.click('button:has-text("Rooms")');
    const notice = page.getByText("Couldn't load the rest of the directory.");
    await expect(notice).toBeVisible();
    expect(await drainLog(page)).toEqual([['loadMore'], ['loadMore']]);
    await page.waitForTimeout(300);
    expect(await drainLog(page)).toEqual([]);
    // What did load is still listed.
    await expect(row(page, 'Team Room')).toBeVisible();

    // Retry asks again, the same bounded number of times.
    await page.click('#resources-tabpanel button:has-text("Retry")');
    await expect.poll(() => page.evaluate(() => window.__log.length)).toBe(2);
    await expect(notice).toBeVisible();
  });

  test('search loads the whole directory, narrows rows, combines with the type filter and clears', async ({ page }) => {
    await expect(row(page, 'Alice')).toBeVisible();
    await drainLog(page); // the init entries
    const search = page.locator('input[aria-label="Search directory"]');
    await search.fill('ivr');
    // Page 2 is fetched because a search has to see the whole directory.
    await expect.poll(() => drainLog(page)).toEqual([['loadMore']]);
    await expect(row(page, 'IVR App')).toBeVisible();
    await expect(row(page, 'Alice')).toHaveCount(0);
    await expect(page.locator('button:has-text("Load more")')).toHaveCount(0);

    const panel = page.locator('#resources-tabpanel');
    await search.fill('zzz');
    await expect(panel).toContainText('No matches for "zzz".');

    // AND with the type chips.
    await search.fill('team');
    await page.click('button:has-text("Rooms")');
    await expect(row(page, 'Team Room')).toBeVisible();
    await page.click('button:has-text("Subscribers")');
    await expect(panel).toContainText('No matches for "team" in subscribers.');

    await page.click('button[aria-label="Clear search"]');
    await page.click('button:has-text("All")');
    await expect(row(page, 'Alice')).toBeVisible();
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

  test('a failed Load more keeps the loaded rows and retries that page; a page with nothing dialable still pages on', async ({ page }) => {
    const script = (id: string, name: string, dialable = true) => ({
      id,
      addresses: dialable ? [{ id: `${id}-a`, name: name.toLowerCase(), display_name: name, channels: { audio: `/public/${id}?channel=audio` } }] : [],
    });
    // Flipped by the test rather than counted: StrictMode fetches page 1 twice in dev.
    let failNextPage = true;
    await page.route('**/api/swml/scripts*', (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
      if (offset === 0) {
        return route.fulfill({ json: { success: true, data: [script('s1', 'Main IVR')], total: 3, offset: 0, limit: 10, has_more: true } });
      }
      if (failNextPage) return route.fulfill({ status: 429, json: { success: false, error: 'Rate limit exceeded' } });
      if (offset === 1) {
        // A page whose only item has no address: nothing to show, more to come.
        return route.fulfill({ json: { success: true, data: [script('s2', 'No Address', false)], total: 3, offset: 1, limit: 10, has_more: true } });
      }
      return route.fulfill({ json: { success: true, data: [script('s3', 'Last Script')], total: 3, offset, limit: 10, has_more: false } });
    });
    await page.click('[role="tab"]:has-text("SWML")');
    await expect(row(page, 'Main IVR')).toBeVisible();

    const panel = page.locator('#resources-tabpanel');
    await panel.getByRole('button', { name: 'Load 10 more' }).click();
    await expect(panel.getByText('Too many requests')).toBeVisible();
    await expect(row(page, 'Main IVR')).toBeVisible();

    failNextPage = false;
    await panel.getByRole('button', { name: 'Retry' }).click();
    await expect(panel.getByText('Too many requests')).toHaveCount(0);
    await expect(row(page, 'Main IVR')).toBeVisible();
    // The second page added no rows, and the way forward is still there.
    await panel.getByRole('button', { name: 'Load 10 more' }).click();
    await expect(row(page, 'Last Script')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Load 10 more' })).toHaveCount(0);
  });

  test('a first page with nothing dialable says so and still offers the next page', async ({ page }) => {
    await page.route('**/api/swml/scripts*', (route) =>
      route.fulfill({ json: { success: true, data: [{ id: 's1', addresses: [] }], total: 2, offset: 0, limit: 10, has_more: true } }),
    );
    await page.click('[role="tab"]:has-text("SWML")');
    const panel = page.locator('#resources-tabpanel');
    await expect(panel.getByText('Nothing dialable on this page.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Load 10 more' })).toBeVisible();
  });

  test('the REST tabs send the search as q and render the filtered page', async ({ page }) => {
    const seen: Array<string | null> = [];
    const script = (id: string, name: string) => ({
      id,
      addresses: [{ id: `${id}-a`, name: name.toLowerCase(), display_name: name, channels: { audio: `/public/${id}?channel=audio` } }],
    });
    await page.route('**/api/swml/scripts*', (route) => {
      const q = new URL(route.request().url()).searchParams.get('q');
      seen.push(q);
      const data = q === 'main' ? [script('s1', 'Main IVR')] : [script('s1', 'Main IVR'), script('s2', 'Other Script')];
      return route.fulfill({ json: { success: true, data, total: data.length, offset: 0, limit: 10, has_more: false } });
    });
    await page.click('[role="tab"]:has-text("SWML")');
    await expect(row(page, 'Other Script')).toBeVisible();
    await page.fill('input[aria-label="Search scripts"]', 'main');
    await expect(row(page, 'Other Script')).toHaveCount(0);
    await expect(row(page, 'Main IVR')).toBeVisible();
    // StrictMode may issue the first, unfiltered fetch twice in dev.
    expect(seen[0]).toBeNull();
    expect(seen.filter((q) => q !== null)).toEqual(['main']);
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

    // A call that rings and is abandoned by the caller, through the service's
    // own incoming-call handling: it reports the end with wasIncoming false,
    // since that is only set once a call is answered.
    await evalInApp(
      page,
      `${FAKE_CALL}
      const ringing = window.__mkCall('sdk-call-2', { status: 'ringing', direction: 'inbound', fromName: 'Alice', from: '/private/alice', mediaDirections: { audio: 'sendrecv', video: 'sendrecv' } });
      s.handleRingingCall(ringing);
      ringing.setStatus('destroyed');`,
    );
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
    // A bare entry gets the channel it is redialed with.
    await expect(page.locator(ADDRESS_INPUT)).toHaveValue('/private/alice?channel=video');
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

  test('the Recents tab is searchable by label and by number', async ({ page }) => {
    await evalInApp(
      page,
      `
      const r = recents.getState();
      r.start({ direction: 'inbound', destination: '/private/alice', label: 'Alice', video: true }); r.finish('missed');
      r.start({ direction: 'inbound', destination: '+15550001111', label: 'Bob', video: false }); r.finish('declined');
      r.start({ direction: 'outbound', destination: '5559876543', label: '(555) 987-6543', video: false }); r.markConnected(); r.finish('answered');
    `,
    );
    await page.click('button[aria-label="Recent calls"]');
    const recentRow = (label: string) =>
      page.locator(`#resources-tabpanel div:has(> div > div > span > span:text-is("${label}"))`);
    const search = page.locator('input[aria-label="Search recents"]');
    await search.fill('bob');
    await expect(recentRow('Bob')).toBeVisible();
    await expect(recentRow('Alice')).toHaveCount(0);
    // Digits (with phone punctuation) match the destination's digits.
    await search.fill('555 000');
    await expect(recentRow('Bob')).toBeVisible();
    await expect(recentRow('(555) 987-6543')).toHaveCount(0);
    await search.fill('zzz');
    await expect(page.locator('#resources-tabpanel')).toContainText('No matches for "zzz".');
    await page.click('button[aria-label="Clear search"]');
    await expect(recentRow('Alice')).toBeVisible();
    await expect(recentRow('Bob')).toBeVisible();
    await expect(recentRow('(555) 987-6543')).toBeVisible();
  });
});
