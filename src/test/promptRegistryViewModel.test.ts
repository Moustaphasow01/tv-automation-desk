import { describe, expect, it } from "vitest";
import { buildPromptRegistryViewModel } from "@/features/prompt-registry/viewModel";
import type { PromptRegistryOverview } from "@/operationsTypes";

describe("Prompt Registry view model", () => {
  it("maps API data without inventing prompt state", () => {
    const view = buildPromptRegistryViewModel(overview());

    expect(view.metrics[0].value).toBe(2);
    expect(view.prompts[0].label).toBe("Worker LIVE");
    expect(view.prompts[0].hashShort).toBe("aaaaaaaaaaaa");
    expect(view.hasDrift).toBe(false);
  });
});

function overview(): PromptRegistryOverview {
  return {
    contract: "DeskPromptRegistryOverviewV1",
    schemaVersion: "1.0.0",
    generatedAt: "2026-08-09T12:00:00.000Z",
    summary: {
      activePrompts: 2,
      publishedCompositions: 2,
      activeBindings: 2,
      parityOk: 2,
      parityDrift: 0,
      dynamicPromptsToReplace: 1,
    },
    items: [{
      promptKey: "CHATGPT_LIVE_WORKER_FALLBACK",
      lane: "live",
      runtimeStack: "LIVE_V5_4_V2_4",
      missionKey: "LIVE_CONTEXT_DECISION",
      semanticVersion: "2.4.0",
      promptVersionId: "prompt-v",
      compositionId: "composition-v",
      compositionKey: "live",
      binding: null,
      status: "PUBLISHED",
      deploymentStage: "ACTIVE",
      sourcePath: "docs/CHATGPT_LIVE_WORKER_PROMPT.md",
      sourceBytes: 15220,
      contentSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      renderedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      actualSourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parityStatus: "OK",
      consumers: ["mcp_gpt_desk/src/store.js"],
      contracts: [],
      evaluation: {
        status: "PENDING_BASELINE_RUN",
        qualityScore: null,
        costUsd: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        reason: "pending",
      },
      rollback: { lastKnownGoodCompositionId: "composition-v", canRollback: true },
    }],
    dynamicPrompts: [{ prompt_key: "MCP_WORK_ITEM_EXECUTION_PROMPT" }],
    source: {
      registry: "git_seed_pending_postgres_hydration",
      inventoryPath: "config/prompt-registry/runtime-prompt-inventory.v1.json",
      seedPath: "config/prompt-registry/live-replay-2.4.0-seed.v1.json",
      parityMode: "BYTE_EXACT_SOURCE",
      writeApiEnabled: false,
      writeApiReason: "permissions pending",
    },
  };
}
