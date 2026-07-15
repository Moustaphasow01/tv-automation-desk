import { validateSetup } from "@tv-automation/desk-domain";

export function evaluateAnalysisSetup(analysis) {
  return validateSetup({
    setup: analysisSetup(analysis),
    decision: analysis?.executable_decision || {},
  });
}

export function assertAnalysisSetupPass(analysis) {
  const result = evaluateAnalysisSetup(analysis);
  if (result.status === "rejected") {
    throw new Error(`setup_validator_rejected:${result.reasons.join(",")}`);
  }
  if (result.status === "review_required") {
    throw new Error(`setup_validator_review_required:${result.reasons.join(",")}`);
  }
  return result;
}

function analysisSetup(analysis) {
  const executable = analysis?.executable_decision || {};
  const primarySetupId = executable.setup_id || analysis?.primary_setup_id || analysis?.executive_summary?.primary_setup_id;
  const setup = primarySetup(analysis?.setups || [], primarySetupId);
  return {
    ...setup,
    ...executable,
    instrument: executable.instrument || setup.instrument,
    direction: executable.direction || setup.direction,
    setup_type: executable.setup_type || setup.setup_type,
    risk_pct: executable.risk_pct ?? setup.risk_pct,
  };
}

function primarySetup(setups, primarySetupId) {
  if (!Array.isArray(setups)) return {};
  return setups.find((setup) => primarySetupId && setup?.setup_id === primarySetupId)
    || setups.find((setup) => setup?.executable === true)
    || setups.find((setup) => setup?.priority === 1 || setup?.rank === 1)
    || setups[0]
    || {};
}
