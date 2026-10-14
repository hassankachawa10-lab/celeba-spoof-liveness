/// <reference types="vite/client" />

// Extend Vite's ImportMetaEnv with our custom env variables
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
