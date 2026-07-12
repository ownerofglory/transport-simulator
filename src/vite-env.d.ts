/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the transit-simulator-backend real-time service. Empty = same-origin.
  readonly VITE_REALTIME_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
