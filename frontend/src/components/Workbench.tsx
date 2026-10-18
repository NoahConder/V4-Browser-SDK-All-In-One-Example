import React, { useEffect, useMemo, useState } from 'react';
import AppBar from './AppBar';
import Dialer from './Dialer';
import { DestinationsTabs, type ResourceTab } from './DialableResourcesPanel';
import InspectorPane, { type InspectorTab } from './InspectorPane';
import { Pane } from './Pane';
import { WorkbenchContext, type WorkbenchApi } from '../hooks/useWorkbench';
import { useCallStore } from '../hooks/useCallStore';
import { useDialFieldStore } from '../hooks/useDialFieldStore';

// Every list the phone's header panels offer, plus Subscribers (its own panel
// on phones, with Do Not Disturb, which lives in the Diagnostics tab here).
const DESTINATION_TABS: ResourceTab[] = ['directory', 'recents', 'swml', 'sip', 'subscribers'];

// Which side panes are folded to their rail; persisted so a tester's
// arrangement survives a reload.
interface PaneState {
  left: boolean;
  right: boolean;
}

const PANES_KEY = 'dialer_workbench';

const loadPanes = (): PaneState => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      return { left: record.left === true, right: record.right === true };
    }
  } catch {
    // Unreadable: start expanded.
  }
  return { left: false, right: false };
};

const persistPanes = (next: PaneState): PaneState => {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the arrangement just doesn't persist.
  }
  return next;
};

// The desktop layout (App.tsx renders it from WORKBENCH_QUERY up): the bar
// across the top, then Destinations (what to dial) | the call stage |
// the Inspector (what the SDK is doing). Panes are plain regions, never
// dialogs: useDialog would move focus into them and trap Tab, stealing the
// address input's focus and Enter-to-call. The grid's side tracks come from
// globals.css's `workbench`; a collapsed pane overrides its track to the
// rail width through --pane-left / --pane-right.
function Workbench() {
  const [destinationsTab, setDestinationsTab] = useState<ResourceTab>('directory');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('diagnostics');
  const [collapsed, setCollapsed] = useState<PaneState>(loadPanes);
  const isInCall = useCallStore((s) => s.isInCall);
  const selectAddress = useDialFieldStore((s) => s.selectAddress);

  // A call starting is what a tester wants to watch: show its numbers. It
  // stays on Quality after hangup so the final readings can be read.
  useEffect(() => {
    if (isInCall) setInspectorTab('quality');
  }, [isInCall]);

  const togglePane = (side: keyof PaneState) =>
    setCollapsed((prev) => persistPanes({ ...prev, [side]: !prev[side] }));
  const expandPane = (side: keyof PaneState) =>
    setCollapsed((prev) => (prev[side] ? persistPanes({ ...prev, [side]: false }) : prev));

  const api = useMemo<WorkbenchApi>(
    () => ({
      openSubscribers: () => {
        setDestinationsTab('subscribers');
        expandPane('left');
      },
      openRecents: () => {
        setDestinationsTab('recents');
        expandPane('left');
      },
      openCallStats: () => {
        setInspectorTab('quality');
        expandPane('right');
      },
    }),
    [],
  );

  const gridStyle = {
    '--pane-left': collapsed.left ? '2.5rem' : undefined,
    '--pane-right': collapsed.right ? '2.5rem' : undefined,
  } as React.CSSProperties;

  return (
    <WorkbenchContext.Provider value={api}>
      <div className="app-shell flex h-dvh flex-col">
        <AppBar onIdentityClick={api.openSubscribers} />

        <div className="workbench min-h-0 flex-1" style={gridStyle}>
          <Pane
            label="Destinations"
            side="left"
            collapsed={collapsed.left}
            onToggle={() => togglePane('left')}
          >
            <DestinationsTabs
              tabs={DESTINATION_TABS}
              activeTab={destinationsTab}
              onTabChange={setDestinationsTab}
              onSelectAddress={selectAddress}
              className="flex min-h-0 flex-1 flex-col px-3 pt-2"
              panelClassName="min-h-0 flex-1 overflow-y-auto pb-4"
            />
          </Pane>

          <div className="flex min-h-0 flex-col">
            <Dialer />
          </div>

          <Pane
            label="Inspector"
            side="right"
            collapsed={collapsed.right}
            onToggle={() => togglePane('right')}
          >
            <InspectorPane activeTab={inspectorTab} onTabChange={setInspectorTab} />
          </Pane>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
}

export default Workbench;
