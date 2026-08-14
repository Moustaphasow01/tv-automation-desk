import { canonicalSha256 } from "./execution-scope.js";

export const PROMPT_REGISTRY_GOVERNANCE_VERSION_V1 = "1.0.0";
export const PROMPT_REGISTRY_GOVERNANCE_SCHEMA_VERSION_V1 = "prompt_registry_governance_v1";
export const PROMPT_REGISTRY_ACTIONS_V1 = Object.freeze([
  "READ_PROMPT_REGISTRY",
  "PUBLISH_PROMPT_VERSION",
  "DEPLOY_PROMPT_COMPOSITION",
  "ROLLBACK_PROMPT_BINDING",
  "REVOKE_PROMPT_BINDING",
]);

export function authorizePromptRegistryActionV1(input = {}) {
  const action = text(input.action);
  const policy = normalizePolicy(input.policy);
  const rule = policy.rules.get(action);
  if (!rule) return denied(["PROMPT_REGISTRY_ACTION_UNKNOWN"], input);
  const reasons = authorizationReasons(input, rule);
  const decision = auditDecision(input, rule, reasons);
  return { ok: reasons.length === 0, reasons, decision };
}

export function scanPromptTextForSecretsV1(promptText = "") {
  const findings = [];
  String(promptText).split(/\r?\n/).forEach((line, index) => {
    for (const rule of secretRules()) {
      if (rule.pattern.test(line) && !allowedPlaceholder(line)) findings.push({ line: index + 1, code: rule.code });
    }
  });
  return { ok: findings.length === 0, findings };
}

function authorizationReasons(input, rule) {
  const reasons = [];
  if (!hasRole(input.actor, rule.roles)) reasons.push("PROMPT_REGISTRY_ROLE_FORBIDDEN");
  if (rule.confirmation_phrase && input.confirmation_phrase !== rule.confirmation_phrase) reasons.push("PROMPT_REGISTRY_CONFIRMATION_REQUIRED");
  if (rule.requires_reason && !text(input.reason)) reasons.push("PROMPT_REGISTRY_REASON_REQUIRED");
  if (rule.requires_passed_evaluation && input.evaluation_status !== "PASS") reasons.push("PROMPT_EVALUATION_PASS_REQUIRED");
  if (rule.audit_required && !text(input.idempotency_key)) reasons.push("PROMPT_REGISTRY_IDEMPOTENCY_REQUIRED");
  return reasons;
}

function auditDecision(input, rule, reasons) {
  return {
    schema_version: PROMPT_REGISTRY_GOVERNANCE_SCHEMA_VERSION_V1,
    action: text(input.action),
    authorized: reasons.length === 0,
    audit_required: rule.audit_required,
    target_type: text(input.target_type),
    target_id: text(input.target_id),
    actor_id: text(input.actor?.id || input.actor?.email || input.actor?.sub),
    reason: text(input.reason),
    decision_hash: `sha256:${canonicalSha256({
      action: input.action,
      target_type: input.target_type,
      target_id: input.target_id,
      reasons,
    })}`,
  };
}

function normalizePolicy(policy = {}) {
  const read = Array.isArray(policy.read_actions) ? policy.read_actions : [];
  const write = Array.isArray(policy.write_actions) ? policy.write_actions : [];
  return { rules: new Map([...read, ...write].map((rule) => [rule.action, rule])) };
}

function denied(reasons, input) {
  return {
    ok: false,
    reasons,
    decision: auditDecision(input, { audit_required: true }, reasons),
  };
}

function hasRole(actor = {}, roles = []) {
  const actorRoles = new Set(Array.isArray(actor.roles) ? actor.roles : []);
  return roles.some((role) => actorRoles.has(role));
}

function secretRules() {
  return [
    { code: "OPENAI_API_KEY", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { code: "GITHUB_TOKEN", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
    { code: "TELEGRAM_BOT_TOKEN", pattern: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
    { code: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  ];
}

function allowedPlaceholder(line) {
  return /placeholder|example|dummy|change-me|\{\{[A-Z0-9_]+\}\}/i.test(line);
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
