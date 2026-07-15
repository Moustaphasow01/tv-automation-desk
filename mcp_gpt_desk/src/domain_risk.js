import { evaluateRisk } from "@tv-automation/desk-domain";

export function evaluateAnalysisRisk(analysis) {
  return evaluateRisk({
    setup: analysisRiskSetup(analysis),
    rules: riskRules(analysis),
  });
}

export function assertAnalysisRiskPass(analysis) {
  const result = evaluateAnalysisRisk(analysis);
  if (result.status === "rejected") {
    throw new Error(`risk_engine_rejected:${result.reasons.join(",")}`);
  }
  if (result.status === "review_required") {
    throw new Error(`risk_engine_review_required:${result.reasons.join(",")}`);
  }
  return result;
}

function analysisRiskSetup(analysis) {
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
    rr_minimum: executable.rr_minimum ?? setup.rr_minimum,
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

function riskRules(analysis) {
  const risk = analysis?.risk_management || {};
  return {
    maxRiskPct: firstPresent(risk.max_risk_pct_primary_setup, risk.max_risk_pct_session, risk.max_risk_pct),
    minRR: firstPresent(risk.min_rr, risk.min_rr_primary_setup, risk.rr_minimum),
    conditionalMinRR: firstPresent(risk.conditional_min_rr, risk.conditionalMinRR),
    maxCorrelatedActive: firstPresent(risk.max_correlated_active, risk.maxCorrelatedActive),
    allowDuplicateSignal: risk.allow_duplicate_signal === true || risk.allowDuplicateSignal === true,
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
