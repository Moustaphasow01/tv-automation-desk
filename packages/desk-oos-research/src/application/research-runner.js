import { requireResearch } from "../domain/research-evidence.js";

const ACTIVE = new Set(["OBSERVING", "DIAGNOSING", "CLUSTERING", "HYPOTHESIZING", "COUNTEREXAMPLES", "CRITIQUING"]);

/** Autonomous bounded research pass. No experiment execution, live mutation, or infinite retry loop. */
export class ResearchRunner {
  constructor({ api }) { this.api = api; }
  async run({ cycle_id, maximum_steps = 1000, maximum_cases = 1 }, onCheckpoint = async () => {}) {
    requireResearch(Number.isInteger(maximum_steps) && maximum_steps >= 1 && maximum_steps <= 10000,
      "RESEARCH_RUN_LIMIT_INVALID");
    for (let step = 0; step < maximum_steps; step++) {
      const before = await this.api.status({ cycle_id });
      if (!ACTIVE.has(before.status)) return { cycle_id, state: before.status, steps_advanced: step,
        action: "REVIEW_DOSSIER_NO_AUTO_PROMOTION" };
      try {
        const next = await this.api.advance({ cycle_id, maximum_cases });
        await onCheckpoint({ cycle_id, revision: next.revision, status: next.status });
      } catch (error) {
        return { cycle_id, state: "BLOCKED", steps_advanced: step, reason: error.code ?? "RESEARCH_STEP_FAILED",
          resume_checkpoint: (await this.api.status({ cycle_id })).status, automatic_paid_retry: false };
      }
    }
    return { cycle_id, state: "PAUSED_AT_TECHNICAL_BUDGET", steps_advanced: maximum_steps,
      resume_checkpoint: (await this.api.status({ cycle_id })).status };
  }
}
