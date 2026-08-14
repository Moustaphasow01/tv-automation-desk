#!/usr/bin/env node
import { evaluateDemoPaperGate, fetchStatus } from "./check_demo_paper_gate.mjs";
import { buildTradingViewFreshnessDiagnosis } from "./diagnose_tradingview_freshness.mjs";
import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";

const DEFAULT_STATUS_URL = "http://127.0.0.1:8787/status";

export function parseDemoPaperDoctorArgs(argv = process.argv.slice(2)) {
  const options = {
    statusUrl: DEFAULT_STATUS_URL,
    executionOverviewUrl: null,
    output: "pretty",
    exitZero: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--exit-zero") {
      options.exitZero = true;
    } else if (arg.startsWith("--status-url=")) {
      options.statusUrl = arg.slice("--status-url=".length);
    } else if (arg.startsWith("--execution-overview-url=")) {
      options.executionOverviewUrl = arg.slice("--execution-overview-url=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.executionOverviewUrl) {
    options.executionOverviewUrl = deriveExecutionOverviewUrl(options.statusUrl);
  }

  return options;
}

export function deriveExecutionOverviewUrl(statusUrl) {
  const url = new URL(statusUrl);
  url.pathname = "/api/v1/execution/overview";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildDemoPaperDiagnosis({ status, overview, gate }) {
  const actions = [];
  const dataReadiness = status?.data_readiness || {};
  const tradingViewDiagnosis = buildTradingViewFreshnessDiagnosis(dataReadiness, {
    checkedAtUtc: gate.checked_at_utc,
  });
  const brokerSafety = brokerPaperSafetyFromStatus(status);
  const manualTelegramMode = brokerSafety.manual_telegram_execution_enabled === true;
  const startup = overview?.ninjaTraderStartup || {};
  const addonBridge = latestAddonBridge(overview);
  const accountName = String(addonBridge?.account_name || brokerSafety.account_name || "").trim();
  const sim101Account = /^Sim\d*$/i.test(accountName);

  if (gate.blockers.some((blocker) => blocker.id === "data.live_fresh")) {
    actions.push({
      id: "tradingview_live_freshness",
      title: "Réactiver les alertes TradingView MNQ/MES",
      severity: "blocker",
      evidence: tradingViewEvidence(tradingViewDiagnosis),
      action: "Vérifie que les alertes TradingView postent en continu vers le webhook du desk sur MNQ/MES M1 et M5. Le rescue MCP local ne doit servir qu’au diagnostic.",
      command: "python3 scripts/tradingview/migrate_local_alert_webhooks.py",
    });
  }

  if (gate.blockers.some((blocker) => blocker.id === "data.source_durable")) {
    actions.push({
      id: "tradingview_source_durable",
      title: "Remplacer le secours TradingView par des alertes durables",
      severity: "blocker",
      evidence: tradingViewSourceEvidence(dataReadiness),
      action: "Créer ou corriger les alertes TradingView MNQ/MES M1/M5 pour qu’elles postent directement vers /api/v1/webhooks/tradingview avec un identifiant d’alerte ou source=tradingview_alert_webhook. Le backfill MCP local doit rester un secours diagnostic.",
      command: "python3 scripts/tradingview/migrate_local_alert_webhooks.py",
    });
  }

  if (gate.blockers.some((blocker) => blocker.id === "broker.paper_environment_safe")) {
    if (manualTelegramMode) {
      actions.push({
        id: "manual_telegram_execution_policy",
        title: "Vérifier le mode exécution manuelle Telegram",
        severity: "blocker",
        evidence: [
          `manual=${String(brokerSafety.manual_telegram_execution_enabled)}`,
          `authority=${brokerSafety.execution_authority_mode || "unknown"}`,
          `approval=${String(brokerSafety.entry_operator_approval_required)}`,
          `submission_possible=${String(brokerSafety.submission_possible)}`,
        ].join(" · "),
        action: "Le mode manuel doit rester semi-auto: le desk peut produire des tickets opérateur Telegram, mais aucune entrée ne doit être considérée opérable sans Human Gate/approbation opérateur.",
      });
    } else if (brokerSafety.execution_authority_mode !== "semi_auto") {
      actions.push({
        id: "execution_authority_semi_auto",
        title: "Passer l’exécution Sim101 en SEMI_AUTO",
        severity: "blocker",
        evidence: `execution_authority_mode=${brokerSafety.execution_authority_mode || "unknown"}`,
        action: "Depuis la console Exécution, passer le mode d’autorisation à SEMI_AUTO avec la phrase de confirmation.",
      });
    }
    if (brokerSafety.entry_operator_approval_required !== true) {
      actions.push({
        id: "entry_operator_approval_on",
        title: "Activer la validation opérateur à l’entrée",
        severity: "blocker",
        evidence: `entry_operator_approval_required=${String(brokerSafety.entry_operator_approval_required)}`,
        action: "Le mode demo PAPER actuel doit rester semi-manuel: le backend produit et suit le plan, mais l'entrée nécessite un Human Execution Gate explicite.",
      });
    }
    if (brokerSafety.kill_switch_released !== true) {
      actions.push({
        id: "release_db_kill_switch",
        title: "Relâcher le kill switch DB",
        severity: "blocker",
        evidence: `kill_switch_released=${String(brokerSafety.kill_switch_released)}`,
        action: "Relâcher le verrou depuis la console Exécution uniquement si NinjaTrader est bien en Simulation/Sim101.",
      });
    }
  }

  if (gate.blockers.some((blocker) => blocker.id === "execution.manual_telegram_ready")) {
    actions.push({
      id: "telegram_trading_channel_ready",
      title: "Activer le canal Telegram trading",
      severity: "blocker",
      evidence: telegramEvidence(status),
      action: "Configurer TELEGRAM_ALERT_BOT_TOKEN/TELEGRAM_ALERT_CHAT_ID, DESK_TELEGRAM_ENABLED=true, activer la config Telegram puis lancer un test canal trading.",
      command: "npm --prefix mcp_gpt_desk run telegram:acceptance",
    });
  }

  if (gate.blockers.some((blocker) => blocker.id === "broker.sim101_addon_ready")) {
    if (startup.loginRequired === true || startup.state === "login_required") {
      actions.push({
        id: "ninjatrader_login",
        title: "Finaliser le login NinjaTrader sur le VPS",
        severity: "blocker",
        evidence: `state=${startup.state || "unknown"} · window=${startup.processWindowTitle || "unknown"}`,
        action: "Ouvre le VPS, termine l’authentification NinjaTrader, puis ferme l’écran de bienvenue.",
        command: "npm run --silent doctor:ninja -- --json --exit-zero",
      });
    }
    if (startup.connectionReady !== true) {
      actions.push({
        id: "ninjatrader_simulation_connection",
        title: "Connecter NinjaTrader à Simulation",
        severity: "blocker",
        evidence: `connectionName=${startup.connectionName || "unknown"} · provider=${startup.connectionProvider || "unknown"} · ready=${String(startup.connectionReady)}`,
        action: "Dans NinjaTrader, connecter le provider NinjaTrader/Simulation et vérifier que le compte actif est Sim101.",
        command: "npm run --silent doctor:ninja -- --json --exit-zero",
      });
    }
    if (startup.addonHeartbeatFresh !== true) {
      actions.push({
        id: "addon_fresh_heartbeat",
        title: "Relancer ou ouvrir l’AddOn DeskExecution",
        severity: "blocker",
        evidence: addonBridge
          ? `last_seen_at=${addonBridge.last_seen_at || "unknown"} · status=${addonBridge.status || "unknown"}`
          : "aucun bridge AddOn trouvé",
        action: "Vérifie que l’AddOn DeskExecution est chargé dans NinjaTrader et qu’il publie un heartbeat frais vers le backend.",
        command: "npm run --silent doctor:ninja -- --json --exit-zero",
      });
    }
    if (addonBridge && addonBridge.command_enabled !== true) {
      actions.push({
        id: "addon_command_enabled",
        title: "Activer les commandes approuvées côté AddOn",
        severity: "blocker",
        evidence: `status=${addonBridge.status || "unknown"} · command_enabled=${String(addonBridge.command_enabled)}`,
        action: "L’AddOn doit sortir du mode read-only/shadow et accepter uniquement les commandes approuvées Sim101.",
        command: "npm run --silent doctor:ninja -- --json --exit-zero",
      });
    }
    if (accountName && !sim101Account) {
      actions.push({
        id: "sim101_account_required",
        title: "Revenir au compte Sim101",
        severity: "blocker",
        evidence: `account_name=${accountName}`,
        action: "Ne pas utiliser un compte live : le gate demo PAPER exige un compte Sim101.",
        command: "npm run --silent doctor:ninja -- --json --exit-zero",
      });
    }
  }

  return {
    ok: gate.ok,
    status: gate.ok ? "READY" : "BLOCKED",
    checked_at_utc: gate.checked_at_utc,
    blockers: gate.blockers.map((blocker) => blocker.id),
    warnings: gate.warnings.map((warning) => warning.id),
    facts: {
      api_ready: status?.ready === true,
      postgres_mode: status?.mode === "postgres",
      data_state: dataReadiness.state || null,
      core_age_seconds: dataReadiness.core_age_seconds ?? null,
      tradingview_status: tradingViewDiagnosis.status,
      tradingview_blockers: tradingViewDiagnosis.blockers.map((blocker) => blocker.code).join(", ") || null,
      tradingview_source_durable: dataReadiness.source_health?.durable ?? null,
      tradingview_source_non_durable: dataReadiness.source_health?.non_durable_feeds?.map((feed) => `${feed.instrument} ${feed.timeframe}:${feed.classification}`).join(", ") || null,
      execution_authority_mode: brokerSafety.execution_authority_mode ?? overview?.safety?.executionAuthorityMode ?? null,
      manual_telegram_execution_enabled: brokerSafety.manual_telegram_execution_enabled ?? overview?.safety?.manualTelegramExecutionEnabled ?? null,
      entry_operator_approval_required: brokerSafety.entry_operator_approval_required ?? overview?.safety?.entryOperatorApprovalRequired ?? null,
      ninja_state: startup.state || null,
      ninja_window: startup.processWindowTitle || null,
      ninja_login_required: startup.loginRequired ?? null,
      ninja_connection_ready: startup.connectionReady ?? null,
      addon_status: addonBridge?.status || brokerSafety.addon_bridge_status || null,
      addon_heartbeat_fresh: startup.addonHeartbeatFresh ?? brokerSafety.addon_heartbeat_fresh ?? null,
      addon_command_enabled: addonBridge?.command_enabled ?? brokerSafety.command_enabled ?? null,
      account_name: accountName || null,
      sim101_account: sim101Account || brokerSafety.sim101_account === true,
      telegram_trading_ready: telegramTradingReadyFact(status),
    },
    actions,
    final_check_command: "npm run --silent gate:demo-paper -- --json",
    release_check_command: "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json",
  };
}

function telegramEvidence(status = {}) {
  const telegram = (status.operations?.services || [])
    .find((service) => service?.service_kind === "telegram_alerting" || service?.service_id === "telegram_alert_worker");
  const environment = telegram?.details?.environment || {};
  const deliveries = Array.isArray(telegram?.details?.deliveries)
    ? telegram.details.deliveries.map((delivery) => delivery?.status).join(", ")
    : "none";
  return [
    `service=${telegram?.status || "missing"}`,
    `workerEnabled=${String(environment.workerEnabled)}`,
    `tradingConfigured=${String(environment.tradingConfigured)}`,
    `deliveries=${deliveries || "none"}`,
  ].join(" · ");
}

function telegramTradingReadyFact(status = {}) {
  const telegram = (status.operations?.services || [])
    .find((service) => service?.service_kind === "telegram_alerting" || service?.service_id === "telegram_alert_worker");
  const environment = telegram?.details?.environment || {};
  const deliveryStatuses = Array.isArray(telegram?.details?.deliveries)
    ? telegram.details.deliveries.map((delivery) => String(delivery?.status || ""))
    : [];
  return telegram?.healthy === true
    && environment.workerEnabled === true
    && environment.tradingConfigured === true
    && !deliveryStatuses.includes("disabled")
    && !deliveryStatuses.includes("disabled_by_environment");
}

function tradingViewSourceEvidence(dataReadiness = {}) {
  const health = dataReadiness.source_health || {};
  const nonDurable = Array.isArray(health.non_durable_feeds) ? health.non_durable_feeds : [];
  return [
    `durable=${String(health.durable)}`,
    `feeds=${nonDurable.map((feed) => `${feed.instrument} ${feed.timeframe}:${feed.classification || "unknown"}`).join(", ") || "none"}`,
  ].join(" · ");
}

function tradingViewEvidence(diagnosis) {
  const staleFeeds = diagnosis.blockers.map((blocker) => `${blocker.label}:${blocker.code.split(".").at(-1)}`);
  return [
    `status=${diagnosis.status}`,
    `state=${diagnosis.state || "unknown"}`,
    `core_age=${diagnosis.core_age_seconds ?? "n/a"}s`,
    `feeds=${staleFeeds.join(", ") || "backend_not_ready"}`,
  ].join(" · ");
}

export function formatDemoPaperDiagnosis(diagnosis) {
  const lines = [];
  lines.push(`Demo PAPER doctor: ${diagnosis.status}`);
  lines.push(`checked_at_utc=${diagnosis.checked_at_utc}`);
  lines.push("");
  lines.push("Facts:");
  for (const [key, value] of Object.entries(diagnosis.facts)) {
    lines.push(`- ${key}: ${value === null || value === undefined || value === "" ? "—" : value}`);
  }
  if (diagnosis.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of diagnosis.blockers) lines.push(`- ${blocker}`);
  }
  if (diagnosis.actions.length) {
    lines.push("");
    lines.push("Actions opérateur:");
    for (const [index, action] of diagnosis.actions.entries()) {
      lines.push(`${index + 1}. ${action.title}`);
      lines.push(`   preuve: ${action.evidence}`);
      lines.push(`   action: ${action.action}`);
      if (action.command) lines.push(`   diagnostic: ${action.command}`);
    }
  }
  lines.push("");
  lines.push(`Vérification finale: ${diagnosis.final_check_command}`);
  lines.push(`Décision release globale: ${diagnosis.release_check_command}`);
  return lines.join("\n");
}

function brokerPaperSafetyFromStatus(status) {
  const services = Array.isArray(status?.operations?.services) ? status.operations.services : [];
  const broker = services.find((service) => service?.service_kind === "broker_management" || service?.service_id === "broker_management");
  return broker?.details?.result?.paper_safety || {};
}

function latestAddonBridge(overview) {
  const bridges = Array.isArray(overview?.bridges) ? overview.bridges : [];
  return bridges.find((bridge) => bridge?.adapter_kind === "addon") || null;
}

async function fetchJson(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function printUsage() {
  console.log([
    "Usage: node scripts/stack/diagnose_demo_paper_readiness.mjs [--json] [--exit-zero]",
    "",
    "Options:",
    "  --status-url=http://127.0.0.1:8787/status",
    "  --execution-overview-url=http://127.0.0.1:8787/api/v1/execution/overview",
    "  --json",
    "  --exit-zero",
  ].join("\n"));
}

async function main() {
  const options = parseDemoPaperDoctorArgs();
  if (options.help) {
    printUsage();
    return;
  }
  const status = await fetchStatus(options.statusUrl);
  const [overview] = await Promise.all([
    fetchJson(options.executionOverviewUrl),
  ]);
  const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });
  gate.status_url = options.statusUrl;
  const diagnosis = buildDemoPaperDiagnosis({ status, overview, gate });
  if (options.output === "json") {
    console.log(JSON.stringify(diagnosis, null, 2));
  } else {
    console.log(formatDemoPaperDiagnosis(diagnosis));
  }
  if (!diagnosis.ok && !options.exitZero) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
