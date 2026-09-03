export type DeskDataMode = "bff";

export type DeskAppConfig = {
  dataMode: DeskDataMode;
  frontApiBaseUrl: string;
  operatorAuthBaseUrl: string;
  frontApiTimeoutMs: number;
  features: {
    jarvisWorkspace: boolean;
  };
};

const DEFAULT_FRONT_API_TIMEOUT_MS = 60_000;

export function readDeskAppConfig(env: ImportMetaEnv): DeskAppConfig {
  const dataMode: DeskDataMode = "bff";
  const parsedTimeout = Number(env.VITE_FRONT_API_TIMEOUT_MS);

  return {
    dataMode,
    frontApiBaseUrl: normalizeApiBaseUrl(env.VITE_FRONT_API_BASE_URL),
    operatorAuthBaseUrl: normalizeOperatorAuthBaseUrl(env.VITE_OPERATOR_AUTH_BASE_URL),
    frontApiTimeoutMs:
      Number.isFinite(parsedTimeout) && parsedTimeout > 0
        ? parsedTimeout
        : DEFAULT_FRONT_API_TIMEOUT_MS,
    features: {
      jarvisWorkspace: env.VITE_FEATURE_JARVIS_WORKSPACE !== "false"
    }
  };
}

export function normalizeOperatorAuthBaseUrl(value: string | undefined): string {
  return (value?.trim() || "/api/v1/auth/operator").replace(/\/+$/, "");
}

export function normalizeApiBaseUrl(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return "/front-api/v1";
  }

  return value.replace(/\/+$/, "");
}
