import { createHash, randomUUID } from "node:crypto";
import { normalizeGptTelemetry } from "./gpt-telemetry.js";
import { deskDataAvailabilityWorkerRules } from "./data-availability-policy.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
  assertActiveStrategyContractContext,
  assertActiveStrategyRuntimePins,
  assertActiveStrategySaveTarget,
  isActiveStrategyRuntimePins,
} from "./strategy-runtime-versioning.js";

export const DESK_AGENT_WORK_ITEM_SCHEMA_VERSION = "1.0.0";
export const DESK_REPLAY_PROMPT_VERSION = "2.4.0";
export const DESK_WORK_READY_STATUSES = Object.freeze(["READY", "CLAIMED"]);
export const DESK_AGENT_WORKFLOWS = Object.freeze(["REPLAY_MASTER", "REPLAY_MONITOR"]);
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 20 * 60;
const MAX_CLAIM_LIFETIME_SECONDS = 45 * 60;
const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 15 * 60;

export function buildReplayAgentWorkItem({ run, step, bundle, tick }) {
  const bundleType = bundle.bundle_type;
  const workflow = bundleType === "master" ? "REPLAY_MASTER" : "REPLAY_MONITOR";
  const saveTarget = bundle.save_target || {};
  const suggested = saveTarget.suggested_payload || {};
  assertActiveStrategyRuntimePins(run, { operation: "build_replay_agent_work_item" });
  assertActiveStrategyContractContext(bundle.contract_context, {
    workflow,
    operation: "build_replay_agent_work_item",
  });
  assertActiveStrategySaveTarget(suggested, {
    workflow,
    mode: "replay",
    operation: "build_replay_agent_work_item",
  });
  const workItemId = replayWorkItemId(run.backtest_id, step.step_id, workflow);
  const base = {
    work_item_schema_version: DESK_AGENT_WORK_ITEM_SCHEMA_VERSION,
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    work_item_id: workItemId,
    automation_scope: "replay",
    workflow,
    priority: workflow === "REPLAY_MASTER" ? 100 : 200,
    status: "READY",
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    run_id: run.run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    session: run.session,
    step_id: step.step_id,
    sequence: step.sequence,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    as_of_utc: step.as_of_utc,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    bundle_id: bundle.bundle_id,
    bundle_type: bundleType,
    bundle_tool: bundleType === "master" ? "get_replay_master_bundle" : "get_replay_monitor_bundle",
    bundle_args: {
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      view: "compact",
      include_raw_refs: false,
    },
    save_tool: saveTarget.tool,
    save_target: suggested,
    expected_revision: suggested.expected_revision,
    idempotency_key: suggested.idempotency_key,
    contract_context: bundle.contract_context,
    runtime_versions: ACTIVE_STRATEGY_RUNTIME_VERSIONS,
    prompt_name: bundleType === "master" ? "DeskReplayMasterAgentPrompt" : "DeskReplayMonitorAgentPrompt",
    prompt_version: DESK_REPLAY_PROMPT_VERSION,
    attempt_count: 0,
    max_attempts: 3,
    claimed_by: null,
    lease_token: null,
    lease_expires_at_utc: null,
    claimed_at_paris: null,
    lease_expires_at_paris: null,
    last_error: null,
    completed_at_paris: null,
    completed_output_ref: null,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const promptText = buildDeskWorkPrompt(base);
  const promptHash = sha256(promptText);
  return {
    ...base,
    prompt_text: promptText,
    prompt_hash: promptHash,
    source_hash: sha256(JSON.stringify({
      work_item_schema_version: DESK_AGENT_WORK_ITEM_SCHEMA_VERSION,
      workflow,
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      bundle_id: bundle.bundle_id,
      bundle_source_hash: bundle.source_hash || null,
      save_tool: saveTarget.tool || null,
      expected_revision: suggested.expected_revision ?? null,
      prompt_version: DESK_REPLAY_PROMPT_VERSION,
      prompt_hash: promptHash,
      autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    })),
  };
}

export function preserveExistingWorkItem(existing, prepared) {
  if (!existing) return prepared;
  if (["CLAIMED", "COMPLETED"].includes(existing.status)) return existing;
  if (existing.status === "SUPERSEDED") return existing;
  if (existing.status === "PAUSED" && existing.pause_reason !== "source_pack_not_ready") return existing;
  if (["READY", "CLAIMED", "PAUSED", "COMPLETED", "FAILED", "SUPERSEDED"].includes(existing.status) && existing.source_hash && prepared.source_hash && existing.source_hash === prepared.source_hash) return existing;
  return prepared;
}

export function claimReplayWorkItem(item, { worker_id, lease_seconds = 720 }, tick) {
  if (!isClaimableWorkItem(item, tick)) throw workError("WORK_NOT_CLAIMABLE", "Desk work item is not claimable.");
  const leaseToken = randomUUID();
  const boundedLeaseSeconds = boundLeaseSeconds(lease_seconds);
  const leaseExpiresAt = new Date(tick.epochMs + boundedLeaseSeconds * 1000).toISOString();
  const leaseDeadlineAt = new Date(tick.epochMs + MAX_CLAIM_LIFETIME_SECONDS * 1000).toISOString();
  const claimed = {
    ...item,
    status: "CLAIMED",
    claimed_by: worker_id,
    worker_id,
    lease_token: leaseToken,
    claimed_at_utc: tick.utc,
    claimed_at_paris: tick.paris,
    lease_expires_at_utc: leaseExpiresAt,
    lease_expires_at_paris: leaseExpiresAt,
    lease_deadline_at_utc: leaseDeadlineAt,
    retry_after_utc: null,
    retry_after_paris: null,
    attempt_count: Number(item.attempt_count || 0) + 1,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const promptText = buildDeskWorkPrompt(claimed);
  const promptHash = sha256(promptText);
  const currentPrompt = {
    ...claimed,
    prompt_version: DESK_REPLAY_PROMPT_VERSION,
    prompt_text: promptText,
    prompt_hash: promptHash,
  };
  const executionPrompt = buildClaimedReplayPrompt(currentPrompt);
  return {
    ...currentPrompt,
    execution_prompt: executionPrompt,
    execution_prompt_hash: sha256(executionPrompt),
  };
}

export function heartbeatReplayWorkItem(item, { worker_id, lease_token, lease_seconds = 720 }, tick) {
  assertWorkLease(item, { worker_id, lease_token }, tick);
  const hardDeadline = Date.parse(item.lease_deadline_at_utc || "");
  if (!Number.isFinite(hardDeadline) || hardDeadline <= tick.epochMs) {
    throw workError("WORK_LEASE_MAX_DURATION", "Desk work lease reached its maximum lifetime.");
  }
  const requestedExpiry = tick.epochMs + boundLeaseSeconds(lease_seconds) * 1000;
  const leaseExpiresAt = new Date(Math.min(requestedExpiry, hardDeadline)).toISOString();
  return {
    ...item,
    lease_expires_at_utc: leaseExpiresAt,
    lease_expires_at_paris: leaseExpiresAt,
    heartbeat_at_utc: tick.utc,
    heartbeat_at_paris: tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function completeReplayWorkItem(item, { worker_id, lease_token, output_ref = null, telemetry = null }, tick, { allowMaterialized = false } = {}) {
  if (item.status === "COMPLETED") return item;
  if (!allowMaterialized) assertWorkLease(item, { worker_id, lease_token }, tick);
  const gptTelemetry = normalizeGptTelemetry(telemetry) || item.gpt_telemetry || null;
  return {
    ...item,
    status: "COMPLETED",
    completed_by: worker_id || item.claimed_by || "backend_reconciler",
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
    completed_output_ref: output_ref || item.completed_output_ref || null,
    gpt_telemetry: gptTelemetry,
    telemetry_recorded_at_utc: gptTelemetry ? tick.utc : item.telemetry_recorded_at_utc || null,
    retry_after_utc: null,
    retry_after_paris: null,
    lease_token: null,
    lease_expires_at_utc: null,
    lease_expires_at_paris: null,
    lease_deadline_at_utc: null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function failReplayWorkItem(item, { worker_id, lease_token, error_code, error_message, retryable = true }, tick) {
  assertWorkLease(item, { worker_id, lease_token }, tick, { allowExpired: true });
  const exhausted = Number(item.attempt_count || 0) >= Number(item.max_attempts || 3);
  const status = retryable && !exhausted ? "READY" : "FAILED";
  const retryAfter = status === "READY"
    ? new Date(tick.epochMs + retryDelayMs(item)).toISOString()
    : null;
  return {
    ...item,
    status,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    lease_expires_at_utc: null,
    lease_expires_at_paris: null,
    lease_deadline_at_utc: null,
    retry_after_utc: retryAfter,
    retry_after_paris: retryAfter,
    failure_count: Number(item.failure_count || 0) + 1,
    last_error: {
      code: error_code,
      message: error_message,
      retryable: Boolean(retryable),
      occurred_at_utc: tick.utc,
      occurred_at_paris: tick.paris,
    },
    ...(status === "FAILED" ? {
      failed_at_utc: tick.utc,
      failed_at_paris: tick.paris,
    } : {}),
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function pauseReplayWorkItem(item, tick, reason = "automation_paused") {
  if (["COMPLETED", "SUPERSEDED", "FAILED"].includes(item.status)) return item;
  return {
    ...item,
    status: "PAUSED",
    pause_reason: reason,
    lease_token: null,
    lease_expires_at_utc: null,
    lease_expires_at_paris: null,
    lease_deadline_at_utc: null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function resumeReplayWorkItem(item, tick) {
  if (item.status !== "PAUSED") return item;
  return {
    ...item,
    status: "READY",
    pause_reason: null,
    claimed_by: null,
    worker_id: null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function supersedeReplayWorkItem(item, tick, reason = "replay_state_advanced") {
  if (["COMPLETED", "SUPERSEDED"].includes(item.status)) return item;
  return {
    ...item,
    status: "SUPERSEDED",
    superseded_reason: reason,
    lease_token: null,
    lease_expires_at_utc: null,
    lease_expires_at_paris: null,
    lease_deadline_at_utc: null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function selectClaimableReplayWork(items, args, tick) {
  const workflows = new Set(args.workflows?.length ? args.workflows : DESK_AGENT_WORKFLOWS);
  return (items || [])
    .filter((item) => item.automation_scope === "replay")
    .filter((item) => workflows.has(item.workflow))
    .filter((item) => !args.backtest_id || item.backtest_id === args.backtest_id)
    .filter((item) => !args.automation_scope || item.automation_scope === args.automation_scope)
    .filter((item) => !args.trading_date || item.trading_date === args.trading_date)
    .filter((item) => !args.session || item.session === args.session)
    .filter((item) => isClaimableWorkItem(item, tick))
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999) ||
      String(left.created_at_utc || "").localeCompare(String(right.created_at_utc || "")));
}

export function selectVisibleDeskWork(items, args = {}) {
  const workflows = new Set(args.workflows?.length ? args.workflows : DESK_AGENT_WORKFLOWS);
  const visibleStatuses = args.include_terminal === true
    ? new Set(["READY", "CLAIMED", "FAILED"])
    : new Set(["READY", "CLAIMED"]);
  return (items || [])
    .filter((item) => item.automation_scope === "replay")
    .filter((item) => workflows.has(item.workflow))
    .filter((item) => !args.backtest_id || item.backtest_id === args.backtest_id)
    .filter((item) => !args.automation_scope || item.automation_scope === args.automation_scope)
    .filter((item) => !args.trading_date || item.trading_date === args.trading_date)
    .filter((item) => !args.session || item.session === args.session)
    .filter((item) => visibleStatuses.has(item.status))
    .sort((left, right) => workStatusPriority(left.status) - workStatusPriority(right.status)
      || Number(left.priority || 999) - Number(right.priority || 999)
      || String(left.created_at_utc || "").localeCompare(String(right.created_at_utc || "")));
}

export function isClaimableWorkItem(item, tick) {
  if (item.automation_scope !== "replay" || !DESK_AGENT_WORKFLOWS.includes(item.workflow)) return false;
  if (!isActiveReplayWorkItem(item)) return false;
  const retryAfter = Date.parse(item.retry_after_utc || item.retry_after_paris || "");
  if (Number.isFinite(retryAfter) && retryAfter > tick.epochMs) return false;
  if (item.status === "READY") {
    return Number(item.attempt_count || 0) < Number(item.max_attempts || 3);
  }
  if (item.status !== "CLAIMED") return false;
  const expiry = Date.parse(item.lease_expires_at_utc || item.lease_expires_at_paris || "");
  if (!Number.isFinite(expiry) || expiry > tick.epochMs) return false;
  return Number(item.attempt_count || 0) < Number(item.max_attempts || 3);
}

export function replayWorkMatchesRun(item, run) {
  if (!run || run.backtest_id !== item.backtest_id || run.automation_enabled !== true) return false;
  if (!isActiveReplayWorkItem(item)
    || !isActiveStrategyRuntimePins(run, { operation: "match_replay_work_run" })) {
    return false;
  }
  if (run.current_step_id !== item.step_id) return false;
  if (item.workflow === "REPLAY_MASTER") return run.status === "WAITING_GPT_MASTER";
  if (item.workflow === "REPLAY_MONITOR") return run.status === "WAITING_GPT_MONITOR";
  return false;
}

export function replayWorkOutputMaterialized(item, run) {
  if (!run || Number(run.revision || 0) <= Number(item.expected_revision || 0)) return false;
  if (item.workflow === "REPLAY_MASTER") return Boolean(run.linked_master_analysis_id);
  if (item.workflow === "REPLAY_MONITOR") return Boolean(run.latest_monitor_id);
  return false;
}

export function assertReplayWorkForSave(item, args, workflow, tick) {
  if (!item) throw workError("WORK_NOT_FOUND", "Desk work item was not found.");
  if (!isActiveReplayWorkItem(item)) {
    throw workError(
      "HISTORICAL_STRATEGY_WORK_READ_ONLY",
      "Historical strategy work items remain readable but cannot be saved or completed by the active runtime.",
    );
  }
  if (item.workflow !== workflow) throw workError("WORKFLOW_MISMATCH", "Desk work item does not match the save workflow.");
  if (item.backtest_id !== args.backtest_id || item.step_id !== args.step_id) {
    throw workError("WORK_SCOPE_MISMATCH", "Desk work item does not match the replay save scope.");
  }
  if (item.status === "COMPLETED" && item.idempotency_key === args.idempotency_key) return true;
  assertWorkLease(item, args, tick);
  return true;
}

export function assertWorkLease(item, { worker_id, lease_token }, tick, { allowExpired = false } = {}) {
  if (item.status !== "CLAIMED") throw workError("WORK_NOT_CLAIMED", "Desk work item is not claimed.");
  if (!worker_id || item.claimed_by !== worker_id) throw workError("WORKER_MISMATCH", "Desk work item belongs to another worker.");
  if (!lease_token || item.lease_token !== lease_token) throw workError("LEASE_TOKEN_MISMATCH", "Desk work lease token is invalid.");
  const expiry = Date.parse(item.lease_expires_at_utc || item.lease_expires_at_paris || "");
  if (!allowExpired && (!Number.isFinite(expiry) || expiry <= tick.epochMs)) {
    throw workError("WORK_LEASE_EXPIRED", "Desk work lease has expired.");
  }
}

export function replayWorkEvent(item, eventType, tick, details = {}) {
  return {
    event_id: `${item.work_item_id}__${eventType.toLowerCase()}__${tick.epochMs}`,
    work_item_id: item.work_item_id,
    backtest_id: item.backtest_id,
    step_id: item.step_id,
    workflow: item.workflow,
    automation_scope: item.automation_scope,
    strategy_id: item.strategy_id,
    trading_date: item.trading_date,
    session: item.session,
    run_id: item.run_id,
    cutoff_paris: item.cutoff_paris,
    event_type: eventType,
    status: item.status,
    attempt_count: item.attempt_count,
    failure_count: item.failure_count || 0,
    retry_after_utc: item.retry_after_utc || null,
    worker_id: details.worker_id || item.claimed_by || null,
    details,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

function workStatusPriority(status) {
  if (status === "CLAIMED") return 0;
  if (status === "READY") return 1;
  if (status === "FAILED") return 2;
  return 3;
}

function boundLeaseSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 720;
  return Math.max(MIN_LEASE_SECONDS, Math.min(Math.floor(parsed), MAX_LEASE_SECONDS));
}

function retryDelayMs(item) {
  const failureNumber = Number(item.failure_count || 0);
  const exponentialSeconds = Math.min(
    RETRY_MAX_SECONDS,
    RETRY_BASE_SECONDS * (2 ** Math.min(failureNumber, 8)),
  );
  const digest = createHash("sha256")
    .update(`${item.work_item_id || "work"}:${failureNumber + 1}`)
    .digest();
  const jitterRatio = digest.readUInt16BE(0) / 65_535 * 0.2;
  return Math.round(exponentialSeconds * (1 + jitterRatio) * 1000);
}

export function replayWorkItemId(backtestId, stepId, workflow) {
  return `deskwork__${sanitize(backtestId)}__${sanitize(stepId)}__${String(workflow).toLowerCase()}`;
}

function buildDeskWorkPrompt(item) {
  const contract = item.contract_context || {};
  const nativeV5 = (item.workflow === "REPLAY_MASTER"
      && String(contract.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract)
    || (item.workflow === "REPLAY_MONITOR"
      && String(contract.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract);
  return [
    "Tu executes un travail automatise du Desk Futures en mode replay GPT-in-the-loop.",
    "Le backend est l'unique source de continuite, de scope, de revision et d'idempotence.",
    "N'invente aucun identifiant et n'utilise jamais de donnees live.",
    "Ne suspends jamais et ne desactive jamais la tache recurrente ChatGPT; rapporte seulement le statut final du cycle.",
    "",
    `Workflow: ${item.workflow}`,
    `Work item: ${item.work_item_id}`,
    `Backtest: ${item.backtest_id}`,
    `Etape: ${item.step_id}`,
    `Cutoff Paris: ${item.cutoff_paris}`,
    `Bundle tool: ${item.bundle_tool}`,
    `Save tool: ${item.save_tool}`,
    `Contrat: ${contract.contract_name || "inconnu"} v${contract.schema_version || "inconnue"}`,
    `Contract hash: ${contract.contract_hash || "inconnu"}`,
    `Pack build: ${item.pack_build_id}`,
    "",
    "Sequence obligatoire:",
    "1. Appelle get_active_contracts avec view=summary.",
    `2. Appelle get_contract pour ${contract.contract_name || "le contrat du bundle"} v${contract.schema_version || "la version du bundle"}.`,
    `3. Appelle ${item.bundle_tool} avec exactement bundle_args, en vue compacte et sans refs raw.`,
    "4. Verifie contract_context, pack_build_id, source coverage, data_quality et anti-lookahead.",
    "5. Utilise uniquement les lectures replay-scoped du manifest si un approfondissement est necessaire.",
    "6. Pars exclusivement de bundle.save_target.suggested_payload pour construire la sauvegarde.",
    `7. Complete l'analyse conforme au contrat puis appelle ${item.save_tool} directement par MCP.`,
    "8. Ajoute au save work_item_id, worker_id et lease_token retournes par claim_next_replay_work.",
    "9. Apres le save reussi, appelle complete_replay avec les memes work_item_id, worker_id et lease_token.",
    "10. En cas d'echec, appelle fail_replay avec un code structure et termine.",
    "",
    "Regles de donnees:",
    ...deskDataAvailabilityWorkerRules(),
    "- Un gap technologique est non applicable avant la premiere cotation courante.",
    "- Le VIX cash ferme ne bloque pas seul l'analyse.",
    "- Aucun JSON ne doit etre rendu a l'operateur pour etre copie dans le front.",
    "- Ne suspends jamais et ne desactive jamais la tache recurrente ChatGPT: si le backend attend GPT, termine le tour apres avoir indique le prochain appel MCP exact.",
    "",
    ...(nativeV5 ? [
      "Contrat d'execution actif Master V5.4 / Monitor V2.4, Plan V1.4, Command V1.4, Policy V4.3 et Catalog V1.2:",
      "- LIVE et REPLAY utilisent exactement contrats, compilateur, predicates, gates, machines d'etat et outcome. Seule l'acquisition temporelle differe; aucun fallback LIVE n'est autorise.",
      "- Profil OPPORTUNITY_SEEKING_CONTROLLED: recherche zero a cinq candidats distincts rank 1..5; seuil contextuel 0.55; une confirmation facultative absente reste soft et ne suffit pas a produire WAIT_NO_SETUP.",
      "- La tolerance ne change pas le risque: risk_pct_requested>0 et <=0.25% de NET_EQUITY, stop obligatoire, RR recalcule>=2. Le broker seul calcule les contrats entiers par ceil et bloque si rounding_excess_percent depasse max_rounding_excess_pct.",
      "- GPT ne produit jamais ENGINE_TRIGGER, TRIGGERED, CLOSED, fill, position, quantite, ordre broker, resultat R, hash compile ni diagnostics. Le moteur rejoue chaque bougie M1 fermee entre les checkpoints GPT M15 et les checkpoints critiques explicites.",
      "- Tout setup contient setup_id epingle, rank, requested_state, pattern, instrument, direction, order_type, entry_mode, entry.price ou entry.zone_lower+zone_upper, stop.type+price, toutes les targets action+close_fraction (PARTIAL_CLOSE strictement entre 0 et 1 ; FULL_CLOSE toujours égal à 1 car il ferme tout le reliquat), rr_expected, conditions, management, validity, rationale et evidence_refs.",
      "- Chaque condition utilise exclusivement les enums Catalog V1.2 et fournit tous les parameters, temporal_rule, weight, sequence et evidence_refs. Une phrase libre n'est jamais executable.",
      "- VETO temporaire (EVENT_BLACKOUT, TIME_WINDOW, intermarket, volatilite) utilise BLOCK_IF_TRUE, required_for_trigger=false, weight=0, memory_policy=LATEST_ONLY; il se leve quand faux puis exige une confirmation M1 fraiche.",
      "- INVALIDATION est reservee a une rupture structurelle explicite avec INVALIDATE_TERMINAL. LATCH_UNTIL_TRIGGER est interdit a tout BLOCK_IF_TRUE; MANDATORY d'activation/confirmation utilise REQUIRE_TRUE.",
      "- Les gates sont phasees. EVENT_BLACKOUT requis indeterminable reste UNKNOWN et bloque seulement ENTRY_TRIGGER; les donnees contextuelles facultatives absentes restent soft.",
      "- La confirmation ne peut pas entrer same-bar. NEXT_BAR attend une M1 fermee ulterieure; toute reacquisition apres sortie de zone est reevaluee par les predicates machine.",
      "- Aucun effet soft n'est cache: REQUIRE_CONFIRMATION exige une condition Catalog V1.2 explicite; REDUCE_RISK exige un nouveau plan avec risk.risk_pct_requested abaisse avant compilation, sinon il reste advisory et jamais veto.",
      "- WAIT_NO_SETUP exige best_long, best_short, blocking_reasons, wait_to_go_conditions structurees et revalidation_triggers.",
      "- Recopie exactement plan_id, analysis/monitor/thesis/setup/command IDs, expected_revision et idempotency. expected_revision est un compare-and-swap: ne l'incremente et ne le devine jamais.",
      ...(item.workflow === "REPLAY_MONITOR" ? [
        "- monitor_output.command est l'unique Command V1.4; NO_ACTION met les quatre branches a null.",
        "- UPSERT_CANDIDATE, PRE_ARM, ARM et REPLACE exigent setup_transition.setup complet. CANCEL/EXPIRE/INVALIDATE ciblent l'identite existante; REPLACE utilise une nouvelle identite distincte.",
        "- Toute management_request reste GPT_REQUEST_ONLY et le backend valide l'etat de position.",
      ] : [
        "- analysis_output.execution_plan et active_thesis sont complets; active_thesis.plan_id egale execution_plan.plan_id et selected_hypothesis_id appartient aux hypotheses.",
        "- Un candidat secondaire incomplet est omis plutot que de faire echouer un candidat principal valide; scope, identite et anti-lookahead restent atomiques.",
      ]),
    ] : [
      "Contrat d'execution legacy epingle:",
      "- Respecte strictement son schema sans conversion implicite vers V5/V2.",
      "- GPT ne confirme jamais TRIGGERED, CLOSED, fill, position ou resultat R; le backend reste autorite d'execution.",
    ]),
  ].join("\n");
}

function isActiveReplayWorkItem(item = {}) {
  if (!isActiveStrategyRuntimePins(item, { operation: "replay_work_item" })) return false;
  try {
    assertActiveStrategyContractContext(item.contract_context, {
      workflow: item.workflow,
      operation: "replay_work_item",
    });
    assertActiveStrategySaveTarget(item.save_target, {
      workflow: item.workflow,
      mode: "replay",
      operation: "replay_work_item",
    });
    return true;
  } catch {
    return false;
  }
}

function buildClaimedReplayPrompt(item) {
  return [
    item.prompt_text,
    "",
    "Attribution active:",
    `- work_item_id: ${item.work_item_id}`,
    `- worker_id: ${item.claimed_by}`,
    `- lease_token: ${item.lease_token}`,
    `- lease_expires_at_utc: ${item.lease_expires_at_utc}`,
    ...(item.expected_revision === null ? [] : [`- expected_revision: ${item.expected_revision}`]),
    `- idempotency_key: ${item.idempotency_key}`,
    ...(item.partial_output_ref ? [
      `- partial_output_ref: ${JSON.stringify(item.partial_output_ref)}`,
      "- Une sortie partielle existe deja: verifie-la par MCP et reprends uniquement les saves contractuels restants.",
    ] : []),
    "- Si le bail risque d'expirer avant le save, appelle heartbeat_replay.",
  ].join("\n");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sanitize(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
}

function workError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
