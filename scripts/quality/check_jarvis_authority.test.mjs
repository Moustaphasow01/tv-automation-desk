import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkJarvisAuthority } from "./check_jarvis_authority.mjs";

describe("Jarvis authority guard", () => {
  it("passes on the current repository policy", () => {
    const result = checkJarvisAuthority();

    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.ok(result.summary.frontCommands >= 4);
    assert.ok(result.summary.mcpTools >= 100);
    assert.ok(result.matrix.some((row) => row.tool === "front-api:/views/jarvis-workspace" && row.brokerEffect === false));
  });

  it("detects a hidden Jarvis broker command", () => {
    const result = checkJarvisAuthority({
      commandCatalog: {
        "jarvis.broker.submit": {
          capability: "jarvis.write",
          mutation: "jarvis.broker.submit",
          brokerExecution: true,
        },
      },
      mcpSlices: [],
      ...certifiedAssistantSources(),
      mockJarvisSource: "",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.violations.map((violation) => violation.reason).sort(), [
      "FRONT_COMMAND_BROKER_EXECUTION_FORBIDDEN",
      "JARVIS_COMMAND_NOT_CERTIFIED",
    ]);
  });

  it("detects a Jarvis view that exposes pending actions before backend certification", () => {
    const result = checkJarvisAuthority({
      commandCatalog: {},
      mcpSlices: [],
      assistantRuntimeSource: certifiedAssistantSources().assistantRuntimeSource,
      assistantSqlSource: certifiedAssistantSources().assistantSqlSource,
      bffSource: "import { jarvisWorkspace } from './front-jarvis-projection.js';",
      jarvisProjectionSource: "function jarvisWorkspace() { return { pendingActions: [{ id: 'x' }], commands: [] }; }",
      mockJarvisSource: "",
    });

    assert.equal(result.ok, false);
    assert.equal(result.violations[0].reason, "JARVIS_BFF_VIEW_NOT_CERTIFIED_READ_ONLY");
  });
});

function certifiedAssistantSources() {
  return {
    bffSource: `
      function jarvisWorkspace() {
        return {
          missions: [
            { missionId: "assistant_research" },
            { missionId: "assistant_live_runtime" },
            { missionId: "assistant_portfolio_risk" },
            { missionId: "assistant_execution" },
            { missionId: "assistant_data" },
            { missionId: "assistant_platform_ops" }
          ],
          pendingActions: [],
          commands: [],
          voice: { serviceStatus: "OFF" }
        };
      }
    `,
    assistantRuntimeSource: `
      export const DEFAULT_DOMAIN_ASSISTANT_PROFILES = [
        "assistant_research",
        "assistant_live_runtime",
        "assistant_portfolio_risk",
        "assistant_execution",
        "assistant_data",
        "assistant_platform_ops"
      ];
      class DomainAssistantRuntimeService {
        requireReadOnlyProfile() {}
      }
      const permissions = {
        can_confirm_human_gate: false,
        can_create_provider_command: false,
        can_activate_live: false,
        can_activate_auto_execution: false
      };
      const payload = { forbidden_actions: forbiddenActionCodes() };
      function forbiddenActionCodes() {}
    `,
    assistantSqlSource: `
      CONSTRAINT assistant_profiles_read_only_default CHECK (
        can_confirm_human_gate = false
        AND can_create_provider_command = false
        AND activate_live = false
        AND activate_auto_execution = false
      );
      CONSTRAINT assistant_tasks_no_sensitive_bypass CHECK (
        activate_live = false
        AND activate_auto_execution = false
        AND confirm_human_gate = false
        AND create_provider_command = false
      );
    `,
  };
}
