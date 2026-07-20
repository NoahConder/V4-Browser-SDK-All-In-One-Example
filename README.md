# SignalWire iPhone Dialer

A web-based iPhone-style dialer application built with React and SignalWire SDK for making and receiving WebRTC calls.

> This is a heavily modified version of [briankwest/swdialer](https://github.com/briankwest/swdialer).

## Changes from Upstream

This fork diverges from [briankwest/swdialer](https://github.com/briankwest/swdialer) in the ways below. This list grows as the fork continues to evolve — newest changes at the top.

- **Call quality badge & connection diagnostics** — a live signal-strength icon (plus a network-issue warning) appears in the call screen header, driven by the SDK's `call.qualityLevel$`/`qualityScore$`/`networkIssues$` observables (`CallQualityBadge.tsx`). A new Diagnostics panel, opened from a toolbar icon in the dialer header, runs `client.preflight()` against any number/address to test signaling/TURN/bandwidth before you dial, and can export the full SDK session diagnostics (`client.exportDiagnostics()`) as JSON (`DiagnosticsPanel.tsx`, `services/diagnostics.ts`).
- **In-call controls sheet** — a new "More" button on the call screen opens a bottom sheet (`CallControlsSheet.tsx`) for hold/resume (`call.toggleHold()`), call transfer, screen sharing (only shown when `call.capabilities$` includes `'screenshare'`), the device picker, and live toggles for echo cancellation / noise suppression / auto gain control (`call.self`), plus a diagnostics export shortcut.
- **Blind call transfer** — a new transfer modal (`TransferModal.tsx`) sends the active call to a new number/SIP URI/Fabric address via `call.transfer()`, reusing the same dial-address normalization as outbound dialing.
- **Device picker** — a new panel (`DevicePicker.tsx`), reachable from both the idle dialer header and the in-call controls sheet, lists and selects microphone/camera/speaker using the SDK's `audioInputDevices$`/`videoInputDevices$`/`audioOutputDevices$` observables. Picking a speaker here is what makes the existing speaker toggle actually switch output, via `selectAudioOutputDevice`/`applySelectedAudioOutputDevice`.
- **Inline error banners instead of hard failures** — a new `callError` field on the call store surfaces failed calls/answers/holds/transfers, etc. as a dismissible banner (`ErrorBanner.tsx`) on the idle dialer or call screen, instead of taking over the whole app. SDK error types (`MediaAccessError`, `MediaTrackError`, `CallCreateError`, `PreflightError`, and a new `ClientNotReadyError` for actions attempted before `client.ready$` fires) are translated into human-readable messages by `describeCallError()` (`hooks/useSignalWire.ts`).
- **Session-health surfacing** — the client now tracks `client.ready$` continuously rather than only at initial mount, and escalates session-ending problems — token refresh failures and the `credential_no_refresh_handler` warning — to the UI via the same error banner, prompting a reload instead of silently failing in the background.
- **SWML Scripts browser** — a new panel (toggle button in the dialer header) lists the SignalWire space's SWML scripts and their dialable addresses, and lets you tap one to fill the dial field. Backed by a new `GET /api/swml/scripts` endpoint (`backend/api/swml.py`).
- **Direct SIP/Fabric-address dialing** — the dial field now also accepts SIP URIs (`sip:user@domain`) and Fabric addresses (`/public/room-name`) alongside phone numbers; both skip E.164 formatting.
- **SignalWire JS SDK** bumped to `@signalwire/js@^4.0.0-rc.2` (from an exact pin at `4.0.0-rc.0`).
- **Dev environment** — added a `.devcontainer/` (Python 3.12 + Node 20) that bootstraps the venv and runs `npm install` automatically, with ports 5001/5173 pre-forwarded.
- **Documentation** — expanded `CLAUDE.md` with architecture notes for the above, and credited the upstream project in this README.

## Features

- ✅ iPhone-style dialer UI with dark theme
- ✅ Outbound calling with DTMF tones
- ✅ Inbound call reception with full-screen UI
- ✅ Automatic token refresh (at 80% of token lifetime)
- ✅ Call controls (mute, speaker, keypad)
- ✅ Real-time call duration display
- ✅ In-call DTMF keypad support
- ✅ Keyboard input for DTMF during calls
- ✅ Microphone permission handling
- ✅ Error boundaries for graceful error handling
- ✅ Whimsical ringtone for incoming calls
- ✅ Connection status indicator

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+
- SignalWire account with Fabric resources
- Modern web browser with WebRTC support

## Setup

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file from example
cp .env.example .env
```

Edit `backend/.env` with your SignalWire credentials:
```env
SPACE_NAME=your-space.signalwire.com
PROJECT_ID=your-project-id
AUTH_TOKEN=your-auth-token
PORT=5001
FRONTEND_URL=http://localhost:5173
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### 3. Running the Application

Start the backend server:
```bash
cd backend
source venv/bin/activate  # If not already activated
python app.py
```

The backend will run on `http://localhost:5001`

In a new terminal, start the frontend:
```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:5173`

## Usage

1. Open `http://localhost:5173` in your browser
2. Grant microphone permissions when prompted
3. Wait for SignalWire connection to establish
4. Enter a phone number and press the green call button to make a call
5. Incoming calls will show a full-screen notification

## Development

### Backend API Endpoints

- `GET /` - Health check endpoint
- `GET /health` - Detailed health check with configuration status
- `POST /api/auth/token` - Generate subscriber token for WebRTC access
- `POST /api/auth/refresh` - Refresh subscriber token
- `POST /api/auth/validate` - Validate token (placeholder endpoint)
- `POST /api/calls/dial` - Initiate outbound call
- `POST /api/calls/answer/{call_id}` - Answer incoming call
- `POST /api/calls/end/{call_id}` - End active call
- `POST /api/calls/reject/{call_id}` - Reject incoming call
- `GET /api/calls/{call_id}` - Get call details
- `GET /api/calls/` - Get all calls (call history)

### Frontend Structure

```
frontend/
├── src/
│   ├── components/          # React components
│   │   ├── Dialer.tsx      # Main dialer interface with state management
│   │   ├── DialPad.tsx     # Number pad with DTMF tone generation
│   │   ├── CallScreen.tsx  # Active call UI with controls
│   │   ├── IncomingCall.tsx # Full-screen incoming call notification
│   │   └── ErrorBoundary.tsx # Error handling wrapper component
│   ├── hooks/              # Custom React hooks
│   │   ├── useSignalWire.ts # SignalWire SDK integration & WebRTC management
│   │   └── useCallStore.ts  # Zustand store for global call state
│   ├── services/           # Service layer
│   │   ├── api.ts          # Backend API client with axios
│   │   ├── signalwire.ts   # SignalWire client wrapper
│   │   └── tones.ts        # Audio tone generation (DTMF & ringtones)
│   ├── styles/             # CSS files
│   │   └── globals.css     # Global styles and Tailwind imports
│   ├── types/              # TypeScript definitions
│   │   └── index.ts        # Shared type definitions
│   ├── App.tsx             # Root application component
│   └── main.tsx            # Application entry point
├── vite.config.ts          # Vite configuration with proxy setup
├── tailwind.config.js      # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
└── package.json            # Frontend dependencies

backend/
├── api/                    # API blueprints
│   ├── __init__.py        # Blueprint initialization
│   ├── auth.py            # Authentication endpoints
│   └── calls.py           # Call management endpoints
├── utils/                  # Utility modules
│   ├── __init__.py        # Utils initialization
│   └── signalwire.py      # SignalWire SDK wrapper
├── app.py                  # Flask application entry point
├── requirements.txt        # Python dependencies
└── .env.example           # Environment variables template
```

## Troubleshooting

### Connection Issues

1. Verify SignalWire credentials in `.env`
2. Check that your SignalWire project has Fabric resources configured
3. Ensure both backend and frontend are running
4. Check browser console for errors

### Audio Issues

1. Ensure microphone permissions are granted
2. Check that no other application is using the microphone
3. Try using headphones to avoid echo

### Token Refresh Issues

The application automatically refreshes tokens at 80% of their lifetime (e.g., after 48 minutes for a 60-minute token). If you experience disconnections:

1. Check backend logs for token generation errors
2. Verify SignalWire API credentials
3. Ensure stable network connection

## Technology Stack

### Frontend
- **React 18** with TypeScript for type safety
- **Vite** as the build tool and dev server
- **Tailwind CSS** for styling
- **Zustand** for state management
- **@signalwire/js** SDK for WebRTC functionality
- **Axios** for API communication
- **Lucide React** for icons

### Backend
- **Flask** web framework
- **Flask-CORS** for cross-origin support
- **SignalWire Python SDK** for token generation
- **Python-dotenv** for environment configuration
- **Gunicorn** for production deployment

## Production Deployment

For production deployment:

1. Use environment variables for all sensitive configuration
2. Enable HTTPS for both frontend and backend
3. Configure proper CORS origins in backend
4. Use a production WSGI server (e.g., Gunicorn) for Flask
5. Build the React app: `npm run build`
6. Serve static files with a web server (e.g., Nginx)
7. Set up proper logging and monitoring
8. Configure firewall rules for WebRTC media ports

## License

MIT

## Support

For SignalWire-specific issues, consult the [SignalWire documentation](https://developer.signalwire.com/).

For application issues, check the logs in both backend and frontend consoles.