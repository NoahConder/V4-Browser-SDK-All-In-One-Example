// Where each SDK capability lives. The "</>" buttons (components/CodeRef.tsx)
// read this to point at the Browser SDK API behind a feature, the file in
// this repository that uses it, and the SDK reference page. It mirrors the
// feature table in README.md -- change both together.
export const GITHUB_BLOB = 'https://github.com/NoahConder/V4-Browser-SDK-All-In-One-Example/blob/main/';

const DOCS = 'https://signalwire.com/docs/browser-sdk/v4/';

export type FeatureKey =
  | 'connection'
  | 'dial'
  | 'incoming'
  | 'lifecycle'
  | 'call-controls'
  | 'devices'
  | 'audio-processing'
  | 'quality'
  | 'meters'
  | 'directory'
  | 'recents'
  | 'suggestions'
  | 'listings'
  | 'subscribers'
  | 'preflight'
  | 'events'
  | 'settings'
  | 'reattach';

export interface CodeRefEntry {
  title: string;
  // SDK calls and observables, as written in the code.
  apis: string[];
  // Repository paths, linked to GitHub.
  files: string[];
  docs?: { label: string; href: string };
}

export const CODE_MAP: Record<FeatureKey, CodeRefEntry> = {
  connection: {
    title: 'Connect and authenticate',
    apis: ['new SignalWire({ credentialProvider, reconnectAttachedCalls })', 'client.ready$', 'client.warnings$', 'client.isRegistered$'],
    files: ['frontend/src/services/signalwire.ts', 'frontend/src/components/AppBar.tsx', 'backend/api/auth.py'],
    docs: { label: 'SignalWire client', href: `${DOCS}reference/signalwire` },
  },
  dial: {
    title: 'Place a call',
    apis: ['client.dial({ to, audio, video })'],
    files: ['frontend/src/components/Dialer.tsx', 'frontend/src/services/signalwire.ts', 'frontend/src/utils/address.ts'],
    docs: { label: 'SignalWire.dial()', href: `${DOCS}reference/signalwire/dial` },
  },
  incoming: {
    title: 'Receive a call',
    apis: ['client.incomingCalls$', 'call.answer()', 'call.reject()'],
    files: ['frontend/src/components/IncomingCall.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'Inbound calls guide', href: `${DOCS}guides/inbound-calls` },
  },
  lifecycle: {
    title: 'Call lifecycle and recovery',
    apis: ['call.status$', 'call.hangup()', 'call.errors$', 'call.recoveryState$', 'call.recoveryEvent$'],
    files: ['frontend/src/components/CallScreen.tsx', 'frontend/src/services/signalwire.ts', 'frontend/src/hooks/useSignalWire.ts'],
    docs: { label: 'WebRTCCall.status$', href: `${DOCS}reference/webrtc-call/status$` },
  },
  'call-controls': {
    title: 'In-call controls',
    apis: [
      'call.sendDigits()',
      'call.toggleHold()',
      'call.transfer()',
      'call.self.startScreenShare()',
      'call.self.capabilities.screenshare$',
      'call.self.addVideoInputDevice()',
    ],
    files: [
      'frontend/src/components/CallToolbar.tsx',
      'frontend/src/components/TransferModal.tsx',
      'frontend/src/components/DialPad.tsx',
      'frontend/src/services/signalwire.ts',
    ],
    docs: { label: 'Call controls guide', href: `${DOCS}guides/call-controls` },
  },
  devices: {
    title: 'Device selection',
    apis: ['client.audioInputDevices$', 'client.videoInputDevices$', 'client.audioOutputDevices$', 'client.selectAudioOutputDevice()', 'client.deviceRecovered$'],
    files: ['frontend/src/components/DevicePicker.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'Device management guide', href: `${DOCS}guides/device-management` },
  },
  'audio-processing': {
    title: 'Audio processing',
    apis: ['call.self.setEchoCancellation()', 'call.self.setNoiseSuppression()', 'call.self.setAutoGainControl()'],
    files: ['frontend/src/components/InspectorPane.tsx', 'frontend/src/components/CallControlsSheet.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'SelfParticipant', href: `${DOCS}reference/self-participant` },
  },
  quality: {
    title: 'Call quality and statistics',
    apis: ['call.qualityLevel$', 'call.qualityScore$', 'call.networkIssues$', 'call.networkMetrics$', 'call.getStats()'],
    files: ['frontend/src/components/CallStatsSheet.tsx', 'frontend/src/components/CallQualityBadge.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'WebRTCCall.networkMetrics$', href: `${DOCS}reference/webrtc-call/network-metrics$` },
  },
  meters: {
    title: 'Audio level meters',
    apis: ['call.localAudioLevel$', 'call.remoteAudioLevel$', 'call.localSpeaking$'],
    files: ['frontend/src/components/AudioLevelMeter.tsx'],
    docs: { label: 'WebRTCCall.localAudioLevel$', href: `${DOCS}reference/webrtc-call/local-audio-level$` },
  },
  directory: {
    title: 'Directory of dialable addresses',
    apis: ['client.directory$', 'directory.addresses$', 'directory.hasMore$', 'directory.loadMore()'],
    files: ['frontend/src/components/DirectoryAddressList.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'SignalWire.directory$', href: `${DOCS}reference/signalwire/directory$` },
  },
  recents: {
    title: 'Recents',
    apis: ['No SDK call: a client-side log of each call and its outcome (Zustand persist)'],
    files: ['frontend/src/hooks/useRecentsStore.ts', 'frontend/src/components/RecentsList.tsx', 'frontend/src/hooks/useSignalWire.ts'],
  },
  suggestions: {
    title: 'Address suggestions',
    apis: ['directory.addresses$ (the pages already loaded) merged with Recents'],
    files: ['frontend/src/hooks/useAddressSuggestions.ts', 'frontend/src/components/AddressSuggestions.tsx'],
  },
  listings: {
    title: 'SWML scripts and SIP credentials',
    apis: ['REST, from the backend: GET /resources/swml_scripts, GET /resources/sip_endpoints and each resource’s /addresses'],
    files: ['backend/api/swml.py', 'backend/api/sip_credentials.py', 'frontend/src/components/ResourceAddressList.tsx'],
  },
  subscribers: {
    title: 'Subscribers and Do Not Disturb',
    apis: ['client.unregister()', 'client.register()', 'client.isRegistered$', 'REST, from the backend: GET /resources/subscribers'],
    files: ['frontend/src/components/SubscriberPicker.tsx', 'backend/api/subscribers.py', 'backend/api/auth.py'],
    docs: { label: 'SignalWire.unregister()', href: `${DOCS}reference/signalwire/unregister` },
  },
  preflight: {
    title: 'Connection test and diagnostics export',
    apis: ['client.preflight()', 'client.exportDiagnostics()'],
    files: ['frontend/src/components/DiagnosticsPanel.tsx', 'frontend/src/services/diagnostics.ts', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'SignalWire.preflight()', href: `${DOCS}reference/signalwire/preflight` },
  },
  events: {
    title: 'Event log',
    apis: ['call.status$', 'call.errors$', 'client.warnings$', 'call.recoveryEvent$', 'client.deviceRecovered$', 'RTCPeerConnection ICE state'],
    files: ['frontend/src/services/signalwire.ts', 'frontend/src/components/EventLog.tsx'],
    docs: { label: 'SignalWire.warnings$', href: `${DOCS}reference/signalwire/warnings$` },
  },
  settings: {
    title: 'SDK settings applied live',
    apis: ['setLogLevel()', 'setDebugOptions()', 'preferences.preferredAudioCodecs', 'preferences.relayOnly'],
    files: ['frontend/src/services/settings.ts', 'frontend/src/components/DiagnosticsPanel.tsx', 'frontend/src/services/signalwire.ts'],
    docs: { label: 'ClientPreferences', href: `${DOCS}reference/client-preferences` },
  },
  reattach: {
    title: 'Call reattach after a page reload',
    apis: ['reconnectAttachedCalls: true', 'client.session.calls$'],
    files: ['frontend/src/services/signalwire.ts', 'frontend/src/App.tsx'],
    docs: { label: 'ClientPreferences', href: `${DOCS}reference/client-preferences` },
  },
};
