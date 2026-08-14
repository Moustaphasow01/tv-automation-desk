import { describe, expect, it } from "vitest";
import { buildLiveDeskScreenViewModel } from "@/features/live-desk/viewModel";
import { deskSessionFixture } from "@/test/fixtures/deskSessionFixture";
import type { ExecutionOverview } from "@/executionTypes";
import type { DeskSession } from "@/types";

describe("Live Desk ViewModel", () => {
  it("présente les identifiants techniques avec des libellés opérateur", () => {
    const viewModel = buildLiveDeskScreenViewModel(liveSession(), {
      phaseLabel: "New York",
      refreshing: false,
      dataUpdatedAt: Date.UTC(2026, 6, 13, 15, 30, 15),
    });

    expect(viewModel.heading.subtitle).toContain("Session New York");
    expect(viewModel.heading.subtitle).toContain("Plan New York 15:30");
    expect(viewModel.heading.subtitle).not.toContain("ny_open_1530");
    expect(viewModel.source.detail).toBe("dégradée");
    expect(viewModel.sync.title).toBe("Desk actif");
  });

  it("sépare l’état passé, courant et futur de la file GPT", () => {
    const viewModel = buildLiveDeskScreenViewModel(liveSession({
      nextTaskStatus: "late",
      nextTaskStatusLabel: "En retard",
      latencySeconds: 181,
      latencyStatus: "late",
    }), {
      phaseLabel: "New York",
      refreshing: true,
      dataUpdatedAt: 0,
    });

    expect(viewModel.metrics.lastClaimAt).toBe("15:31");
    expect(viewModel.metrics.nextTaskStatusLabel).toBe("En retard");
    expect(viewModel.metrics.nextTaskTone).toBe("negative");
    expect(viewModel.metrics.claimLatency).toBe("3 min 1 s");
    expect(viewModel.metrics.claimLatencyTone).toBe("negative");
    expect(viewModel.process.stages.at(-1)?.state).toBe("active");
  });

  it("ne fabrique pas de macro quand aucune actualité future n’est signalée", () => {
    const session = liveSession();
    session.macro = [];

    const viewModel = buildLiveDeskScreenViewModel(session, {
      phaseLabel: "New York",
      refreshing: false,
      dataUpdatedAt: 0,
    });

    expect(viewModel.metrics.nextMacro).toBe("Aucun à venir");
  });

  it("projette divergence broker et protection post-fill sans état rassurant inventé", () => {
    const viewModel = buildLiveDeskScreenViewModel(liveSession(), {
      phaseLabel: "New York",
      refreshing: false,
      dataUpdatedAt: 0,
      executionOverview: executionOverviewWithBrokerDivergence(),
    });

    expect(viewModel.brokerGuard.available).toBe(true);
    expect(viewModel.brokerGuard.tone).toBe("negative");
    expect(viewModel.brokerGuard.headline).toBe("Exécution sous contrôle fail-closed");
    expect(viewModel.brokerGuard.cards.find(card => card.label === "Réconciliation")?.value).toBe("1 écart(s)");
    expect(viewModel.brokerGuard.cards.find(card => card.label === "Protection broker")?.value).toBe("Stop à corriger");
    expect(viewModel.brokerGuard.alerts.join("\n")).toContain("PROTECTIVE_STOP_ORDER_MISSING");
  });

  it("signale explicitement que la projection broker n’est pas chargée", () => {
    const viewModel = buildLiveDeskScreenViewModel(liveSession(), {
      phaseLabel: "New York",
      refreshing: false,
      dataUpdatedAt: 0,
      executionOverview: null,
    });

    expect(viewModel.brokerGuard.available).toBe(false);
    expect(viewModel.brokerGuard.headline).toBe("Projection broker en attente");
    expect(viewModel.brokerGuard.cards.find(card => card.label === "Connexion broker")?.value).toBe("Non projeté");
  });
});

function liveSession(claimPatch: Partial<DeskSession["claim"]> = {}): DeskSession {
  const session = structuredClone(deskSessionFixture.sessions.ny_open) as unknown as DeskSession;
  session.label = "NY Open";
  session.strategyId = "ny_open_1530";
  session.currentCheckpointAt = "15:30";
  session.lastCompletedCheckpointAt = "15:15";
  session.nextCheckpointAt = "15:45";
  session.nextMonitorAt = "15:45";
  session.claim = {
    lastClaimAt: "15:31",
    lastClaimAtUtc: "2026-07-13T13:31:00Z",
    workerId: "gpt-live-pool-01",
    nextTaskStatus: "waiting",
    nextTaskStatusLabel: "En attente",
    nextTaskWorkflow: "LIVE_M15_MONITOR",
    nextTaskLabel: "Monitor GPT M15",
    nextTaskCheckpoint: "15:45",
    followingTaskCheckpoint: "16:00",
    followingTaskWorkflow: "LIVE_M15_MONITOR",
    lastCompletedCheckpoint: "15:15",
    dueCheckpoint: "15:45",
    readyAt: "15:46",
    bundleReadyAt: "15:46",
    latencySeconds: 45,
    latencyTargetSeconds: 120,
    latencyStatus: "on_target",
    bundleClaimLatencySeconds: 20,
    bundleClaimLatencyStatus: "on_target",
    ...claimPatch,
  };
  session.macro = [{ time: "16:00", title: "ISM services", importance: "high", impactText: "Surveiller USD", isNext: true }];
  return session;
}

function executionOverviewWithBrokerDivergence(): ExecutionOverview {
  return {
    contract: "DeskExecutionOverview",
    schemaVersion: "1.0.0",
    generatedAt: "2026-07-13T13:32:00.000Z",
    safety: {
      executionEnabled: true,
      bridgeMode: "sim101_addon_approved_only",
      killSwitchEnv: false,
      maxContracts: 1,
      riskPercent: 0.25,
      maxRoundingExcessPercent: 0.25,
      maxDecisionAgeSeconds: 120,
      executionAuthorityMode: "auto",
      entryOperatorApprovalRequired: false,
      managementOperatorApprovalRequired: false,
      contractRoundingMode: "ceil",
      fallbackCapitalEnabled: false,
      fallbackCapital: null,
      sizingPolicyRevision: 4,
      accountSnapshotMaxAgeSeconds: 120,
      allowedInstruments: ["MNQ", "MES"],
      liveAccountAllowed: false,
      databaseLocked: true,
      submissionPossible: false,
    },
    ninjaTraderStartup: {
      available: true,
      enabled: true,
      revision: 2,
      connectionName: "Sim101",
      connectionProvider: "NinjaTrader",
      autoConnectRequired: true,
      simulationOnly: true,
      supervisorInstalled: true,
      supervisorRunning: true,
      processRunning: true,
      processWindowTitle: "NinjaTrader",
      loginRequired: false,
      platformReady: true,
      autoConnectConfigured: true,
      addonHeartbeatFresh: true,
      addonConnected: true,
      connectionReady: true,
      lastStartedAt: "2026-07-13T13:00:00.000Z",
      lastAppliedAt: "2026-07-13T13:00:00.000Z",
      lastError: null,
      state: "running",
    },
    summary: {
      pendingApproval: 0,
      queued: 0,
      activeOrders: 1,
      openTrades: 1,
      healthyBridges: 1,
      activeLocks: 1,
      pendingManagement: 0,
      queuedManagement: 0,
      addonSnapshots: 1,
      addonEvents: 1,
      addonParityDivergences: 0,
    },
    providers: [],
    accounts: [],
    accountSnapshots: [],
    contracts: [],
    policies: [],
    policyAudits: [],
    bridges: [],
    locks: [{
      execution_lock_id: "protection_lock_ninjatrader_paper_local",
      scope_type: "account",
      scope_value: "ninjatrader_paper_local",
      locked: true,
      reason: "Broker protection not confirmed for trade_1: PROTECTIVE_STOP_ORDER_MISSING",
      set_by: "broker_protection_guard",
      set_at: "2026-07-13T13:31:00.000Z",
    }],
    decisions: [],
    intents: [],
    orders: [],
    trades: [{
      trade_id: "trade_1",
      status: "open",
      side: "long",
      quantity_open: 1,
      avg_entry_price: 30000,
      realized_pnl: null,
      unrealized_pnl: 0,
      updated_at: "2026-07-13T13:31:00.000Z",
      raw: {
        broker_protection_state: "failed",
        broker_protection_reason: "PROTECTIVE_STOP_ORDER_MISSING",
      },
    }],
    reconciliations: [{
      reconciliation_run_id: "reconciliation_1",
      status: "diverged",
      mismatch_count: 1,
      started_at: "2026-07-13T13:31:00.000Z",
      completed_at: "2026-07-13T13:31:05.000Z",
      metadata: { reconciliation_policy: { mode: "blocking" } },
    }],
    managementIntents: [],
    managementApprovals: [],
    managementOutbox: [],
    addonSnapshots: [],
    addonEvents: [],
    adapterParityRuns: [],
  };
}
