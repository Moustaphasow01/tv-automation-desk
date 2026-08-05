import { createHash } from "node:crypto";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { parisWallTimeIso } from "./live-scope.js";
import { deskError } from "./desk-errors.js";
import { normalizeDeskInstrumentScopes } from "./data-availability-policy.js";
import { isV5ReplayPackCoverageComplete } from "./v5-replay-data-profile.js";
import { GPT_MONITOR_CADENCE_VALUE } from "./desk-monitor-cadence.js";
import {
  DAILY_END_TIME,
  DAILY_PHASES,
  DAILY_RUN_SCOPE,
  DAILY_SCOPE_SESSION,
  DAILY_SCOPE_STRATEGY_ID,
  DAILY_START_TIME,
} from "./daily-run-model.js";

const COLLECTION = DESK_COLLECTIONS.deskReplayPreparationJobs;
const ACTIVE_STATUSES = new Set(["QUEUED", "DATA_CHECK", "PACK_BUILDING"]);
const PUBLISHABLE_STATUSES = new Set(["AWAITING_CONFIRMATION", "QUEUED_FOR_GPT"]);
const DEFAULT_LEASE_MS = 30 * 60_000;

export class ReplayPreparationService {
  constructor({ persistence, clock, host, leaseMs = DEFAULT_LEASE_MS }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
    this.leaseMs = Math.max(60_000, Number(leaseMs) || DEFAULT_LEASE_MS);
  }

  async create(args = {}) {
    const input = normalizePreparationInput(args);
    const preparationId = preparationDocumentId(input);
    const existing = await this.persistence.getDocument(COLLECTION, preparationId).catch(() => null);
    if (existing) {
      return {
        ok: true,
        status: "PREPARATION_QUEUED",
        count: 1,
        jobs: [projectPreparation(existing)],
      };
    }
    const preparations = await this.persistence.listDocuments(COLLECTION, 500).catch(() => []);
    const runNumber = Math.max(
      0,
      ...preparations
        .filter((item) => item.trading_date === input.trading_date)
        .map((item) => Number(item.run_number) || 0),
    ) + 1;
    const executionId = replayExecutionId(input);
    const aggregateEligible = !preparations.some((item) =>
      item.trading_date === input.trading_date && item.aggregate_eligible === true);
    const tick = this.clock.now();
    const job = {
      preparation_id: preparationId,
      schema_version: "2.0.0",
      status: "QUEUED",
      progress_percent: 5,
      trading_date: input.trading_date,
      session: DAILY_SCOPE_SESSION,
      run_scope: DAILY_RUN_SCOPE,
      phases: DAILY_PHASES,
      execution_id: executionId,
      run_family_id: `replayday__${input.trading_date}`,
      run_number: runNumber,
      aggregate_role: aggregateEligible ? "primary" : "comparison",
      aggregate_eligible: aggregateEligible,
      cadence: input.cadence,
      start_time: input.start_time,
      end_time: input.end_time,
      timezone: "Europe/Paris",
      worker_group: input.worker_group,
      priority: input.priority,
      instruments: input.instruments,
      trading_instruments: input.trading_instruments,
      context_instruments: input.context_instruments,
      idempotency_key: input.idempotency_key,
      request_hash: preparationRequestHash(input),
      source_evidence: input.source_evidence || null,
      pack_id: null,
      pack_build_id: null,
      config_id: replayConfigId(input.trading_date, executionId),
      backtest_id: replayBacktestId(input.trading_date, input.cadence, executionId),
      pack_reused: false,
      attempts: 0,
      lease_owner: null,
      lease_expires_at_utc: null,
      error: null,
      stages: [stage("QUEUED", tick, "Préparation journalière continue placée dans la file locale.")],
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    if (typeof this.persistence.createDocument === "function") {
      try {
        await this.persistence.createDocument(COLLECTION, preparationId, job);
      } catch (error) {
        if (error?.code !== "DOCUMENT_ALREADY_EXISTS") throw error;
      }
    } else {
      await this.persistence.setDocument(COLLECTION, preparationId, job);
    }
    const stored = await this.persistence.getDocument(COLLECTION, preparationId).catch(() => job);
    return {
      ok: true,
      status: "PREPARATION_QUEUED",
      count: 1,
      jobs: [projectPreparation(stored)],
    };
  }

  async list({ status, session, date, limit = 100 } = {}) {
    const jobs = await this.persistence.listDocuments(COLLECTION, Math.max(1, Math.min(Number(limit) || 100, 500))).catch(() => []);
    const items = jobs
      .filter((job) => !status || job.status === status)
      .filter((job) => !session || job.session === session)
      .filter((job) => !date || job.trading_date === date)
      .sort((left, right) => String(right.updated_at_utc || "").localeCompare(String(left.updated_at_utc || "")))
      .map(projectPreparation);
    return { ok: true, count: items.length, items };
  }

  async get({ preparation_id } = {}) {
    const job = await this.persistence.getDocument(COLLECTION, preparation_id).catch(() => null);
    if (!job) throw deskError("REPLAY_PREPARATION_NOT_FOUND", `Replay preparation not found: ${preparation_id}.`);
    return { ok: true, job: projectPreparation(job) };
  }

  async processNext({ worker_id = `replay-preparation-${process.pid}` } = {}) {
    const nowMs = Date.parse(this.clock.now().utc);
    const jobs = await this.persistence.listDocuments(COLLECTION, 500).catch(() => []);
    const candidate = jobs
      .filter((job) => job.status === "QUEUED" || (
        ["DATA_CHECK", "PACK_BUILDING"].includes(job.status)
        && Date.parse(job.lease_expires_at_utc || "") <= nowMs
      ))
      .sort((left, right) => String(left.created_at_utc || "").localeCompare(String(right.created_at_utc || "")))[0];
    if (!candidate) return { ok: true, status: "NO_PREPARATION_WORK" };
    const claimed = await this.#claim(candidate, worker_id);
    return this.process({ preparation_id: claimed.preparation_id, worker_id });
  }

  async process({ preparation_id, worker_id = `replay-preparation-${process.pid}` } = {}) {
    let job = await this.persistence.getDocument(COLLECTION, preparation_id).catch(() => null);
    if (!job) throw deskError("REPLAY_PREPARATION_NOT_FOUND", `Replay preparation not found: ${preparation_id}.`);
    if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status, job: projectPreparation(job) };
    if (job.lease_owner && job.lease_owner !== worker_id
      && Date.parse(job.lease_expires_at_utc || "") > Date.parse(this.clock.now().utc)) {
      return { ok: true, status: "PREPARATION_BUSY", job: projectPreparation(job) };
    }
    if (job.lease_owner !== worker_id) job = await this.#claim(job, worker_id);
    try {
      job = await this.#transition(job, "DATA_CHECK", 20, "Audit de la couverture PostgreSQL et des packs immuables.", worker_id);
      const reusable = await this.#findReusablePack(job);
      let pack;
      if (reusable) {
        pack = reusable;
      } else {
        job = await this.#transition(job, "PACK_BUILDING", 55, "Construction du pack replay_source immuable.", worker_id);
        pack = await this.host.buildAndPublishReplaySourcePack({
          date: job.trading_date,
          session: DAILY_SCOPE_SESSION,
          start_paris: job.start_time,
          cutoff_paris: job.end_time,
          pack_id: replayPackId(job),
          source_evidence: job.source_evidence || null,
        });
        pack = await this.host.getDeskPack({
          pack_id: pack.pack_id,
          pack_build_id: pack.pack_build_id,
          mode: "replay",
        });
      }
      assertPreparedPack(pack, job);
      const tick = this.clock.now();
      const ready = {
        ...job,
        status: "AWAITING_CONFIRMATION",
        progress_percent: 85,
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        pack_reused: Boolean(reusable),
        pack_quality: pack.quality || null,
        source_manifest_hash: pack.source_manifest_hash || null,
        source_coverage: pack.source_coverage || null,
        data_profile_id: pack.data_profile_id || null,
        data_profile_version: pack.data_profile_version || null,
        canonical_coverage_complete: pack.canonical_coverage_complete === true,
        requested_coverage: pack.requested_coverage || null,
        actual_coverage: pack.actual_coverage || null,
        source_evidence: pack.source_evidence || job.source_evidence || null,
        lease_owner: null,
        lease_expires_at_utc: null,
        error: null,
        stages: [
          ...(job.stages || []),
          stage("PACK_VALIDATED", tick, reusable ? "Pack immuable existant réutilisé." : "Nouveau pack immuable validé."),
          stage("AWAITING_CONFIRMATION", tick, "Prêt pour confirmation et publication dans la file GPT."),
        ],
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(COLLECTION, ready.preparation_id, ready);
      return { ok: true, status: ready.status, job: projectPreparation(ready) };
    } catch (error) {
      const tick = this.clock.now();
      const failed = {
        ...job,
        status: "FAILED",
        progress_percent: job.progress_percent || 20,
        error: {
          code: error?.code || "REPLAY_PREPARATION_FAILED",
          message: error?.message || String(error),
          details: error?.details || {},
        },
        lease_owner: null,
        lease_expires_at_utc: null,
        stages: [...(job.stages || []), stage("FAILED", tick, error?.message || String(error))],
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(COLLECTION, failed.preparation_id, failed);
      return { ok: false, status: "FAILED", job: projectPreparation(failed) };
    }
  }

  async action({ preparation_id, action, actor = {}, expected_error_code, reason } = {}) {
    const job = await this.persistence.getDocument(COLLECTION, preparation_id).catch(() => null);
    if (!job) throw deskError("REPLAY_PREPARATION_NOT_FOUND", `Replay preparation not found: ${preparation_id}.`);
    if (action === "publish") return this.#publish(job, actor);
    if (action === "retry") {
      if (job.status !== "FAILED" && job.status !== "CANCELLED") {
        throw deskError("REPLAY_PREPARATION_ACTION_INVALID", `Preparation ${preparation_id} cannot be retried from ${job.status}.`);
      }
      const expectedErrorCode = expected_error_code ? String(expected_error_code) : null;
      const previousError = job.error || null;
      if (expectedErrorCode && previousError?.code !== expectedErrorCode) {
        throw deskError(
          "REPLAY_PREPARATION_RETRY_STALE",
          `Preparation ${preparation_id} no longer has expected error ${expectedErrorCode}.`,
          { expected_error_code: expectedErrorCode, actual_error_code: previousError?.code || null },
        );
      }
      if (job.lease_owner && Date.parse(job.lease_expires_at_utc || "") > Date.parse(this.clock.now().utc)) {
        throw deskError(
          "REPLAY_PREPARATION_BUSY",
          `Preparation ${preparation_id} still has an active lease.`,
        );
      }
      const tick = this.clock.now();
      const queued = {
        ...job,
        status: "QUEUED",
        progress_percent: 5,
        retry_revision: Number(job.retry_revision || 0) + 1,
        retry_history: previousError
          ? [
              ...(job.retry_history || []),
              {
                error: previousError,
                retried_at_utc: tick.utc,
                retried_at_paris: tick.paris,
                actor: actor.email || actor.uid || actor.kind || "operator",
                reason: reason || "operator_retry",
              },
            ]
          : (job.retry_history || []),
        error: null,
        lease_owner: null,
        lease_expires_at_utc: null,
        stages: [
          ...(job.stages || []),
          stage(
            "QUEUED",
            tick,
            previousError?.code
              ? `Nouvelle tentative après réparation de ${previousError.code}.`
              : "Nouvelle tentative demandée par l’opérateur.",
          ),
        ],
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(COLLECTION, queued.preparation_id, queued);
      return { ok: true, status: queued.status, job: projectPreparation(queued) };
    }
    if (action === "cancel") {
      if (job.status === "QUEUED_FOR_GPT") {
        throw deskError("REPLAY_PREPARATION_ACTION_INVALID", "A published preparation must be paused from queue supervision.");
      }
      const tick = this.clock.now();
      const cancelled = {
        ...job,
        status: "CANCELLED",
        stages: [...(job.stages || []), stage("CANCELLED", tick, "Préparation annulée par l’opérateur.")],
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(COLLECTION, cancelled.preparation_id, cancelled);
      return { ok: true, status: cancelled.status, job: projectPreparation(cancelled) };
    }
    throw deskError("REPLAY_PREPARATION_ACTION_INVALID", `Unsupported replay preparation action: ${action}.`);
  }

  async #publish(job, actor) {
    if (!PUBLISHABLE_STATUSES.has(job.status)) {
      throw deskError("REPLAY_PREPARATION_ACTION_INVALID", `Preparation ${job.preparation_id} is not ready to publish.`);
    }
    if (job.status === "QUEUED_FOR_GPT") return { ok: true, status: job.status, job: projectPreparation(job) };
    const configResult = await this.host.upsertReplayAutopilotConfig({
      enabled: true,
      status: "READY",
      config_id: job.config_id,
      backtest_id: job.backtest_id,
      trading_date: job.trading_date,
      session: DAILY_SCOPE_SESSION,
      strategy_id: DAILY_SCOPE_STRATEGY_ID,
      run_scope: DAILY_RUN_SCOPE,
      phases: DAILY_PHASES,
      execution_id: job.execution_id,
      run_family_id: job.run_family_id,
      run_number: job.run_number,
      aggregate_role: job.aggregate_role,
      aggregate_eligible: job.aggregate_eligible,
      pack_id: job.pack_id,
      pack_build_id: job.pack_build_id,
      cutoff_paris: job.start_time,
      start_time: job.start_time,
      end_time: job.end_time,
      cadence: job.cadence,
      timezone: "Europe/Paris",
      instruments: job.instruments,
      trading_instruments: job.trading_instruments,
      context_instruments: job.context_instruments,
      source_evidence: job.source_evidence || null,
      risk_model: "front_configured_net_equity",
      worker_group: job.worker_group,
      priority: job.priority,
      max_transitions: 6,
      notes: `Prepared by ${job.preparation_id}`,
    });
    const tick = this.clock.now();
    const published = {
      ...job,
      status: "QUEUED_FOR_GPT",
      progress_percent: 100,
      config_id: configResult.config.config_id,
      backtest_id: configResult.config.backtest_id,
      published_by: actor.email || actor.uid || actor.kind || "operator",
      published_at_utc: tick.utc,
      stages: [
        ...(job.stages || []),
        stage("CONFIG_CREATED", tick, `Configuration ${configResult.config.config_id} créée.`),
        stage("QUEUED_FOR_GPT", tick, "Replay publié dans la file dédiée replay-v4."),
      ],
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    await this.persistence.setDocument(COLLECTION, published.preparation_id, published);
    return { ok: true, status: published.status, job: projectPreparation(published), config: configResult.config };
  }

  async #findReusablePack(job) {
    const packId = replayPackId(job);
    const pack = await this.host.getDeskPack({ pack_id: packId, mode: "replay" }).catch(() => null);
    if (!pack) return null;
    try {
      assertPreparedPack(pack, job);
      return pack;
    } catch {
      return null;
    }
  }

  async #claim(job, workerId) {
    const tick = this.clock.now();
    const recovered = job.status !== "QUEUED";
    const claimed = {
      ...job,
      status: recovered ? "QUEUED" : job.status,
      attempts: Number(job.attempts || 0) + 1,
      lease_owner: workerId,
      lease_expires_at_utc: new Date(Date.parse(tick.utc) + this.leaseMs).toISOString(),
      stages: recovered
        ? [...(job.stages || []), stage("RECOVERED", tick, `Bail expiré récupéré par ${workerId}.`)]
        : job.stages,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    await this.persistence.setDocument(COLLECTION, claimed.preparation_id, claimed);
    return claimed;
  }

  async #transition(job, status, progress, message, workerId) {
    const tick = this.clock.now();
    const next = {
      ...job,
      status,
      progress_percent: progress,
      lease_owner: workerId,
      lease_expires_at_utc: new Date(Date.parse(tick.utc) + this.leaseMs).toISOString(),
      stages: [...(job.stages || []), stage(status, tick, message)],
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    await this.persistence.setDocument(COLLECTION, next.preparation_id, next);
    return next;
  }
}

function normalizePreparationInput(args) {
  const tradingDate = String(args.trading_date || args.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
    throw deskError("INVALID_REPLAY_PREPARATION", `Invalid trading date: ${tradingDate || "missing"}.`);
  }
  const cadence = ["5m", "15m", "30m", "60m"].includes(args.cadence)
    ? args.cadence
    : GPT_MONITOR_CADENCE_VALUE;
  const instrumentScopes = normalizeDeskInstrumentScopes(args);
  const sourceEvidence = normalizeSourceEvidence(args.source_evidence);
  return {
    trading_date: tradingDate,
    session: DAILY_SCOPE_SESSION,
    run_scope: DAILY_RUN_SCOPE,
    cadence,
    start_time: args.start_time || parisWallTimeIso(tradingDate, DAILY_START_TIME),
    end_time: args.end_time || parisWallTimeIso(tradingDate, DAILY_END_TIME),
    worker_group: args.worker_group || "replay-v4",
    priority: Math.max(1, Math.min(Number(args.priority) || 100, 999)),
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    idempotency_key: String(args.idempotency_key || `replay-preparation:${tradingDate}:full-day:${cadence}`),
    ...(sourceEvidence ? { source_evidence: sourceEvidence } : {}),
  };
}

function preparationDocumentId(input) {
  return `replayprep__${createHash("sha256").update(preparationRequestHash(input)).digest("hex").slice(0, 24)}`;
}

function preparationRequestHash(input) {
  return JSON.stringify({
    trading_date: input.trading_date,
    session: input.session,
    cadence: input.cadence,
    start_time: input.start_time,
    end_time: input.end_time,
    worker_group: input.worker_group,
    idempotency_key: input.idempotency_key,
    ...(input.source_evidence ? { source_evidence_sha256: canonicalSha256(input.source_evidence) } : {}),
  });
}

function replayPackId(job) {
  return `${job.trading_date}_full_day_replay_source`;
}

function assertPreparedPack(pack, job) {
  if (!pack || pack.status !== "ready" || pack.execution_allowed === false) {
    throw deskError("REPLAY_PREPARATION_PACK_INVALID", "Replay source pack is not executable.");
  }
  if (pack.pack_purpose !== "replay_source" || pack.mode !== "replay") {
    throw deskError("REPLAY_PREPARATION_PACK_SCOPE_INVALID", "Pack is not an immutable replay_source build.");
  }
  if (pack.trading_date !== job.trading_date || pack.session !== DAILY_SCOPE_SESSION) {
    throw deskError("REPLAY_PREPARATION_PACK_SCOPE_INVALID", "Pack date/session does not match the requested replay.");
  }
  if (!isV5ReplayPackCoverageComplete(pack)) {
    throw deskError("REPLAY_PREPARATION_PACK_COVERAGE_INCOMPLETE", "Pack V5 canonical MNQ/MES M1/M5 coverage is incomplete.", {
      data_profile_id: pack.data_profile_id || null,
      data_profile_version: pack.data_profile_version || null,
      canonical_coverage_complete: pack.canonical_coverage_complete === true,
      requested_coverage: pack.requested_coverage || null,
      actual_coverage: pack.actual_coverage || null,
    });
  }
  const coverageStart = Date.parse(pack.source_coverage?.start_utc || "");
  const coverageEnd = Date.parse(pack.source_coverage?.end_utc || pack.cutoff_utc || "");
  if (!Number.isFinite(coverageStart) || !Number.isFinite(coverageEnd)
    || coverageStart > Date.parse(job.start_time) || coverageEnd < Date.parse(job.end_time)) {
    throw deskError("REPLAY_PREPARATION_PACK_COVERAGE_INVALID", "Pack does not cover the complete replay window.", {
      requested_start: job.start_time,
      requested_end: job.end_time,
      source_coverage: pack.source_coverage || null,
    });
  }
  if (!pack.source_manifest_hash || !pack.pack_build_id) {
    throw deskError("REPLAY_PREPARATION_PACK_MANIFEST_INVALID", "Pack build or immutable manifest is missing.");
  }
  if (["5m", "15m"].includes(job.cadence)) {
    const missingDatasets = ["MNQ_M1", "MES_M1"].filter((dataset) => !pack.datasets?.[dataset]);
    if (missingDatasets.length > 0) {
      throw deskError(
        "REPLAY_PREPARATION_M1_REQUIRED",
        "A hybrid GPT replay requires MNQ/MES M1 datasets for deterministic position management.",
        { missing_datasets: missingDatasets },
      );
    }
  }
  if (job.source_evidence) {
    const expectedHash = canonicalSha256(job.source_evidence);
    const mismatches = [];
    if (canonicalSha256(pack.source_evidence || null) !== expectedHash) {
      mismatches.push("source_evidence");
    }
    if (canonicalSha256(pack.resolved_scope?.source_evidence || null) !== expectedHash) {
      mismatches.push("resolved_scope.source_evidence");
    }
    for (const file of job.source_evidence.files || []) {
      const dataset = pack.datasets?.[file.dataset] || {};
      const expected = {
        source_import_id: job.source_evidence.import_id,
        source_import_manifest_sha256: job.source_evidence.manifest_sha256,
        source_capture_proof_sha256: job.source_evidence.capture_proof_sha256,
        source_capture_policy_version: job.source_evidence.capture_policy_version,
        source_file_sha256: file.sha256,
      };
      for (const [key, value] of Object.entries(expected)) {
        if (dataset[key] !== value) mismatches.push(`datasets.${file.dataset}.${key}`);
      }
    }
    if (mismatches.length) {
      throw deskError(
        "REPLAY_PREPARATION_PACK_SOURCE_EVIDENCE_MISMATCH",
        "Replay pack does not match the requested immutable source evidence.",
        { mismatches, expected_evidence_sha256: expectedHash },
      );
    }
  }
}

function stage(status, tick, message) {
  return { status, at_utc: tick.utc, at_paris: tick.paris, message };
}

function replayExecutionId(input) {
  return `replayexec__${input.trading_date}__${createHash("sha256")
    .update(`${input.idempotency_key}:${input.cadence}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function replayConfigId(tradingDate, executionId) {
  return `replay_autopilot__${tradingDate.replaceAll("-", "_")}__full_day__${executionId.slice(-12)}`;
}

function replayBacktestId(tradingDate, cadence, executionId) {
  return `replay_${tradingDate}_full_day_${cadence}_${executionId.slice(-12)}`;
}

function projectPreparation(job) {
  const instrumentScopes = normalizeDeskInstrumentScopes(job);
  return {
    preparation_id: job.preparation_id,
    status: job.status,
    progress_percent: Number(job.progress_percent || 0),
    trading_date: job.trading_date,
    session: job.session,
    run_scope: job.run_scope || (job.schema_version === "2.0.0" ? DAILY_RUN_SCOPE : "session"),
    phases: job.phases || [],
    execution_id: job.execution_id || null,
    run_family_id: job.run_family_id || null,
    run_number: Number(job.run_number || 1),
    aggregate_role: job.aggregate_role || "primary",
    aggregate_eligible: job.aggregate_eligible !== false,
    cadence: job.cadence,
    start_time: job.start_time,
    end_time: job.end_time,
    worker_group: job.worker_group,
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    pack_id: job.pack_id || null,
    pack_build_id: job.pack_build_id || null,
    pack_reused: job.pack_reused === true,
    attempts: Number(job.attempts || 0),
    retry_revision: Number(job.retry_revision || 0),
    retry_history: job.retry_history || [],
    lease_owner: job.lease_owner || null,
    lease_expires_at_utc: job.lease_expires_at_utc || null,
    config_id: job.config_id || null,
    backtest_id: job.backtest_id || null,
    pack_quality: job.pack_quality || null,
    source_coverage: job.source_coverage || null,
    data_profile_id: job.data_profile_id || null,
    data_profile_version: job.data_profile_version || null,
    canonical_coverage_complete: job.canonical_coverage_complete === true,
    requested_coverage: job.requested_coverage || null,
    actual_coverage: job.actual_coverage || null,
    source_evidence: job.source_evidence || null,
    error: job.error || null,
    stages: job.stages || [],
    created_at_utc: job.created_at_utc,
    updated_at_utc: job.updated_at_utc,
  };
}

function normalizeSourceEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}
