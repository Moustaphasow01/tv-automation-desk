import { requireFact } from "../domain/batch-contract.js";
import { isDeepStrictEqual } from "node:util";

export class ReplayWorkflow {
  constructor({ archive, tradingView, freeze, fingerprint, decodeImage, clock }) {
    Object.assign(this, { archive, tradingView, freeze, fingerprint, decodeImage, clock });
  }

  async replay(day) {
    const frozen = await this.freeze.verify(day);
    const prior = await this.archive.optionalJson(day, "evidence/replay-completed.json");
    if (prior && await this.archive.optionalJson(day, "evidence/results.json")) {
      requireFact(prior.plan_sha256 === frozen.meta.plan_sha256, "REPLAY_HASH_MISMATCH");
      return prior;
    }
    await this.tradingView.prepareFrozenReplay({ ...day, ...frozen });
    const fingerprint = await this.tradingView.readPlanFingerprint(day);
    requireFact(fingerprint.plan_sha256 === frozen.meta.plan_sha256 && fingerprint.engine_version === day.engine_version
      && fingerprint.book_mode === day.book_mode && fingerprint.symbol === day.symbol
      && fingerprint.cutoff === day.cutoff, "LOADED_PLAN_MISMATCH");
    const end = `${day.date}T20:00:00+02:00`;
    const result = await this.tradingView.replayTo({ ...day, end, plan_sha256: frozen.meta.plan_sha256 });
    requireFact(result.replay === true && result.at === end && result.symbol === day.symbol
      && result.plan_sha256 === frozen.meta.plan_sha256, "REPLAY_COMPLETION_UNPROVEN");
    if (prior) return prior;
    const record = { ...result, completed_at: this.clock() };
    await this.archive.putJson(day, "evidence/replay-completed.json", record);
    return record;
  }

  async results(day) {
    const { meta } = await this.freeze.verify(day);
    const end = await this.archive.readJson(day, "evidence/replay-completed.json");
    const existing = await this.archive.optionalJson(day, "evidence/results.json");
    const result = existing || await this.tradingView.collectResults({ ...day, end: end.at, plan_sha256: meta.plan_sha256 });
    requireFact(result.plan_sha256 === meta.plan_sha256 && result.symbol === day.symbol
      && result.at === end.at && result.engine_version === day.engine_version
      && result.book_mode === day.book_mode, "RESULT_SCOPE_MISMATCH");
    requireFact(result.audit && typeof result.audit === "object" && !Array.isArray(result.audit), "AUDIT_REQUIRED");
    const names = ["dashboard_final.png", "5m_final.png", "15m_final.png"];
    for (const name of names) this.decodeImage(result.images?.[name]);
    if (!existing) await this.archive.putJson(day, "evidence/results.json", result);
    const artifacts = [];
    for (const name of names) artifacts.push(await this.archive.put(day, `replay/${name}`, this.decodeImage(result.images[name])));
    artifacts.push(await this.archive.putJson(day, "replay/audit.json", result.audit));
    if (typeof result.logs === "string") artifacts.push(await this.archive.put(day, "replay/logs.txt", result.logs));
    const runMeta = { ...day, plan_sha256: meta.plan_sha256, premarket_manifest_sha256: meta.premarket_manifest_sha256,
      completed_at: end.completed_at, replay_end: end.at, artifacts, audit_source: result.source ?? null };
    await this.archive.putJson(day, "replay/run_meta.json", runMeta);
    return { run_meta: runMeta, audit: result.audit };
  }

  async verifyResults(day, pinned) {
    const frozen = await this.freeze.verify(day);
    const meta = await this.archive.readJson(day, "replay/run_meta.json");
    requireFact(isDeepStrictEqual(meta, pinned)
      && meta.plan_sha256 === frozen.meta.plan_sha256, "RESULT_REGISTRY_MISMATCH");
    for (const artifact of meta.artifacts) {
      requireFact(this.fingerprint(await this.archive.read(day, artifact.path)) === artifact.sha256, "RESULT_HASH_MISMATCH");
    }
  }
}
