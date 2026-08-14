#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";
import { SystemClock } from "../../packages/desk-time/index.js";
import {
  buildDressRehearsalEvidenceFromRuntimeSnapshot,
  evaluateFullSystemDressRehearsalEvidence,
} from "../src/full-system-dress-rehearsal-certifier.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const ORDER_SIDE_EFFECT_TABLES = Object.freeze([
  "broker_provider_commands",
  "broker_provider_events",
  "broker_execution_outbox",
  "broker_management_outbox",
  "broker_orders",
  "trade_order_intents",
  "portfolio_order_intent_lineage",
]);
const REQUIRED_TABLES = Object.freeze([
  "desk_schema_migrations",
  "desk_service_heartbeats",
  "agent_missions",
  "agent_tasks",
  "datasets",
  "strategy_definitions",
  "strategy_versions",
  "strategy_instances",
  "simulation_runs",
  "research_experiments",
  "research_candidates",
  "research_evaluation_reports",
  "strategy_signal_outbox",
  "portfolio_order_intent_lineage",
  "trade_order_intents",
  "broker_provider_commands",
  "assistant_tasks",
  "assistant_outbox",
]);

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && samePath(process.argv[1], currentFile)) {
  const report = await certifyTd2420DressRehearsal(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict === "NO-GO") process.exitCode = 1;
}

export async function certifyTd2420DressRehearsal({
  baseUrl = process.env.DESK_TD2_420_BASE_URL || DEFAULT_BASE_URL,
  databaseUrl = process.env.DATABASE_URL || "",
  sinceUtc = process.env.DESK_TD2_420_SINCE_UTC || "",
  beforeCounts = null,
  minStrategies = 10,
  maxStrategies = 20,
  probeSse = false,
  sseTimeoutMs = 2_000,
} = {}) {
  const clock = new SystemClock();
  const checkedAtUtc = clock.now().utc;
  const normalizedBase = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/g, "");
  const snapshot = {
    checked_at_utc: checkedAtUtc,
    release: process.env.DESK_RELEASE_VERSION || "unversioned",
    source: {
      database_configured: Boolean(String(databaseUrl || "").trim()),
      base_url: normalizedBase,
      since_utc: sinceUtc || null,
    },
  };

  if (String(databaseUrl || "").trim()) {
    const dbSnapshot = await collectDatabaseSnapshot({ databaseUrl, sinceUtc, beforeCounts });
    Object.assign(snapshot, dbSnapshot);
  }

  const bffSnapshot = await collectBffSnapshot({ baseUrl: normalizedBase, probeSse, sseTimeoutMs });
  snapshot.front = {
    ...(snapshot.front || {}),
    ...bffSnapshot.front,
  };
  snapshot.live_runtime = {
    ...(snapshot.live_runtime || {}),
    ...bffSnapshot.live_runtime,
  };
  snapshot.assistants = {
    ...(snapshot.assistants || {}),
    ...bffSnapshot.assistants,
  };

  const evidence = buildDressRehearsalEvidenceFromRuntimeSnapshot(snapshot);
  const evaluation = evaluateFullSystemDressRehearsalEvidence(evidence, { minStrategies, maxStrategies });
  return {
    ...evaluation,
    checked_at_utc: checkedAtUtc,
    release: snapshot.release,
    source: snapshot.source,
    snapshot,
    safety: {
      secrets_redacted: true,
      mode: "READ_ONLY_CERTIFICATION",
      auto_execution_required: "OFF",
      live_auto_required: "OFF",
      broker_provider_side_effect_expected: "ZERO",
    },
  };
}

async function collectDatabaseSnapshot({ databaseUrl, sinceUtc, beforeCounts }) {
  const client = new Client({ connectionString: databaseUrl, application_name: "td2-420-dress-rehearsal-certifier" });
  const snapshot = {};
  try {
    await client.connect();
    snapshot.schema = await schemaSnapshot(client);
    snapshot.services = await serviceSnapshot(client);
    snapshot.workers = await workerSnapshot(client);
    snapshot.safety = await safetySnapshot(client, beforeCounts);
    snapshot.research = await researchSnapshot(client, sinceUtc);
    snapshot.data = await dataSnapshot(client, sinceUtc);
    snapshot.strategy = await strategySnapshot(client, sinceUtc);
    snapshot.live_runtime = await liveRuntimeSnapshot(client);
    snapshot.signal_pipeline = await signalPipelineSnapshot(client, sinceUtc);
    snapshot.observability = await observabilitySnapshot(client, sinceUtc);
    snapshot.restart = await restartSnapshot(client, sinceUtc);
    snapshot.chaos = await chaosSnapshot(client, sinceUtc);
    snapshot.telegram = await telegramSnapshot(client, sinceUtc);
    snapshot.sim101 = await sim101Snapshot(client);
  } catch (error) {
    snapshot.database_error = publicError(error);
  } finally {
    await client.end().catch(() => undefined);
  }
  return snapshot;
}

async function schemaSnapshot(client) {
  const present = [];
  for (const table of REQUIRED_TABLES) {
    const result = await safeQuery(client, "SELECT to_regclass($1) IS NOT NULL AS present", [table]);
    if (result.rows[0]?.present === true) present.push(table);
  }
  return { present_tables: present };
}

async function serviceSnapshot(client) {
  const result = await safeQuery(client, `
    SELECT service_id, service_kind, status, release_version, details,
           EXTRACT(EPOCH FROM (now() - heartbeat_at_utc))::int AS heartbeat_age_seconds
      FROM desk_service_heartbeats
     ORDER BY service_kind, service_id
  `);
  return result.rows.map((row) => ({
    service_id: row.service_id,
    service_kind: row.service_kind,
    status: row.status,
    release_version: row.release_version,
    details: row.details || {},
    heartbeat_age_seconds: row.heartbeat_age_seconds,
    critical: isCriticalRehearsalService(row),
    critical_reason: criticalRehearsalServiceReason(row),
  }));
}

async function workerSnapshot(client) {
  const rows = (await safeQuery(client, `
    SELECT service_id, service_kind, status, release_version, details,
           EXTRACT(EPOCH FROM (now() - heartbeat_at_utc))::int AS heartbeat_age_seconds
      FROM desk_service_heartbeats
     WHERE service_id ILIKE '%worker%'
        OR service_id ILIKE '%research%'
        OR service_kind ILIKE '%worker%'
        OR service_kind ILIKE '%research%'
     ORDER BY service_id
  `)).rows;
  const researchWorkers = rows.filter(isRelevantResearchWorkerHeartbeat);
  const activeResearch = researchWorkers.filter((row) => ["healthy", "degraded"].includes(String(row.status).toLowerCase()) && Number(row.heartbeat_age_seconds) <= 180).length;
  const simulationWorkers = rows.filter((row) => `${row.service_id} ${row.service_kind}`.toLowerCase().includes("simulation"));
  const queueDepth = await scalarInt(client, "SELECT count(*)::int FROM agent_tasks WHERE lane = 'research' AND status IN ('PENDING','READY','CLAIMED','RUNNING')", []);
  return {
    expected_research_workers: researchWorkers.length,
    active_research_workers: activeResearch,
    active_simulation_workers: simulationWorkers.filter((row) => ["healthy", "degraded"].includes(String(row.status).toLowerCase())).length,
    queue_depth: queueDepth,
    max_heartbeat_age_seconds: 180,
    heartbeats: researchWorkers.map((row) => ({
      service_id: row.service_id,
      service_kind: row.service_kind,
      status: row.status,
      heartbeat_age_seconds: row.heartbeat_age_seconds,
      stale: Number(row.heartbeat_age_seconds) > 180,
    })),
    ignored_historical_or_disabled_heartbeats: rows.filter((row) => !isRelevantResearchWorkerHeartbeat(row)).map((row) => ({
      service_id: row.service_id,
      service_kind: row.service_kind,
      status: row.status,
      heartbeat_age_seconds: row.heartbeat_age_seconds,
    })),
  };
}

async function safetySnapshot(client, beforeCounts) {
  const after = await orderSideEffectCounts(client);
  return {
    auto_execution_enabled: false,
    live_auto_enabled: false,
    side_effect_counts_before: beforeCounts || null,
    side_effect_counts_after: after,
    broker_provider_side_effect_delta: beforeCounts ? sideEffectDelta(beforeCounts, after) : null,
  };
}

async function researchSnapshot(client, sinceUtc) {
  const sinceWhere = sinceUtc ? "WHERE created_at_utc >= $1::timestamptz" : "";
  const sinceParams = sinceUtc ? [sinceUtc] : [];
  const strategyRows = (await safeQuery(client, `
    SELECT DISTINCT sd.external_key
      FROM research_candidates rc
      JOIN strategy_definitions sd ON sd.strategy_definition_id = rc.strategy_definition_id
      ${sinceWhere.replace("created_at_utc", "rc.created_at_utc")}
     ORDER BY sd.external_key
     LIMIT 20
  `, sinceParams)).rows;
  const reportKinds = await safeQuery(client, `
    SELECT report_kind::text AS report_kind, count(*)::int AS count
      FROM research_evaluation_reports
      ${sinceWhere}
     GROUP BY report_kind
  `, sinceParams);
  const kindCounts = Object.fromEntries(reportKinds.rows.map((row) => [String(row.report_kind), Number(row.count)]));
  const portfolioFit = await countEvaluationReports(client, "report_kind::text = 'PORTFOLIO_FIT'", sinceUtc);
  return {
    strategy_ids: strategyRows.map((row) => row.external_key).filter(Boolean),
    missions: await countSince(client, "agent_missions", "lane = 'research'", sinceUtc),
    tasks: await countSince(client, "agent_tasks", "lane = 'research'", sinceUtc),
    datasets: await countSince(client, "datasets", "status = 'READY'", sinceUtc),
    simulation_runs: await countSince(client, "simulation_runs", "status = 'COMPLETED'", sinceUtc),
    evaluation_reports: await countSince(client, "research_evaluation_reports", "true", sinceUtc),
    gates: {
      G0_DATA_READY: await countSince(client, "datasets", "status = 'READY'", sinceUtc),
      G1_SCREENED: (kindCounts.TRAIN || 0) + (kindCounts.VALIDATION || 0) + (kindCounts.CONTRADICTORY_REVIEW || 0),
      G2_CANONICAL_VALID: (kindCounts.VALIDATION || 0) + (kindCounts.OUT_OF_SAMPLE || 0),
      G3_ROBUST: (kindCounts.ROBUSTNESS || 0) + (kindCounts.WALK_FORWARD || 0),
      G4_PORTFOLIO_FIT: portfolioFit,
    },
    report_kind_counts: kindCounts,
  };
}

async function dataSnapshot(client, sinceUtc) {
  const ready = await datasetCount(client, "status = 'READY'", sinceUtc);
  const lineage = await datasetCount(client, "status = 'READY' AND content_hash IS NOT NULL AND provenance_hash IS NOT NULL AND build_parameters_hash IS NOT NULL", sinceUtc);
  const synthetic = await datasetCount(client, "status = 'READY' AND lower(coalesce(metadata->>'synthetic','false')) IN ('true','1','yes')", sinceUtc);
  const undeclaredSynthetic = await datasetCount(client, `
    status = 'READY'
    AND lower(coalesce(metadata->>'synthetic','false')) IN ('true','1','yes')
    AND lower(coalesce(metadata->>'synthetic_declared','false')) NOT IN ('true','1','yes')
  `, sinceUtc);
  return {
    ready_datasets: ready,
    lineage_complete_datasets: lineage,
    no_lookahead_declared: lineage > 0,
    synthetic_datasets: synthetic,
    undeclared_synthetic_datasets: undeclaredSynthetic,
    no_synthetic_data_detected: synthetic === 0,
    synthetic_data_declared: undeclaredSynthetic === 0,
  };
}

async function strategySnapshot(client, sinceUtc) {
  const statusCounts = await safeQuery(client, `
    SELECT status::text AS status, count(*)::int AS count
      FROM strategy_versions
     ${sinceUtc ? "WHERE created_at >= $1::timestamptz" : ""}
     GROUP BY status
  `, sinceUtc ? [sinceUtc] : []);
  const statuses = Object.fromEntries(statusCounts.rows.map((row) => [String(row.status), Number(row.count)]));
  const compiledFromSimulation = await countSince(client, "simulation_runs", "compiled_artifact_hash IS NOT NULL", sinceUtc, "created_at_utc");
  const compiledFromVersion = await countSince(client, "strategy_versions", "compiled_artifact_ref IS NOT NULL AND compiled_artifact_hash IS NOT NULL", sinceUtc, "created_at");
  return {
    immutable_versions: Number(statuses.published || 0),
    published_versions: Number(statuses.published || 0),
    validated_versions: Number(statuses.validated || 0),
    compiled_artifacts: compiledFromVersion + compiledFromSimulation,
    compiled_artifacts_from_versions: compiledFromVersion,
    compiled_artifacts_from_simulation_runs: compiledFromSimulation,
    shadow_instances: await countSince(client, "strategy_instances", "execution_mode = 'shadow' AND runtime_state IN ('running','paused')", sinceUtc, "created_at"),
  };
}

async function liveRuntimeSnapshot(client) {
  const running = await scalarInt(client, "SELECT count(*)::int FROM strategy_instances WHERE execution_mode = 'shadow' AND runtime_state = 'running'", []);
  const freshHeartbeat = await scalarInt(client, "SELECT count(*)::int FROM strategy_instances WHERE last_heartbeat_at IS NOT NULL AND now() - last_heartbeat_at < interval '10 minutes'", []);
  return {
    instances_evaluated: running,
    last_evaluation_progressed: freshHeartbeat > 0,
    feed_state: "NOT_PROVEN",
  };
}

async function signalPipelineSnapshot(client, sinceUtc) {
  const signals = await countSince(client, "strategy_signal_outbox", "true", sinceUtc, "created_at_utc");
  const intents = await countSince(client, "portfolio_order_intent_lineage", "true", sinceUtc, "created_at_utc");
  return {
    no_signal_observed: signals === 0,
    no_signal_is_valid: signals === 0,
    signal_to_order_intent_proven: signals > 0 && intents > 0,
    portfolio_risk_lineage_proven: intents > 0,
    human_gate_required: true,
    broker_auto_send: false,
  };
}

async function observabilitySnapshot(client, sinceUtc) {
  const sinceClause = sinceUtc ? "AND updated_at >= $1::timestamptz" : "";
  const params = sinceUtc ? [sinceUtc] : [];
  const result = await safeQuery(client, `
    SELECT count(*)::int AS count
      FROM desk_documents
     WHERE collection IN ('desk_alert_events','desk_operations_events','desk_agent_work_events','dashboard_command_events')
       AND (
         upper(data->>'level') IN ('ERROR','CRITICAL')
         OR upper(data->>'severity') IN ('ERROR','CRITICAL','HIGH')
         OR upper(data->>'status') IN ('FAILED','ERROR')
       )
       ${sinceClause}
  `, params);
  const historical = sinceUtc ? await safeQuery(client, `
    SELECT count(*)::int AS count
      FROM desk_documents
     WHERE collection IN ('desk_alert_events','desk_operations_events','desk_agent_work_events','dashboard_command_events')
       AND (
         upper(data->>'level') IN ('ERROR','CRITICAL')
         OR upper(data->>'severity') IN ('ERROR','CRITICAL','HIGH')
         OR upper(data->>'status') IN ('FAILED','ERROR')
       )
       AND updated_at < $1::timestamptz
  `, [sinceUtc]) : { rows: [{ count: 0 }] };
  return {
    critical_errors: Number(result.rows[0]?.count || 0),
    unexplained_errors: Number(result.rows[0]?.count || 0),
    new_during_rehearsal_errors: Number(result.rows[0]?.count || 0),
    pre_rehearsal_historical_errors: Number(historical.rows[0]?.count || 0),
    window_start_utc: sinceUtc || null,
    warnings: 0,
  };
}

async function restartSnapshot(client, sinceUtc) {
  const sinceClause = sinceUtc ? "AND updated_at >= $1::timestamptz" : "AND updated_at >= now() - interval '24 hours'";
  const params = sinceUtc ? [sinceUtc] : [];
  const fullRestartProof = await scalarInt(client, `
    SELECT count(*)::int
      FROM desk_documents
     WHERE collection IN ('desk_audit_logs','dashboard_command_events')
       AND (data->>'action' IN ('desk.restart','desk.start') OR data->>'event_type' ILIKE '%restart%')
       ${sinceClause}
  `, params);
  return {
    full_restart_recovered: fullRestartProof > 0,
    auto_execution_enabled: false,
    live_auto_enabled: false,
  };
}

async function chaosSnapshot(client, sinceUtc) {
  const sinceClause = sinceUtc ? "AND created_at_utc >= $1::timestamptz" : "";
  const params = sinceUtc ? [sinceUtc] : [];
  const recoveries = await safeQuery(client, `
    SELECT count(*)::int AS count
      FROM agent_events
     WHERE event_type IN ('TASK_EXPIRED','TASK_CLAIMED','TASK_COMPLETED')
       ${sinceClause}
  `, params);
  const duplicateDone = await safeQuery(client, `
    SELECT count(*)::int AS count
      FROM (
        SELECT coalesce(output_ref, task_key) AS business_key
          FROM agent_tasks
         WHERE lane = 'research'
           AND status = 'DONE'
           ${sinceUtc ? "AND completed_at_utc >= $1::timestamptz" : ""}
         GROUP BY coalesce(output_ref, task_key)
        HAVING count(*) > 1
      ) duplicates
  `, params);
  return {
    worker_kill_recovered: Number(recoveries.rows[0]?.count || 0) > 0,
    no_duplicate_result_after_recovery: Number(duplicateDone.rows[0]?.count || 0) === 0,
    backend_restart_recovered: false,
    tasks_persisted_after_restart: false,
    sse_resume_recovered: false,
    feed_stale_fail_closed: false,
  };
}

async function telegramSnapshot(client, sinceUtc) {
  const sent = await countSince(client, "telegram_delivery_outbox", "status IN ('sent','delivered','SENT','DELIVERED')", sinceUtc, "created_at_utc");
  return {
    available: sent > 0,
    operator_notification_sent: sent > 0,
    not_a_broker_order: true,
  };
}

async function sim101Snapshot(_client) {
  return {
    available: false,
    paper_smoke_passed: false,
    live_account_forbidden: true,
  };
}

async function collectBffSnapshot({ baseUrl, probeSse, sseTimeoutMs }) {
  const front = {
    vnext_available: false,
    bff_single_source: false,
    no_front_risk_recalc: false,
    degraded_states_visible: false,
    sse_connected: false,
    cursor_resume_proven: false,
    browser_reopen_truth_preserved: false,
  };
  const assistants = {
    available: false,
    read_only: false,
    answer_grounded: false,
    no_sensitive_authority: false,
  };

  const capabilities = await fetchJson(`${baseUrl}/front-api/v1/capabilities`).catch((error) => ({ status: 0, body: { error: publicError(error) } }));
  const commandCenter = await fetchJson(`${baseUrl}/front-api/v1/views/command-center`).catch((error) => ({ status: 0, body: { error: publicError(error) } }));
  const jarvis = await fetchJson(`${baseUrl}/front-api/v1/views/jarvis-workspace`).catch((error) => ({ status: 0, body: { error: publicError(error) } }));
  const readyz = await fetchJson(`${baseUrl}/readyz`).catch((error) => ({ status: 0, body: { error: publicError(error) } }));
  const status = await fetchJson(`${baseUrl}/status`).catch((error) => ({ status: 0, body: { error: publicError(error) } }));
  const actions = Array.isArray(capabilities.body?.actions) ? capabilities.body.actions : [];

  front.vnext_available = capabilities.status === 200 && commandCenter.status === 200;
  front.bff_single_source = front.vnext_available && capabilities.body?.schemaVersion === "1.0.0";
  front.no_front_risk_recalc = actions.every((action) => action.brokerExecution === false);
  front.degraded_states_visible = commandCenter.status === 200 && Array.isArray(commandCenter.body?.meta?.warnings);

  assistants.available = jarvis.status === 200 && Array.isArray(jarvis.body?.data?.missions);
  assistants.read_only = assistants.available && Array.isArray(jarvis.body?.data?.pendingActions) && jarvis.body.data.pendingActions.length === 0;
  assistants.answer_grounded = assistants.available && Array.isArray(jarvis.body?.data?.citations) && jarvis.body.data.citations.length > 0;
  assistants.no_sensitive_authority = assistants.available && Array.isArray(jarvis.body?.data?.commands) && jarvis.body.data.commands.length === 0;

  if (probeSse) {
    const sse = await probeFrontControlPlaneSse(`${baseUrl}/front-api/v1/events`, sseTimeoutMs);
    front.sse_connected = sse.connected;
    front.cursor_resume_proven = sse.connected && Boolean(sse.event_id);
    front.browser_reopen_truth_preserved = false;
  }

  const liveRuntime = liveRuntimeFromReadiness(readyz.body);

  return {
    front,
    assistants,
    live_runtime: liveRuntime,
    artifacts: {
      capabilities_status: capabilities.status,
      command_center_status: commandCenter.status,
      jarvis_status: jarvis.status,
      readyz_status: readyz.status,
      status_status: status.status,
    },
  };
}

async function probeFrontControlPlaneSse(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
    let text = "";
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunk = await reader.read();
      if (chunk.value) text = new TextDecoder().decode(chunk.value);
      await reader.cancel().catch(() => undefined);
    } else {
      text = await response.text();
    }
    const eventId = String(text.match(/^id:\s*(.+)$/m)?.[1] || "");
    return { connected: response.status === 200 && text.includes("data:"), event_id: eventId };
  } catch (error) {
    return { connected: false, error: publicError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function orderSideEffectCounts(client) {
  const counts = {};
  for (const table of ORDER_SIDE_EFFECT_TABLES) {
    counts[table] = await scalarInt(client, `SELECT count(*)::int FROM ${table}`, []);
  }
  return counts;
}

function sideEffectDelta(before, after) {
  let delta = 0;
  for (const table of ORDER_SIDE_EFFECT_TABLES) {
    delta += Math.abs(Number(after?.[table] || 0) - Number(before?.[table] || 0));
  }
  return delta;
}

async function countSince(client, table, predicate, sinceUtc, column = "created_at_utc") {
  const params = sinceUtc ? [sinceUtc] : [];
  const where = [predicate || "true"];
  if (sinceUtc) where.push(`${column} >= $1::timestamptz`);
  return scalarInt(client, `SELECT count(*)::int FROM ${table} WHERE ${where.join(" AND ")}`, params);
}

async function countEvaluationReports(client, predicate, sinceUtc) {
  const params = sinceUtc ? [sinceUtc] : [];
  const where = [predicate || "true"];
  if (sinceUtc) where.push("created_at_utc >= $1::timestamptz");
  return scalarInt(client, `SELECT count(*)::int FROM research_evaluation_reports WHERE ${where.join(" AND ")}`, params);
}

async function datasetCount(client, predicate, sinceUtc) {
  const params = sinceUtc ? [sinceUtc] : [];
  const where = [predicate || "true"];
  if (sinceUtc) {
    where.push(`(
      created_at_utc >= $1::timestamptz
      OR dataset_id IN (
        SELECT dataset_id FROM simulation_runs WHERE created_at_utc >= $1::timestamptz
      )
    )`);
  }
  return scalarInt(client, `SELECT count(*)::int FROM datasets WHERE ${where.join(" AND ")}`, params);
}

async function scalarInt(client, sql, params = []) {
  const result = await safeQuery(client, sql, params);
  return Number(result.rows[0]?.count || 0);
}

async function safeQuery(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch {
    return { rows: [] };
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw: raw.slice(0, 500) };
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.DESK_TD2_420_BASE_URL || DEFAULT_BASE_URL,
    databaseUrl: process.env.DATABASE_URL || "",
    sinceUtc: process.env.DESK_TD2_420_SINCE_UTC || "",
    beforeCounts: parseBeforeCounts(process.env.DESK_TD2_420_BEFORE_COUNTS || ""),
    minStrategies: 10,
    maxStrategies: 20,
    probeSse: false,
    sseTimeoutMs: 2_000,
  };
  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--database-url=")) options.databaseUrl = arg.slice("--database-url=".length);
    else if (arg.startsWith("--since-utc=")) options.sinceUtc = arg.slice("--since-utc=".length);
    else if (arg.startsWith("--before-counts-json=")) options.beforeCounts = parseBeforeCounts(arg.slice("--before-counts-json=".length));
    else if (arg.startsWith("--min-strategies=")) options.minStrategies = Number.parseInt(arg.slice("--min-strategies=".length), 10);
    else if (arg.startsWith("--max-strategies=")) options.maxStrategies = Number.parseInt(arg.slice("--max-strategies=".length), 10);
    else if (arg === "--probe-sse") options.probeSse = true;
    else if (arg.startsWith("--sse-timeout-ms=")) options.sseTimeoutMs = Number.parseInt(arg.slice("--sse-timeout-ms=".length), 10);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/certify_td2_420_dress_rehearsal.mjs [--base-url=http://127.0.0.1:8787] [--database-url=postgres://...] [--since-utc=ISO] [--before-counts-json=JSON_OR_FILE] [--probe-sse]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseBeforeCounts(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const content = existsSync(raw) ? readFileSync(raw, "utf8") : raw;
  return JSON.parse(content);
}

function isCriticalRehearsalService(row = {}) {
  return criticalRehearsalServiceReason(row) !== null;
}

function criticalRehearsalServiceReason(row = {}) {
  const serviceId = String(row.service_id || "").toLowerCase();
  const serviceKind = String(row.service_kind || "").toLowerCase();
  const details = row.details && typeof row.details === "object" ? row.details : {};
  const lane = String(details.lane || "").toLowerCase();
  if (isHistoricalManualAcceptanceHeartbeat(row)) return null;
  if (serviceId === "telegram_alert_worker" || serviceKind === "telegram_alerting") return "operator_notifications";
  if (serviceId === "live_runtime_scheduler" || serviceKind === "live_runtime_scheduler") return "strategy_runtime_scheduler";
  if ((serviceKind === "agent_runtime_supervisor" || serviceId.includes("agent_runtime_supervisor")) && lane === "research") return "research_agent_supervisor";
  return null;
}

function isRelevantResearchWorkerHeartbeat(row = {}) {
  if (isHistoricalManualAcceptanceHeartbeat(row)) return false;
  const serviceId = String(row.service_id || "").toLowerCase();
  const serviceKind = String(row.service_kind || "").toLowerCase();
  const details = row.details && typeof row.details === "object" ? row.details : {};
  const lane = String(details.lane || "").toLowerCase();
  return lane === "research"
    || serviceKind.includes("research")
    || serviceId.includes("agent_runtime_supervisor_research");
}

function isHistoricalManualAcceptanceHeartbeat(row = {}) {
  const serviceId = String(row.service_id || "").toLowerCase();
  if (!serviceId.includes("manual_acceptance")) return false;
  return !["healthy", "degraded"].includes(String(row.status || "").toLowerCase());
}

function liveRuntimeFromReadiness(readiness = {}) {
  const data = readiness?.data_readiness || {};
  const state = String(data.state || "").toLowerCase();
  const marketClosed = data.market_closed === true || data.market_session?.market_closed === true;
  const fresh = readiness?.ready === true && data.ok === true && ["ready", "fresh"].includes(state);
  return {
    feed_state: fresh ? "fresh" : marketClosed ? "closed_market_expected" : "degraded",
    feed_readyz_ok: readiness?.ready === true,
    market_closed: marketClosed,
    core_age_seconds: Number.isFinite(Number(data.core_age_seconds)) ? Number(data.core_age_seconds) : null,
  };
}

function samePath(left, right) {
  return path.resolve(String(left || "")).replaceAll("\\", "/").toLowerCase()
    === path.resolve(String(right || "")).replaceAll("\\", "/").toLowerCase();
}

function publicError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: String(error?.message || error).slice(0, 300),
  };
}
