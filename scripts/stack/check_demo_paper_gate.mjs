#!/usr/bin/env node
import { SystemClock } from "../../packages/desk-time/index.js";
import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";

const DEFAULT_STATUS_URL = "http://127.0.0.1:8787/status";
const CRITICAL_SERVICE_KINDS = new Set([
  "broker_management",
  "live_runtime_scheduler",
  "replay_preparation",
]);

export function parseDemoPaperGateArgs(argv = process.argv.slice(2)) {
  const options = {
    statusUrl: DEFAULT_STATUS_URL,
    profile: "demo-paper",
    output: "pretty",
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.output = "json";
    } else if (arg.startsWith("--status-url=")) {
      options.statusUrl = arg.slice("--status-url=".length);
    } else if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["stack", "demo-paper"].includes(options.profile)) {
    throw new Error(`Unsupported profile '${options.profile}'. Use stack or demo-paper.`);
  }

  return options;
}

export function evaluateDemoPaperGate(status, { profile = "demo-paper" } = {}) {
  const blockers = [];
  const warnings = [];
  const checks = [];

  const pushCheck = (id, ok, detail = null, severity = "blocker") => {
    checks.push({ id, ok: Boolean(ok), severity, detail });
    if (!ok && severity === "blocker") blockers.push({ id, detail });
    if (!ok && severity === "warning") warnings.push({ id, detail });
  };

  pushCheck("api.ready", status?.ready === true, {
    ready: status?.ready,
    ok: status?.ok,
    mode: status?.mode,
  });
  pushCheck("api.postgres_mode", status?.mode === "postgres", { mode: status?.mode });

  const operations = status?.operations || {};
  const services = Array.isArray(operations.services) ? operations.services : [];
  const missingServices = Array.isArray(operations.missing_services) ? operations.missing_services : [];

  pushCheck("operations.no_missing_services", missingServices.length === 0, { missing_services: missingServices });

  for (const serviceKind of CRITICAL_SERVICE_KINDS) {
    const service = services.find((candidate) => candidate?.service_kind === serviceKind || candidate?.service_id === serviceKind);
    pushCheck(`service.${serviceKind}.present`, Boolean(service), { service_kind: serviceKind });
    if (service) {
      const ok = isServiceAcceptableForProfile(serviceKind, service, profile);
      pushCheck(`service.${serviceKind}.healthy`, ok, {
        service_id: service.service_id,
        status: service.status,
        healthy: service.healthy,
        details: service.details || null,
      });
    }
  }

  const telegram = services.find((service) => service?.service_kind === "telegram_alerting" || service?.service_id === "telegram_alert_worker");
  if (telegram && telegram.healthy !== true) {
    pushCheck("service.telegram_alerting.optional", false, {
      status: telegram.status,
      healthy: telegram.healthy,
      details: telegram.details || null,
    }, "warning");
  }

  const dataReadiness = status?.data_readiness || {};
  const liveRuntime = services.find((service) => service?.service_kind === "live_runtime_scheduler" || service?.service_id === "live_runtime_scheduler");
  const liveDetails = liveRuntime?.details || {};
  const brokerManagement = services.find((service) => service?.service_kind === "broker_management" || service?.service_id === "broker_management");
  const brokerResult = brokerManagement?.details?.result || {};
  const brokerSafety = brokerResult.paper_safety || {};
  const manualTelegramMode = brokerSafety.manual_telegram_execution_enabled === true;

  if (profile === "demo-paper") {
    pushCheck("data.live_fresh", dataReadiness.ok === true, {
      state: dataReadiness.state,
      market_closed: dataReadiness.market_closed,
      market_session: dataReadiness.market_session || null,
      freshness_policy: dataReadiness.freshness_policy || null,
      core_age_seconds: dataReadiness.core_age_seconds ?? null,
      requested_trading_date: dataReadiness.requested_trading_date,
      effective_market_date: dataReadiness.effective_market_date,
      core_feeds: dataReadiness.core_feeds || [],
      scheduler: dataReadiness.scheduler || null,
    });
    pushCheck("data.source_durable", dataSourceDurable(dataReadiness), {
      source_health: dataReadiness.source_health || null,
      core_feeds: (dataReadiness.core_feeds || []).map((feed) => ({
        instrument: feed.instrument,
        timeframe: feed.timeframe,
        feed_id: feed.feed_id || null,
        latest_timestamp_utc: feed.latest_timestamp_utc || null,
        latest_received_at_utc: feed.latest_received_at_utc || null,
        provenance: feed.provenance || null,
      })),
    });
    pushCheck("live_runtime.no_data_blocker", !liveDetails.data_blocker, {
      data_state: liveDetails.data_state,
      data_blocker: liveDetails.data_blocker || null,
      trading_date: liveDetails.trading_date || null,
    });
    pushCheck("broker.paper_armed", brokerResult.status !== "SKIPPED" && brokerResult.reason !== "ENVIRONMENT_NOT_ARMED", {
      status: brokerResult.status || null,
      reason: brokerResult.reason || null,
      count: brokerResult.count ?? null,
    });
    pushCheck("broker.paper_environment_safe", manualTelegramMode ? brokerManualTelegramEnvironmentSafe(brokerSafety) : brokerPaperEnvironmentSafe(brokerSafety), {
      execution_enabled: brokerSafety.execution_enabled ?? null,
      manual_telegram_execution_enabled: brokerSafety.manual_telegram_execution_enabled ?? null,
      bridge_mode: brokerSafety.bridge_mode || null,
      kill_switch_released: brokerSafety.kill_switch_released ?? null,
      max_contracts: brokerSafety.max_contracts ?? null,
      execution_authority_mode: brokerSafety.execution_authority_mode ?? null,
      entry_operator_approval_required: brokerSafety.entry_operator_approval_required ?? null,
      submission_possible: brokerSafety.submission_possible ?? null,
      live_account_allowed: brokerSafety.live_account_allowed ?? null,
    });
    if (manualTelegramMode) {
      pushCheck("execution.manual_telegram_ready", telegramTradingReady(telegram), {
        service_id: telegram?.service_id || null,
        status: telegram?.status || null,
        healthy: telegram?.healthy ?? null,
        environment: telegram?.details?.environment || null,
        deliveries: telegram?.details?.deliveries || null,
      });
    } else {
      pushCheck("broker.sim101_addon_ready", brokerSim101AddonReady(brokerSafety), {
        addon_bridge_status: brokerSafety.addon_bridge_status || null,
        addon_heartbeat_fresh: brokerSafety.addon_heartbeat_fresh ?? null,
        addon_connected: brokerSafety.addon_connected ?? null,
        connection_ready: brokerSafety.connection_ready ?? null,
        command_enabled: brokerSafety.command_enabled ?? null,
        account_name: brokerSafety.account_name || null,
        sim101_account: brokerSafety.sim101_account ?? null,
      });
    }
  } else {
    pushCheck("data.live_fresh.stack_profile", dataReadiness.ok === true, {
      state: dataReadiness.state,
      market_closed: dataReadiness.market_closed,
      market_session: dataReadiness.market_session || null,
      freshness_policy: dataReadiness.freshness_policy || null,
      core_age_seconds: dataReadiness.core_age_seconds ?? null,
      requested_trading_date: dataReadiness.requested_trading_date,
      effective_market_date: dataReadiness.effective_market_date,
    }, "warning");
  }

  const ok = blockers.length === 0;
  return {
    ok,
    profile,
    checked_at_utc: currentUtc(),
    status_url: status?.status_url || DEFAULT_STATUS_URL,
    blockers,
    warnings,
    checks,
  };
}

function currentUtc() {
  return new SystemClock().now().utc;
}

function isServiceAcceptableForProfile(serviceKind, service, profile) {
  if (service.healthy === true && service.status === "healthy") {
    return true;
  }
  if (profile === "stack" && serviceKind === "live_runtime_scheduler") {
    return service.status === "degraded" && Number(service.consecutive_failures || 0) === 0;
  }
  return false;
}

function brokerPaperEnvironmentSafe(safety = {}) {
  return safety.execution_enabled === true
    && safety.bridge_mode === "sim101_addon_approved_only"
    && safety.kill_switch_released === true
    && Number(safety.max_contracts || 0) > 0
    && safety.execution_authority_mode === "semi_auto"
    && safety.entry_operator_approval_required === true
    && safety.submission_possible === true
    && safety.live_account_allowed !== true;
}

function brokerManualTelegramEnvironmentSafe(safety = {}) {
  return safety.manual_telegram_execution_enabled === true
    && Number(safety.max_contracts || 0) > 0
    && safety.execution_authority_mode === "semi_auto"
    && safety.entry_operator_approval_required === true
    && safety.submission_possible !== true
    && safety.live_account_allowed !== true;
}

function brokerSim101AddonReady(safety = {}) {
  return safety.addon_heartbeat_fresh === true
    && safety.addon_connected === true
    && safety.connection_ready === true
    && safety.command_enabled === true
    && safety.sim101_account === true;
}

function telegramTradingReady(service = {}) {
  const environment = service?.details?.environment || {};
  const deliveryStatuses = Array.isArray(service?.details?.deliveries)
    ? service.details.deliveries.map((delivery) => String(delivery?.status || ""))
    : [];
  const configDisabled = deliveryStatuses.includes("disabled");
  const envDisabled = deliveryStatuses.includes("disabled_by_environment");
  return service?.healthy === true
    && environment.workerEnabled === true
    && environment.tradingConfigured === true
    && configDisabled !== true
    && envDisabled !== true;
}

function dataSourceDurable(dataReadiness = {}) {
  if (dataReadiness.market_closed === true) return true;
  const health = dataReadiness.source_health || {};
  if (health.durable === true) return true;
  const feeds = Array.isArray(dataReadiness.core_feeds) ? dataReadiness.core_feeds : [];
  const core = feeds.filter((feed) =>
    ["MNQ", "MES"].includes(String(feed.instrument || "").toUpperCase())
    && ["1", "5"].includes(String(feed.timeframe || "")));
  return core.length >= 4 && core.every((feed) => feed.provenance?.durable === true);
}

export async function fetchStatus(statusUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(statusUrl, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Status endpoint returned HTTP ${response.status}`);
  }
  const status = await response.json();
  return { ...status, status_url: statusUrl };
}

function printUsage() {
  console.log([
    "Usage: node scripts/stack/check_demo_paper_gate.mjs [--profile=demo-paper|stack] [--status-url=http://127.0.0.1:8787/status] [--json]",
    "",
    "Profiles:",
    "  demo-paper  Gate strict avant activation agents/trading en Simulation/PAPER.",
    "  stack       Gate infra plus souple ; la donnée live stale devient warning.",
  ].join("\n"));
}

function formatGate(gate) {
  const lines = [];
  lines.push(`Demo PAPER gate: ${gate.ok ? "PASS" : "BLOCKED"}`);
  lines.push(`profile=${gate.profile}`);
  lines.push(`status_url=${gate.status_url}`);
  if (gate.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of gate.blockers) {
      lines.push(`- ${blocker.id}: ${JSON.stringify(blocker.detail)}`);
    }
  }
  if (gate.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of gate.warnings) {
      lines.push(`- ${warning.id}: ${JSON.stringify(warning.detail)}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const options = parseDemoPaperGateArgs();
  if (options.help) {
    printUsage();
    return;
  }

  const status = await fetchStatus(options.statusUrl);
  const gate = evaluateDemoPaperGate(status, options);
  gate.status_url = options.statusUrl;

  if (options.output === "json") {
    console.log(JSON.stringify(gate, null, 2));
  } else {
    console.log(formatGate(gate));
  }

  if (!gate.ok) {
    process.exitCode = 1;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`Demo PAPER gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
