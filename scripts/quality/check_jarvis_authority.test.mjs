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
      bffSource: 'function jarvisWorkspace({ warnings }) { warnings.push("jarvis-workspace:NOT_IMPLEMENTED"); return { pendingActions: [], commands: [] }; }',
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
      bffSource: "function jarvisWorkspace() { return { pendingActions: [{ id: 'x' }], commands: [] }; }",
      mockJarvisSource: "",
    });

    assert.equal(result.ok, false);
    assert.equal(result.violations[0].reason, "JARVIS_BFF_VIEW_NOT_READ_ONLY_NOT_IMPLEMENTED");
  });
});
