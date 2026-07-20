import { signalWireService } from './signalwire';

// Shared by DiagnosticsPanel (idle) and CallControlsSheet (mid-call) --
// broken out of both so it isn't a non-component export living in a .tsx
// component file (react-refresh/only-export-components).
export const downloadDiagnostics = () => {
  const diagnostics = signalWireService.exportDiagnostics();
  if (!diagnostics) return;

  const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `signalwire-diagnostics-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
