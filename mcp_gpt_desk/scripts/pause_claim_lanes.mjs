const baseUrl = String(
  process.env.DESK_PUBLIC_BASE_URL
  || process.env.DESK_OAUTH_ISSUER
  || "http://127.0.0.1:8787",
).replace(/\/+$/, "");
const operatorPin = String(
  process.env.DESK_OPERATOR_ADMIN_PIN
  || process.env.DESK_OAUTH_ADMIN_PIN
  || "",
);
const reason = String(process.argv[2] || "OPERATOR_MAINTENANCE_HOLD");
const requestedLanes = process.argv.slice(3);
const lanes = requestedLanes.length ? requestedLanes : ["live", "replay"];

if (!operatorPin) throw new Error("DESK_OPERATOR_ADMIN_PIN_MISSING");
if (lanes.some((lane) => !["live", "replay"].includes(lane))) {
  throw new Error("CLAIM_LANE_INVALID");
}

const login = await fetch(`${baseUrl}/api/v1/auth/operator/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pin: operatorPin }),
});
if (!login.ok) {
  throw new Error(`OPERATOR_LOGIN_FAILED:${login.status}`);
}
const setCookies = typeof login.headers.getSetCookie === "function"
  ? login.headers.getSetCookie()
  : [login.headers.get("set-cookie")].filter(Boolean);
const cookie = setCookies
  .map((value) => String(value).split(";")[0])
  .filter(Boolean)
  .join("; ");
if (!cookie) throw new Error("OPERATOR_SESSION_COOKIE_MISSING");

const overview = await api("/api/v1/claim-lanes");
const results = [];
for (const lane of lanes) {
  const current = overview?.lanes?.[lane];
  if (!current) throw new Error(`CLAIM_LANE_NOT_FOUND:${lane}`);
  if (current.enabled === false) {
    results.push({
      lane,
      status: current.status,
      enabled: false,
      revision: current.revision,
      changed: false,
    });
    continue;
  }
  const result = await api(`/api/v1/claim-lanes/${lane}/actions`, {
    method: "POST",
    body: JSON.stringify({
      action: "pause",
      expected_revision: Number(current.revision || 0),
      reason,
    }),
  });
  results.push({
    lane,
    status: result?.status,
    enabled: result?.control?.enabled,
    revision: result?.control?.revision,
    changed: true,
  });
}

console.log(JSON.stringify({
  ok: true,
  reason,
  results,
}, null, 2));

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`CLAIM_LANE_API_FAILED:${response.status}:${body?.error || "unknown"}`);
  }
  return body;
}
