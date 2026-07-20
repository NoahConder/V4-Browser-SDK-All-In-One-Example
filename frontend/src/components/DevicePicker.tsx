import React, { useEffect, useState } from 'react';
import { Mic, Video, Volume2, Check, X } from 'lucide-react';
import { signalWireService } from '../services/signalwire';

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
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
      <Icon size={13} />
      {label}
    </div>
    {devices.length === 0 ? (
      <div className="px-3 py-2 text-sm text-gray-500">No devices found</div>
    ) : (
      devices.map((device) => {
        const isSelected = selected ? selected.deviceId === device.deviceId : false;
        return (
          <button
            key={device.deviceId}
            type="button"
            onClick={() => onSelect(device)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
          >
            <span className="flex-1 truncate text-sm text-white">
              {device.label || `${label} (${device.deviceId.slice(0, 8)})`}
            </span>
            {isSelected && <Check size={16} className="shrink-0 text-ios-green" />}
          </button>
        );
      })
    )}
  </div>
);

// Idle-screen and mid-call entry points each mount their own instance (see
// Dialer.tsx / CallScreen.tsx) -- device lists are read-only, live SDK state,
// not something worth threading through Zustand for a single consumer.
const DevicePicker: React.FC<DevicePickerProps> = ({ isOpen, onClose }) => {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<MediaDeviceInfo | null>(null);
  const [selectedVideoInput, setSelectedVideoInput] = useState<MediaDeviceInfo | null>(null);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<MediaDeviceInfo | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Populates device labels (blank until permission is granted) and
    // re-enumerates for anything plugged in since this was last opened.
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
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectAudioOutput = (device: MediaDeviceInfo | null) => {
    // Feeds toggleSpeaker() -- selecting an output device here is what makes
    // the in-call speaker toggle actually switch something.
    signalWireService.setPreferredAudioOutputDevice(device);
  };

  return (
    <div className="glass-panel relative z-10 mx-auto mt-2 max-h-64 w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl px-2 py-2">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Devices</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

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
    </div>
  );
};

export default DevicePicker;
