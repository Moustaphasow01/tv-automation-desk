import {
  ANALYTICAL_PHASE_CATALOG,
  completeAnalyticalPhase,
  createAnalyticalJourney,
  recordAnalyticalEvidence,
  startAnalyticalPhase,
} from "../../src/analytical-journey-api.js";

export const ANALYTICAL_TEST_CUTOFF = "2026-06-11T08:15:00.000Z";

export function analyticalDecisionFixture(overrides = {}) {
  return {
    decision_id: "decision-june11-0815",
    action: "WAIT",
    rationale: "The deterministic opportunity gate remains selective.",
    ...overrides,
  };
}

export function buildCompletedAnalyticalJourney({
  availabilityByPhase = {},
  decision = analyticalDecisionFixture(),
  journeyId = "analytical-journey-june11-0815",
  throughPhase = "CONCLUSION",
} = {}) {
  let journey = createAnalyticalJourney({
    journeyId,
    scope: "replay",
    workflow: "REPLAY_MASTER",
    cutoffUtc: ANALYTICAL_TEST_CUTOFF,
    identity: {
      backtest_id: "replay-2026-06-11-v5-1",
      work_item_id: "work-june11-master-001",
      bundle_id: "bundle-june11-0815",
      pack_build_id: "pack-build-june11",
    },
    createdAtUtc: "2026-08-02T10:00:00.000Z",
  });

  const endIndex = ANALYTICAL_PHASE_CATALOG.findIndex((entry) => entry.phase === throughPhase);
  if (endIndex < 0) throw new Error(`unknown analytical fixture phase: ${throughPhase}`);
  ANALYTICAL_PHASE_CATALOG.slice(0, endIndex + 1).forEach((definition, index) => {
    const timestamp = new Date(Date.parse("2026-08-02T10:00:01.000Z") + index * 3_000);
    journey = startAnalyticalPhase(journey, {
      phase: definition.phase,
      atUtc: timestamp.toISOString(),
    });
    const availability = availabilityByPhase[definition.phase] || "AVAILABLE";
    const evidence = {
      evidence_kind: definition.required_evidence_kinds[0],
      availability,
      source: {
        source_type: definition.phase === "CONCLUSION"
          ? "ANALYTICAL_OUTPUT"
          : "IMMUTABLE_BUNDLE_SECTION",
        source_id: `${definition.phase.toLowerCase()}-source`,
        source_version: "v1",
        source_ref: `bundle://bundle-june11-0815/${definition.phase.toLowerCase()}`,
      },
      effective_at_utc: ANALYTICAL_TEST_CUTOFF,
      metadata: {
        backend_scope: "replay",
        phase_ordinal: definition.ordinal,
      },
    };
    if (["AVAILABLE", "DEGRADED"].includes(availability)) {
      evidence.payload = definition.phase === "CONCLUSION"
        ? decision
        : {
            phase: definition.phase,
            facts: [`backend-fact-${definition.ordinal}`],
          };
    }
    if (availability !== "AVAILABLE") {
      evidence.reason_codes = [`${definition.phase}_${availability}`];
    }
    const recorded = recordAnalyticalEvidence(journey, {
      phase: definition.phase,
      evidence,
      atUtc: new Date(timestamp.getTime() + 1_000).toISOString(),
    });
    journey = completeAnalyticalPhase(recorded.journey, {
      phase: definition.phase,
      summary: `Phase ${definition.phase} completed from backend-issued evidence.`,
      atUtc: new Date(timestamp.getTime() + 2_000).toISOString(),
    });
  });
  return journey;
}
