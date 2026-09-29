import { requireFact } from "../domain/batch-contract.js";
import { validateSyntaxReceipt, verifyFrozen } from "../domain/evidence-contract.js";

export class PlanFreeze {
  constructor({ archive, scenarioBuilder, syntaxValidator, premarket, fingerprint, clock }) {
    Object.assign(this, { archive, scenarioBuilder, syntaxValidator, premarket, fingerprint, clock });
  }

  async receive(day, attempt) {
    const name = `evidence/candidate-${attempt}.json`;
    const existing = await this.archive.optionalJson(day, name);
    if (existing) return existing;
    const input = await this.premarket.verify(day);
    // Deliberate allowlist: no repository, output directory, runtime or result can enter this call.
    const response = await this.scenarioBuilder.request({ request_id: `${day.batch_id}:${day.date}:${attempt}`,
      manifest: input.manifest, manifest_sha256: input.manifest_sha256, images: input.images });
    if (response.status === "PENDING") return null;
    requireFact(response.status === "READY" && typeof response.plan_text === "string"
      && response.plan_text.length > 0 && response.plan_text.length <= 2_000_000
      && response.plan_text.isWellFormed(), "SCENARIO_RESPONSE_INVALID");
    requireFact(typeof response.generated_by === "string" && response.generated_by.length > 0
      && Number.isFinite(Date.parse(response.generated_at)), "SCENARIO_PROVENANCE_REQUIRED");
    const candidate = { plan_text: response.plan_text, generated_by: response.generated_by,
      generated_at: response.generated_at, received_at: this.clock(), premarket_manifest_sha256: input.manifest_sha256 };
    await this.archive.putJson(day, name, candidate);
    return candidate;
  }

  async freeze(day, attempt) {
    const candidate = await this.archive.readJson(day, `evidence/candidate-${attempt}.json`);
    const evidence = await this.premarket.verify(day);
    requireFact(evidence.manifest_sha256 === candidate.premarket_manifest_sha256, "PREMARKET_HASH_MISMATCH");
    const planHash = this.fingerprint(candidate.plan_text);
    const receipt = await this.syntaxValidator.validate({ plan_text: candidate.plan_text,
      date: day.date, symbol: day.symbol, schema: day.schema, engine_version: day.engine_version, plan_sha256: planHash });
    validateSyntaxReceipt(receipt, { ...day, plan_sha256: planHash });
    const existing = await this.archive.optionalJson(day, "plan/plan_meta.json");
    const meta = existing || { ...day, plan_id: `${day.batch_id}:${day.date}:${attempt}`, status: "FROZEN",
      generated_by: candidate.generated_by, generated_at: candidate.generated_at, frozen_at: this.clock(),
      plan_sha256: planHash, premarket_manifest_sha256: evidence.manifest_sha256 };
    verifyFrozen({ meta, day, planHash, manifestHash: evidence.manifest_sha256 });
    await this.archive.put(day, "plan/PLAN_SMC3.txt", candidate.plan_text);
    await this.archive.putJson(day, "plan/plan_meta.json", meta);
    return meta;
  }

  async verify(day) {
    const plan = await this.archive.read(day, "plan/PLAN_SMC3.txt");
    const meta = await this.archive.readJson(day, "plan/plan_meta.json");
    const evidence = await this.premarket.verify(day);
    verifyFrozen({ meta, day, planHash: this.fingerprint(plan), manifestHash: evidence.manifest_sha256 });
    return { plan_text: plan.toString("utf8"), meta };
  }
}
