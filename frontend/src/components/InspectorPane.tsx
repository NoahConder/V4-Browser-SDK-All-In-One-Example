import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CallStatsBody } from './CallStatsSheet';
import EventLog from './EventLog';
import { ConnectionTestBody, ExportDiagnosticsButton, SdkFacts, SettingsBody } from './DiagnosticsPanel';
import { DeviceSections } from './DevicePicker';
import { DoNotDisturbSwitch } from './SubscriberPicker';
import { SheetSection, SheetStat } from './SheetPrimitives';
import { useCallStore } from '../hooks/useCallStore';
import { useSignalWire } from '../hooks/useSignalWire';

export type InspectorTab = 'call' | 'events' | 'session';

const TABS: Array<{ key: InspectorTab; label: string; title: string }> = [
  { key: 'call', label: 'Call', title: 'Live statistics for the current call (kept after hangup)' },
  { key: 'events', label: 'Events', title: 'What the SDK and this dialer did, in order' },
  { key: 'session', label: 'Session', title: 'Connection, identity, SDK settings, connection test, devices' },
];

// Connection and identity facts, then the same settings / connection-test /
// export / devices bodies the phone's Diagnostics panel is made of.
function SessionBody() {
  const isClientReady = useCallStore((s) => s.isClientReady);
  const activeSubscriberName = useCallStore((s) => s.activeSubscriberName);
  const canSelectAudioOutput = useCallStore((s) => s.canSelectAudioOutput);
  // DeviceSections prompts for camera permission on mount, so it's mounted
  // only once asked for.
  const [showDevices, setShowDevices] = useState(false);

  return (
    <>
      <SheetSection label="Connection" />
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
      <SheetStat
        label="Speaker selection"
        value={canSelectAudioOutput ? 'Supported' : 'Not supported'}
        hint="HTMLMediaElement.setSinkId — missing on Firefox and Safari"
      />

      <SettingsBody />

      <SheetSection label="Test my connection" />
      <div className="px-3">
        <ConnectionTestBody />
        <ExportDiagnosticsButton className="mt-3" />
      </div>

      <SheetSection label="Devices" />
      <button
        type="button"
        onClick={() => setShowDevices((prev) => !prev)}
        aria-expanded={showDevices}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        {showDevices ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {showDevices ? 'Hide microphone, camera and speaker' : 'Show microphone, camera and speaker'}
      </button>
      {showDevices && <DeviceSections />}

      <SdkFacts />
    </>
  );
}

interface InspectorPaneProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}

// The workbench's right pane. All three tab panels stay mounted and are
// toggled with `hidden`: the Call tab keeps its last reading after hangup, the
// connection test keeps its result, and the event log keeps its scroll.
function InspectorPane({ activeTab, onTabChange }: InspectorPaneProps) {
  const isInCall = useCallStore((s) => s.isInCall);
  const { requestIceRestart } = useSignalWire();

  return (
    <>
      <div
        role="tablist"
        aria-label="Inspector"
        className="glass-bar flex min-h-12 shrink-0 items-center gap-1 px-4 pt-safe text-[13px] font-medium"
      >
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
            className={`relative flex items-center gap-1.5 px-3 py-3 transition-colors ${
              activeTab === tab.key
                ? 'text-accent-text after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
                : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.key === 'call' && isInCall && (
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            )}
          </button>
        ))}
      </div>

      <div
        id="inspector-panel-call"
        role="tabpanel"
        aria-labelledby="inspector-tab-call"
        hidden={activeTab !== 'call'}
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
        id="inspector-panel-session"
        role="tabpanel"
        aria-labelledby="inspector-tab-session"
        hidden={activeTab !== 'session'}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        <SessionBody />
      </div>
    </>
  );
}

export default InspectorPane;
