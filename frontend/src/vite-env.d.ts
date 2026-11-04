/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected by vite.config.ts's `define` from backend/.env's DIALER_API_KEY,
  // not read from a frontend .env file.
  readonly VITE_DIALER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
