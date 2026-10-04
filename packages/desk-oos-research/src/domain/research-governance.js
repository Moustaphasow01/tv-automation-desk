import { requireResearch } from "./research-evidence.js";

const PROPOSAL_FIELDS = ["description", "target_component", "mechanism", "feature_rule", "outcome_rule",
  "testable_change", "expected_benefit", "expected_risk", "winner_risk"];
export function validateProposalFields(proposal) {
  requireResearch(proposal && Object.keys(proposal).every(k => PROPOSAL_FIELDS.includes(k)), "RESEARCH_OUTPUT_FIELDS_INVALID");
}

export function validateResearchSplit({ discovery, validation, test, exposedDates = [] }) {
  const groups = [discovery, validation, test];
  requireResearch(groups.every(g => Array.isArray(g) && g.length > 0), "RESEARCH_SPLIT_REQUIRED");
  for (const dates of groups) requireResearch(dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(`${d}T00:00:00Z`))
    && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d), "RESEARCH_SPLIT_DATE_INVALID");
  requireResearch(new Set(groups.flat()).size === groups.flat().length, "RESEARCH_SPLIT_OVERLAP");
  requireResearch([...discovery].sort().at(-1) < [...validation].sort()[0]
    && [...validation].sort().at(-1) < [...test].sort()[0], "RESEARCH_SPLIT_NOT_WALK_FORWARD");
  requireResearch(![...validation, ...test].some(d => exposedDates.includes(d)), "RESEARCH_HOLDOUT_CONTAMINATED");
  return { discovery, validation, test, holdout_status: "RESERVED_NOT_ACCESSED" };
}

export function validateHypothesis({ hypothesis, caseIds }) {
  requireResearch(typeof hypothesis.description === "string" && hypothesis.description.length >= 8, "RESEARCH_HYPOTHESIS_REQUIRED");
  requireResearch(["MAP", "CONFIRMATION", "ENTRY", "FILTER", "REENTRY", "MANAGEMENT"].includes(hypothesis.target_component), "RESEARCH_COMPONENT_INVALID");
  requireResearch(typeof hypothesis.mechanism === "string" && hypothesis.mechanism.length > 0, "RESEARCH_MECHANISM_REQUIRED");
  for (const field of ["supporting_cases", "counterexamples"]) {
    requireResearch(Array.isArray(hypothesis[field]), "RESEARCH_CASES_REQUIRED");
    requireResearch(hypothesis[field].every(id => caseIds.includes(id)), "RESEARCH_CASE_UNKNOWN");
  }
  requireResearch(hypothesis.supporting_cases.length > 0, "RESEARCH_SUPPORT_REQUIRED");
  requireResearch(!hypothesis.supporting_cases.some(id => hypothesis.counterexamples.includes(id)), "RESEARCH_CASE_ROLE_CONFLICT");
  requireResearch(typeof hypothesis.expected_risk === "string" && typeof hypothesis.winner_risk === "string", "RESEARCH_RISK_REQUIRED");
  return { ...hypothesis, status: "NEW", confidence: "UNVALIDATED", classification: "RESEARCH_HYPOTHESIS", evidence_is_discovery_only: true };
}

export function evaluateExperimentReadiness({ hypothesis, critique, counterexampleSearch, winnerRegression, split }) {
  const criteria = [
    [searchedCounterexamples(counterexampleSearch), "COUNTEREXAMPLE_SEARCH_REQUIRED"],
    [independentReviewReady(critique), "INDEPENDENT_CRITIQUE_REQUIRED"],
    [winnerSetReady(winnerRegression), "WINNER_REGRESSION_REQUIRED"],
    [split && split.holdout_status === "RESERVED_NOT_ACCESSED", "UNCONTAMINATED_HOLDOUT_REQUIRED"],
    [hypothesis?.testable_change, "TESTABLE_CHANGE_REQUIRED"] ];
  const blockers = criteria.filter(([ready]) => !ready).map(([, code]) => code);
  return { ready: blockers.length === 0, status: blockers.length ? "AUDITING" : "READY_FOR_EXPERIMENT", blockers,
    champion_modification_allowed: false, replay_authorization: false, automatic_promotion: false,
    validated_edge: false };
}

function searchedCounterexamples(search) { return search?.completed && Boolean(search?.searched_case_ids?.length); }
function independentReviewReady(critique) { return critique?.independent && critique?.verdict === "READY_FOR_EXPERIMENT"; }
function winnerSetReady(set) { return set?.complete && Array.isArray(set.at_risk); }

/** Selection from an actual provider capability list, never from remembered model names. */
export function selectResearchModel(capabilities) {
  const available = capabilities.filter(c => c.available === true && c.reasoning === true && Number.isFinite(c.capability_rank));
  requireResearch(available.length > 0, "RESEARCH_MODEL_UNAVAILABLE");
  const model = [...available].sort((a, b) => b.capability_rank - a.capability_rank)[0];
  requireResearch(model.reasoning_efforts?.includes("xhigh"), "RESEARCH_REASONING_EFFORT_UNAVAILABLE");
  return { identifier: model.identifier, reasoning_effort: "xhigh", capability_source: model.capability_source };
}
