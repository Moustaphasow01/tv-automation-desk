import {
  BROKER_CONTRACT_ROUNDING_MODE,
  BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS,
  BROKER_RISK_PERCENT,
  brokerExecutionAuthorityMode,
} from "@tv-automation/desk-domain";

export function buildBrokerExecutionOverview({
  data,
  startupStatus,
  environment,
  generatedAt,
}) {
  normalizeOverviewCollections(data);
  const latestAddonBridge = data.bridges.find((item) => item.adapter_kind === "addon") || null;
  const addonHeartbeatAgeMs = latestAddonBridge ? Date.parse(generatedAt) - Date.parse(latestAddonBridge.last_seen_at || "") : Number.POSITIVE_INFINITY;
  const addonHeartbeatFresh = Number.isFinite(addonHeartbeatAgeMs) && addonHeartbeatAgeMs >= 0 && addonHeartbeatAgeMs <= environment.bridgeStaleSeconds * 1_000;
  const addonConnected = addonHeartbeatFresh && latestAddonBridge?.ninja_connected === true;
  const latestAddonSnapshot = latestByTimestamp(data.addonSnapshots, "captured_at");
  const addonSnapshotConnected = String(latestAddonSnapshot?.connection?.status || "").toLowerCase() === "connected"
    && String(latestAddonSnapshot?.connection?.price_status || "").toLowerCase() === "connected";
  const activeLocks = data.locks || [];
  const sizingPolicy = data.policies.find((item) => item.policy_profile_id === "ninjatrader_sim101_local") || data.policies[0] || null;
  const executionAuthorityMode = brokerExecutionAuthorityMode(sizingPolicy || {});
  return contract("DeskExecutionOverview", {
    generatedAt,
    safety: buildSafetyProjection({ environment, sizingPolicy, activeLocks, executionAuthorityMode }),
    summary: buildSummaryProjection({ data, activeLocks }),
    ninjaTraderStartup: {
      ...startupStatus,
      connectionName: String(latestAddonSnapshot?.connection?.name || startupStatus.connectionName || ""),
      connectionProvider: String(latestAddonSnapshot?.connection?.provider || startupStatus.connectionProvider || ""),
      addonHeartbeatFresh,
      addonConnected,
      connectionReady: addonConnected && addonSnapshotConnected,
      state: startupStatus.state === "running" && !addonConnected ? "waiting_addon" : startupStatus.state,
    },
    ...data,
  });
}

function normalizeOverviewCollections(data) {
  data.managementIntents ||= [];
  data.managementApprovals ||= [];
  data.managementOutbox ||= [];
  data.addonSnapshots ||= [];
  data.addonEvents ||= [];
  data.adapterParityRuns ||= [];
  data.theoreticalEvents ||= [];
  data.manualExecutionEvents ||= [];
}

function buildSafetyProjection({ environment, sizingPolicy, activeLocks, executionAuthorityMode }) {
  return {
    executionEnabled: environment.executionEnabled,
    bridgeMode: environment.bridgeMode,
    killSwitchEnv: environment.killSwitch,
    maxContracts: environment.maxContracts,
    riskPercent: Number(sizingPolicy?.risk_per_trade_pct ?? BROKER_RISK_PERCENT),
    maxRoundingExcessPercent: Number(sizingPolicy?.max_rounding_excess_pct ?? 0.25),
    maxDecisionAgeSeconds: Number(sizingPolicy?.max_decision_age_seconds ?? BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS),
    executionAuthorityMode,
    entryOperatorApprovalRequired: executionAuthorityMode === "semi_auto",
    managementOperatorApprovalRequired: false,
    contractRoundingMode: BROKER_CONTRACT_ROUNDING_MODE,
    fallbackCapitalEnabled: sizingPolicy?.fallback_capital_enabled === true,
    fallbackCapital: sizingPolicy?.fallback_capital === null || sizingPolicy?.fallback_capital === undefined ? null : Number(sizingPolicy.fallback_capital),
    sizingPolicyRevision: Number(sizingPolicy?.revision || 0),
    accountSnapshotMaxAgeSeconds: environment.accountSnapshotStaleSeconds,
    allowedInstruments: environment.allowedInstruments,
    liveAccountAllowed: environment.allowLiveAccount,
    databaseLocked: activeLocks.length > 0,
    manualTelegramExecutionEnabled: environment.manualTelegramExecutionEnabled === true,
    submissionPossible: environment.manualTelegramExecutionEnabled === true
      ? false
      : environment.executionEnabled === true && environment.killSwitch === false && activeLocks.length === 0,
  };
}

function buildSummaryProjection({ data, activeLocks }) {
  return {
    pendingApproval: data.intents.filter((item) => item.status === "pending_approval").length,
    queued: data.intents.filter((item) => item.status === "queued").length,
    activeOrders: data.orders.filter((item) => !["filled", "cancelled", "rejected", "expired"].includes(item.status)).length,
    openTrades: data.trades.filter((item) => !["closed", "cancelled", "rejected", "expired"].includes(item.status)).length,
    healthyBridges: data.bridges.filter((item) => ["healthy", "armed"].includes(item.status)).length,
    activeLocks: activeLocks.length,
    pendingManagement: data.managementIntents.filter((item) => item.status === "pending_approval").length,
    queuedManagement: data.managementIntents.filter((item) => ["queued", "leased", "rendered", "delivered"].includes(item.status)).length,
    addonSnapshots: data.addonSnapshots.length,
    addonEvents: data.addonEvents.length,
    addonParityDivergences: data.adapterParityRuns.filter((item) => item.status === "diverged").length,
  };
}

function latestByTimestamp(items = [], field) {
  return items.reduce((latest, candidate) => (
    !latest || Date.parse(candidate?.[field] || "") > Date.parse(latest?.[field] || "") ? candidate : latest
  ), null);
}

function contract(name, payload) {
  return { contract: name, schemaVersion: "1.0.0", ...payload };
}
