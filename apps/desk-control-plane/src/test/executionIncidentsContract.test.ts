import { describe, expect, it } from "vitest";
import {
  eventsAuditView,
  executionIncidentsView,
  executionProvidersView,
  liveTradingView,
  operationsQueueView,
  ordersView
} from "@/mocks/canonicalDataset";
import { isExecutionIncidentsView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildExecutionIncidentCommand } from "@/pages/ExecutionIncidentsPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("execution incidents front contract", () => {
  it("accepts the canonical Execution Incidents view envelope", () => {
    const envelope = assertViewEnvelope(executionIncidentsView, isExecutionIncidentsView);

    expect(envelope.data.incidents.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.retries.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.selectedIncident.chronology.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.selectedIncident.reconciliationResults.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(6);
  });

  it("reuses incident ids exposed by Live, Providers and Operations", () => {
    const incidentIds = new Set(executionIncidentsView.data.incidents.map((incident) => incident.incidentId));
    const liveIncidentIds = liveTradingView.data.incidents.map((incident) => incident.incidentId);
    const providerIncidentIds = executionProvidersView.data.incidents.map((incident) => incident.incidentId);
    const operationsIncidentIds = operationsQueueView.data.incidents.map((incident) => incident.incidentId);

    expect(liveIncidentIds.every((incidentId) => incidentIds.has(incidentId))).toBe(true);
    expect(providerIncidentIds.every((incidentId) => incidentIds.has(incidentId))).toBe(true);
    expect(operationsIncidentIds.every((incidentId) => incidentIds.has(incidentId))).toBe(true);
  });

  it("keeps incident chronology resolvable against Timeline & Audit events", () => {
    const eventIds = new Set(eventsAuditView.data.events.map((event) => event.eventId));
    const correlationIds = new Set(eventsAuditView.data.events.map((event) => event.correlationId));
    const chronologyEventIds = executionIncidentsView.data.selectedIncident.chronology
      .map((step) => step.eventId)
      .filter((eventId): eventId is string => Boolean(eventId));

    expect(chronologyEventIds.every((eventId) => eventIds.has(eventId))).toBe(true);
    expect(
      executionIncidentsView.data.incidents
        .filter((incident) => incident.correlationId === "corr_live_reconcile_cln5_20260810")
        .every((incident) => correlationIds.has(incident.correlationId))
    ).toBe(true);
  });

  it("references only known providers and known orders when ids are present", () => {
    const providerIds = new Set(executionProvidersView.data.providers.map((provider) => provider.providerId));
    const orderIds = new Set([
      ...ordersView.data.activeOrders.map((order) => order.orderId),
      ...ordersView.data.history.map((order) => order.orderId),
      ...ordersView.data.fills.map((fill) => fill.orderId)
    ]);

    expect(
      executionIncidentsView.data.incidents
        .map((incident) => incident.providerId)
        .filter((providerId): providerId is string => Boolean(providerId))
        .every((providerId) => providerIds.has(providerId))
    ).toBe(true);

    expect(
      executionIncidentsView.data.incidents
        .map((incident) => incident.orderId)
        .filter((orderId): orderId is string => Boolean(orderId))
        .every((orderId) => orderIds.has(orderId))
    ).toBe(true);
  });

  it("submits incident reconciliation through Command Runtime with If-Match", () => {
    const action = executionIncidentsView.data.commandActions.find((candidate) => candidate.commandType === "execution.incident.reconcile");
    expect(action).toBeTruthy();

    const input = buildExecutionIncidentCommand(action!, "Operator requests targeted provider reconciliation.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:30:00.000Z"),
      randomId: (() => {
        const ids = ["incident-one", "incident-two"];
        return () => ids.shift() ?? "incident-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      incidentId: "inc_live_broker_netting_cl_delta",
      providerId: "provider_ninjatrader_sim101",
      orderId: "ord_sig_vnext_demo_mnq_0940_001"
    });
  });

  it("requires step-up for resolve/suspend and rejects emergency close when denied", () => {
    const resolveAction = executionIncidentsView.data.commandActions.find((candidate) => candidate.commandType === "execution.incident.resolve");
    const suspendAction = executionIncidentsView.data.commandActions.find((candidate) => candidate.commandType === "execution.provider.suspend");
    const deniedAction = executionIncidentsView.data.commandActions.find((candidate) => candidate.commandType === "execution.incident.emergency_close");
    expect(resolveAction).toBeTruthy();
    expect(suspendAction).toBeTruthy();
    expect(deniedAction).toBeTruthy();

    expect(() => buildExecutionIncidentCommand(resolveAction!, "Resolve", "bad-token")).toThrow("EXECUTION_INCIDENT_STEP_UP_REQUIRED");
    expect(() => buildExecutionIncidentCommand(suspendAction!, "Suspend", "bad-token")).toThrow("EXECUTION_INCIDENT_STEP_UP_REQUIRED");
    expect(() => buildExecutionIncidentCommand(deniedAction!, "Emergency close")).toThrow("EXECUTION_INCIDENT_PERMISSION_DENIED");

    const input = buildExecutionIncidentCommand(resolveAction!, "Resolve after reconciliation proof.", resolveAction!.actionId);
    expect(input.payload).toMatchObject({
      actionId: resolveAction!.actionId,
      incidentId: "inc_live_broker_netting_cl_delta",
      requireReconciliationMatch: true,
      stepUpAccepted: true
    });
  });

  it("keeps operator intervention as exceptional gate, not daily assignment", () => {
    const serialized = JSON.stringify(executionIncidentsView.data).toLowerCase();

    expect(serialized).not.toContain("assignee");
    expect(serialized).not.toContain("assignedto");
    expect(executionIncidentsView.data.incidents.some((incident) => incident.operatorGate === "REQUIRED")).toBe(true);
  });

  it("rejects empty command reasons before submitting", () => {
    expect(() => buildExecutionIncidentCommand(executionIncidentsView.data.commandActions[0], " ")).toThrow(
      "EXECUTION_INCIDENT_REASON_REQUIRED"
    );
  });
});
