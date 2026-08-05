const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const INSECURE_EXACT_VALUES = new Set([
  "12345678",
  "local-preprod-key",
  "local-tradingview-secret",
  "local-preprod-token-secret-change-me",
  "local-operator-session-secret-change-me",
]);

export function validateRuntimeConfiguration(env = process.env) {
  const publicMode = booleanEnv(env.DESK_PUBLIC_MODE);
  const bindHost = String(env.DESK_BIND_HOST || (publicMode ? "127.0.0.1" : "0.0.0.0")).trim();
  const port = Number(env.PORT || env.DESK_GPT_MCP_PORT || 8787);
  const errors = [];

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    errors.push("PORT must be an integer between 1 and 65535");
  }

  if (publicMode) {
    requireHttpsUrl(env.DESK_MCP_PUBLIC_BASE_URL, "DESK_MCP_PUBLIC_BASE_URL", errors);
    requireSecret(env.DESK_MCP_API_KEY || env.DESK_GPT_MCP_API_KEY, "DESK_MCP_API_KEY", 32, errors);
    requireSecret(env.DESK_OAUTH_ADMIN_PIN || env.DESK_MCP_OAUTH_PIN, "DESK_OAUTH_ADMIN_PIN", 10, errors);
    requireSecret(env.DESK_OAUTH_TOKEN_SECRET || env.DESK_MCP_OAUTH_SECRET, "DESK_OAUTH_TOKEN_SECRET", 32, errors);
    requireSecret(env.DESK_OPERATOR_ADMIN_PIN || env.DESK_OAUTH_ADMIN_PIN, "DESK_OPERATOR_ADMIN_PIN", 10, errors);
    requireSecret(env.DESK_OPERATOR_SESSION_SECRET, "DESK_OPERATOR_SESSION_SECRET", 32, errors);
    requireSecret(env.TRADINGVIEW_WEBHOOK_SECRET, "TRADINGVIEW_WEBHOOK_SECRET", 24, errors);

    if (!LOOPBACK_HOSTS.has(bindHost)) {
      errors.push("DESK_BIND_HOST must be loopback in public mode; Caddy is the only public listener");
    }

    const origins = parseOrigins(env.DESK_REST_ALLOWED_ORIGINS);
    if (!origins.length) {
      errors.push("DESK_REST_ALLOWED_ORIGINS must contain the public HTTPS origin");
    }
    for (const origin of origins) {
      if (origin === "*" || !isHttpsOrigin(origin)) {
        errors.push(`DESK_REST_ALLOWED_ORIGINS contains an unsafe origin: ${origin}`);
      }
    }

    const databaseUrl = String(env.DATABASE_URL || "");
    if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
      errors.push("DATABASE_URL must be an explicit PostgreSQL URL");
    }
    if (/desk_local_only|localhost|@postgres(?::|\/)/i.test(databaseUrl)) {
      errors.push("DATABASE_URL still contains a local/Docker production placeholder");
    }

    if (String(env.DESK_NINJA_ALLOW_LIVE_ACCOUNT || "false").toLowerCase() === "true") {
      errors.push("DESK_NINJA_ALLOW_LIVE_ACCOUNT cannot be enabled by the generic public deployment profile");
    }
  }

  if (errors.length) {
    const error = new Error(`DESK_RUNTIME_CONFIG_INVALID:\n- ${errors.join("\n- ")}`);
    error.code = "DESK_RUNTIME_CONFIG_INVALID";
    error.details = errors;
    throw error;
  }

  return Object.freeze({
    publicMode,
    bindHost,
    port,
    trustProxy: publicMode || booleanEnv(env.DESK_TRUST_PROXY),
  });
}

export function booleanEnv(value) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function requireSecret(value, name, minimumLength, errors) {
  const secret = String(value || "").trim();
  if (secret.length < minimumLength) {
    errors.push(`${name} must contain at least ${minimumLength} characters`);
    return;
  }
  if (INSECURE_EXACT_VALUES.has(secret) || /change-me|local-only|example|placeholder/i.test(secret)) {
    errors.push(`${name} still contains a development placeholder`);
  }
}

function requireHttpsUrl(value, name, errors) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new Error("unsafe");
    }
  } catch {
    errors.push(`${name} must be an absolute HTTPS URL without credentials, query or fragment`);
  }
}

function parseOrigins(raw) {
  return String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/+$/, "");
  } catch {
    return false;
  }
}
