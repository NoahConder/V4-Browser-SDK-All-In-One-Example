import { useEffect, useState } from 'react';
import Dialer from './components/Dialer';
import Workbench from './components/Workbench';
import { WORKBENCH_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import { useSignalWire } from './hooks/useSignalWire';
import { signalWireService } from './services/signalwire';
import { toneService } from './services/tones';
import { log } from './utils/log';

function App() {
  const { isInitialized, error } = useSignalWire();
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  // Wide screens get the workbench (Destinations | phone | Inspector); phones,
  // tablets and short windows get the phone column with its header panels.
  // Call state and the dial field live in stores, so resizing across the
  // breakpoint mid-call just re-homes the same screen.
  const isWorkbench = useMediaQuery(WORKBENCH_QUERY);

  useEffect(() => {
    // Handle proper cleanup only on page unload
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Only disconnect when the page is actually being closed
      log.debug('Page unloading event triggered');
      // Double-check this is a real unload event
      if (event && event.type === 'beforeunload') {
        // Not while a call is up. client.disconnect() ends the session and
        // clears its resume state AND its attach records together (the backend
        // only honors attach records within the session that created them), so
        // disconnecting here would leave the reloaded page nothing to reattach
        // to. Letting the socket drop on its own instead keeps the session
        // alive server-side long enough for the reload to pick the call back
        // up -- see reconnectAttachedCalls in services/signalwire.ts. The
        // records expire on their own after preferences.reconnectCallsTimeout
        // (5 min by default), so nothing is stranded if the user doesn't come
        // back.
        if (signalWireService.hasActiveCall()) {
          log.debug('beforeunload during an active call - keeping the session so the call can be reattached');
          return;
        }
        log.debug('Confirmed beforeunload - disconnecting SignalWire');
        signalWireService.disconnect();
      }
    };

    // Only add the listener, don't call the function
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Lets the ringtone and key tones play before the user has tapped
    // anything else that would unlock audio (see tones.ts).
    toneService.primeOnFirstGesture();

    // Request microphone permissions on load
    const requestPermissions = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the stream immediately after getting permission
        stream.getTracks().forEach(track => track.stop());
        setPermissionsGranted(true);
      } catch (err) {
        log.error('Failed to get microphone permissions:', err);
        setPermissionsGranted(false);
      }
    };

    requestPermissions();

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  if (!permissionsGranted) {
    return (
      <div className="app-shell flex flex-col h-dvh items-center justify-center p-8">
        <div className="glass-panel w-full max-w-sm rounded-xl p-8 text-center">
          <h1 className="text-2xl font-semibold mb-4">Microphone Permission Required</h1>
          <p className="text-muted mb-8">
            Please allow microphone access to make and receive calls
          </p>
          <button
            onClick={async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setPermissionsGranted(true);
              } catch {
                alert('Microphone permission is required to use this app');
              }
            }}
            className="w-full rounded-lg bg-accent px-6 py-3 font-medium text-on-accent transition-all hover:bg-accent-hover active:scale-[0.98]"
          >
            Grant Permission
          </button>
        </div>
      </div>
    );
  }

  // A failed start must fall through to the error screen below, not sit on
  // the spinner.
  if (!isInitialized && !error) {
    return (
      <div className="app-shell flex flex-col h-dvh items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mb-4 mx-auto"></div>
          <p className="text-muted">Connecting to SignalWire...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell flex flex-col h-dvh items-center justify-center p-8">
        <div className="glass-panel w-full max-w-sm rounded-xl p-8 text-center">
          <h1 className="text-2xl font-semibold mb-4 text-danger-text">Connection Error</h1>
          <p className="text-muted mb-8">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg border border-edge-strong bg-surface-2 px-6 py-3 font-medium text-ink transition-all hover:bg-surface-hover active:scale-[0.98]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return isWorkbench ? <Workbench /> : <Dialer />;
}

export default App;