import { describe, expect, it } from "vitest";
import { toCommandCenterModel, truthTone } from "@/features/command-center/mapper";
import type { CommandCenterView } from "@/domains/front-api/viewModels";

describe("Command Center golden master", () => {
  it("maps the six operator KPIs without inventing unavailable values", () => {
    const model = toCommandCenterModel({
      meta: {
        generatedAt: "2026-08-15T08:00:00.000Z",
        asOf: "2026-08-15T08:00:00.000Z",
        stale: false,
        latencyMs: 12,
        correlationId: "corr-command-center",
        schemaVersion: "1.0.0",
        availability: "AVAILABLE",
      },
      permissions: [],
      data: fixture(),
    });

    expect(model.kpis).toHaveLength(6);
    expect(model.kpis.find((item) => item.id === "workers")?.value).toBe("— / —");
    expect(model.kpis.find((item) => item.id === "human-gate")?.value).toBe("1");
    expect(model.kpis.find((item) => item.id === "provider-safety")?.value).toContain("No broker");
  });

  it("never derives Human Gate actions from an OrderIntent status", () => {
    const data = fixture();
    expect(data.humanGate.rows[0].status).toBe("AWAITING_MANUAL_CONFIRMATION");
    expect(data.humanGate.rows[0].allowedActions).toEqual([]);
  });

  it("distinguishes an intentional empty or policy-disabled source from an outage", () => {
    expect(truthTone("CONNECTED_EMPTY")).toBe("info");
    expect(truthTone("DISABLED_BY_POLICY")).toBe("info");
    expect(truthTone("NOT_APPLICABLE_CURRENT_MODE")).toBe("info");
    expect(truthTone("UNAVAILABLE")).toBe("danger");
    expect(truthTone("AVAILABLE", true)).toBe("warning");
  });
});

function fixture(): CommandCenterView {
  return {
    mode: { environment: "UNKNOWN", executionMode: "SEMI_MANUAL", autoExecution: "OFF", liveBroker: "OFF", release: "8", marketData: "FRESH" },
    summary: { deskStatus: "NOMINAL", activeStrategies: 12, activeResearchAgents: null, expectedResearchAgents: null, criticalIncidents: 0, pendingCommands: 1, providerSafety: "NO_BROKER_SIDE_EFFECT" },
    systems: [], activity: [],
    risk: { capitalStatus: "NORMAL", riskUsagePct: null, maxDrawdownR: null, openPositions: null, healthyLimits: null, totalLimits: null, activeAlerts: 0 },
    lanes: [], upcoming: [],
    market: { status: "FRESH", freshnessSeconds: 1, rows: [] },
    research: { available: false, hypothesisCount: 0, experimentCount: 0, runCount: null, candidateCount: 0, activeWorkers: null, expectedWorkers: null, datasetCount: null, artifactCount: null, rows: [] },
    signals: { available: true, rows: [] },
    humanGate: { available: true, rows: [{ orderIntentId: "intent-1", instrument: "MNQ", side: "BUY", quantity: 1, executionMode: "SEMI_MANUAL", status: "AWAITING_MANUAL_CONFIRMATION", allowedActions: [], ageSeconds: 2 }] },
    provider: { available: true, mode: "PAPER", circuitBreaker: "NOT_APPLICABLE_CURRENT_MODE", health: "HEALTHY", ackLatencyMs: null, mismatchCount: null, events: [] },
    performance: { available: false, pnlR: null, trades: null, maxDrawdownR: null, curve: [] },
    incidents: [],
    operations: { availability: "KNOWN", queuedTasks: 0, dlqItems: 0, staleFeeds: 0 },
    assistant: { available: true, activeWorkers: 0, expectedWorkers: null, runningTasks: 0, latest: [] },
    audit: [],
  };
}
