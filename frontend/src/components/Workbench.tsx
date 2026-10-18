import { useEffect, useMemo, useState } from 'react';
import Dialer from './Dialer';
import { DestinationsTabs, type ResourceTab } from './DialableResourcesPanel';
import InspectorPane, { type InspectorTab } from './InspectorPane';
import { WorkbenchContext, type WorkbenchApi } from '../hooks/useWorkbench';
import { useCallStore } from '../hooks/useCallStore';
import { useDialFieldStore } from '../hooks/useDialFieldStore';

// Every list the phone's header panels offer, plus Subscribers (its own panel
// on phones, with Do Not Disturb, which lives in the Session tab here).
const DESTINATION_TABS: ResourceTab[] = ['directory', 'recents', 'swml', 'sip', 'subscribers'];

// The desktop layout (App.tsx renders it from WORKBENCH_QUERY up): the phone
// column unchanged in the middle, as the device under test, with the tooling
// beside it instead of on top of it -- Destinations on the left (what to
// dial), the Inspector on the right (what the SDK is doing). Panes are plain
// regions, never dialogs: useDialog would move focus into them and trap Tab,
// stealing the address input's focus and Enter-to-call.
function Workbench() {
  const [destinationsTab, setDestinationsTab] = useState<ResourceTab>('directory');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('session');
  const isInCall = useCallStore((s) => s.isInCall);
  const selectAddress = useDialFieldStore((s) => s.selectAddress);

  // A call starting is what a tester wants to watch: show its numbers. It
  // stays on Call after hangup so the final readings can be read.
  useEffect(() => {
    if (isInCall) setInspectorTab('call');
  }, [isInCall]);

  const api = useMemo<WorkbenchApi>(
    () => ({
      openSubscribers: () => setDestinationsTab('subscribers'),
      openCallStats: () => setInspectorTab('call'),
    }),
    [],
  );

  return (
    <WorkbenchContext.Provider value={api}>
      <div className="app-shell workbench h-dvh">
        <section
          role="region"
          aria-label="Destinations"
          className="flex min-h-0 flex-col border-r border-edge bg-canvas"
        >
          <DestinationsTabs
            tabs={DESTINATION_TABS}
            activeTab={destinationsTab}
            onTabChange={setDestinationsTab}
            onSelectAddress={selectAddress}
            className="flex min-h-0 flex-1 flex-col px-4 pt-3"
            panelClassName="min-h-0 flex-1 overflow-y-auto pb-4"
          />
        </section>

        <div className="flex min-h-0 justify-center">
          <div className="flex min-h-0 w-full flex-col border-x border-edge">
            <Dialer />
          </div>
        </div>

        <section role="region" aria-label="Inspector" className="flex min-h-0 flex-col border-l border-edge bg-canvas">
          <InspectorPane activeTab={inspectorTab} onTabChange={setInspectorTab} />
        </section>
      </div>
    </WorkbenchContext.Provider>
  );
}

export default Workbench;
