import { requireFact } from "../domain/batch-contract.js";
import { isDeepStrictEqual } from "node:util";
import { REPLAY_IMAGES, validatePublishedResult, validateArtifactList, validateAuditPresentation, validatePanelPresentation } from "../domain/replay-artifacts.js";
import { SESSION_COVERAGE_PATH, proveMarketSessionExhaustion, frozenPlanHasMatchingGap, unscorableSessionReceipt } from "../domain/market-session-exhaustion.js";

export class ReplayWorkflow {
  constructor({ archive, tradingView, freeze, fingerprint, decodeImage, clock, progress }) {
    Object.assign(this, { archive, tradingView, freeze, fingerprint, decodeImage, clock, progress });
  }

  async replay(day) {
    const frozen = await this.freeze.verify(day);
    const coverage = await this.archive.optionalJson(day, SESSION_COVERAGE_PATH);
    if (coverage) return { run_meta: await this.verifySessionCoverage(day), audit: null };
    const prior = await this.completedReplay(day);
    if (prior) return prior;
    const progress = await this.progress?.read(day, frozen.meta.plan_sha256);
    const onProgress = value => this.progress?.save(day, frozen.meta.plan_sha256, value);
    return this.runFrozenReplay({ day, frozen, progress, onProgress });
  }

  async runFrozenReplay({ day, frozen, progress, onProgress }) {
    await this.tradingView.prepareFrozenReplay({ ...day, ...frozen, progress, onProgress });
    const fingerprint = await this.tradingView.readPlanFingerprint(day);
    requireFact(fingerprint.plan_sha256 === frozen.meta.plan_sha256 && fingerprint.engine_version === day.engine_version
      && fingerprint.book_mode === day.book_mode && fingerprint.symbol === day.symbol
      && fingerprint.cutoff === day.cutoff, "LOADED_PLAN_MISMATCH");
    const end = `${day.date}T20:00:00+02:00`;
    let result;
    try { result = await this.tradingView.replayTo({ ...day, end, plan_sha256: frozen.meta.plan_sha256 }); }
    catch (error) {
      if (error.code !== "TV_REPLAY_SESSION_BAR_UNAVAILABLE") throw error;
      return this.completeUnscorableSession({ day, frozen, details: error.details });
    }
    const ended = result.at === end || result.session_end === end && Date.parse(result.at) > Date.parse(end);
    requireFact(result.replay === true && ended && result.symbol === day.symbol
      && result.plan_sha256 === frozen.meta.plan_sha256, "REPLAY_COMPLETION_UNPROVEN");
    const record = { ...result, completed_at: this.clock() };
    await this.archive.putJson(day, "evidence/replay-completed.json", record);
    return record;
  }

  async completeUnscorableSession({ day, frozen, details }) {
    const coverage = proveMarketSessionExhaustion({ day, meta: frozen.meta, details });
    requireFact(!frozenPlanHasMatchingGap(frozen.plan_text, coverage), "DECLARED_MARKET_GAP_ENGINE_AUDIT_REQUIRED", coverage);
    const receipt = unscorableSessionReceipt({ day, meta: frozen.meta, coverage, completedAt: this.clock() });
    await this.archive.putJson(day, SESSION_COVERAGE_PATH, receipt);
    return { run_meta: await this.verifySessionCoverage(day), audit: null };
  }

  async verifySessionCoverage(day, pinned) {
    const frozen = await this.freeze.verify(day);
    const bytes = await this.archive.read(day, SESSION_COVERAGE_PATH), receipt = JSON.parse(bytes.toString("utf8"));
    requireFact(receipt.plan_sha256 === frozen.meta.plan_sha256
      && receipt.premarket_manifest_sha256 === frozen.meta.premarket_manifest_sha256
      && receipt.source === "NATIVE_MARKET_SESSION_COVERAGE" && receipt.scorable === false
      && receipt.reason === "UNDECLARED_MARKET_SESSION_GAP" && receipt.recalculated === false, "SESSION_COVERAGE_RECEIPT_INVALID");
    const coverage = proveMarketSessionExhaustion({ day, meta: frozen.meta, details: {
      stage: "REPLAYING", timeframe: "15", native_gap: receipt.native_gap,
      observed_bar_open: receipt.native_gap.previous_confirmed_bar,
      observed_bar_close: receipt.last_native_bar_close, last_confirmed_bar_time: receipt.native_gap.previous_confirmed_bar,
      tv_replay_state: { immutable_scope: receipt.immutable_scope } } });
    requireFact(!frozenPlanHasMatchingGap(frozen.plan_text, coverage)
      && isDeepStrictEqual(receipt, unscorableSessionReceipt({ day, meta: frozen.meta, coverage, completedAt: receipt.completed_at })), "SESSION_COVERAGE_RECEIPT_INVALID");
    const meta = { ...receipt, coverage_receipt: { path: SESSION_COVERAGE_PATH, sha256: this.fingerprint(bytes) } };
    requireFact(!pinned || isDeepStrictEqual(meta, pinned), "SESSION_COVERAGE_REGISTRY_MISMATCH");
    return meta;
  }

  async completedReplay(day) {
    const prior = await this.archive.optionalJson(day, "evidence/replay-completed.json");
    if (!prior) return null;
    const frozen = await this.freeze.verify(day), end = `${day.date}T20:00:00+02:00`;
    requireFact(prior.plan_sha256 === frozen.meta.plan_sha256, "REPLAY_HASH_MISMATCH");
    requireFact(prior.replay === true && prior.symbol === day.symbol
      && (prior.at === end || prior.session_end === end && Date.parse(prior.at) > Date.parse(end)), "REPLAY_COMPLETION_UNPROVEN");
    return prior;
  }

  async results(day) {
    const frozen = await this.freeze.verify(day), { meta } = frozen;
    const end = await this.completedReplay(day);
    requireFact(end, "REPLAY_COMPLETION_UNPROVEN");
    const existing = await this.archive.optionalJson(day, "evidence/results.json");
    const result = existing || await this.collectResults({ day, frozen, end });
    validatePublishedResult(result, { ...day, plan_sha256: meta.plan_sha256, at: end.at });
    const names = [...REPLAY_IMAGES, ...(result.positions_distinct ? ["positions_final.png"] : [])];
    for (const name of names) this.decodeImage(result.images?.[name]);
    if (!existing) await this.archive.putJson(day, "evidence/results.json", result);
    const artifacts = [];
    for (const name of names) artifacts.push(await this.archive.put(day, `replay/${name}`, this.decodeImage(result.images[name])));
    artifacts.push(await this.archive.putJson(day, "replay/audit.json", result.audit));
    if (typeof result.logs === "string") artifacts.push(await this.archive.put(day, "replay/logs.txt", result.logs));
    const runMeta = resultMetadata({ day, meta, end, result, artifacts });
    const metaArtifact = await this.archive.putJson(day, "replay/run_meta.json", runMeta);
    // The run_meta file cannot contain its own SHA. Pin its bytes in a separate immutable receipt.
    const integrity = { schema_version: "oos-result-integrity/1", plan_sha256: meta.plan_sha256, artifacts: [...artifacts, metaArtifact] };
    validateArtifactList(integrity.artifacts, runMeta);
    await this.archive.putJson(day, "evidence/result-integrity.json", integrity);
    return { run_meta: runMeta, audit: result.audit };
  }

  async collectResults({ day, frozen, end }) {
    const progress = await this.progress?.read(day, frozen.meta.plan_sha256);
    await this.tradingView.resumeResultCapture({ ...day, ...frozen, completed_replay: end, progress });
    try {
      return await this.tradingView.collectResults({ ...day, end: end.at, plan_sha256: frozen.meta.plan_sha256 });
    } catch (error) {
      if (error.diagnostic_image_base64) {
        const bytes = this.decodeImage(error.diagnostic_image_base64);
        const artifact = await this.archive.put(day, `evidence/panel-failure-${this.fingerprint(bytes).slice(0, 20)}.png`, bytes);
        delete error.diagnostic_image_base64;
        error.details = { ...error.details, debug_artifact: artifact };
      }
      throw error;
    }
  }

  async verifyResults(day, pinned) {
    const frozen = await this.freeze.verify(day);
    const meta = await this.archive.readJson(day, "replay/run_meta.json");
    requireFact(isDeepStrictEqual(meta, pinned)
      && meta.plan_sha256 === frozen.meta.plan_sha256, "RESULT_REGISTRY_MISMATCH");
    validateAuditPresentation(meta.capture_provenance?.["dashboard_final.png"]?.presentation);
    if (meta.positions_distinct) validatePanelPresentation(meta.capture_provenance?.["positions_final.png"]?.presentation, "POSITIONS");
    const integrity = await this.archive.readJson(day, "evidence/result-integrity.json");
    requireFact(integrity.plan_sha256 === meta.plan_sha256, "RESULT_INTEGRITY_SCOPE_MISMATCH");
    validateArtifactList(integrity.artifacts, meta);
    requireFact(isDeepStrictEqual(integrity.artifacts.filter(x => x.path !== "replay/run_meta.json"), meta.artifacts), "RESULT_ARTIFACT_REGISTRY_MISMATCH");
    for (const artifact of integrity.artifacts) {
      requireFact(this.fingerprint(await this.archive.read(day, artifact.path)) === artifact.sha256, "RESULT_HASH_MISMATCH");
    }
    return integrity;
  }
}

function resultMetadata({ day, meta, end, result, artifacts }) {
  return { ...day, plan_sha256: meta.plan_sha256, premarket_manifest_sha256: meta.premarket_manifest_sha256,
    completed_at: end.completed_at, replay_end: end.at, artifacts, audit_source: result.source ?? null,
    capture_provenance: result.capture_provenance, positions_distinct: result.positions_distinct,
    logs_accessible: result.logs_accessible, config_hash: result.config_hash ?? null,
    execution_timeframe: end.execution_timeframe ?? null, session_end: end.session_end ?? end.at };
}
