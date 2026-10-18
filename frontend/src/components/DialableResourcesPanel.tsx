import React from 'react';
import { X } from 'lucide-react';
import ResourceAddressList, { type ResourcePage } from './ResourceAddressList';
import DirectoryAddressList from './DirectoryAddressList';
import RecentsList from './RecentsList';
import { SubscriberList } from './SubscriberPicker';
import { swmlAPI, sipAPI } from '../services/api';
import { useDialog } from '../hooks/useDialog';
import type { SwmlScript, SipCredential, DialableAddress } from '../types';

export type ResourceTab = 'directory' | 'recents' | 'swml' | 'sip' | 'subscribers';

type SelectAddress = (path: string, video: boolean, label?: string) => void;

// Short labels so the whole tab strip fits a 320px-wide phone.
const TAB_META: Record<ResourceTab, { label: string; title: string }> = {
  directory: { label: 'Directory', title: "This subscriber's address book (SDK directory)" },
  recents: { label: 'Recents', title: 'Calls made and received in this browser' },
  swml: { label: 'SWML', title: 'SWML scripts in the space' },
  sip: { label: 'SIP', title: 'SIP credentials in the space' },
  subscribers: { label: 'Subscribers', title: "The space's subscribers: call one, or switch to it" },
};

// The phone's header panel shows these four; the workbench's Destinations pane
// adds Subscribers (on phones that's its own header panel, with Do Not Disturb).
const PANEL_TABS: ResourceTab[] = ['directory', 'recents', 'swml', 'sip'];

// Module-scope (referentially stable) so ResourceAddressList's fetch effect
// doesn't refire every render.
const fetchSwmlPage = async (offset: number, limit: number, query: string): Promise<ResourcePage<SwmlScript>> => {
  const page = await swmlAPI.listScripts(offset, limit, query);
  return { items: page.scripts, hasMore: page.hasMore };
};

const fetchSipPage = async (offset: number, limit: number, query: string): Promise<ResourcePage<SipCredential>> => {
  const page = await sipAPI.listCredentials(offset, limit, query);
  return { items: page.credentials, hasMore: page.hasMore };
};

const getSwmlRowLabel = (_script: SwmlScript, address: DialableAddress): string =>
  address.display_name || address.name;

// SIP credential's dial-auth username lives nested under sip_endpoint (confirmed
// against the live REST response -- it's not a top-level field). Label each
// address row with both to disambiguate multiple addresses under one credential.
const getSipRowLabel = (credential: SipCredential, address: DialableAddress): string =>
  `${credential.sip_endpoint.username} · ${address.display_name || address.name}`;

interface DestinationsTabsProps {
  tabs: ResourceTab[];
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onSelectAddress: SelectAddress;
  // Renders a Close button after the tab strip (the header panel has one).
  onClose?: () => void;
  className?: string;
  // Classes for the tab panel: the Destinations pane makes it the scrolling
  // flex child; the header panel scrolls as a whole.
  panelClassName?: string;
}

// The tab strip and the active list, shared by the phone's header panel
// (below) and the workbench's Destinations pane (Workbench.tsx). The ids are
// fixed because only one instance exists at a time.
export function DestinationsTabs({
  tabs,
  activeTab,
  onTabChange,
  onSelectAddress,
  onClose,
  className = '',
  panelClassName = '',
}: DestinationsTabsProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Dialable resources"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto border-b border-edge text-[13px] font-medium"
        >
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`resources-tab-${key}`}
              aria-selected={activeTab === key}
              aria-controls="resources-tabpanel"
              title={TAB_META[key].title}
              onClick={() => onTabChange(key)}
              className={`relative shrink-0 px-2.5 py-2 transition-colors ${
                activeTab === key
                  ? 'text-accent-text after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {TAB_META[key].label}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Each list is keyed by tab so switching remounts it (fresh fetch for the
          REST tabs; the Directory is cached by the SDK and re-renders instantly).
          Each tab's search box lives in its list, so it starts empty again too. */}
      <div
        id="resources-tabpanel"
        role="tabpanel"
        aria-labelledby={`resources-tab-${activeTab}`}
        className={panelClassName}
      >
        {activeTab === 'directory' ? (
          <DirectoryAddressList key="directory" onSelectAddress={onSelectAddress} />
        ) : activeTab === 'recents' ? (
          <RecentsList key="recents" onSelectAddress={onSelectAddress} />
        ) : activeTab === 'subscribers' ? (
          <SubscriberList key="subscribers" onSelectAddress={onSelectAddress} />
        ) : activeTab === 'swml' ? (
          <ResourceAddressList
            key="swml"
            fetchPage={fetchSwmlPage}
            getRowLabel={getSwmlRowLabel}
            onSelectAddress={onSelectAddress}
            emptyMessage="No SWML scripts found in this space."
            loadingMessage="Loading scripts..."
            searchPlaceholder="Search scripts"
          />
        ) : (
          <ResourceAddressList
            key="sip"
            fetchPage={fetchSipPage}
            getRowLabel={getSipRowLabel}
            onSelectAddress={onSelectAddress}
            emptyMessage="No SIP credentials found in this space."
            loadingMessage="Loading credentials..."
            searchPlaceholder="Search SIP credentials"
          />
        )}
      </div>
    </div>
  );
}

interface DialableResourcesPanelProps {
  isOpen: boolean;
  // Controlled by Dialer so other UI (the Recents shortcut) can open a
  // specific tab.
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onClose: () => void;
  // `label` is the picked entry's display name, for the Recents log.
  onSelectAddress: SelectAddress;
}

// The phone's header panel: DestinationsTabs inside a dialog under the status bar.
const DialableResourcesPanel: React.FC<DialableResourcesPanelProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  onSelectAddress,
}) => {
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Dialable resources"
      className="glass-panel mx-auto mt-2 max-h-[60dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl px-4 py-3 short:max-h-[calc(100dvh-4.5rem)]"
    >
      <DestinationsTabs
        tabs={PANEL_TABS}
        activeTab={activeTab}
        onTabChange={onTabChange}
        onSelectAddress={onSelectAddress}
        onClose={onClose}
      />
    </div>
  );
};

export default DialableResourcesPanel;
