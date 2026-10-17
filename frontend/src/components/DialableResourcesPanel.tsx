import React from 'react';
import { X } from 'lucide-react';
import ResourceAddressList, { type ResourcePage } from './ResourceAddressList';
import DirectoryAddressList from './DirectoryAddressList';
import RecentsList from './RecentsList';
import { swmlAPI, sipAPI } from '../services/api';
import type { SwmlScript, SipCredential, DialableAddress } from '../types';

export type ResourceTab = 'directory' | 'recents' | 'swml' | 'sip';

interface DialableResourcesPanelProps {
  isOpen: boolean;
  // Controlled by Dialer so other UI (the Recents shortcut) can open a
  // specific tab.
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onClose: () => void;
  // `label` is the picked entry's display name, for the Recents log.
  onSelectAddress: (path: string, video: boolean, label?: string) => void;
}

// Short labels so the whole tab strip fits a 320px-wide phone.
const TABS: Array<{ key: ResourceTab; label: string; title: string }> = [
  { key: 'directory', label: 'Directory', title: "This subscriber's address book (SDK directory)" },
  { key: 'recents', label: 'Recents', title: 'Calls made and received in this browser' },
  { key: 'swml', label: 'SWML', title: 'SWML scripts in the space' },
  { key: 'sip', label: 'SIP', title: 'SIP credentials in the space' },
];

// Module-scope (referentially stable) so ResourceAddressList's fetch effect
// doesn't refire every render.
const fetchSwmlPage = async (offset: number, limit: number): Promise<ResourcePage<SwmlScript>> => {
  const page = await swmlAPI.listScripts(offset, limit);
  return { items: page.scripts, hasMore: page.hasMore };
};

const fetchSipPage = async (offset: number, limit: number): Promise<ResourcePage<SipCredential>> => {
  const page = await sipAPI.listCredentials(offset, limit);
  return { items: page.credentials, hasMore: page.hasMore };
};

const getSwmlRowLabel = (_script: SwmlScript, address: DialableAddress): string =>
  address.display_name || address.name;

// SIP credential's dial-auth username lives nested under sip_endpoint (confirmed
// against the live REST response -- it's not a top-level field). Label each
// address row with both to disambiguate multiple addresses under one credential.
const getSipRowLabel = (credential: SipCredential, address: DialableAddress): string =>
  `${credential.sip_endpoint.username} · ${address.display_name || address.name}`;

const DialableResourcesPanel: React.FC<DialableResourcesPanelProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  onSelectAddress,
}) => {
  if (!isOpen) return null;

  return (
    <div className="glass-panel mx-auto mt-2 max-h-72 w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Dialable resources"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-white/6 p-0.5 text-xs font-medium uppercase tracking-wider"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`resources-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls="resources-tabpanel"
              title={tab.title}
              onClick={() => onTabChange(tab.key)}
              className={`shrink-0 rounded-full px-2.5 py-2 transition-colors ${
                activeTab === tab.key ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Each list is keyed by tab so switching remounts it (fresh fetch for the
          REST tabs; the Directory is cached by the SDK and re-renders instantly). */}
      <div id="resources-tabpanel" role="tabpanel" aria-labelledby={`resources-tab-${activeTab}`}>
        {activeTab === 'directory' ? (
          <DirectoryAddressList key="directory" onSelectAddress={onSelectAddress} />
        ) : activeTab === 'recents' ? (
          <RecentsList key="recents" onSelectAddress={onSelectAddress} />
        ) : activeTab === 'swml' ? (
          <ResourceAddressList
            key="swml"
            fetchPage={fetchSwmlPage}
            getRowLabel={getSwmlRowLabel}
            onSelectAddress={onSelectAddress}
            emptyMessage="No SWML scripts found in this space."
            loadingMessage="Loading scripts..."
          />
        ) : (
          <ResourceAddressList
            key="sip"
            fetchPage={fetchSipPage}
            getRowLabel={getSipRowLabel}
            onSelectAddress={onSelectAddress}
            emptyMessage="No SIP credentials found in this space."
            loadingMessage="Loading credentials..."
          />
        )}
      </div>
    </div>
  );
};

export default DialableResourcesPanel;
