# SignalWire iPhone Dialer

A web-based iPhone-style dialer built with React and the SignalWire Browser SDK (`@signalwire/js` v4) for making and receiving WebRTC calls — audio and video, to phone numbers, SIP URIs, and SignalWire Fabric addresses. It's intended as a hands-on way to explore the Browser SDK's features.

> This is a heavily modified version of [briankwest/swdialer](https://github.com/briankwest/swdialer).

## Changes from Upstream

This fork diverges from [briankwest/swdialer](https://github.com/briankwest/swdialer) in the ways below. This list grows as the fork continues to evolve — newest changes at the top.

- **Tests and CI** — a Playwright suite (`frontend/e2e/`, `npm test`) that runs without SignalWire credentials through a dev-only `?e2e=1` seam, a screenshot run for every screen at four viewports (`npm run test:shots`), a pytest suite for the backend that shares a number-normalization fixture with the frontend, and a GitHub Actions workflow running lint, type-check, build and both suites.
- **Tester tooling from the SDK** — a **Directory** tab listing the signed-in subscriber's own address book (`client.directory$`: other subscribers for browser-to-browser calls, video rooms, apps); a **Recents** tab (client-side call log with outcomes, durations and redial, replacing the single remembered number); a **Call Statistics** sheet behind the quality badge (RTT, jitter, loss, bandwidth estimate, negotiated codecs, ICE path, SDK recovery state and events, call id); live mic and remote **audio-level meters**; **Do Not Disturb** (`unregister()`); and **SDK Settings** in the Diagnostics panel — audio codec order, SDK log level, WebSocket tracing, relay-only (TURN) media and app debug logs — applied without a reload. The connection test gained its options (skip the media test, test length) and shows STUN/TURN reachability and device checks.
- **Call-flow fixes found by review** — the Speaker toggle's "off" direction never worked (SDK `applySelectedAudioOutputDevice()` returns `false` with no device selected) and is now disabled where `setSinkId` is unsupported; the call timer starts when the far end answers (not when dialing starts) and the status line distinguishes "Ringing…"; DTMF is held until connected; a startup failure shows the error screen instead of spinning forever; a deleted saved subscriber no longer locks the app out; an incoming call during a dial is auto-rejected; pasted numbers like `(555) 123-4567` normalize the same way the backend does; a browser that blocks autoplay (e.g. after a reload that reattached a call) shows "Tap to enable audio"; media loss during a call shows "Reconnecting…" and defers to the SDK's recovery instead of hanging up on the first ICE failure.
- **Interaction and accessibility** — every sheet, modal and panel is a proper dialog (focus trap, Escape, focus return); keyboard shortcuts (Enter/Escape to answer/decline, `m` to mute, hold `0` for `+`); an installable PWA manifest with icons, safe-area padding for notched phones, and pinch-zoom re-enabled; console noise replaced by an app logger gated behind a setting.
- **Backend hardening** — one shared REST client, request timeouts, bounded page sizes, generic error bodies, redacted request logging, and removal of the unused `/api/auth/validate` and `/api/calls/incoming` stubs.
- **Toolchain refresh** — Vite 8, Tailwind CSS 4, and typescript-eslint 8 on the frontend; the backend now depends only on what it uses (Flask, Flask-CORS, requests, python-dotenv), all on current releases.
- **Call-experience improvements** — verified with automated browser-to-browser, PSTN, and SIP test calls:
  - Instant mute and unmute. Audio resumes the moment you unmute.
  - Screen sharing follows the SDK's screen-sharing guide. It's offered only when SignalWire grants the call the `screenshare` capability (calls into a video room or conference), shows a disabled "Starting…"/"Stopping…" state while a share settles, gives a specific message for each failure, and can optionally include tab audio. Hanging up mid-share now removes the share from the room immediately.
  - Mute works from the moment a call starts dialing, so muting before the other side answers is honored.
  - Hanging up while a call is still being placed reliably cancels it.
  - If the server doesn't permit a hold or transfer, the app says so and the call continues.
  - Cleaner remote-audio playback and incoming-call handling.
- **Responsive layout & accessibility** — the UI now fits phones from 320px wide (the old forced 360×640 minimum is gone), phones in landscape (address field and dial pad side by side), tablets, and desktop. Header panels open as an overlay instead of squashing the dial pad, long SIP/Fabric addresses wrap, all icon-only buttons have accessible labels, and header/close buttons have 40px tap targets.
- **Groundwork for call reattach across reloads** — the client is configured to resume an active call after a page reload (`reconnectAttachedCalls`), adopting reattached calls as they arrive. This takes effect once reattach is supported server-side.
- **Subscriber picker** — a new toolbar icon in the dialer header opens a panel (`SubscriberPicker.tsx`) listing subscribers in the SignalWire space, so the app can authenticate as any of them instead of a hardcoded default. Backed by a new `GET /api/subscribers` endpoint (`backend/api/subscribers.py`) that trims each record down to id/display name/email and is gated the same way as the token endpoints, since subscriber records carry real PII. Switching reloads the page, since the SDK client's identity is fixed at construction.
- **SIP Credentials tab & per-channel dial options in the resource browser** — the SWML Scripts browser is now a tabbed `DialableResourcesPanel` (SWML Scripts + SIP Credentials, the latter backed by a new `GET /api/sip/credentials` endpoint mirroring the SWML one), and each address row shows explicit Audio/Video dial buttons instead of one generic button, since offering video requires the address's channel-specific `?channel=video` URL rather than just a dial-time flag.
- **Call quality badge & connection diagnostics** — a live signal-strength icon (plus a network-issue warning) appears in the call screen header, driven by the SDK's `call.qualityLevel$`/`qualityScore$`/`networkIssues$` observables (`CallQualityBadge.tsx`). A new Diagnostics panel, opened from a toolbar icon in the dialer header, runs `client.preflight()` against any number/address to test signaling/TURN/bandwidth before you dial, and can export the full SDK session diagnostics (`client.exportDiagnostics()`) as JSON (`DiagnosticsPanel.tsx`, `services/diagnostics.ts`).
- **In-call controls sheet** — a new "More" button on the call screen opens a bottom sheet (`CallControlsSheet.tsx`) for hold/resume (`call.toggleHold()`), call transfer, screen sharing (shown when the browser supports `getDisplayMedia` and the call has the `screenshare` capability — see above), the device picker, and live toggles for echo cancellation / noise suppression / auto gain control (`call.self`), plus a diagnostics export shortcut.
- **Blind call transfer** — a new transfer dialog (`TransferModal.tsx`) requests a blind transfer of the active call to a number, SIP URI, or Fabric address via `call.transfer()`, reusing the same dial-address normalization as outbound dialing. If the transfer isn't permitted for the call, the dialog shows the reason and the call continues.
- **Device picker** — a new panel (`DevicePicker.tsx`), reachable from both the idle dialer header and the in-call controls sheet, lists and selects microphone/camera/speaker using the SDK's `audioInputDevices$`/`videoInputDevices$`/`audioOutputDevices$` observables. Picking a speaker here is what makes the existing speaker toggle actually switch output, via `selectAudioOutputDevice`/`applySelectedAudioOutputDevice`.
- **Inline error banners instead of hard failures** — a new `callError` field on the call store surfaces failed calls/answers/holds/transfers, etc. as a dismissible banner (`ErrorBanner.tsx`) on the idle dialer or call screen, instead of taking over the whole app. SDK error types (`MediaAccessError`, `MediaTrackError`, `CallCreateError`, `PreflightError`, and a new `ClientNotReadyError` for actions attempted before `client.ready$` fires) are translated into human-readable messages by `describeCallError()` (`hooks/useSignalWire.ts`).
- **Session-health surfacing** — the client now tracks `client.ready$` continuously rather than only at initial mount, and escalates session-ending problems — token refresh failures and the `credential_no_refresh_handler` warning — to the UI via the same error banner, prompting a reload instead of silently failing in the background.
- **SWML Scripts browser** — a new panel (toggle button in the dialer header) lists the SignalWire space's SWML scripts and their dialable addresses, and lets you tap one to fill the dial field. Backed by a new `GET /api/swml/scripts` endpoint (`backend/api/swml.py`).
- **Video calls** — a camera toggle in the address field places video calls (upstream is audio-only). The call screen shows remote video full-screen with a local picture-in-picture preview, and the camera can be turned on mid-call, even on a call that started audio-only.
- **Direct SIP/Fabric-address dialing** — the dial field now also accepts SIP URIs (`sip:user@domain`) and Fabric addresses (`/public/room-name`) alongside phone numbers; both skip E.164 formatting.
- **SignalWire JS SDK** on the published release candidate `@signalwire/js@^4.0.0-rc.5` (upstream pins the dev build `4.0.0-dev-20260911205444`).
- **Dev environment** — added a `.devcontainer/` (Python 3.12 + Node 20) that bootstraps the venv and runs `npm install` automatically, with ports 5001/5173 pre-forwarded.
- **Documentation** — expanded `CLAUDE.md` with architecture notes for the above, and credited the upstream project in this README.

## Features

- ✅ iPhone-style dark UI that adapts to phones (portrait and landscape), tablets, and desktop
- ✅ Outbound audio or video calls to phone numbers (normalized to E.164), SIP URIs, and Fabric addresses
- ✅ Inbound calls with a full-screen accept/decline screen and ringtone (a second incoming call during an active call is auto-rejected)
- ✅ In-call controls: mute, speaker, camera, keypad, hold/resume, and screen share (with optional tab audio) on video room/conference calls
- ✅ DTMF from the on-screen keypad (with key tones) or your keyboard, once the call is connected
- ✅ Audio/video device picker and echo cancellation / noise suppression / auto gain toggles
- ✅ Live call-quality badge that opens a call-statistics sheet (RTT, jitter, loss, codecs, ICE path, recovery events, call id), plus mic and remote audio-level meters
- ✅ "Reconnecting…" during media loss, deferring to the SDK's own recovery before giving up on a call
- ✅ Pre-call network diagnostics (with options), diagnostics export, and SDK settings: codec order, log level, WebSocket tracing, relay-only media
- ✅ Directory of everything the subscriber can dial (other subscribers, rooms, apps), Recents with redial, and browsers for the space's SWML scripts and SIP credentials
- ✅ Subscriber picker to act as any subscriber in the space, and Do Not Disturb
- ✅ Installable (PWA manifest and icons), keyboard shortcuts, and dialogs that trap and return focus
- ✅ Automatic token refresh: the SDK calls the backend's refresh endpoint about 80% into each token's lifetime
- ✅ Microphone permission prompt, inline error banners, and an error boundary for unexpected failures

## Prerequisites

- Node.js 20.19+ and npm (required by Vite 8; the devcontainer provides it)
- Python 3 (the devcontainer uses Python 3.12)
- A SignalWire space with at least one subscriber (Fabric)
- A modern browser with WebRTC support

## Setup

The quickest route is the included devcontainer (`.devcontainer/`), which creates the venv and installs all dependencies for you. You still need to create the two `.env` files below. To set up manually:

### 1. Backend

From the repo root:

```bash
# Create and activate a virtual environment at the repo root
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Create the backend .env from the example
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
SPACE_NAME=your-space.signalwire.com
PROJECT_ID=your-project-id
AUTH_TOKEN=your-api-token
PORT=5001
FRONTEND_URL=http://localhost:5173
DIALER_API_KEY=choose-a-long-random-string
```

`DIALER_API_KEY` is required. Without it the token endpoints return 503 and the app can't connect. `FRONTEND_URL` sets the allowed CORS origin, and its hostname is added to Vite's allowed hosts (useful for ngrok and other tunnels).

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Set `VITE_DIALER_API_KEY` in `frontend/.env` to the same value as `DIALER_API_KEY`. It's read at build/dev-server start, so restart `npm run dev` after changing it.

### 3. Run

Start the backend (from the repo root, with the venv active):

```bash
cd backend
python app.py                     # http://localhost:5001
```

In a second terminal, start the frontend:

```bash
cd frontend
npm run dev                       # http://localhost:5173, proxies /api to :5001
```

## Usage

1. Open `http://localhost:5173` and allow microphone access.
2. Wait for the dialer to connect.
3. Type a phone number, SIP URI (`sip:user@domain`), or Fabric address (`/public/room`), or pick one from the resources panel (list icon in the header): **Directory** lists everything this subscriber can dial — including other subscribers, for browser-to-browser calls — **Recents** lists calls made and received in this browser, and **SWML**/**SIP** list the space's scripts and credentials. Toggle the camera button in the address field for a video call, then press the green call button (or Enter). With an empty field, the call button fills in the last number you dialed.
4. Incoming calls show a full-screen accept/decline screen (Enter accepts, Escape declines).
5. In a call: the keypad sends DTMF once connected (also from your keyboard), `m` toggles mute, and tapping the signal icon in the header opens live call statistics. More → Hold, Transfer, Screen Share (on room calls), devices and audio processing.
6. To act as a different subscriber, open the Subscriber panel (person icon). The page reloads under the new identity. The same panel has a Do Not Disturb switch (stay connected, stop receiving calls).
7. Diagnostics (pulse icon) runs a pre-call connection test and holds the SDK settings: audio codec order, SDK log level, WebSocket tracing, relay-only media and app debug logs. Log settings apply at once; codec and relay settings apply to the next call.

## Development

```bash
cd frontend
npm run build                     # type-check + production build
npm run lint                      # eslint
npm test                          # Playwright suite (starts or reuses the dev server)
npm run test:shots                # screenshots of every screen at four viewports → e2e/screenshots/
```

The Playwright suite in `frontend/e2e/` needs no SignalWire credentials: it opens the app with `?e2e=1`, a dev-server-only seam that skips the SignalWire connection, then stubs the service and drives the UI state directly. Backend tests: `pip install -r backend/requirements-dev.txt` once, then `python -m pytest backend/tests` from the repo root (with the venv active). The two suites share `frontend/e2e/fixtures/dial-normalization.json`, so a change to phone-number normalization on one side fails the other side's test until it's mirrored. `.github/workflows/ci.yml` runs all of this on push and pull request.

The app's own console logging is off by default; turn on "App debug logs" in Diagnostics & Settings to see call-flow traces (the SDK's log level is a separate setting there).

### Backend API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | Basic health check |
| `GET /health` | Health check with configuration status |
| `POST /api/auth/token` | Mint a subscriber token for the browser SDK. Requires `X-API-Key`; rate limited |
| `POST /api/auth/refresh` | Mint a fresh token (called by the SDK before expiry). Requires `X-API-Key`; rate limited |
| `GET /api/subscribers` | List the space's subscribers (id, display name, email). Requires `X-API-Key`; rate limited. `limit` ≤ 50 |
| `GET /api/swml/scripts` | Paginated SWML scripts with their dialable addresses. `limit` ≤ 50 |
| `GET /api/sip/credentials` | Paginated SIP credentials with their dialable addresses. `limit` ≤ 50 |
| `POST /api/calls/dial` | Records an outbound call in the in-memory log (the call itself is placed by the browser) |
| `GET /api/calls/status/<call_id>` | Look up a logged call |
| `POST /api/calls/end/<call_id>` | Mark a logged call as ended |
| `GET /api/calls/history` | Logged call history |
| `GET /api/calls/active` | Calls currently logged as active |

The `/api/calls/*` endpoints keep an optional, in-memory call log for debugging. Calls themselves are signaled and carried directly between the browser and SignalWire.

### Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Dialer.tsx                  # Idle dialer: header toolbar, address input, routing to call screens
│   │   ├── DialPad.tsx                 # Keypad with DTMF tones
│   │   ├── CallScreen.tsx              # Active call: info, controls, video, in-call keypad
│   │   ├── CallControlsSheet.tsx       # "More" sheet: hold, transfer, screen share, devices, audio processing
│   │   ├── TransferModal.tsx           # Blind transfer
│   │   ├── IncomingCall.tsx            # Full-screen incoming call
│   │   ├── CallQualityBadge.tsx        # Signal-strength / network-issue indicator
│   │   ├── DevicePicker.tsx            # Mic / camera / speaker selection
│   │   ├── DiagnosticsPanel.tsx        # Preflight test + diagnostics export
│   │   ├── DialableResourcesPanel.tsx  # SWML Scripts / SIP Credentials tabs
│   │   ├── ResourceAddressList.tsx     # Shared paginated address list for those tabs
│   │   ├── SubscriberPicker.tsx        # Switch subscriber identity
│   │   ├── ErrorBanner.tsx             # Dismissible inline error
│   │   └── ErrorBoundary.tsx           # Catches render errors
│   ├── hooks/
│   │   ├── useSignalWire.ts            # Bridges SDK callbacks into the store; user actions
│   │   └── useCallStore.ts             # Zustand store for UI call state
│   ├── services/
│   │   ├── signalwire.ts               # SignalWire client wrapper (calls, media, devices)
│   │   ├── api.ts                      # Backend API client (axios)
│   │   ├── diagnostics.ts              # Diagnostics export download
│   │   └── tones.ts                    # Ringtone and disconnect tones
│   ├── styles/globals.css              # Tailwind setup, custom utilities, dial-button sizing
│   ├── types/index.ts                  # Shared types
│   ├── App.tsx                         # Permission / connecting / error gates
│   └── main.tsx                        # Entry point
├── vite.config.ts                      # Dev server, /api proxy, allowed hosts
├── tailwind.config.js                  # Theme, plus the `short:` (landscape-phone) breakpoint
├── postcss.config.js                   # Tailwind's PostCSS plugin
└── package.json

backend/
├── api/
│   ├── auth.py                         # Token mint/refresh (gated)
│   ├── subscribers.py                  # Subscriber list (gated)
│   ├── swml.py                         # SWML scripts + addresses
│   ├── sip_credentials.py              # SIP credentials + addresses
│   └── calls.py                        # In-memory call log
├── utils/
│   ├── signalwire.py                   # SignalWire REST client (tokens, resource listing, number formatting)
│   └── security.py                     # API-key check and per-IP rate limiting
├── app.py                              # Flask app, CORS, blueprint registration
├── requirements.txt
└── .env.example
```

See `CLAUDE.md` for architecture notes: token lifecycle, why call state is split across three places, call reattach, remote-audio and call-end fallbacks, and how mute, screen share, and transfer interact with the SDK.

## Troubleshooting

### Stuck on "Connecting to SignalWire..." or a connection error

1. A 401 from `/api/auth/token` means `VITE_DIALER_API_KEY` doesn't match `DIALER_API_KEY`. A 503 means `DIALER_API_KEY` is unset. A 429 means the 10-per-minute rate limit was hit.
2. Check `SPACE_NAME`, `PROJECT_ID`, and `AUTH_TOKEN` in `backend/.env`.
3. Make sure both the backend and the frontend are running.
4. Check the browser console and the backend logs.

### Audio issues

1. Make sure microphone permission is granted.
2. Make sure no other application is using the microphone.
3. Use headphones to avoid echo.

### Token refresh

Tokens are minted with a 1-hour lifetime. The SDK calls the backend's refresh endpoint about 80% of the way through (around 48 minutes). If sessions drop around then, check the backend logs for token errors and look for `credential_no_refresh_handler` or token-refresh errors in the browser console.

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite 8** for the dev server and build
- **Tailwind CSS 4** for styling
- **Zustand** for state management
- **@signalwire/js** (v4 release candidate) for signaling, media, and devices
- **Axios** for backend API calls
- **Lucide React** for icons

### Backend
- **Flask** with **Flask-CORS**
- **requests** for the SignalWire REST API (token minting, resource listing)
- **python-dotenv** for configuration

## Testing on Other Devices

This app is built for trying out the SignalWire Browser SDK and its features. It isn't intended as a production deployment. To test from a phone or another machine, you can expose the dev server through a tunnel such as ngrok: set `FRONTEND_URL` to the tunnel URL and restart both servers. Browsers only allow microphone and camera access over HTTPS, which tunnels provide.

The backend mints real subscriber tokens for your SignalWire space, so share tunnel URLs only with people you trust, and close the tunnel when you're done.

## License

MIT

## Support

For SignalWire-specific issues, see the [SignalWire documentation](https://developer.signalwire.com/).

For application issues, check the browser console and the backend logs.
