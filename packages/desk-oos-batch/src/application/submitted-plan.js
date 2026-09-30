import { requireFact } from "../domain/batch-contract.js";

/** External text is an opaque input. This use case never calls an analyst or a replay. */
export class SubmittedPlan {
  constructor({ repository, archive, premarket, freeze, fingerprint, clock }) {
    Object.assign(this, { repository, archive, premarket, freeze, fingerprint, clock });
  }

  async submit(day, text) {
    requireFact(typeof text === "string" && text.length > 0 && text.length <= 2_000_000
      && text.isWellFormed(), "PLAN_TEXT_INVALID");
    return this.repository.withDayLock(day, async () => {
      let row = await this.repository.get(day);
      if (row.plan_sha256) {
        requireFact(row.plan_sha256 === this.fingerprint(text), "FROZEN_PLAN_CONFLICT");
        return { accepted: true, ...(await this.freeze.verify(day)).meta };
      }
      requireFact(row.capture_count === 8 && row.manifest_sha256, "PREMARKET_NOT_READY");
      const bundle = await this.premarket.verify(day);
      requireFact(bundle.manifest_sha256 === row.manifest_sha256, "PREMARKET_HASH_MISMATCH");
      row = await this.storeCandidate(row, text, bundle.manifest_sha256);
      return this.validateAndFreeze(row);
    });
  }

  async storeCandidate(row, text, manifestHash) {
    const prior = await this.archive.optionalJson(row.definition, `evidence/candidate-${row.candidate_attempt}.json`);
    if (prior && prior.plan_text !== text) {
      requireFact(row.state === "FAILED_PLAN_VALIDATION", "PLAN_SUBMISSION_CONFLICT");
      row = await this.repository.save(row, { candidate_attempt: row.candidate_attempt + 1 }, this.clock());
    }
    if (!prior || prior.plan_text !== text) {
      const at = this.clock();
      await this.archive.putJson(row.definition, `evidence/candidate-${row.candidate_attempt}.json`, {
        plan_text: text, generated_by: "EXTERNAL_SCENARIO_BUILDER", generated_at: at,
        received_at: at, premarket_manifest_sha256: manifestHash,
      });
    }
    return this.repository.save(row, { state: "PLAN_RECEIVED", checkpoint: "PLAN_RECEIVED", error: null }, this.clock());
  }

  async validateAndFreeze(row) {
    row = await this.repository.save(row, { state: "VALIDATING_PLAN", checkpoint: "VALIDATING_PLAN" }, this.clock());
    try {
      const meta = await this.freeze.freeze(row.definition, row.candidate_attempt);
      await this.repository.save(row, { state: "FROZEN", checkpoint: "FROZEN", plan_sha256: meta.plan_sha256 }, this.clock());
      return { accepted: true, ...meta };
    } catch (error) {
      const code = error.code || "PLAN_VALIDATOR_UNAVAILABLE";
      await this.repository.save(row, { state: "FAILED_PLAN_VALIDATION", error: { code } }, this.clock());
      return { accepted: false, status: "FAILED_PLAN_VALIDATION", error: { code } };
    }
  }
}
