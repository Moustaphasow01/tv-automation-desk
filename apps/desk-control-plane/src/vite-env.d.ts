/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly VITE_DATA_MODE?: "mock" | "bff";
  readonly VITE_OPERATOR_AUTH_BASE_URL?: string;
  readonly VITE_FRONT_API_BASE_URL?: string;
  readonly VITE_FRONT_API_TIMEOUT_MS?: string;
  readonly VITE_FEATURE_JARVIS_WORKSPACE?: string;
  readonly VITE_DESK_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
