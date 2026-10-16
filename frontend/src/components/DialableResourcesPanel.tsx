import React, { useState } from 'react';
import { X } from 'lucide-react';
import ResourceAddressList, { type ResourcePage } from './ResourceAddressList';
import { swmlAPI, sipAPI } from '../services/api';
import type { SwmlScript, SipCredential, DialableAddress } from '../types';

interface DialableResourcesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAddress: (path: string, video: boolean) => void;
}

type ResourceTab = 'swml' | 'sip';

const TABS: Array<{ key: ResourceTab; label: string }> = [
  { key: 'swml', label: 'SWML Scripts' },
  { key: 'sip', label: 'SIP Credentials' },
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

const DialableResourcesPanel: React.FC<DialableResourcesPanelProps> = ({ isOpen, onClose, onSelectAddress }) => {
  const [activeTab, setActiveTab] = useState<ResourceTab>('swml');

  if (!isOpen) return null;

  return (
    <div className="glass-panel mx-auto mt-2 max-h-64 w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-full bg-white/6 p-0.5 text-xs font-medium uppercase tracking-wider">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={activeTab === tab.key}
              className={`rounded-full px-3 py-2 transition-colors ${
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

      {activeTab === 'swml' ? (
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
  );
};

export default DialableResourcesPanel;
