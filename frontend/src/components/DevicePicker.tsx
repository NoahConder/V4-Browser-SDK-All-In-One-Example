import React, { useEffect, useState } from 'react';
import { Mic, Video, Volume2, Check, Loader2, X } from 'lucide-react';
import { signalWireService } from '../services/signalwire';
import { useDialog } from '../hooks/useDialog';

interface DevicePickerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DeviceSectionProps {
  icon: React.ElementType;
  label: string;
  devices: MediaDeviceInfo[];
  selected: MediaDeviceInfo | null;
  onSelect: (device: MediaDeviceInfo | null) => void;
}

const DeviceSection: React.FC<DeviceSectionProps> = ({ icon: Icon, label, devices, selected, onSelect }) => (
  <div className="mb-2">
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-faint">
      <Icon size={13} />
      {label}
    </div>
    {devices.length === 0 ? (
      <div className="px-3 py-2 text-sm text-faint">No devices found</div>
    ) : (
      devices.map((device) => {
        const isSelected = selected ? selected.deviceId === device.deviceId : false;
        return (
          <button
            key={device.deviceId}
            type="button"
            onClick={() => onSelect(device)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="flex-1 truncate text-sm text-ink">
              {device.label || `${label} (${device.deviceId.slice(0, 8)})`}
            </span>
            {isSelected && <Check size={16} className="shrink-0 text-accent-text" />}
          </button>
        );
      })
    )}
  </div>
);

// Microphone / camera / speaker lists with selection, from the SDK's device
// observables. Requests media permission on mount (labels are blank until
// granted), so mount it only when the user asks for devices -- the pickers
// below and the workbench's Session tab do. Device lists are read-only, live
// SDK state, not something worth threading through Zustand for one consumer.
export function DeviceSections() {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<MediaDeviceInfo | null>(null);
  const [selectedVideoInput, setSelectedVideoInput] = useState<MediaDeviceInfo | null>(null);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<MediaDeviceInfo | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    // Populates device labels (blank until permission is granted) and
    // re-enumerates for anything plugged in since this was last shown.
    signalWireService.requestMediaPermissions({ audio: true, video: true }).catch(() => {});
    signalWireService.refreshDevices().catch(() => {});

    const subs = [
      signalWireService.getAudioInputDevices$().subscribe(setAudioInputs),
      signalWireService.getVideoInputDevices$().subscribe(setVideoInputs),
      signalWireService.getAudioOutputDevices$().subscribe(setAudioOutputs),
      signalWireService.getSelectedAudioInputDevice$().subscribe(setSelectedAudioInput),
      signalWireService.getSelectedVideoInputDevice$().subscribe(setSelectedVideoInput),
      signalWireService.getSelectedAudioOutputDevice$().subscribe(setSelectedAudioOutput),
    ];

    return () => subs.forEach((sub) => sub.unsubscribe());
  }, []);

  // Firefox and Safari list nothing until access is granted (and nothing at
  // all once it's denied), so three "No devices found" rows need a way out.
  const noneFound = audioInputs.length === 0 && videoInputs.length === 0 && audioOutputs.length === 0;
  const grantAccess = async () => {
    setIsRequesting(true);
    try {
      await signalWireService.requestMediaPermissions({ audio: true, video: true });
    } catch {
      // Denied, or no hardware: refreshDevices() below lists whatever there is.
    }
    try {
      await signalWireService.refreshDevices();
    } catch {
      // Same: the lists simply stay as they are.
    }
    setIsRequesting(false);
  };

  const handleSelectAudioOutput = (device: MediaDeviceInfo | null) => {
    // Feeds toggleSpeaker() -- selecting an output device here is what makes
    // the in-call speaker toggle actually switch something.
    signalWireService.setPreferredAudioOutputDevice(device);
  };

  return (
    <>
      <DeviceSection
        icon={Mic}
        label="Microphone"
        devices={audioInputs}
        selected={selectedAudioInput}
        onSelect={signalWireService.selectAudioInputDevice.bind(signalWireService)}
      />
      <DeviceSection
        icon={Video}
        label="Camera"
        devices={videoInputs}
        selected={selectedVideoInput}
        onSelect={signalWireService.selectVideoInputDevice.bind(signalWireService)}
      />
      <DeviceSection
        icon={Volume2}
        label="Speaker"
        devices={audioOutputs}
        selected={selectedAudioOutput}
        onSelect={handleSelectAudioOutput}
      />

      {noneFound && (
        <div className="px-3 pb-2">
          <p className="mb-2 text-xs text-faint">
            Browsers hide devices until access is granted, and some list nothing once it's denied.
          </p>
          <button
            type="button"
            onClick={grantAccess}
            disabled={isRequesting}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-edge-strong bg-surface-2 px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {isRequesting ? <Loader2 size={14} className="animate-spin" /> : null}
            Grant microphone and camera access
          </button>
        </div>
      )}
    </>
  );
}

// Idle-screen and mid-call entry points each mount their own instance (see
// Dialer.tsx / CallScreen.tsx); the sections unmount with the panel.
const DevicePicker: React.FC<DevicePickerProps> = ({ isOpen, onClose }) => {
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="devices-title"
      className="glass-panel relative z-10 mx-auto mt-2 max-h-[60dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl px-2 py-2 short:max-h-[calc(100dvh-4.5rem)]"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span id="devices-title" className="text-xs font-medium uppercase tracking-wider text-muted">Devices</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-full p-3 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <DeviceSections />
    </div>
  );
};

export default DevicePicker;
