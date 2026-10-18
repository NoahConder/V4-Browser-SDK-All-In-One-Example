import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CallStatsBody } from './CallStatsSheet';
import EventLog from './EventLog';
import { ConnectionTestBody, ExportDiagnosticsButton, SdkFacts, SettingsBody } from './DiagnosticsPanel';
import { DeviceSections } from './DevicePicker';
import { DoNotDisturbSwitch } from './SubscriberPicker';
import { SheetSection, SheetStat, SheetSwitch } from './SheetPrimitives';
import { useCallStore } from '../hooks/useCallStore';
import { useSignalWire } from '../hooks/useSignalWire';
import type { FeatureKey } from '../codeMap';

export type InspectorTab = 'quality' | 'events' | 'devices' | 'diagnostics';

// Tab names are unique on the page (the Destinations tabs are Directory,
// Recents, SWML, SIP and Subscribers): the workbench and screenshot specs
// select tabs by name without scoping.
const TABS: Array<{ key: InspectorTab; label: string; title: string }> = [
  { key: 'quality', label: 'Quality', title: 'Live statistics for the current call (kept after hangup)' },
  { key: 'events', label: 'Events', title: 'What the SDK and this dialer did, in order' },
  { key: 'devices', label: 'Devices', title: 'Microphone, camera, speaker and audio processing' },
  { key: 'diagnostics', label: 'Diagnostics', title: 'Connection, identity, SDK settings, connection test, export' },
];

// The "where's the code" entry for each tab (shown in the pane's header).
export const INSPECTOR_CODE: Record<InspectorTab, FeatureKey> = {
  quality: 'quality',
  events: 'events',
  devices: 'devices',
  diagnostics: 'connection',
};

// Device selection (the SDK's device observables) and the per-call audio
// processing toggles, which live on call.self and so need a call to be up.
function DevicesBody() {
  const isInCall = useCallStore((s) => s.isInCall);
  const canSelectAudioOutput = useCallStore((s) => s.canSelectAudioOutput);
  const isEchoCancellationOn = useCallStore((s) => s.isEchoCancellationOn);
  const isNoiseSuppressionOn = useCallStore((s) => s.isNoiseSuppressionOn);
  const isAutoGainOn = useCallStore((s) => s.isAutoGainOn);
  const { toggleEchoCancellation, toggleNoiseSuppression, toggleAutoGain } = useSignalWire();
  // DeviceSections prompts for camera permission on mount, so it's mounted
  // only once asked for.
  const [showDevices, setShowDevices] = useState(false);
  const processingHint = isInCall ? undefined : 'Available during a call';

  return (
    <>
      <SheetSection label="Devices" codeRef="devices" />
      <button
        type="button"
        onClick={() => setShowDevices((prev) => !prev)}
        aria-expanded={showDevices}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        {showDevices ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {showDevices ? 'Hide microphone, camera and speaker' : 'Show microphone, camera and speaker'}
      </button>
      {!showDevices && (
        <p className="px-3 pb-2 text-xs text-faint">Listing devices asks the browser for microphone and camera access.</p>
      )}
      {showDevices && <DeviceSections />}
      <SheetStat
        label="Speaker selection"
        value={canSelectAudioOutput ? 'Supported' : 'Not supported'}
        hint="HTMLMediaElement.setSinkId — missing on Firefox and Safari"
      />

      <SheetSection label="Audio processing" codeRef="audio-processing" />
      <p className="px-3 pb-1 text-xs text-faint">
        Echo cancellation, noise suppression and automatic gain control are set on the call&apos;s own
        microphone track (call.self), so they can be changed once a call is up.
      </p>
      <SheetSwitch
        label="Echo Cancellation"
        checked={isEchoCancellationOn}
        onChange={toggleEchoCancellation}
        disabled={!isInCall}
        hint={processingHint}
      />
      <SheetSwitch
        label="Noise Suppression"
        checked={isNoiseSuppressionOn}
        onChange={toggleNoiseSuppression}
        disabled={!isInCall}
        hint={processingHint}
      />
      <SheetSwitch
        label="Auto Gain Control"
        checked={isAutoGainOn}
        onChange={toggleAutoGain}
        disabled={!isInCall}
        hint={processingHint}
      />
    </>
  );
}

// Connection and identity facts, then the same settings / connection-test /
// export bodies the phone's Diagnostics panel is made of.
function DiagnosticsBody() {
  const isClientReady = useCallStore((s) => s.isClientReady);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);

  return (
    <>
      <SheetSection label="Session" codeRef="connection" />
      <SheetStat
        label="SignalWire"
        value={
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isClientReady ? 'bg-success' : 'bg-warn animate-pulse'}`} />
            {isClientReady ? 'Connected' : 'Reconnecting…'}
          </span>
        }
        hint="client.ready$ — connected and authenticated"
      />
      <SheetStat
        label="Signed in as"
        value={activeSubscriberName ?? '—'}
        hint="Switch from the Subscribers tab in Destinations"
      />
      <DoNotDisturbSwitch />

      <SettingsBody />

      <SheetSection label="Test my connection" codeRef="preflight" />
      <div className="px-3">
        <ConnectionTestBody />
        <ExportDiagnosticsButton className="mt-3" />
      </div>

      <SdkFacts />
    </>
  );
}

interface InspectorPaneProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}

// The workbench's right pane. All four tab panels stay mounted and are
// toggled with `hidden`: the Quality tab keeps its last reading after hangup,
// the connection test keeps its result, and the event log keeps its scroll.
function InspectorPane({ activeTab, onTabChange }: InspectorPaneProps) {
  const isInCall = useCallStore((s) => s.isInCall);
  const { requestIceRestart } = useSignalWire();

  return (
    <>
      <div className="flex min-h-11 shrink-0 items-center gap-1 border-b border-edge px-3 text-[13px] font-medium">
        <div role="tablist" aria-label="Inspector" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`inspector-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`inspector-panel-${tab.key}`}
              title={tab.title}
              onClick={() => onTabChange(tab.key)}
              className={`relative flex shrink-0 items-center gap-1.5 px-2.5 py-3 transition-colors ${
                activeTab === tab.key
                  ? 'text-accent-text after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {tab.label}
              {tab.key === 'quality' && isInCall && (
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        id="inspector-panel-quality"
        role="tabpanel"
        aria-labelledby="inspector-tab-quality"
        hidden={activeTab !== 'quality'}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        <CallStatsBody onRequestIceRestart={requestIceRestart} />
      </div>

      <div
        id="inspector-panel-events"
        role="tabpanel"
        aria-labelledby="inspector-tab-events"
        hidden={activeTab !== 'events'}
        className="flex min-h-0 flex-1 flex-col px-4 py-3"
      >
        <EventLog fill />
      </div>

      <div
        id="inspector-panel-devices"
        role="tabpanel"
        aria-labelledby="inspector-tab-devices"
        hidden={activeTab !== 'devices'}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        <DevicesBody />
      </div>

      <div
        id="inspector-panel-diagnostics"
        role="tabpanel"
        aria-labelledby="inspector-tab-diagnostics"
        hidden={activeTab !== 'diagnostics'}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        <DiagnosticsBody />
      </div>
    </>
  );
}

export default InspectorPane;
