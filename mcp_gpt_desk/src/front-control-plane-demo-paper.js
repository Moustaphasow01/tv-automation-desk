import { normalizeFrontApiScope } from "./front-session-projection.js";
import { safeIdPart, text } from "./front-control-plane-common.js";

const BROKER_PIPELINE_STEPS = new Set(["EXECUTION_GATEWAY", "PROVIDER", "BROKER"]);
const DEPENDENT_PIPELINE_STEPS = new Set(["FEATURE_ENGINE", "SIGNAL_BUS", "ARBITRATION", "GLOBAL_RISK", "BROKER_NETTING", "ORDER_INTENT", "RECONCILIATION"]);
const CORE_INSTRUMENTS = new Set(["MNQ", "MES"]);
const CORE_TIMEFRAMES = new Set(["1", "5"]);

export function buildDemoPaperReadiness({ execution, health, query, nowIso, rows }) {
  const executionValue = execution || {};
  const launchGate = demoPaperLaunchGate({ health, execution: executionValue, nowIso, rows });
  const dataReadiness = health?.data_readiness || {};
  const { brokerSafety, startup, addonBridge, accountName } = brokerReadinessInputs({ executionValue, health, rows });
  const scope = normalizeFrontApiScope(query);
  return {
    summary: {
      status: launchGate.status,
      finalDecision: launchGate.finalDecision,
      canOpenAgents: launchGate.ok,
      blockersCount: launchGate.blockers.length,
      nextCheckCommand: launchGate.releaseCheckCommand,
      checkedAt: launchGate.checkedAt,
      tradingDate: scope.trading_date,
      session: scope.session,
    },
    launchGate: publicLaunchGate(launchGate),
    components: launchGate.components,
    actionItems: readinessActionItems(launchGate),
    marketData: marketDataReadiness(dataReadiness, rows),
    broker: brokerReadiness({ brokerSafety, startup, addonBridge, accountName, executionSafety: executionValue.safety || {} }),
    commands: {
      releaseGate: launchGate.releaseCheckCommand,
      tradingGate: launchGate.finalCheckCommand,
      doctor: "npm run --silent doctor:demo-paper -- --json --exit-zero",
      tradingViewDoctor: "npm run --silent doctor:tradingview -- --json --exit-zero",
    },
    links: [
      { label: "Live Trading", route: "/live", reason: "Voir pipeline et signaux live." },
      { label: "Execution Providers", route: "/execution/providers", reason: "Contrôler Simulation/Sim101 et providers." },
      { label: "Incidents", route: "/execution/incidents", reason: "Traiter DLQ et incidents broker." },
      { label: "Event Explorer", route: "/events", reason: "Lire les preuves et événements système." },
    ],
  };
}

export function demoPaperLaunchGate({ health, execution, nowIso, rows }) {
  const dataReadiness = health?.data_readiness || {};
  const liveRuntime = findService(rows(health?.operations?.services), "live_runtime_scheduler");
  const { brokerSafety, startup, addonBridge, accountName } = brokerReadinessInputs({ executionValue: execution, health, rows });
  const checkList = launchChecks({ health, dataReadiness, liveRuntime, brokerSafety, startup, addonBridge, accountName, execution, rows });
  const blockers = checkList.filter((check) => !check.ok).map((check) => launchBlocker(check));
  return {
    status: blockers.length ? "BLOCKED" : "READY",
    ok: blockers.length === 0,
    finalDecision: blockers.length ? "KEEP_AGENTS_CLOSED_OR_SHADOW" : "OPEN_DEMO_PAPER_AGENTS_ALLOWED",
    components: launchComponents(blockers),
    releaseCheckCommand: "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json",
    checkedAt: nowIso,
    checks: checkList,
    checksById: Object.fromEntries(checkList.map((check) => [check.id, check])),
    blockers,
    operatorActions: launchOperatorActions({ blockers, dataReadiness, startup, addonBridge, brokerSafety, accountName, rows }),
    finalCheckCommand: "npm run --silent gate:demo-paper -- --json",
  };
}

function launchChecks({ health, dataReadiness, liveRuntime, brokerSafety, startup, addonBridge, accountName, execution, rows }) {
  const telegram = findService(rows(health?.operations?.services), "telegram_alert_worker")
    || findService(rows(health?.operations?.services), "telegram_alerting");
  const manualTelegramMode = brokerSafety.manual_telegram_execution_enabled === true;
  const brokerExecutionChecks = manualTelegramMode
    ? [
        manualTelegramEnvironmentCheck(execution, brokerSafety),
        manualTelegramReadyCheck(telegram),
      ]
    : [
        paperEnvironmentCheck(execution, brokerSafety),
        sim101AddonCheck({ startup, addonBridge, brokerSafety, accountName }),
      ];
  return [
    apiReadyCheck(health),
    postgresModeCheck(health),
    liveFreshCheck(dataReadiness),
    durableSourceCheck(dataReadiness, rows),
    liveRuntimeCheck(liveRuntime),
    ...brokerExecutionChecks,
  ];
}

function apiReadyCheck(health) {
  return gateCheck("api.ready", health?.ready === true || health?.ok === true, "API locale prête", `ready=${String(health?.ready ?? health?.ok)} · mode=${health?.mode || "unknown"}`, "system");
}

function postgresModeCheck(health) {
  return gateCheck("api.postgres_mode", health?.mode === "postgres", "PostgreSQL actif", `mode=${health?.mode || "unknown"}`, "system");
}

function liveFreshCheck(dataReadiness) {
  return gateCheck("data.live_fresh", dataReadiness.ok === true, "Flux MNQ/MES frais", dataFreshnessDetail(dataReadiness), "market-data");
}

function durableSourceCheck(dataReadiness, rows) {
  return gateCheck("data.source_durable", dataSourceDurable(dataReadiness, rows), "Source TradingView durable", dataSourceDetail(dataReadiness, rows), "market-data");
}

function liveRuntimeCheck(liveRuntime) {
  return gateCheck("live_runtime.no_data_blocker", !liveRuntime?.details?.data_blocker, "Runtime live sans data blocker", liveRuntime?.details?.data_blocker || liveRuntime?.details?.data_state || "ok", "runtime");
}

function paperEnvironmentCheck(execution, brokerSafety) {
  return gateCheck("broker.paper_environment_safe", brokerPaperEnvironmentSafe(execution?.safety || {}, brokerSafety), "Environnement PAPER armé", brokerEnvironmentDetail(execution?.safety || {}, brokerSafety), "broker");
}

function manualTelegramEnvironmentCheck(execution, brokerSafety) {
  return gateCheck("broker.paper_environment_safe", brokerManualTelegramEnvironmentSafe(execution?.safety || {}, brokerSafety), "Environnement PAPER manuel Telegram", brokerEnvironmentDetail(execution?.safety || {}, brokerSafety), "broker");
}

function manualTelegramReadyCheck(telegram) {
  return gateCheck("execution.manual_telegram_ready", telegramTradingReady(telegram), "Alertes Telegram trading prêtes", telegramTradingDetail(telegram), "execution");
}

function sim101AddonCheck({ startup, addonBridge, brokerSafety, accountName }) {
  return gateCheck("broker.sim101_addon_ready", brokerSim101AddonReady({ startup, addonBridge, brokerSafety, accountName }), "NinjaTrader AddOn Sim101 prêt", brokerAddonDetail({ startup, addonBridge, brokerSafety, accountName }), "broker");
}

export function publicLaunchGate(gate) {
  return {
    status: gate.status,
    finalDecision: gate.finalDecision,
    checkedAt: gate.checkedAt,
    blockers: gate.blockers,
    components: gate.components,
    checks: gate.checks.map(({ id, label, ok, detail, domain }) => ({ id, label, ok, detail, domain })),
    operatorActions: gate.operatorActions.map(({ id, blockerId, title, severity, evidence, action, command, route }) => ({ id, blockerId: blockerId || id, title, severity, evidence, action, command: command || null, route })),
    finalCheckCommand: gate.finalCheckCommand,
    releaseCheckCommand: gate.releaseCheckCommand,
  };
}

export function liveMarketDataStatus(launchGate) {
  if (launchGate.checksById["data.live_fresh"]?.ok === false) return "STALE";
  if (launchGate.checksById["data.source_durable"]?.ok === false) return "DELAYED";
  return "LIVE";
}

export function launchGatePipelineStatus(stepId, gate) {
  if (!gate || gate.ok) return null;
  if (stepId === "MARKET_DATA" && hasGateBlocker(gate, ["data.live_fresh", "data.source_durable"])) return "BLOCKED";
  if (stepId === "STRATEGY_RUNTIME" && hasGateBlocker(gate, ["live_runtime.no_data_blocker"])) return "BLOCKED";
  if (BROKER_PIPELINE_STEPS.has(stepId) && hasGateBlocker(gate, ["broker.paper_environment_safe", "broker.sim101_addon_ready", "execution.manual_telegram_ready"])) return "BLOCKED";
  if (DEPENDENT_PIPELINE_STEPS.has(stepId)) return "WATCH";
  return null;
}

export function launchGatePipelineDetail(stepId, gate) {
  if (!gate || gate.ok) return null;
  const detailByStep = {
    MARKET_DATA: ["data.live_fresh", "data.source_durable"],
    STRATEGY_RUNTIME: ["live_runtime.no_data_blocker"],
    EXECUTION_GATEWAY: ["broker.paper_environment_safe", "broker.sim101_addon_ready", "execution.manual_telegram_ready"],
    PROVIDER: ["broker.paper_environment_safe", "broker.sim101_addon_ready", "execution.manual_telegram_ready"],
    BROKER: ["broker.paper_environment_safe", "broker.sim101_addon_ready", "execution.manual_telegram_ready"],
  };
  const blockers = (detailByStep[stepId] || []).filter((id) => gate.checksById[id]?.ok === false);
  return blockers.length ? blockers.join(" · ") : null;
}

function brokerReadinessInputs({ executionValue, health, rows }) {
  const brokerManagement = findService(rows(health?.operations?.services), "broker_management");
  const brokerSafety = brokerManagement?.details?.result?.paper_safety || {};
  const startup = executionValue?.ninjaTraderStartup || {};
  const addonBridge = rows(executionValue?.bridges).find((bridge) => bridge?.adapter_kind === "addon") || null;
  return { brokerSafety, startup, addonBridge, accountName: text(addonBridge?.account_name || brokerSafety.account_name, "—") };
}

function findService(services, id) {
  return services.find((service) => service?.service_kind === id || service?.service_id === id);
}

function hasGateBlocker(gate, ids) {
  return ids.some((id) => gate.checksById[id]?.ok === false);
}

function isCoreTradingViewFeed(feed = {}) {
  return CORE_INSTRUMENTS.has(String(feed.instrument ?? "").toUpperCase()) && CORE_TIMEFRAMES.has(String(feed.timeframe || ""));
}

function isSimAccount(accountName = "") {
  return /^Sim\d*$/i.test(accountName);
}

function readinessActionItems(launchGate) {
  return (launchGate.operatorActions.length ? launchGate.operatorActions : launchGate.blockers).map((item) => ({
    actionId: `readiness_${safeIdPart(item.id)}`,
    blockerId: item.blockerId || item.id,
    title: item.title,
    domain: item.domain || domainForActionRoute(item.route) || "system",
    severity: item.severity,
    evidence: item.evidence,
    operatorAction: item.action,
    command: item.command || null,
    route: item.route || readinessRouteForBlocker(item.id),
  }));
}

function marketDataReadiness(dataReadiness, rows) {
  return {
    state: text(dataReadiness.state, "unknown"),
    marketClosed: dataReadiness.market_closed === true,
    coreAgeSeconds: Number(dataReadiness.core_age_seconds ?? 0),
    sourceDurable: dataSourceDurable(dataReadiness, rows),
    effectiveMarketDate: text(dataReadiness.effective_market_date || dataReadiness.requested_trading_date, "—"),
    freshnessPolicy: dataReadiness.freshness_policy || null,
    coreFeeds: rows(dataReadiness.core_feeds).map((feed) => ({
      instrument: text(feed.instrument, "—"),
      timeframe: String(feed.timeframe || "—"),
      latestTimestampUtc: isoText(feed.latest_timestamp_utc),
      latestReceivedAtUtc: isoText(feed.latest_received_at_utc),
      classification: text(feed.provenance?.classification || feed.classification, "unknown"),
      durable: feed.provenance?.durable === true,
      source: text(feed.provenance?.source || feed.latest_source || feed.source, "—"),
      alertId: text(feed.provenance?.alert_id || feed.latest_alert_id, "—"),
    })),
  };
}

function brokerReadiness({ brokerSafety, startup, addonBridge, accountName, executionSafety }) {
  const facts = brokerReadinessFacts({ brokerSafety, startup, addonBridge, accountName, executionSafety });
  return {
    accountName,
    ...facts,
  };
}

function brokerReadinessFacts({ brokerSafety = {}, startup = {}, addonBridge = null, accountName = "", executionSafety = {} } = {}) {
  return {
    sim101Account: isSim101ReadyAccount(accountName, brokerSafety),
    startupState: text(startup.state, "unknown"),
    loginRequired: startup.loginRequired === true,
    connectionReady: fallbackValue(startup.connectionReady, brokerSafety.connection_ready, false),
    addonHeartbeatFresh: fallbackValue(startup.addonHeartbeatFresh, brokerSafety.addon_heartbeat_fresh, false),
    addonConnected: fallbackValue(startup.addonConnected, brokerSafety.addon_connected, false),
    commandEnabled: fallbackValue(addonBridgeValue(addonBridge, "command_enabled"), brokerSafety.command_enabled, false),
    addonStatus: text(fallbackValue(addonBridgeValue(addonBridge, "status"), brokerSafety.addon_bridge_status), "unknown"),
    executionAuthorityMode: text(fallbackValue(executionSafety.executionAuthorityMode, brokerSafety.execution_authority_mode), "unknown"),
    entryOperatorApprovalRequired: fallbackValue(executionSafety.entryOperatorApprovalRequired, brokerSafety.entry_operator_approval_required, null),
  };
}

function isSim101ReadyAccount(accountName = "", brokerSafety = {}) {
  return isSimAccount(accountName) || brokerSafety.sim101_account === true;
}

function addonBridgeValue(addonBridge, field) {
  return addonBridge ? addonBridge[field] : undefined;
}

function fallbackValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function launchComponents(blockers) {
  return [
    { componentId: "demo-paper", label: "Gate trading démo/PAPER", status: blockers.length ? "BLOCKED" : "READY", blockers: blockers.map((blocker) => blocker.id) },
    { componentId: "vnext-operator", label: "Parcours opérateur VNext", status: "VERIFY_WITH_RELEASE_GATE", blockers: [] },
  ];
}

function gateCheck(id, ok, label, detail, domain) {
  return { id, ok: Boolean(ok), label, detail: text(detail, "—"), domain };
}

function dataSourceDurable(dataReadiness = {}, rows) {
  if (dataReadiness.market_closed === true) return true;
  const sourceHealth = dataReadiness.source_health || {};
  if (sourceHealth.durable === true) return true;
  const core = rows(dataReadiness.core_feeds).filter(isCoreTradingViewFeed);
  return core.length >= 4 && core.every((feed) => feed?.provenance?.durable === true);
}

function brokerPaperEnvironmentSafe(safety = {}, brokerSafety = {}) {
  return brokerPaperSafetyFacts(safety, brokerSafety).every(Boolean);
}

function brokerManualTelegramEnvironmentSafe(safety = {}, brokerSafety = {}) {
  return brokerSafety.manual_telegram_execution_enabled === true
    && maxContractsConfigured(safety, brokerSafety)
    && executionAuthorityAuto(safety, brokerSafety)
    && entryApprovalNotRequired(safety, brokerSafety)
    && brokerSubmissionDisabled(safety, brokerSafety)
    && liveAccountForbidden(safety, brokerSafety);
}

function brokerPaperSafetyFacts(safety = {}, brokerSafety = {}) {
  return [
    executionEnabled(safety, brokerSafety),
    brokerBridgeModeApproved(safety, brokerSafety),
    killSwitchReleased(safety, brokerSafety),
    databaseUnlocked(safety),
    maxContractsConfigured(safety, brokerSafety),
    executionAuthorityAuto(safety, brokerSafety),
    entryApprovalNotRequired(safety, brokerSafety),
    brokerSubmissionPossible(safety, brokerSafety),
    liveAccountForbidden(safety, brokerSafety),
  ];
}

function executionEnabled(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.executionEnabled, brokerSafety.execution_enabled) === true;
}

function brokerBridgeModeApproved(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.bridgeMode, brokerSafety.bridge_mode) === "sim101_addon_approved_only";
}

function killSwitchReleased(safety = {}, brokerSafety = {}) {
  if (safety.killSwitchEnv !== undefined) return safety.killSwitchEnv === false;
  return brokerSafety.kill_switch_released === true;
}

function databaseUnlocked(safety = {}) {
  return safety.databaseLocked !== true;
}

function maxContractsConfigured(safety = {}, brokerSafety = {}) {
  return Number(fallbackValue(safety.maxContracts, brokerSafety.max_contracts, 0)) > 0;
}

function executionAuthorityAuto(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.executionAuthorityMode, brokerSafety.execution_authority_mode) === "auto";
}

function entryApprovalNotRequired(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.entryOperatorApprovalRequired, brokerSafety.entry_operator_approval_required) === false;
}

function brokerSubmissionPossible(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.submissionPossible, brokerSafety.submission_possible) === true;
}

function brokerSubmissionDisabled(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.submissionPossible, brokerSafety.submission_possible) !== true;
}

function liveAccountForbidden(safety = {}, brokerSafety = {}) {
  return fallbackValue(safety.liveAccountAllowed, brokerSafety.live_account_allowed) !== true;
}

function brokerSim101AddonReady({ startup = {}, addonBridge = null, brokerSafety = {}, accountName = "" } = {}) {
  return addonReadinessFacts({ startup, addonBridge, brokerSafety, accountName }).every(Boolean);
}

function telegramTradingReady(service = {}) {
  const environment = service?.details?.environment || {};
  const deliveries = Array.isArray(service?.details?.deliveries) ? service.details.deliveries : [];
  const deliveryStatuses = deliveries.map((delivery) => String(delivery?.status || ""));
  return service?.healthy === true
    && environment.workerEnabled === true
    && environment.tradingConfigured === true
    && !deliveryStatuses.includes("disabled")
    && !deliveryStatuses.includes("disabled_by_environment");
}

function addonReadinessFacts({ startup = {}, addonBridge = null, brokerSafety = {}, accountName = "" } = {}) {
  return [
    (startup.addonHeartbeatFresh ?? brokerSafety.addon_heartbeat_fresh) === true,
    (startup.addonConnected ?? brokerSafety.addon_connected) === true,
    (startup.connectionReady ?? brokerSafety.connection_ready) === true,
    (addonBridge?.command_enabled ?? brokerSafety.command_enabled) === true,
    isSimAccount(accountName),
  ];
}

function launchBlocker(check) {
  return { id: check.id, title: check.label, severity: "BLOCKER", domain: check.domain, evidence: check.detail, action: blockerAction(check.id) };
}

function blockerAction(id) {
  return {
    "api.ready": "Vérifier que l’API locale et PostgreSQL répondent avant tout démarrage agent.",
    "api.postgres_mode": "Relancer la stack préprod en mode PostgreSQL, pas en mémoire ni legacy.",
    "data.live_fresh": "Réactiver les alertes TradingView MNQ/MES M1/M5 et attendre une nouvelle bougie fermée.",
    "data.source_durable": "Remplacer le secours TradingView par des alertes durables avec source=tradingview_alert_webhook ou alert_id stable.",
    "live_runtime.no_data_blocker": "Corriger le data blocker live avant de réveiller les agents.",
    "broker.paper_environment_safe": "Passer Sim101 en AUTO, relâcher le kill switch et vérifier max contracts/risk policy.",
    "broker.sim101_addon_ready": "Finaliser le login NinjaTrader, connecter Simulation/Sim101, ouvrir l’AddOn et activer les commandes approuvées.",
    "execution.manual_telegram_ready": "Activer le worker Telegram et les canaux trading avant de réveiller les agents.",
  }[id] || "Consulter le runbook démo/PAPER.";
}

function launchOperatorActions({ blockers = [], dataReadiness = {}, startup = {}, addonBridge = null, brokerSafety = {}, accountName = "", rows } = {}) {
  const blockerIds = new Set(blockers.map((blocker) => blocker.id));
  return dedupeBy([
    ...marketDataOperatorActions(blockerIds, dataReadiness, rows),
    ...executionOperatorActions(blockerIds, startup, addonBridge, brokerSafety, accountName),
  ], (action) => action.id);
}

function marketDataOperatorActions(blockerIds, dataReadiness, rows) {
  return [
    blockerIds.has("data.live_fresh") && operatorAction("tradingview_live_freshness", "data.live_fresh", "Réactiver les alertes TradingView MNQ/MES", "market-data", dataFreshnessDetail(dataReadiness), "Vérifier que les alertes TradingView postent en continu vers le webhook du desk sur MNQ/MES M1 et M5. Le rescue MCP local ne doit servir qu’au diagnostic.", "/research/data", "python3 scripts/tradingview/migrate_local_alert_webhooks.py"),
    blockerIds.has("data.source_durable") && operatorAction("tradingview_source_durable", "data.source_durable", "Remplacer le secours TradingView par des alertes durables", "market-data", dataSourceDetail(dataReadiness, rows), "Créer ou corriger les alertes TradingView MNQ/MES M1/M5 vers /api/v1/webhooks/tradingview avec source durable ou alert_id stable.", "/research/data", "python3 scripts/tradingview/migrate_local_alert_webhooks.py"),
  ].filter(Boolean);
}

function executionOperatorActions(blockerIds, startup, addonBridge, brokerSafety, accountName) {
  if (blockerIds.has("execution.manual_telegram_ready")) {
    return [operatorAction("manual_telegram_ready", "execution.manual_telegram_ready", "Activer les alertes Telegram trading", "execution", "telegram trading worker not ready", "Vérifier que DeskFuturesTelegram tourne, que les canaux trading sont configurés et envoyer une alerte de test.", "/execution/providers", "npm --prefix mcp_gpt_desk run telegram:acceptance")];
  }
  if (blockerIds.has("broker.paper_environment_safe")) return [operatorAction("paper_environment_safe", "broker.paper_environment_safe", "Armer l’environnement PAPER en mode auto Sim101", "broker", brokerEnvironmentDetail({}, brokerSafety), "Vérifier execution_enabled, bridge_mode=sim101_addon_approved_only, kill switch relâché, max contracts > 0, authority=auto et compte live interdit.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero")];
  if (!blockerIds.has("broker.sim101_addon_ready")) return [];
  return sim101AddonOperatorActions({ startup, addonBridge, brokerSafety, accountName });
}

function sim101AddonOperatorActions({ startup, addonBridge, brokerSafety, accountName }) {
  return [
    ninjaLoginAction({ startup }),
    ninjaConnectionAction({ startup, brokerSafety }),
    addonHeartbeatAction({ startup, addonBridge, brokerSafety }),
    addonCommandAction({ addonBridge, brokerSafety }),
    sim101AccountAction({ accountName }),
  ].filter(Boolean);
}

function ninjaLoginAction({ startup = {} } = {}) {
  if (!startupNeedsLogin(startup)) return null;
  return operatorAction("ninjatrader_login", "broker.sim101_addon_ready", "Finaliser le login NinjaTrader sur le VPS", "broker", `state=${startup.state || "unknown"} · window=${startup.processWindowTitle || "unknown"}`, "Ouvrir le VPS, terminer l’authentification NinjaTrader et fermer l’écran de bienvenue.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero");
}

function ninjaConnectionAction({ startup = {}, brokerSafety = {} } = {}) {
  if (!connectionNotReady(startup, brokerSafety)) return null;
  return operatorAction("ninjatrader_simulation_connection", "broker.sim101_addon_ready", "Connecter NinjaTrader à Simulation", "broker", `connection=${startup.connectionName || "Simulation"} · ready=${String(fallbackValue(startup.connectionReady, brokerSafety.connection_ready))}`, "Dans NinjaTrader, connecter le provider NinjaTrader/Simulation et vérifier que le compte actif est Sim101.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero");
}

function addonHeartbeatAction({ startup = {}, addonBridge = null, brokerSafety = {} } = {}) {
  if (!heartbeatNotFresh(startup, brokerSafety)) return null;
  return operatorAction("addon_fresh_heartbeat", "broker.sim101_addon_ready", "Relancer ou ouvrir l’AddOn DeskExecution", "broker", addonBridgeEvidence(addonBridge), "Vérifier que l’AddOn DeskExecution est chargé dans NinjaTrader et publie un heartbeat frais vers le backend.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero");
}

function addonCommandAction({ addonBridge = null, brokerSafety = {} } = {}) {
  if (!commandsDisabled(addonBridge, brokerSafety)) return null;
  return operatorAction("addon_command_enabled", "broker.sim101_addon_ready", "Activer les commandes approuvées côté AddOn", "broker", addonCommandEvidence(addonBridge, brokerSafety), "L’AddOn doit sortir de read-only/shadow et accepter uniquement les commandes signées et approuvées Sim101.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero");
}

function sim101AccountAction({ accountName = "" } = {}) {
  if (!accountName) return null;
  if (isSimAccount(accountName)) return null;
  return operatorAction("sim101_account_required", "broker.sim101_addon_ready", "Revenir au compte Sim101", "broker", `account_name=${accountName}`, "Ne pas utiliser de compte live : la gate demo/PAPER exige Sim101.", "/execution/providers", "npm run --silent doctor:ninja -- --json --exit-zero");
}

function startupNeedsLogin(startup = {}) {
  return startup.loginRequired === true || startup.state === "login_required";
}

function connectionNotReady(startup = {}, brokerSafety = {}) {
  return (startup.connectionReady ?? brokerSafety.connection_ready) !== true;
}

function heartbeatNotFresh(startup = {}, brokerSafety = {}) {
  return (startup.addonHeartbeatFresh ?? brokerSafety.addon_heartbeat_fresh) !== true;
}

function commandsDisabled(addonBridge = null, brokerSafety = {}) {
  return fallbackValue(addonBridgeValue(addonBridge, "command_enabled"), brokerSafety.command_enabled) !== true;
}

function addonBridgeEvidence(addonBridge) {
  return addonBridge ? `last_seen_at=${addonBridge.last_seen_at || "unknown"} · status=${addonBridge.status || "unknown"}` : "aucun bridge AddOn trouvé";
}

function addonCommandEvidence(addonBridge = null, brokerSafety = {}) {
  return `status=${fallbackValue(addonBridgeValue(addonBridge, "status"), brokerSafety.addon_bridge_status, "unknown")} · command_enabled=${String(fallbackValue(addonBridgeValue(addonBridge, "command_enabled"), brokerSafety.command_enabled))}`;
}

function operatorAction(id, blockerId, title, domain, evidence, action, route, command = null) {
  return { id, blockerId, title, domain, severity: "BLOCKER", evidence, action, route, command };
}

function dedupeBy(items, keyFn) {
  return Array.from(new Map(items.map((item) => [keyFn(item), item])).values());
}

function domainForActionRoute(route = "") {
  if (route.startsWith("/research/data")) return "market-data";
  if (route.startsWith("/execution")) return "broker";
  if (route.startsWith("/live")) return "runtime";
  return null;
}

function readinessRouteForBlocker(blockerId) {
  if (blockerId.startsWith("data.")) return "/research/data";
  if (blockerId.startsWith("broker.")) return "/execution/providers";
  if (blockerId.startsWith("live_runtime.")) return "/live";
  if (blockerId.startsWith("api.") || blockerId.startsWith("service.")) return "/events";
  return "/command-center";
}

function dataFreshnessDetail(dataReadiness = {}) {
  return [`state=${dataReadiness.state || "unknown"}`, `age=${dataReadiness.core_age_seconds ?? "n/a"}s`, `market=${dataReadiness.effective_market_date || dataReadiness.requested_trading_date || "unknown"}`].join(" · ");
}

function isoText(value, fallback = "—") {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text(value, fallback);
}

function dataSourceDetail(dataReadiness = {}, rows) {
  const nonDurable = rows(dataReadiness.source_health?.non_durable_feeds);
  return nonDurable.length ? nonDurable.map((feed) => `${feed.instrument || "?"} ${feed.timeframe || "?"}:${feed.classification || "unknown"}`).join(", ") : `durable=${String(dataReadiness.source_health?.durable ?? "unknown")}`;
}

function brokerEnvironmentDetail(safety = {}, brokerSafety = {}) {
  return [
    `enabled=${String(safety.executionEnabled ?? brokerSafety.execution_enabled)}`,
    `mode=${safety.bridgeMode || brokerSafety.bridge_mode || "unknown"}`,
    `authority=${safety.executionAuthorityMode || brokerSafety.execution_authority_mode || "unknown"}`,
    `submission=${String(safety.submissionPossible ?? brokerSafety.submission_possible)}`,
    `kill=${String(safety.killSwitchEnv === false ? "released" : brokerSafety.kill_switch_released === true ? "released" : "active")}`,
  ].join(" · ");
}

function brokerAddonDetail({ startup = {}, addonBridge = null, brokerSafety = {}, accountName = "" } = {}) {
  return [`state=${startup.state || "unknown"}`, `heartbeat=${String(startup.addonHeartbeatFresh ?? brokerSafety.addon_heartbeat_fresh)}`, `connection=${String(startup.connectionReady ?? brokerSafety.connection_ready)}`, `command=${String(addonBridge?.command_enabled ?? brokerSafety.command_enabled)}`, `account=${accountName || "unknown"}`].join(" · ");
}

function telegramTradingDetail(service = {}) {
  const environment = service?.details?.environment || {};
  const deliveryStatuses = Array.isArray(service?.details?.deliveries)
    ? service.details.deliveries.map((delivery) => String(delivery?.status || "unknown")).join(",")
    : "none";
  return [
    `status=${service?.status || "unknown"}`,
    `healthy=${String(service?.healthy)}`,
    `worker=${String(environment.workerEnabled)}`,
    `trading=${String(environment.tradingConfigured)}`,
    `deliveries=${deliveryStatuses}`,
  ].join(" · ");
}
