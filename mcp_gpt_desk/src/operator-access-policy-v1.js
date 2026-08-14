export const OPERATOR_ACCESS_POLICY_VERSION = "operator_access_policy_v1";

export const DESK_OAUTH_SCOPES = Object.freeze([
  "desk.read",
  "desk.write",
  "desk.automation.read",
  "desk.automation.write",
  "desk.execution.read",
  "desk.execution.write",
  "desk.admin",
]);

const SCOPE_IMPLICATIONS = Object.freeze({
  "desk.admin": DESK_OAUTH_SCOPES,
  "desk.write": ["desk.read", "desk.automation.read", "desk.automation.write", "desk.execution.read", "desk.execution.write"],
  "desk.read": ["desk.automation.read", "desk.execution.read"],
  "desk.automation.write": ["desk.automation.read"],
  "desk.execution.write": ["desk.execution.read"],
});

const ROUTE_POLICY_RULES = Object.freeze([
  { match: /^\/execution/, read: ["desk.execution.read", "execution_read", "read"], write: ["desk.execution.write", "execution", "high"] },
  { match: /^\/operator/, read: ["desk.read", "read", "read"], write: ["desk.write", "operator_command", "elevated"] },
  { match: /^\/(?:operations|workflows|replays|replay-preparations|claim-lanes|gpt-processes|observability|incidents|notifications|runbooks|history|strategies|strategy-v2|research|simulation-runs|events)/, read: ["desk.automation.read", "automation_read", "read"], write: ["desk.automation.write", "automation_action", "elevated"] },
  { match: /^\//, read: ["desk.read", "read", "read"], write: ["desk.write", "operator_action", "standard"] },
]);

export function expandOperatorScopes(scopes = []) {
  const expanded = new Set();
  for (const scope of scopes || []) {
    expanded.add(scope);
    for (const implied of SCOPE_IMPLICATIONS[scope] || []) expanded.add(implied);
  }
  return [...expanded].sort();
}

export function hasOperatorScopes(grantedScopes = [], requiredScopes = []) {
  if (!requiredScopes.length) return true;
  const granted = new Set(expandOperatorScopes(grantedScopes));
  return requiredScopes.every((scope) => granted.has(scope));
}

export function operatorAccessPolicyForFrontRoute({ path = "/", pathname = path, method = "GET" } = {}) {
  const normalizedPath = normalizeFrontPath(pathname || path);
  const mode = String(method || "GET").toUpperCase() === "GET" ? "read" : "write";
  return policy(...(ROUTE_POLICY_RULES.find((rule) => rule.match.test(normalizedPath)) || ROUTE_POLICY_RULES.at(-1))[mode]);
}

function policy(requiredScope, capability, risk) {
  return {
    policyVersion: OPERATOR_ACCESS_POLICY_VERSION,
    requiredScopes: [requiredScope],
    compatibilityScopes: requiredScope.endsWith(".read") ? ["desk.read", "desk.write", "desk.admin"] : ["desk.write", "desk.admin"],
    capability,
    risk,
  };
}

function normalizeFrontPath(value) {
  const text = String(value || "/");
  return text.startsWith("/api/v1/") ? text.slice("/api/v1".length) : text;
}
