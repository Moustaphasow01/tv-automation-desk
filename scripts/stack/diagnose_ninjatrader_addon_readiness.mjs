#!/usr/bin/env node
import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";

const DEFAULT_EXECUTION_OVERVIEW_URL = "http://127.0.0.1:8787/api/v1/execution/overview";

export function parseNinjaAddonDoctorArgs(argv = process.argv.slice(2)) {
  const options = { executionOverviewUrl: DEFAULT_EXECUTION_OVERVIEW_URL, output: "pretty", exitZero: false };
  for (const arg of argv) {
    if (arg === "--json") options.output = "json";
    else if (arg === "--exit-zero") options.exitZero = true;
    else if (arg.startsWith("--execution-overview-url=")) {
      options.executionOverviewUrl = arg.slice("--execution-overview-url=".length);
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function buildNinjaAddonReadinessDiagnosis(overview = {}, { checkedAtUtc } = {}) {
  const checkedAt = parseDate(checkedAtUtc) || new Date();
  const startup = overview.ninjaTraderStartup || {};
  const safety = overview.safety || {};
  const bridge = selectPhysicalAddonBridge(overview.bridges);
  const snapshot = selectLatestSnapshot(overview.addonSnapshots, bridge?.bridge_id);
  const snapshotAgeSeconds = ageSeconds(snapshot?.captured_at || snapshot?.received_at, checkedAt);
  const accountName = String(bridge?.account_name || snapshot?.account_name || "").trim();
  const facts = {
    execution_enabled: safety.executionEnabled ?? null,
    bridge_mode: safety.bridgeMode || null,
    live_account_allowed: safety.liveAccountAllowed ?? null,
    submission_possible: safety.submissionPossible ?? null,
    startup_state: startup.state || null,
    process_window_title: startup.processWindowTitle || null,
    login_required: startup.loginRequired ?? null,
    platform_ready: startup.platformReady ?? null,
    connection_name: startup.connectionName || null,
    connection_ready: startup.connectionReady ?? null,
    addon_bridge_id: bridge?.bridge_id || null,
    addon_status: bridge?.status || null,
    addon_heartbeat_fresh: startup.addonHeartbeatFresh ?? null,
    addon_connected: startup.addonConnected ?? null,
    command_enabled: bridge?.command_enabled ?? null,
    account_name: accountName || null,
    sim101_account: /^Sim\d*$/i.test(accountName),
    latest_snapshot_at: snapshot?.captured_at || null,
    latest_snapshot_age_seconds: snapshotAgeSeconds,
  };
  const blockers = readinessBlockers({ facts, bridge, snapshot, maxSnapshotAgeSeconds: safety.accountSnapshotMaxAgeSeconds });
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    checked_at_utc: checkedAt.toISOString(),
    facts,
    blockers,
    actions: actionsForBlockers(blockers),
  };
}

export function formatNinjaAddonReadinessDiagnosis(diagnosis) {
  const lines = [
    `NinjaTrader AddOn doctor: ${diagnosis.status}`,
    `checked_at_utc=${diagnosis.checked_at_utc}`,
    "",
    "Facts:",
  ];
  for (const [key, value] of Object.entries(diagnosis.facts)) {
    lines.push(`- ${key}: ${value === null || value === undefined || value === "" ? "—" : value}`);
  }
  if (diagnosis.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of diagnosis.blockers) lines.push(`- ${blocker.code}: ${blocker.detail}`);
  }
  if (diagnosis.actions.length) {
    lines.push("");
    lines.push("Actions opérateur:");
    for (const [index, action] of diagnosis.actions.entries()) {
      lines.push(`${index + 1}. ${action.title}`);
      lines.push(`   ${action.detail}`);
    }
  }
  return lines.join("\n");
}

function readinessBlockers({ facts, bridge, snapshot, maxSnapshotAgeSeconds }) {
  const blockers = [];
  addBlocker(blockers, facts.execution_enabled !== true, "execution.disabled", "DESK_BROKER_EXECUTION_ENABLED doit rester true pour PAPER.");
  addBlocker(blockers, facts.bridge_mode !== "sim101_addon_approved_only", "bridge.mode_invalid", `bridge_mode=${facts.bridge_mode || "unknown"}`);
  addBlocker(blockers, facts.live_account_allowed === true, "safety.live_account_allowed", "Un compte live est explicitement interdit pour cette phase.");
  addBlocker(blockers, facts.submission_possible !== true, "safety.submission_not_possible", "Le backend ne considère pas la soumission PAPER possible.");
  addBlocker(blockers, facts.login_required === true || facts.startup_state === "login_required", "ninjatrader.login_required", `window=${facts.process_window_title || "unknown"}`);
  addBlocker(blockers, facts.connection_ready !== true, "ninjatrader.connection_not_ready", `connection=${facts.connection_name || "unknown"}`);
  addBlocker(blockers, !bridge, "addon.bridge_missing", "Aucun bridge AddOn physique enregistré.");
  addBlocker(blockers, bridge && facts.addon_heartbeat_fresh !== true, "addon.heartbeat_stale", `bridge=${bridge?.bridge_id || "unknown"}`);
  addBlocker(blockers, bridge && facts.addon_status !== "armed", "addon.not_armed", `status=${facts.addon_status || "unknown"}`);
  addBlocker(blockers, bridge && facts.command_enabled !== true, "addon.commands_disabled", `command_enabled=${String(facts.command_enabled)}`);
  addBlocker(blockers, !facts.sim101_account, "account.not_sim101", `account=${facts.account_name || "unknown"}`);
  addSnapshotBlocker(blockers, snapshot, facts.latest_snapshot_age_seconds, maxSnapshotAgeSeconds);
  return blockers;
}

function addSnapshotBlocker(blockers, snapshot, age, maxAge) {
  const limit = Number(maxAge);
  if (!snapshot) addBlocker(blockers, true, "addon.snapshot_missing", "Aucun snapshot AddOn récent.");
  else if (Number.isFinite(limit) && Number.isFinite(age) && age > limit) {
    addBlocker(blockers, true, "addon.snapshot_stale", `age=${age}s · max=${limit}s`);
  }
}

function addBlocker(blockers, condition, code, detail) {
  if (condition) blockers.push({ code, detail });
}

function actionsForBlockers(blockers) {
  const codes = new Set(blockers.map((blocker) => blocker.code));
  const actions = [];
  if (codes.has("ninjatrader.login_required")) actions.push(action("Finaliser le login NinjaTrader", "Sur le VPS, terminer l’écran Bienvenue/login avant toute activation agent."));
  if (codes.has("ninjatrader.connection_not_ready")) actions.push(action("Connecter NinjaTrader à Simulation", "Connexion attendue : provider NinjaTrader, mode Simulation, compte Sim101."));
  if (codes.has("addon.bridge_missing") || codes.has("addon.heartbeat_stale")) actions.push(action("Ouvrir ou relancer l’AddOn DeskExecution", "L’AddOn doit publier un heartbeat frais vers /api/v1/execution/addon/heartbeat."));
  if (codes.has("addon.not_armed") || codes.has("addon.commands_disabled")) actions.push(action("Armer les commandes approuvées Sim101", "L’AddOn doit sortir de read-only/shadow et accepter uniquement les commandes signées et approuvées."));
  if (codes.has("account.not_sim101")) actions.push(action("Revenir au compte Sim101", "Aucun compte live ne doit être connecté au chemin de soumission de cette phase."));
  if (codes.has("addon.snapshot_missing") || codes.has("addon.snapshot_stale")) actions.push(action("Publier un snapshot AddOn frais", "Le snapshot doit prouver connexion, compte Sim101, ordres/positions courants et horodatage récent."));
  return dedupeActions(actions);
}

function action(title, detail) {
  return { title, detail };
}

function dedupeActions(actions) {
  return Array.from(new Map(actions.map((item) => [item.title, item])).values());
}

function selectPhysicalAddonBridge(bridges) {
  const candidates = Array.isArray(bridges) ? bridges.filter((bridge) => bridge?.adapter_kind === "addon") : [];
  return candidates.find((bridge) => bridge?.capabilities?.approved_commands === true && !bridge?.capabilities?.simulator)
    || candidates.find((bridge) => !bridge?.capabilities?.simulator)
    || candidates[0]
    || null;
}

function selectLatestSnapshot(snapshots, bridgeId) {
  const candidates = Array.isArray(snapshots) ? snapshots : [];
  const scoped = bridgeId ? candidates.filter((snapshot) => snapshot?.bridge_id === bridgeId) : candidates;
  return scoped.sort((left, right) => Date.parse(right?.captured_at || right?.received_at || "") - Date.parse(left?.captured_at || left?.received_at || ""))[0] || null;
}

function ageSeconds(value, checkedAt) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return Math.max(0, Math.floor((checkedAt.getTime() - parsed.getTime()) / 1000));
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchJson(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function printUsage() {
  console.log([
    "Usage: node scripts/stack/diagnose_ninjatrader_addon_readiness.mjs [--json] [--exit-zero]",
    "",
    "Options:",
    "  --execution-overview-url=http://127.0.0.1:8787/api/v1/execution/overview",
    "  --json",
    "  --exit-zero",
  ].join("\n"));
}

async function main() {
  const options = parseNinjaAddonDoctorArgs();
  if (options.help) {
    printUsage();
    return;
  }
  const overview = await fetchJson(options.executionOverviewUrl);
  const diagnosis = buildNinjaAddonReadinessDiagnosis(overview);
  if (options.output === "json") console.log(JSON.stringify(diagnosis, null, 2));
  else console.log(formatNinjaAddonReadinessDiagnosis(diagnosis));
  if (!diagnosis.ok && !options.exitZero) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
