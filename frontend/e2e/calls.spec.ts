import { expect, test } from '@playwright/test';
import { ADDRESS_INPUT, FAKE_CALL, callStatusText, drainLog, evalInApp, openDialer } from './helpers';

// The service's own call handling (services/signalwire.ts), run for real
// against a fake SDK client and fake Calls. Unlike the UI specs, nothing here
// replaces makeCall, endCall, toggleMute or the incoming-call handling.
const FAKE_CLIENT = `
  ${FAKE_CALL}
  window.__dials = [];
  s.isReady = true;
  s.client = {
    preferences: { recoveryDebounceTime: 2, maxRecoveryAttempts: 3, iceRestartTimeout: 5 },
    dial: (to, options) => new Promise((resolve, reject) => window.__dials.push({ to, options, resolve, reject })),
    selectAudioOutputDevice() {},
  };
`;

type Snapshot = {
  currentCall: string | null;
  inCall: boolean;
  remote: string;
  callError: string | null;
  hangups: number[];
  recents: string[];
};

const snapshot = (page: import('@playwright/test').Page) =>
  evalInApp<Snapshot>(
    page,
    `const st = store.getState();
     return {
       currentCall: s.currentCall?.id ?? null, inCall: st.isInCall, remote: st.remoteNumber, callError: st.callError,
       hangups: (window.__calls ?? []).map((call) => call.hangups),
       recents: recents.getState().entries.map((e) => e.destination + ' ' + e.outcome + (e.callId ? ' ' + e.callId : '')),
     };`,
  );

const settleDial = (page: import('@playwright/test').Page, index: number, how: 'resolve' | 'reject') =>
  evalInApp(
    page,
    how === 'resolve'
      ? `const call = window.__mkCall('call-${index + 1}'); (window.__calls ??= [])[${index}] = call; window.__dials[${index}].resolve(call);`
      : `window.__dials[${index}].reject(new Error('Call create timeout'));`,
  );

const dial = async (page: import('@playwright/test').Page, number: string) => {
  await page.fill(ADDRESS_INPUT, number);
  await page.click('button[aria-label="Call"]');
  await page.locator('button[aria-label="End call"]').waitFor();
};

const hangUp = async (page: import('@playwright/test').Page) => {
  await page.click('button[aria-label="End call"]');
  await page.locator(ADDRESS_INPUT).waitFor();
};

test.describe('placing and cancelling calls', () => {
  test.beforeEach(async ({ page }) => {
    // The dial is also logged to the backend, which isn't running here.
    await page.route('**/api/calls/dial', (route) => route.fulfill({ json: { success: true, data: {} } }));
    await openDialer(page);
    await evalInApp(page, FAKE_CLIENT);
  });

  test('a dial cancelled with End is hung up when it resolves and never takes the screen from the next call', async ({ page }) => {
    await dial(page, '+15551230001');
    await hangUp(page); // dial() #1 is still pending
    await dial(page, '+15551230002'); // dial() #2, with #1 still pending

    await settleDial(page, 0, 'resolve');
    await expect.poll(() => snapshot(page)).toMatchObject({
      currentCall: null,
      inCall: true,
      remote: '+15551230002',
      hangups: [1],
      recents: ['+15551230002 in-progress', '+15551230001 cancelled'],
    });

    await settleDial(page, 1, 'resolve');
    await expect.poll(() => snapshot(page)).toMatchObject({
      currentCall: 'call-2',
      inCall: true,
      hangups: [1, 0],
      recents: ['+15551230002 in-progress call-2', '+15551230001 cancelled'],
    });

    await hangUp(page);
    await expect.poll(() => snapshot(page)).toMatchObject({ currentCall: null, inCall: false, hangups: [1, 1] });
  });

  test('a cancelled dial that fails late leaves the next call alone', async ({ page }) => {
    await dial(page, '+15551230001');
    await hangUp(page);
    await dial(page, '+15551230002');

    await settleDial(page, 0, 'reject');
    await page.waitForTimeout(150);
    expect(await snapshot(page)).toMatchObject({
      inCall: true,
      remote: '+15551230002',
      callError: null,
      recents: ['+15551230002 in-progress', '+15551230001 cancelled'],
    });

    await settleDial(page, 1, 'resolve');
    await expect.poll(() => snapshot(page)).toMatchObject({ currentCall: 'call-2', inCall: true });
  });

  test('End on the second attempt cancels it too: neither call is adopted', async ({ page }) => {
    await dial(page, '+15551230001');
    await hangUp(page);
    await dial(page, '+15551230002');
    await hangUp(page);

    await settleDial(page, 1, 'resolve');
    await settleDial(page, 0, 'resolve');
    await expect.poll(() => snapshot(page)).toMatchObject({ currentCall: null, inCall: false, hangups: [1, 1] });
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
  });

  test('the dial carries the media options, and a caller ID only for a phone number', async ({ page }) => {
    await evalInApp(page, `s.makeCall('5551230001', false, '+15550000001'); s.endCall();`);
    await evalInApp(page, `s.makeCall('/public/room?channel=video', true, '+15550000001'); s.endCall();`);
    const dials = await evalInApp(page, `return window.__dials.map((d) => [d.to, d.options]);`);
    expect(dials).toEqual([
      ['+15551230001', { audio: true, video: false, receiveVideo: false, from: '+15550000001' }],
      ['/public/room?channel=video', { audio: true, video: true, receiveVideo: true }],
    ]);
  });

  test('Camera is off for an audio call; on a video call a tap before the call exists says so and stays off', async ({ page }) => {
    await dial(page, '+15551230001');
    const camera = page.locator('button[aria-label="Camera"]');
    await expect(camera).toBeDisabled();
    await hangUp(page);

    await dial(page, '/public/room?channel=audio');
    await expect(camera).toBeDisabled();
    await hangUp(page);

    // Dialed with Video on but its camera turned off, while dial() is pending.
    await dial(page, '/public/room?channel=video');
    await expect(camera).toBeEnabled();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await evalInApp(page, `store.getState().setCallState({ isCameraOn: false });`);
    await camera.click();
    await expect(page.getByText('The call is still being set up')).toBeVisible();
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
  });

  test('a call set up without video refuses the camera instead of pretending', async ({ page }) => {
    const message = await evalInApp<string>(
      page,
      `class FakePc extends EventTarget {
         iceConnectionState = 'connected'; connectionState = 'connected';
         getReceivers() { return []; } getSenders() { return []; }
         getTransceivers() { return [{ receiver: { track: { kind: 'audio' } } }]; }
       }
       s.currentCall = window.__mkCall('call-1', {
         status: 'connected', rtcPeerConnection: new FakePc(),
         self: { videoMuted: false, addVideoInputDevice: async () => {} },
       });
       try { await s.toggleCamera(true); return 'no error'; } catch (error) { return error.message; } finally { s.currentCall = null; }`,
    );
    expect(message).toContain('set up without video');
  });
});

test.describe('why a call ended', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/calls/dial', (route) => route.fulfill({ json: { success: true, data: {} } }));
    await openDialer(page);
    await evalInApp(page, FAKE_CLIENT);
  });

  const banner = (page: import('@playwright/test').Page) => page.locator('[role="alert"]');
  const farEnd = (page: import('@playwright/test').Page, body: string) => evalInApp(page, `const call = window.__calls[0]; ${body}`);

  test('a call the far end ends before answering says so; a connected call that ends says nothing', async ({ page }) => {
    await dial(page, '+15551230001');
    await settleDial(page, 0, 'resolve');
    await farEnd(page, `call.setStatus('ringing'); call.setStatus('disconnected');`);
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
    await expect(banner(page)).toHaveText(/The call ended before it was answered\./);

    // The next dial replaces the message; an answered call that the far end
    // hangs up needs no explanation.
    await evalInApp(page, `window.__dials = []; window.__calls = [];`);
    await dial(page, '+15551230002');
    await expect(banner(page)).toHaveCount(0);
    await settleDial(page, 0, 'resolve');
    await farEnd(page, `call.setStatus('connected');`);
    await expect.poll(() => callStatusText(page)).toContain('Connected');
    await farEnd(page, `call.setStatus('disconnected');`);
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test('a call that ends on a fatal error shows the error', async ({ page }) => {
    await dial(page, '+15551230001');
    await settleDial(page, 0, 'resolve');
    await farEnd(page, `call.setStatus('connected');`);
    await expect.poll(() => callStatusText(page)).toContain('Connected');
    await farEnd(page, `call.emitError({ kind: 'signaling', fatal: true, error: new Error('Signaling connection lost') }); call.setStatus('failed');`);
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
    await expect(banner(page)).toHaveText(/The call ended on an error: Signaling connection lost/);
  });

  test('a session error stays up through the next dial until it is dismissed', async ({ page }) => {
    await evalInApp(page, `s.onSessionError('Your session could not be refreshed. Please reload the page to reconnect.');`);
    const sessionBanner = page.locator('[role="alert"]:has-text("Please reload the page")');
    await expect(sessionBanner).toBeVisible();
    await dial(page, '+15551230001');
    await expect(sessionBanner).toBeVisible();
    await hangUp(page);
    await expect(sessionBanner).toBeVisible();
    await sessionBanner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(sessionBanner).toHaveCount(0);
  });
});

test.describe('token refresh', () => {
  test('a refresh the backend fails is retried and goes through; a rejected key is not retried', async ({ page }) => {
    await openDialer(page);
    // Flipped by the test: the backend is down, then back.
    let backend: 'down' | 'up' | 'rejects' = 'down';
    let requests = 0;
    await page.route('**/api/auth/refresh', (route) => {
      requests += 1;
      if (backend === 'down') return route.fulfill({ status: 502, json: { success: false } });
      if (backend === 'rejects') return route.fulfill({ status: 401, json: { success: false, error: 'Unauthorized' } });
      return route.fulfill({ json: { success: true, data: { token: 'fresh', expires_at: new Date(Date.now() + 3600_000).toISOString(), subscriber_id: 'sub-1', subscriber_display_name: 'e2e' } } });
    });
    await evalInApp(page, `window.__refresh = s.refreshTokenPatiently().then((data) => ({ ok: data.token }), (error) => ({ failed: error.message }));`);
    await expect(page.getByText("The backend didn't answer the session refresh")).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
    backend = 'up';
    expect(await page.evaluate(() => (window as unknown as { __refresh: Promise<unknown> }).__refresh)).toEqual({ ok: 'fresh' });
    await expect(page.getByText('The session refresh went through')).toBeVisible();
    await expect(page.getByText("The backend didn't answer the session refresh")).toHaveCount(0);

    backend = 'rejects';
    const before = requests;
    const rejected = await evalInApp<{ failed?: string }>(page, `return s.refreshTokenPatiently().then(() => ({}), (error) => ({ failed: error.message }));`);
    expect(rejected.failed).toBeTruthy();
    expect(requests - before).toBe(1);
  });
});

test.describe('incoming calls', () => {
  test.beforeEach(async ({ page }) => {
    await openDialer(page);
    await evalInApp(page, FAKE_CALL);
  });

  test('the incoming card is announced, takes the focus harmlessly, and Accept says Connecting… until the call connects', async ({ page }) => {
    await evalInApp(
      page,
      `s.isReady = true;
       s.client = { preferences: { recoveryDebounceTime: 2, maxRecoveryAttempts: 3, iceRestartTimeout: 5 } };
       window.__caller = window.__mkCall('in-1', { status: 'ringing', direction: 'inbound', from: 'subscriber://alice', answer: () => { window.__caller.answered = true; } });
       s.handleRingingCall(window.__caller);`,
    );
    const card = page.locator('[role="alert"]');
    await expect(card).toContainText('Incoming call');
    await expect(card).toContainText('alice');
    // Focus is on the caller line, so a key meant for the address field does nothing.
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect(await evalInApp(page, `return [s.pendingCall?.id, window.__caller.answered ?? false, window.__caller.rejects];`)).toEqual(['in-1', false, 0]);
    // Tab reaches Decline, then Accept.
    await page.keyboard.press('Tab');
    await expect(page.locator('button[aria-label="Decline"]')).toBeFocused();

    await page.click('button[aria-label="Accept"]');
    await expect.poll(() => callStatusText(page)).toContain('Connecting');
    expect(await evalInApp(page, `return [window.__caller.answered, store.getState().connectedAt];`)).toEqual([true, null]);
    await page.evaluate(() => (window as unknown as { __caller: { setStatus(status: string): void } }).__caller.setStatus('connected'));
    await expect.poll(() => callStatusText(page)).toContain('Connected');
    // The caller is stored as something the dial field can call back.
    expect(await evalInApp(page, `const e = recents.getState().entries[0]; return [e.label, e.destination, e.direction];`)).toEqual(['alice', '/private/alice', 'inbound']);
    await page.click('button[aria-label="End call"]');
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
  });

  test('a second call while one rings is rejected and logged as missed; the first keeps the screen', async ({ page }) => {
    await evalInApp(
      page,
      `const ringing = (id, name) => window.__mkCall(id, { status: 'ringing', direction: 'inbound', fromName: name, from: '/private/' + name.toLowerCase() });
       window.__alice = ringing('in-1', 'Alice');
       window.__bob = ringing('in-2', 'Bob');
       s.handleRingingCall(window.__alice);
       s.handleRingingCall(window.__bob);
       // incomingCalls$ re-emits the whole list on every change.
       s.handleRingingCall(window.__bob);
       s.handleRingingCall(window.__alice);`,
    );
    await expect(page.getByText('Alice')).toBeVisible();
    await expect(page.locator('button[aria-label="Accept"]')).toBeVisible();
    const counts = () =>
      evalInApp(page, `return { pending: s.pendingCall?.id, aliceRejects: window.__alice.rejects, bobRejects: window.__bob.rejects, recents: recents.getState().entries.map((e) => e.label + ' ' + e.outcome) };`);
    expect(await counts()).toEqual({
      pending: 'in-1',
      aliceRejects: 0,
      bobRejects: 1,
      recents: ['Bob missed', 'Alice in-progress'],
    });

    // The first caller gives up: a missed call, and back to the dialer.
    await page.evaluate(() => (window as unknown as { __alice: { setStatus(status: string): void } }).__alice.setStatus('destroyed'));
    await expect(page.locator(ADDRESS_INPUT)).toBeVisible();
    await expect.poll(counts).toMatchObject({ pending: undefined, recents: ['Bob missed', 'Alice missed'] });
    // A rejected call that is still in the SDK's list is not offered again.
    await evalInApp(page, `s.handleRingingCall(window.__bob);`);
    await expect(page.locator('button[aria-label="Accept"]')).toHaveCount(0);
    expect(await counts()).toMatchObject({ bobRejects: 1 });
  });
});

test.describe('mute and speaker', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/calls/dial', (route) => route.fulfill({ json: { success: true, data: {} } }));
    await openDialer(page);
    await evalInApp(page, FAKE_CLIENT);
  });

  test('Mute is local: it disables the mic track and the sender track, and a tap while dialing is kept', async ({ page }) => {
    await dial(page, '+15551230001');
    await page.click('button[aria-label="Mute"]'); // no Call object yet

    await evalInApp(
      page,
      `const Observable = s.getNetworkMetrics$().constructor;
       const tone = () => { const ctx = new AudioContext(); return ctx.createMediaStreamDestination().stream; };
       const local = tone(); const sent = tone();
       window.__mic = local.getAudioTracks()[0];
       window.__sender = sent.getAudioTracks()[0];
       class FakePc extends EventTarget {
         iceConnectionState = 'new'; connectionState = 'new';
         getReceivers() { return []; }
         getSenders() { return [{ track: window.__sender }]; }
       }
       const call = window.__mkCall('call-1', {
         localStream: local,
         localStream$: new Observable((sub) => { sub.next(local); }),
         rtcPeerConnection: new FakePc(),
         self: { mute: async () => log('self.mute'), unmute: async () => log('self.unmute') },
       });
       (window.__calls ??= [])[0] = call;
       window.__dials[0].resolve(call);`,
    );
    const tracks = () => evalInApp(page, `return [window.__mic.enabled, window.__sender.enabled];`);
    await expect.poll(tracks).toEqual([false, false]);

    await page.click('button[aria-label="Mute"]');
    await expect.poll(tracks).toEqual([true, true]);
    await page.click('button[aria-label="Mute"]');
    await expect.poll(tracks).toEqual([false, false]);
    // Never through the SDK's server-side mute.
    expect(await drainLog(page)).toEqual([]);
    await hangUp(page);
  });

  test('the remote video is not restarted for tracks it is already playing', async ({ page }) => {
    const assignments = await evalInApp<number[]>(
      page,
      `const video = document.createElement('video');
       video.muted = true;
       let count = 0;
       const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
       Object.defineProperty(video, 'srcObject', { get() { return desc.get.call(this); }, set(v) { count++; desc.set.call(this, v); } });
       s.remoteVideoEl = video;
       s.currentCall = window.__mkCall('call-1', { status: 'connected' });
       const audio = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0];
       const canvas = document.createElement('canvas');
       canvas.getContext('2d');
       const frames = canvas.captureStream().getVideoTracks()[0];
       const results = [];
       // The same two tracks arrive again and again in new MediaStream wrappers.
       for (let i = 0; i < 4; i++) { s.handleRemoteMedia(new MediaStream([audio, frames])); results.push(count); }
       // A track the element doesn't have yet is a real change.
       const more = canvas.captureStream().getVideoTracks()[0];
       s.handleRemoteMedia(new MediaStream([audio, more]));
       results.push(count);
       s.handleCallEnded();
       s.remoteVideoEl = null;
       return results;`,
    );
    expect(assignments).toEqual([1, 1, 1, 1, 2]);
  });

  test('a speaker chosen for one call is not carried into the next', async ({ page }) => {
    const result = await evalInApp<{ skipped?: boolean; during?: boolean; applies?: number; after?: string; speakerOn?: boolean }>(
      page,
      `const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
       const target = outputs.find((d) => d.deviceId !== 'default' && d.deviceId !== '');
       if (!target) return { skipped: true };
       s.client.applySelectedAudioOutputDevice = async (el) => { await el.setSinkId(target.deviceId); return true; };
       s.currentCall = window.__mkCall('call-1', { status: 'connected' });
       const ctx = new AudioContext();
       s.handleRemoteMedia(ctx.createMediaStreamDestination().stream);
       let applies = 0;
       const apply = s.client.applySelectedAudioOutputDevice;
       s.client.applySelectedAudioOutputDevice = (el) => { applies++; return apply(el); };
       const applied = await s.toggleSpeaker(true);
       const el = document.getElementById('sw-remote-audio');
       const during = applied && el.sinkId === target.deviceId;
       // Picking a device while Speaker is on moves the audio at once.
       s.setPreferredAudioOutputDevice(target);
       s.handleCallEnded();
       await new Promise((resolve) => setTimeout(resolve, 200));
       return { during, applies, after: el.sinkId, speakerOn: s.isSpeakerOn };`,
    );
    test.skip(result.skipped === true, 'this browser lists no selectable audio output');
    expect(result).toEqual({ during: true, applies: 2, after: '', speakerOn: false });
  });
});
