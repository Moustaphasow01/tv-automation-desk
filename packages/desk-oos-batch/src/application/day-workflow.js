import { requireFact, STAGES, validateDay } from "../domain/batch-contract.js";
import { isUnscorableMarketGap } from "../domain/market-session-exhaustion.js";

export class OosDayWorkflow {
  constructor({ repository, premarket, freeze, replay, clock }) {
    Object.assign(this, { repository, premarket, freeze, replay, clock });
  }

  async execute(input, action = "run") {
    const day = validateDay(input);
    requireFact(["capture", "retry-capture", "scenario", "replay", "run", "retry", "new-plan"].includes(action), "ACTION_INVALID");
    return this.repository.withDayLock(day, async () => {
      let row = await this.repository.ensureDay(day);
      if (row.state === "COMPLETED") return row;
      row = await this.recover(row, action);
      if (action === "replay") requireFact(STAGES.indexOf(row.checkpoint) >= STAGES.indexOf("FROZEN"), "PLAN_NOT_FROZEN");
      const terminal = ["capture", "retry-capture"].includes(action) ? "PREMARKET_READY" : action === "scenario" || action === "new-plan" ? "FROZEN" : "COMPLETED";
      try {
        while (STAGES.indexOf(row.checkpoint) < STAGES.indexOf(terminal)) {
          const next = await this.advance(row);
          if (!next) break;
          row = next;
        }
      } catch (error) {
        row = await this.repository.get(day);
        const failed = error.code?.startsWith("PLAN_") && row.checkpoint === "VALIDATING_PLAN"
          ? "FAILED_PLAN_VALIDATION" : "FAILED_TECHNICAL";
        row = await this.repository.save(row, { state: failed, error: { code: error.code || "EXTERNAL_FAILURE", details: error.details || {} } }, this.clock());
      }
      return row;
    });
  }

  async recover(row, action) {
    if (row.state === "FAILED_PLAN_VALIDATION") {
      requireFact(action === "new-plan", "NEW_EXTERNAL_PLAN_REQUIRED");
      return this.repository.save(row, { state: "WAITING_SCENARIO", checkpoint: "WAITING_SCENARIO",
        candidate_attempt: row.candidate_attempt + 1, error: null }, this.clock());
    }
    if (row.state === "FAILED_TECHNICAL") {
      requireFact(["retry", "retry-capture"].includes(action), "TECHNICAL_RETRY_REQUIRED");
      if (action === "retry-capture") requireFact(STAGES.indexOf(row.checkpoint) <= STAGES.indexOf("PREMARKET_READY"), "CAPTURE_RETRY_SCOPE_REJECTED");
      // Repair the old combined replay/capture checkpoint from its immutable completion proof.
      const checkpoint = row.checkpoint === "REPLAYING" && await this.replay.completedReplay(row.definition)
        ? "CAPTURING_RESULTS" : row.checkpoint;
      return this.repository.save(row, { state: checkpoint, checkpoint, error: null }, this.clock());
    }
    requireFact(action !== "new-plan", "PLAN_REPLACEMENT_FORBIDDEN");
    return row;
  }

  async advance(row) {
    const day = row.definition;
    const state = row.checkpoint;
    let result = {};
    if (state === "CAPTURING") {
      const bundle = await this.repository.withChartLock(() => this.premarket.capture(day, async count => {
        if (count > row.capture_count) row = await this.repository.save(row, { capture_count: count }, this.clock());
      }));
      result = { manifest_sha256: bundle.manifest_sha256, capture_count: bundle.manifest.captures.length };
    }
    if (state === "WAITING_SCENARIO") {
      if (!await this.freeze.receive(day, row.candidate_attempt)) return null;
    }
    if (state === "VALIDATING_PLAN") result = { plan_sha256: (await this.freeze.freeze(day, row.candidate_attempt)).plan_sha256 };
    if (state === "REPLAYING") {
      const frozen = await this.freeze.verify(day);
      requireFact(frozen.meta.plan_sha256 === row.plan_sha256
        && frozen.meta.premarket_manifest_sha256 === row.manifest_sha256, "FROZEN_REGISTRY_MISMATCH");
      // Chart lock spans both replay and result capture, preventing another day moving the UI between them.
      result = await this.repository.withChartLock(async () => {
        const replay = await this.replay.replay(day);
        if (isUnscorableMarketGap(replay)) return this.repository.save(row, {
          state: "COMPLETED", checkpoint: "COMPLETED", ...replay, error: null }, this.clock());
        const capturing = await this.repository.save(row, {
          state: "CAPTURING_RESULTS", checkpoint: "CAPTURING_RESULTS" }, this.clock());
        return this.captureResults(capturing);
      });
      return result;
    }
    if (state === "CAPTURING_RESULTS") return this.repository.withChartLock(() => this.captureResults(row));
    const next = STAGES[STAGES.indexOf(state) + 1];
    return this.repository.save(row, { state: next, checkpoint: next, ...result }, this.clock());
  }

  async captureResults(row) {
    const frozen = await this.freeze.verify(row.definition);
    requireFact(frozen.meta.plan_sha256 === row.plan_sha256
      && frozen.meta.premarket_manifest_sha256 === row.manifest_sha256, "FROZEN_REGISTRY_MISMATCH");
    const result = await this.replay.results(row.definition);
    await this.replay.verifyResults(row.definition, result.run_meta);
    return this.repository.save(row, { state: "COMPLETED", checkpoint: "COMPLETED", ...result }, this.clock());
  }
}
