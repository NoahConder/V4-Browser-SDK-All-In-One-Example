/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIALER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
