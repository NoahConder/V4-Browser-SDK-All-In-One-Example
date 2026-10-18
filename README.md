# SignalWire Browser SDK Dialer

A reference dialer built with React and the SignalWire Browser SDK (`@signalwire/js` v4) for making and receiving WebRTC calls — audio and video, to phone numbers, SIP URIs, and SignalWire Fabric addresses. It is a hands-on way to explore what the Browser SDK can do, a test bench for exercising every one of its features while watching call state and statistics live, and a reference for how each piece is wired up (the table below maps every feature to the SDK API and the file). It is a testing and learning tool, not a production app.

It wears the SignalWire docs' design language — Lexend and Instrument Sans type, the docs' dark and light palettes (turquoise and SignalWire blue accents), flat cards and underline tabs. Dark is the default; an Appearance setting switches to light or follows your system.

In a desktop browser window (1024px and wider) it is a three-pane console: **Destinations** on the left (Directory, Recents, SWML scripts, SIP credentials, Subscribers), the call stage in the middle (the address field, a keypad you can fold away, and during a call a card with the status, timer, call id, video, level meters and every control), and an **Inspector** on the right (**Quality**, **Events**, **Devices**, **Diagnostics**). Either side pane folds to a rail. On a phone the same pieces stack, with the lists, devices, diagnostics and subscribers opening from the top bar.

This project is a fork of [briankwest/swdialer](https://github.com/briankwest/swdialer). See [CHANGELOG.md](CHANGELOG.md) for how it differs from upstream.

## What it demonstrates

Every SignalWire interaction happens in the browser through the published npm package; the Flask backend only mints subscriber tokens and lists resources. If you're here to see how a particular SDK feature is used, start with the file in the right-hand column.

| Feature | Browser SDK API | Where |
|---|---|---|
| Connect and authenticate | `new SignalWire({ credentialProvider, reconnectAttachedCalls, ... })`, `client.ready$`, `client.warnings$` | [signalwire.ts](frontend/src/services/signalwire.ts), [AppBar.tsx](frontend/src/components/AppBar.tsx) |
| Place a call (audio or video; phone, SIP or Fabric address) | `client.dial()` with the address's per-channel URL | [signalwire.ts](frontend/src/services/signalwire.ts), [Dialer.tsx](frontend/src/components/Dialer.tsx) |
| Receive a call | `client.incomingCalls$`, `call.answer()`, `call.reject()` | [signalwire.ts](frontend/src/services/signalwire.ts), [IncomingCall.tsx](frontend/src/components/IncomingCall.tsx) |
| Call lifecycle and errors | `call.status$`, `call.hangup()`, `call.errors$`, `recoveryState$`/`recoveryEvent$` | [signalwire.ts](frontend/src/services/signalwire.ts), [useSignalWire.ts](frontend/src/hooks/useSignalWire.ts) |
| DTMF | `call.sendDigits()` | [DialPad.tsx](frontend/src/components/DialPad.tsx), [CallScreen.tsx](frontend/src/components/CallScreen.tsx) |
| Camera on/off mid-call | `call.self.addVideoInputDevice()`, `muteVideo()`/`unmuteVideo()` | [signalwire.ts](frontend/src/services/signalwire.ts) |
| Hold and blind transfer | `call.toggleHold()`, `call.transfer()` (server refusals arrive on `call.errors$`) | [CallToolbar.tsx](frontend/src/components/CallToolbar.tsx), [TransferModal.tsx](frontend/src/components/TransferModal.tsx) |
| Screen share | `call.startScreenShare()`, gated on `call.self.capabilities.screenshare$` | [CallToolbar.tsx](frontend/src/components/CallToolbar.tsx) |
| Device selection | `audioInputDevices$`, `videoInputDevices$`, `audioOutputDevices$`, `selectAudioOutputDevice()`, `applySelectedAudioOutputDevice()` | [DevicePicker.tsx](frontend/src/components/DevicePicker.tsx) |
| Audio processing toggles | `call.setEchoCancellation()`, `setNoiseSuppression()`, `setAutoGainControl()` | [InspectorPane.tsx](frontend/src/components/InspectorPane.tsx), [CallControlsSheet.tsx](frontend/src/components/CallControlsSheet.tsx) |
| Call quality and statistics | `qualityLevel$`, `qualityScore$`, `networkIssues$`, `networkMetrics$`, `getStats()` | [CallQualityBadge.tsx](frontend/src/components/CallQualityBadge.tsx), [CallStatsSheet.tsx](frontend/src/components/CallStatsSheet.tsx) |
| Audio level meters | `localAudioLevel$`, `remoteAudioLevel$` | [AudioLevelMeter.tsx](frontend/src/components/AudioLevelMeter.tsx) |
| Directory of dialable addresses | `client.directory$` (`hasMore$`, `loadMore()`) | [DirectoryAddressList.tsx](frontend/src/components/DirectoryAddressList.tsx) |
| Pre-call connection test and diagnostics export | `client.preflight()`, `client.exportDiagnostics()` | [DiagnosticsPanel.tsx](frontend/src/components/DiagnosticsPanel.tsx), [diagnostics.ts](frontend/src/services/diagnostics.ts) |
| Event log of SDK activity | `call.status$`, `call.errors$`, `client.warnings$`, `recoveryEvent$`, `deviceRecovered$`, `isRegistered$`, ICE state | [signalwire.ts](frontend/src/services/signalwire.ts) (`getEventLog$`), [EventLog.tsx](frontend/src/components/EventLog.tsx) |
| Do Not Disturb | `client.unregister()`/`register()`, `isRegistered$` | [SubscriberPicker.tsx](frontend/src/components/SubscriberPicker.tsx), [InspectorPane.tsx](frontend/src/components/InspectorPane.tsx) |
| Device hot-plug notices | `client.deviceRecovered$` | [signalwire.ts](frontend/src/services/signalwire.ts) |
| SDK settings applied live | `setLogLevel`, `setDebugOptions`, `preferences.preferredAudioCodecs`, `preferences.relayOnly` | [settings.ts](frontend/src/services/settings.ts), [DiagnosticsPanel.tsx](frontend/src/components/DiagnosticsPanel.tsx) |
| Call reattach after a page reload | `reconnectAttachedCalls: true`, reattached calls arriving on `calls$` | [signalwire.ts](frontend/src/services/signalwire.ts), [App.tsx](frontend/src/App.tsx) |

## Features

- ✅ Styled after the SignalWire docs, dark by default with a light theme (Appearance setting); a three-pane console from 1024px wide (Destinations | call stage | Inspector with Quality, Events, Devices and Diagnostics tabs, side panes that fold away) that stacks on phones (portrait and landscape) and tablets
- ✅ Address suggestions while you type, from Recents and the loaded Directory (Up/Down to choose, Enter to fill)
- ✅ Event log of what the SDK and the dialer did — call status, errors and warnings, recovery and ICE, device changes, your own actions — with filters and copy, in the Diagnostics panel and the Inspector
- ✅ Outbound audio or video calls to phone numbers (normalized to E.164), SIP URIs, and Fabric addresses
- ✅ Inbound calls with an accept/decline card and ringtone (a second incoming call during an active call is auto-rejected)
- ✅ In-call toolbar with every control in view: mute, keypad, camera, hold/resume, transfer, screen share (with optional tab audio) on video room/conference calls, speaker
- ✅ DTMF from the on-screen keypad (with key tones) or your keyboard, once the call is connected
- ✅ Audio/video device picker and echo cancellation / noise suppression / auto gain toggles
- ✅ Live call-quality badge that opens a call-statistics panel (RTT, jitter, loss, active network issues, codecs, ICE path, recovery events, call id) that leaves the call controls usable, plus mic and remote audio-level meters; on the workbench the statistics stay in view for the whole call and keep the last call's numbers after hangup
- ✅ "Reconnecting…" during media loss, deferring to the SDK's own recovery before giving up on a call
- ✅ Pre-call network diagnostics (with options), diagnostics export, and SDK settings: codec order, log level, WebSocket tracing, relay-only media
- ✅ Directory of everything the subscriber can dial (other subscribers, rooms, SIP endpoints, SWML scripts), Recents with redial, and browsers for the space's SWML scripts and SIP credentials, each with a search field
- ✅ Subscribers panel: call any subscriber's browser (audio or video), switch the dialer to act as one, and Do Not Disturb
- ✅ Call reattach: an active call survives a page reload
- ✅ Installable (PWA manifest and icons), keyboard shortcuts, and dialogs that trap and return focus
- ✅ Automatic token refresh: the SDK calls the backend's refresh endpoint about 80% into each token's lifetime
- ✅ Microphone permission prompt, inline error banners, and an error boundary for unexpected failures

## Prerequisites

- Node.js 20.19+ and npm (required by Vite 8; the devcontainer provides it)
- Python 3 (the devcontainer uses Python 3.12)
- A SignalWire space, plus a Project ID and API token from its Dashboard (see Setup). No subscriber needs to exist in advance; the backend creates one on first run.
- A modern browser with WebRTC support. Chrome and Edge support everything; Firefox and Safari lack `setSinkId`, so the speaker/output selection is disabled there.

## Setup

The quickest route is the included devcontainer (`.devcontainer/`), which creates the venv and installs all dependencies for you. You still need to create `backend/.env` (step 2). To set up manually:

### 1. SignalWire credentials

Everything you need is on the **API** page of your SignalWire Dashboard; the [API credentials](https://signalwire.com/docs/platform/your-signalwire-api-space) guide walks through it.

- `SPACE_NAME` is the hostname of your **Space URL**, for example `example.signalwire.com`.
- `PROJECT_ID` is the **Project ID** shown on that page.
- `AUTH_TOKEN` is an **API token**: click **+ New**, give it a descriptive name, and under **Permissions** enable **Voice** (every Fabric REST endpoint the backend calls accepts Voice, Messaging, Fax or Video; one is enough). The backend sends it with the Project ID as HTTP basic auth to `https://<SPACE_NAME>/api/fabric/...` to mint subscriber tokens and list the space's subscribers, SWML scripts and SIP credentials. If the backend log shows 401 responses from SignalWire, the token is missing that scope.

The API token stays on the server. The browser only ever receives the short-lived subscriber tokens the backend mints with it.

### 2. Backend

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
FLASK_DEBUG=False
```

- `DIALER_API_KEY` is required: without it the token endpoints return 503 and the app can't connect. It is **not a secret**. Vite bakes it into the public JS bundle, so anyone who loads the page can read it. Together with the per-IP rate limits it stops automated scanners from minting tokens or listing resources through the backend; it does not protect a deployment that's reachable by people you don't trust.
- `FRONTEND_URL` sets the allowed CORS origin, and its hostname is added to Vite's allowed hosts (useful for ngrok and other tunnels).
- Leave `FLASK_DEBUG` off. It enables the Werkzeug debugger, which allows code execution from the browser, and the backend listens on all interfaces.

### 3. Frontend

```bash
cd frontend
npm install
```

There is no frontend `.env`. The dev server and the build read `DIALER_API_KEY` from `backend/.env` and bake it into the bundle, so restart `npm run dev` (or rebuild) after changing it.

### 4. Run

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

### Which subscriber you are

On first start the backend mints a subscriber token with the reference `swdialer`. SignalWire creates a subscriber with that reference if none exists yet, and the dialer signs in as it; you'll see it appear in your space's subscriber list. To act as a different subscriber, open the Subscribers panel in the dialer header and press **Switch** on one. The choice is remembered in this browser, and a stale choice (the subscriber was deleted) falls back to the default.

## Usage

1. Open `http://localhost:5173` and allow microphone access.
2. Wait for the dialer to connect (the pill in the top bar turns green and says Connected).
3. Enter a destination in the address field: a phone number (10-digit US numbers get `+1`), a SIP URI (`sip:user@domain`), or a Fabric address (`/public/room`). As you type, matching Recents and Directory entries appear under the field (Up/Down to choose, Enter to fill, Escape to dismiss). Or pick one from the lists — **Resources** in the top bar on a phone, the **Destinations** pane on the left in a desktop window:
   - **Directory**: everything this subscriber can dial, from the SDK. Filter by **Subscribers** to find other browsers (each subscriber's address is `/private/<name>`), **Rooms** for video rooms, or **Apps** for SWML scripts.
   - **Recents**: calls made and received in this browser, with redial.
   - **SWML** and **SIP**: the space's SWML scripts and SIP credentials, each with Audio and Video buttons.
   - Each tab has a search box at the top. Directory and Recents filter as you type (the Directory keeps loading pages until it has checked the whole address book); SWML and SIP search the space server-side.
4. Press **Video** under the field for a video call, then **Call** (or Enter). With an empty field, Call redials the last outbound destination. The keypad is always there on a phone; in a desktop window **Show keypad** unfolds it.
5. Incoming calls show an accept/decline card (Enter accepts, Escape declines).
6. In a call, the card shows the status, the number, the timer, the call id (with copy) and the quality badge, then the toolbar: Mute, Keypad, Camera, Hold, Transfer, Share (on room calls), Speaker, More and End. The keypad sends DTMF once connected (also from your keyboard) while the status and timer stay in view, and `m` toggles mute. Tapping the quality badge opens live call statistics in a panel that leaves Mute and End usable; **More** holds the device picker, the audio-processing toggles and the diagnostics export. In a desktop window the statistics are the Inspector's **Quality** tab (selected automatically when a call starts, and kept after hangup).
7. The Subscribers list (**Subscriber** in the top bar on a phone; the **Subscribers** tab of the Destinations pane on desktop, also reached by clicking your name in the bar) shows the space's subscribers with their `/private/<name>` addresses: **Audio**/**Video** fill the dial field to call that subscriber's browser and **Switch** reloads the dialer signed in as them. The Do Not Disturb switch (top of the panel; the Inspector's **Diagnostics** tab on desktop) stops this browser from receiving calls while staying connected; the bar shows DND while it is on. Calling a subscriber whose browser is closed or in Do Not Disturb is refused by the server; the dialer says so.
8. **Diagnostics** in the top bar (the Inspector's **Diagnostics** tab on desktop) holds the SDK settings, a pre-call connection test, the diagnostics export and the **Events** log; **Devices** in the bar (the Inspector's **Devices** tab) picks the microphone, camera and speaker, and on desktop also carries the audio-processing toggles. The settings are the appearance (Dark / Light / System; the bar's sun/moon button flips it too), audio codec order, SDK log level, WebSocket tracing, relay-only media and app debug logs. Appearance and log settings apply at once; codec and relay settings apply to the next call. The codec order ranks what this browser offers and applies to WebRTC and SIP calls; calls to phone numbers use G.711 (PCMU/PCMA) regardless, so it has no effect on them. The media test places a short real call to the destination and hangs up by itself; the destination has to answer within 5 seconds, so an auto-answering SWML script or app is the best target (with "Skip media test" on, no call is placed). The event log lists what the SDK and the dialer did, in order — dialing, call status, errors and warnings, recovery and ICE changes, device switches, settings changes — with filters and a copy button; on desktop it is the Inspector's **Events** tab.

## Development

```bash
cd frontend
npm run build                     # type-check + production build
npm run lint                      # eslint
npm test                          # Playwright suite, phone and desktop projects (starts or reuses the dev server)
npm run test:shots                # screenshots of every screen at four viewports → e2e/screenshots/
```

The Playwright suite in `frontend/e2e/` needs no SignalWire credentials: it opens the app with `?e2e=1`, a dev-server-only seam that skips the SignalWire connection, and drives the UI state directly. The `phone` project runs the behavioral specs at a phone viewport; the `desktop` project runs the workbench spec at 1280×800. Backend tests: `pip install -r backend/requirements-dev.txt` once, then `python -m pytest backend/tests` from the repo root (with the venv active). The two suites share `frontend/e2e/fixtures/dial-normalization.json`, so a change to phone-number normalization on one side fails the other side's test until it's mirrored. `.github/workflows/ci.yml` runs all of this on push and pull request.

The app's own console logging is off by default; turn on "App debug logs" in Diagnostics & Settings to see call-flow traces (the SDK's log level is a separate setting there).

### Backend API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | Basic health check |
| `GET /health` | Health check with configuration status |
| `POST /api/auth/token` | Mint a subscriber token for the browser SDK. Requires `X-API-Key`; rate limited |
| `POST /api/auth/refresh` | Mint a fresh token (called by the SDK before expiry). Requires `X-API-Key`; rate limited |
| `GET /api/subscribers` | List the space's subscribers (id, display name, email, dialable addresses). Requires `X-API-Key`; rate limited. `limit` ≤ 50 |
| `GET /api/swml/scripts` | Paginated SWML scripts with their dialable addresses; `q` filters by name before paging. Requires `X-API-Key`; rate limited. `limit` ≤ 50 |
| `GET /api/sip/credentials` | Paginated SIP credentials with their dialable addresses; `q` filters by name or SIP username before paging. Requires `X-API-Key`; rate limited. `limit` ≤ 50 |
| `POST /api/calls/dial` | Validates and logs an outbound dial server-side (the call itself is placed by the browser). Requires `X-API-Key`; rate limited |

Every `/api` route requires the key. The frontend sends it on every request, and each listed item costs an authenticated SignalWire REST call, so the listings are not left open. Calls themselves are signaled and carried directly between the browser and SignalWire; the browser's Recents tab is the call log.

### Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Workbench.tsx               # Desktop layout (≥1024px): the bar, then Destinations | call stage | Inspector
│   │   ├── Pane.tsx                    # A workbench side pane and its fold-to-rail toggle
│   │   ├── InspectorPane.tsx           # Inspector tabs: Quality, Events, Devices, Diagnostics
│   │   ├── AppBar.tsx                  # Top bar: wordmark, connection pill, identity chip, theme toggle, panel buttons
│   │   ├── Dialer.tsx                  # Idle dialer: address field, Video/Call row, keypad, suggestions, routing to call screens
│   │   ├── AddressSuggestions.tsx      # Suggestions under the address field (Recents + loaded Directory)
│   │   ├── DialPad.tsx                 # Flat keypad with key tones (hold 0 for +; DTMF mode in a call)
│   │   ├── CallScreen.tsx              # Active call card: status strip, video, meters, in-call keypad
│   │   ├── CallToolbar.tsx             # Every in-call control: mute, keypad, camera, hold, transfer, share, speaker, more, end
│   │   ├── CallControlsSheet.tsx       # "More" sheet: devices, audio processing, export (hold/transfer/share too)
│   │   ├── CallStatsSheet.tsx          # RTT, jitter, loss, codecs, ICE path, recovery events (body shared with the Inspector)
│   │   ├── EventLog.tsx                # What the SDK and the dialer did, in order
│   │   ├── CallQualityBadge.tsx        # Signal-strength / network-issue indicator
│   │   ├── AudioLevelMeter.tsx         # Mic and remote audio-level meters
│   │   ├── TransferModal.tsx           # Blind transfer
│   │   ├── IncomingCall.tsx            # Incoming call card
│   │   ├── DevicePicker.tsx            # Mic / camera / speaker selection
│   │   ├── DiagnosticsPanel.tsx        # SDK settings, connection test, export, events (bodies shared with the Inspector)
│   │   ├── DialableResourcesPanel.tsx  # Directory / Recents / SWML / SIP tabs
│   │   ├── DirectoryAddressList.tsx    # SDK directory (client.directory$) with type filters
│   │   ├── RecentsList.tsx             # Client-side call log
│   │   ├── ResourceAddressList.tsx     # Paginated address list for the SWML and SIP tabs
│   │   ├── SubscriberPicker.tsx        # Call or switch to a subscriber; Do Not Disturb
│   │   ├── SheetPrimitives.tsx         # Shared sheet building blocks
│   │   ├── ErrorBanner.tsx             # Dismissible inline error / notice
│   │   └── ErrorBoundary.tsx           # Catches render errors
│   ├── hooks/
│   │   ├── useSignalWire.ts            # Bridges SDK callbacks into the store; user actions
│   │   ├── useCallStore.ts             # Zustand store for UI call state
│   │   ├── useRecentsStore.ts          # Recents call log (localStorage)
│   │   ├── useDialFieldStore.ts        # The address field's value, video choice and picked label
│   │   ├── useAddressSuggestions.ts    # Suggestions from Recents and the loaded Directory
│   │   ├── useMediaQuery.ts            # Live matchMedia; the workbench breakpoint
│   │   ├── useWorkbench.ts             # Context the workbench offers the call stage
│   │   └── useDialog.ts                # Focus trap, Escape and focus return for overlays
│   ├── services/
│   │   ├── signalwire.ts               # SignalWire client wrapper (calls, media, devices)
│   │   ├── api.ts                      # Backend API client (axios)
│   │   ├── settings.ts                 # Tester settings (appearance, codec order, log level, relay-only)
│   │   ├── theme.ts                    # Light/dark: resolves the Appearance setting to data-theme
│   │   ├── diagnostics.ts              # Diagnostics export download
│   │   └── tones.ts                    # Ringtone, key tones, disconnect tone
│   ├── utils/
│   │   ├── address.ts                  # SIP / Fabric address detection, digit counting
│   │   ├── search.ts                   # Query normalization and the Directory/Recents matchers
│   │   └── log.ts                      # App logger gated by the debug setting
│   ├── styles/globals.css              # Tailwind setup, the docs' token layer (light + dark), shared utilities
│   ├── types/index.ts                  # Shared types
│   ├── App.tsx                         # Permission / connecting / error gates
│   └── main.tsx                        # Entry point
├── e2e/                                # Playwright suite, fixtures, screenshot run
├── public/                             # PWA manifest and icons
├── vite.config.ts                      # Dev server, /api proxy, allowed hosts, API-key define
├── tailwind.config.js                  # Theme, plus the `short:` (landscape-phone) breakpoint
├── postcss.config.js                   # Tailwind's PostCSS plugin
├── playwright.config.ts
└── package.json

backend/
├── api/
│   ├── auth.py                         # Token mint/refresh (gated)
│   ├── subscribers.py                  # Subscriber list with addresses (gated)
│   ├── swml.py                         # SWML scripts + addresses (gated)
│   ├── sip_credentials.py              # SIP credentials + addresses (gated)
│   └── calls.py                        # Validates and logs outbound dials (gated)
├── utils/
│   ├── signalwire.py                   # SignalWire REST client (tokens, resource listing, number formatting)
│   └── security.py                     # API-key check, per-IP rate limiting, page bounds
├── tests/                              # pytest suite (fake REST client, no credentials)
├── app.py                              # Flask app, CORS, blueprint registration
├── requirements.txt
├── requirements-dev.txt
└── .env.example

.devcontainer/                          # Python 3.12 + Node 20; creates the venv and runs npm install
.github/workflows/ci.yml                # Lint, type-check, build, Playwright, pytest
```

### Architecture notes

A few decisions worth knowing if you adapt this for your own app:

- **Tokens stay on the server.** The browser never stores a SignalWire token. `signalwire.ts` passes a `credentialProvider` to `new SignalWire(...)` whose `authenticate` and `refresh` callbacks call the backend, and the SDK invokes them on demand, about 80% into each 1-hour token.
- **Call state lives in three places on purpose.** The service owns the SDK `Call` objects, a Zustand store holds UI state, and `useSignalWire` bridges the two. High-frequency observables (network metrics, audio levels) are read directly by the component that shows them and never pass through the store.
- **Mute is local.** The server doesn't grant `self.mute` on 1:1 calls, so mute disables the outgoing audio track instead of calling the SDK's mute, which keeps unmute instant.
- **Reattach shapes unload.** With `reconnectAttachedCalls` on, the page skips `disconnect()` on unload while a call is active, because disconnecting would discard the record the reloaded page needs to rejoin the call.

Maintainer notes, including the SDK behaviors these decisions respond to, are in `CLAUDE.md`.

## Troubleshooting

### Stuck on "Connecting to SignalWire..." or a connection error

1. The error screen names the cause when the backend request failed: "Backend unreachable" means nothing answered on :5001; "rejected the API key" (401) means the frontend was started (or built) before `DIALER_API_KEY` was set or changed in `backend/.env`, so restart `npm run dev`; a 503 means `DIALER_API_KEY` is unset; "Too many requests" (429) means the 10-per-minute rate limit was hit.
2. Check `SPACE_NAME`, `PROJECT_ID`, and `AUTH_TOKEN` in `backend/.env`. `GET http://localhost:5001/health` reports whether they and `DIALER_API_KEY` are set. If the backend log shows 401 responses from SignalWire, the API token lacks a scope (see Setup step 1).
3. Make sure both the backend and the frontend are running.
4. Check the browser console and the backend logs.

### "Your saved subscriber no longer exists"

The subscriber you switched to was deleted from the space. The backend answers 400 "Unknown subscriber", and the dialer forgets the saved choice and connects as the default subscriber.

### 503 "Subscriber lookup unavailable"

The backend couldn't list the space's subscribers to validate your chosen one. This is transient; retry, and check the backend log if it persists.

### "The destination isn't online"

You called a subscriber whose browser is closed or in Do Not Disturb, and the server refused the call (`no_devices_or_registrations`). Open the dialer in that subscriber's browser, or turn its Do Not Disturb switch off.

### Audio issues

1. Make sure microphone permission is granted.
2. Make sure no other application is using the microphone.
3. Use headphones to avoid echo.
4. After a page reload that reattached a call, the browser's autoplay policy may hold back remote audio until you interact with the page; the call screen shows **Tap to enable audio** when that happens.
5. The Speaker control is disabled in browsers without `setSinkId` (Firefox, Safari).

### Token refresh

Tokens are minted with a 1-hour lifetime. The SDK calls the backend's refresh endpoint about 80% of the way through (around 48 minutes). If sessions drop around then, check the backend logs for token errors and look for `credential_no_refresh_handler` or token-refresh errors in the browser console.

## Security and exposure

This app is built for trying out the SignalWire Browser SDK and its features. It isn't intended as a production deployment. Before exposing it beyond your own machine, know that:

- **Both servers listen on all interfaces** (Flask on `0.0.0.0`, Vite with `host: true`), so other machines on your network can reach them without a tunnel. CORS only restricts browsers to `FRONTEND_URL`; it doesn't stop direct requests.
- **The backend holds your account's API token** and mints call-capable subscriber tokens for anyone who presents `DIALER_API_KEY`, which ships in the frontend bundle. The per-IP rate limits bound the damage from automation; they are not an access control.
- **To test from a phone or another machine**, expose the dev server through a tunnel such as ngrok: set `FRONTEND_URL` to the tunnel URL and restart both servers. Browsers only allow microphone and camera access over HTTPS (or on `localhost`), which tunnels provide. Share tunnel URLs only with people you trust, and close the tunnel when you're done.

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite 8** for the dev server and build
- **Tailwind CSS 4** for styling, over a semantic token layer that carries the SignalWire docs' light and dark palettes; Lexend, Instrument Sans and JetBrains Mono from Google Fonts (system fonts offline)
- **Zustand** for state management
- **@signalwire/js** (v4 release candidate) for signaling, media, and devices, with **RxJS** for its observables
- **Axios** for backend API calls
- **Lucide React** for icons

### Backend
- **Flask** with **Flask-CORS**
- **requests** for the SignalWire REST API (token minting, resource listing)
- **python-dotenv** for configuration

## Support

For the SDK itself, see the [Browser SDK v4 guides](https://signalwire.com/docs/browser-sdk/v4/guides/overview) and the [SignalWire documentation](https://signalwire.com/docs).

For issues with this app, check the browser console and the backend logs, then open an issue in this repository.
