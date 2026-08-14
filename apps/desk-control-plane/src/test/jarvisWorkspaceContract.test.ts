import { describe, expect, it } from "vitest";
import { jarvisWorkspaceView } from "@/mocks/canonicalDataset";
import { isJarvisWorkspaceView } from "@/domains/front-api/viewModels";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { assertViewEnvelope } from "@/shared/contracts";

describe("jarvis workspace front contract", () => {
  it("accepts the canonical Jarvis Workspace view envelope", () => {
    const envelope = assertViewEnvelope(jarvisWorkspaceView, isJarvisWorkspaceView);

    expect(envelope.data.summary.morningBriefStatus).toBe("READY");
    expect(envelope.data.morningBrief.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.conversation.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.pendingActions.length).toBeGreaterThanOrEqual(1);
    expect(envelope.data.voice.serviceStatus).toBe("DEGRADED");
  });

  it("keeps all Jarvis citations resolvable and routed to VNext zoom/global screens", () => {
    const { citations, conversation, morningBrief, suggestions } = jarvisWorkspaceView.data;
    const citationIds = new Set(citations.map((citation) => citation.citationId));
    const referencedIds = [
      ...conversation.flatMap((message) => message.citationIds),
      ...morningBrief.flatMap((section) => section.sourceIds),
      ...suggestions.flatMap((suggestion) => suggestion.sourceIds)
    ];

    expect(referencedIds.length).toBeGreaterThan(0);
    expect(referencedIds.every((citationId) => citationIds.has(citationId))).toBe(true);
    expect(citations.every((citation) => citation.route.startsWith("/"))).toBe(true);
  });

  it("turns Jarvis proposals into explicit Command Runtime requests instead of direct business mutations", () => {
    const action = jarvisWorkspaceView.data.pendingActions[0];
    const prepared = prepareDeskCommand({
      commandType: action.commandType,
      environment: "MOCK",
      expectedVersion: action.actionId,
      reason: `Jarvis pending action confirmed: ${action.title}`,
      payload: action.payload
    });

    expect(action.requiresConfirmation).toBe(true);
    expect(action.permission).toBe("ALLOWED");
    expect(action.commandType).toBe("live.reconciliation.request");
    expect(action.commandType).not.toMatch(/order|position|broker\.submit/i);
    expect(prepared.status).toBe("REQUESTED");
    expect(prepared.idempotencyKey).toContain("live_reconciliation_request");
    expect(prepared.expectedVersion).toBe(action.actionId);
  });
});
