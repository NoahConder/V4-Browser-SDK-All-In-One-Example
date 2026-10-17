import { defineConfig, devices } from '@playwright/test';

// Runs against the Vite dev server through the dev-only `?e2e=1` seam (see
// useSignalWire.ts): no SignalWire credentials or backend are needed. Tests
// stub the service singleton and drive the Zustand store directly.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The behavioral suite, on a phone-sized viewport with touch.
      name: 'phone',
      testIgnore: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      // Non-asserting screenshots of every screen at four viewports, for
      // eyeballing layout changes: `npm run test:shots`, then look in
      // e2e/screenshots/.
      name: 'shots',
      testMatch: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
