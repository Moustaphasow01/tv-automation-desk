import { describe, expect, it } from "vitest";
import { operationsQueueView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isOperationsQueueView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("operations queue front contract", () => {
  it("accepts the canonical Operations Queue view envelope", () => {
    const envelope = assertViewEnvelope(operationsQueueView, isOperationsQueueView);

    expect(envelope.data.summary.activeMissions).toBe(envelope.data.missions.length);
    expect(envelope.data.missions.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.eventFlow.length).toBeGreaterThanOrEqual(6);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps missions, events, gates, DLQ and incidents linked by mission ids", () => {
    const { missions, eventFlow, policyGates, deadLetters, incidents, commandActions } = operationsQueueView.data;
    const missionIds = new Set(missions.map((mission) => mission.missionId));

    expect(eventFlow.every((event) => missionIds.has(event.missionId))).toBe(true);
    expect(policyGates.every((gate) => missionIds.has(gate.missionId))).toBe(true);
    expect(deadLetters.every((item) => missionIds.has(item.missionId))).toBe(true);
    expect(incidents.every((incident) => missionIds.has(incident.missionId))).toBe(true);
    expect(commandActions.every((action) => missionIds.has(action.missionId))).toBe(true);
  });

  it("does not expose human assignment fields or copy in the autonomous operations model", () => {
    const forbiddenKeyPattern = /assignee|assignedTo|ownerUser|humanOwner|operatorOwner/i;
    const forbiddenCopyPattern = /assigné|assigned to|à traiter par|owner humain/i;
    const entries = flattenEntries(operationsQueueView.data);

    expect(entries.some(([key]) => forbiddenKeyPattern.test(key))).toBe(false);
    expect(JSON.stringify(operationsQueueView.data)).not.toMatch(forbiddenCopyPattern);
  });

  it("turns operator interventions into Command Runtime requests", () => {
    const action = operationsQueueView.data.commandActions.find((item) => item.permission === "ALLOWED");
    expect(action).toBeDefined();

    const prepared = prepareDeskCommand({
      commandType: action!.commandType,
      environment: "MOCK",
      expectedVersion: action!.actionId,
      reason: `Operations autonomous action confirmed: ${action!.label}`,
      payload: action!.payload
    });

    expect(action!.requiresConfirmation).toBe(true);
    expect(action!.commandType).toMatch(/^operations\./);
    expect(prepared.status).toBe("REQUESTED");
    expect(prepared.expectedVersion).toBe(action!.actionId);
    expect(prepared.idempotencyKey).toContain(action!.commandType.replaceAll(".", "_"));
  });
});

function flattenEntries(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenEntries(item, `${prefix}[${index}]`));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [[path, item] as [string, unknown], ...flattenEntries(item, path)];
    });
  }

  return [];
}
