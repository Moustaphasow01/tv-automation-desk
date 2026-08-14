import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROMPT_REGISTRY_GOVERNANCE_SCHEMA_VERSION_V1,
  authorizePromptRegistryActionV1,
  scanPromptTextForSecretsV1,
} from "../index.js";

describe("prompt registry governance V1", () => {
  it("authorizes a deployment only with role, confirmation, reason, idempotency and passed evaluation", () => {
    const result = authorizePromptRegistryActionV1({
      policy: governance(),
      action: "DEPLOY_PROMPT_COMPOSITION",
      actor: { id: "operator-1", roles: ["prompt_registry_admin"] },
      target_type: "prompt_composition",
      target_id: "composition-live",
      confirmation_phrase: "CONFIRM_DEPLOY_PROMPT",
      reason: "validated canary",
      idempotency_key: "idem-prompt-deploy-1",
      evaluation_status: "PASS",
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision.schema_version, PROMPT_REGISTRY_GOVERNANCE_SCHEMA_VERSION_V1);
    assert.equal(result.decision.audit_required, true);
    assert.equal(result.decision.authorized, true);
    assert.match(result.decision.decision_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("denies write bypasses without admin role and exact confirmation", () => {
    const result = authorizePromptRegistryActionV1({
      policy: governance(),
      action: "DEPLOY_PROMPT_COMPOSITION",
      actor: { id: "viewer", roles: ["operator"] },
      target_type: "prompt_composition",
      target_id: "composition-live",
      confirmation_phrase: "DEPLOY",
      reason: "",
      evaluation_status: "REVIEW",
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("PROMPT_REGISTRY_ROLE_FORBIDDEN"));
    assert.ok(result.reasons.includes("PROMPT_REGISTRY_CONFIRMATION_REQUIRED"));
    assert.ok(result.reasons.includes("PROMPT_REGISTRY_REASON_REQUIRED"));
    assert.ok(result.reasons.includes("PROMPT_EVALUATION_PASS_REQUIRED"));
    assert.ok(result.reasons.includes("PROMPT_REGISTRY_IDEMPOTENCY_REQUIRED"));
  });

  it("allows rollback without passed evaluation but still requires audit controls", () => {
    const result = authorizePromptRegistryActionV1({
      policy: governance(),
      action: "ROLLBACK_PROMPT_BINDING",
      actor: { email: "operator@desk.local", roles: ["prompt_registry_admin"] },
      target_type: "agent_prompt_binding",
      target_id: "binding-live",
      confirmation_phrase: "CONFIRM_ROLLBACK_PROMPT",
      reason: "canary degraded",
      idempotency_key: "idem-prompt-rollback-1",
      evaluation_status: "FAIL",
    });

    assert.equal(result.ok, true);
  });

  it("detects secret-looking prompt content", () => {
    const result = scanPromptTextForSecretsV1(`token ${openAiKeyFixture()}\nsafe {{WORKER_ID}}\n`);

    assert.equal(result.ok, false);
    assert.deepEqual(result.findings, [{ line: 1, code: "OPENAI_API_KEY" }]);
  });
});

function openAiKeyFixture() {
  return ["sk", "-1234567890abcdefghijklmnopqrstuvwxyz"].join("");
}

function governance() {
  return {
    write_actions: [
      {
        action: "DEPLOY_PROMPT_COMPOSITION",
        roles: ["prompt_registry_admin"],
        confirmation_phrase: "CONFIRM_DEPLOY_PROMPT",
        audit_required: true,
        requires_reason: true,
        requires_passed_evaluation: true,
      },
      {
        action: "ROLLBACK_PROMPT_BINDING",
        roles: ["prompt_registry_admin"],
        confirmation_phrase: "CONFIRM_ROLLBACK_PROMPT",
        audit_required: true,
        requires_reason: true,
        requires_passed_evaluation: false,
      },
    ],
  };
}
