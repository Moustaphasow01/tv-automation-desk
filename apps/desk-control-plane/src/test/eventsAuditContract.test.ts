import { describe, expect, it } from "vitest";
import { eventsAuditView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isEventsAuditView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("events audit front contract", () => {
  it("accepts the canonical Timeline & Audit view envelope", () => {
    const envelope = assertViewEnvelope(eventsAuditView, isEventsAuditView);

    expect(envelope.data.summary.totalEvents).toBe(envelope.data.events.length);
    expect(envelope.data.summary.authoritativeSteps).toBe(envelope.data.selectedCorrelation.authoritativePath.length);
    expect(envelope.data.summary.advisoryBranches).toBe(envelope.data.selectedCorrelation.advisoryPath.length);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps selected authoritative and advisory paths backed by real events", () => {
    const { events, selectedCorrelation } = eventsAuditView.data;
    const eventsById = new Map(events.map((event) => [event.eventId, event]));

    expect(eventsById.has(selectedCorrelation.rootEventId)).toBe(true);
    expect(selectedCorrelation.authoritativePath.every((eventId) => eventsById.has(eventId))).toBe(true);
    expect(selectedCorrelation.advisoryPath.every((eventId) => eventsById.has(eventId))).toBe(true);
    expect(selectedCorrelation.authoritativePath.every((eventId) => eventsById.get(eventId)?.lane === "AUTHORITATIVE")).toBe(true);
    expect(selectedCorrelation.advisoryPath.every((eventId) => eventsById.get(eventId)?.lane === "ADVISORY")).toBe(true);
  });

  it("keeps the AI advisory branch separate from deterministic order flow", () => {
    const { events, selectedCorrelation } = eventsAuditView.data;
    const authoritativeEvents = selectedCorrelation.authoritativePath.map((eventId) => events.find((event) => event.eventId === eventId));
    const advisoryEvents = selectedCorrelation.advisoryPath.map((eventId) => events.find((event) => event.eventId === eventId));
    const authoritativeTypes = authoritativeEvents.map((event) => event?.eventType).join(" ");

    expect(authoritativeTypes).toContain("global.risk");
    expect(authoritativeTypes).toContain("execution.gateway");
    expect(authoritativeTypes).not.toContain("ai.context");
    expect(advisoryEvents.every((event) => event?.eventType.includes("advisory"))).toBe(true);
  });

  it("keeps causation and relation references resolvable", () => {
    const { events, relations } = eventsAuditView.data;
    const eventIds = new Set(events.map((event) => event.eventId));

    expect(events.every((event) => !event.causationId || eventIds.has(event.causationId))).toBe(true);
    expect(relations.every((relation) => eventIds.has(relation.fromEventId) && eventIds.has(relation.toEventId))).toBe(true);
    expect(relations.some((relation) => relation.relation === "ADVISES")).toBe(true);
  });

  it("turns export/copy audit actions into Command Runtime requests", () => {
    const action = eventsAuditView.data.commandActions.find((item) => item.permission === "ALLOWED");
    expect(action).toBeDefined();

    const prepared = prepareDeskCommand({
      commandType: action!.commandType,
      environment: "MOCK",
      expectedVersion: action!.actionId,
      reason: `Events audit action confirmed: ${action!.label}`,
      payload: action!.payload
    });

    expect(action!.commandType).toMatch(/^events\./);
    expect(prepared.status).toBe("REQUESTED");
    expect(prepared.expectedVersion).toBe(action!.actionId);
    expect(prepared.idempotencyKey).toContain(action!.commandType.replaceAll(".", "_"));
  });
});
