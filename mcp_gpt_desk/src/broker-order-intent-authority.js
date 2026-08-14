export function assertLegacyPositionExecutionRollbackEnabled(environment) {
  if (environment?.legacyPositionExecutionEnabled === true) return;
  throw authorityError(
    "LEGACY_POSITION_EXECUTION_DISABLED",
    "Legacy desk_positions -> trade_decision -> order_intent execution is disabled. Use StrategySignal -> Portfolio/Risk -> TargetPosition -> OrderIntent.",
    { required_pipeline: "strategy_signal_to_portfolio_risk_target_position", rollback_flag: "DESK_LEGACY_POSITION_EXECUTION_ENABLED=true" },
  );
}

export function assertBrokerOrderIntentAuthority({ intent = null, candidate = null, environment, action }) {
  if (environment?.legacyPositionExecutionEnabled === true) return;
  if (hasPersistedPortfolioRiskProof({ intent, candidate })) return;
  throw authorityError(
    "ORDER_INTENT_PORTFOLIO_RISK_PROOF_REQUIRED",
    "Broker submission is blocked because this OrderIntent does not prove TargetPosition/PortfolioRisk lineage.",
    { action, required_pipeline: "PortfolioArbitration -> GlobalRisk -> TargetPosition -> OrderIntent", rollback_flag: "DESK_LEGACY_POSITION_EXECUTION_ENABLED=true" },
  );
}

function hasPersistedPortfolioRiskProof({ intent, candidate }) {
  if (candidate?.execution_provider_command_id && candidate?.portfolio_order_intent_id && isPortfolioExecutionEnvelope(candidate.payload)) return true;
  if (candidate?.portfolio_order_intent_id && hasPortfolioRiskPayload(candidate.command_payload || candidate.intent_payload || candidate.payload)) return true;
  if (intent?.portfolio_order_intent_id && hasPortfolioRiskPayload(intent.payload || intent.raw || intent)) return true;
  return false;
}

function isPortfolioExecutionEnvelope(value) {
  return value?.schema_version === "execution_provider_command_envelope_v1"
    && value.source?.kind === "PORTFOLIO_ORDER_INTENT_LINEAGE"
    && Boolean(value.portfolio_order_intent_id || value.source?.portfolio_order_intent_id)
    && hasPortfolioRiskPayload(value.order_intent_payload);
}

function hasPortfolioRiskPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value.source || {};
  return value.schema_version === "portfolio_order_intent_v1"
    && value.broker_submission_allowed === true
    && Boolean(value.target_position_id || source.target_position_id)
    && source.kind === "TARGET_POSITION"
    && Array.isArray(source.risk_decision_ids)
    && source.risk_decision_ids.length > 0
    && Array.isArray(source.candidate_allocation_ids)
    && source.candidate_allocation_ids.length > 0
    && value.audit?.direct_llm_order !== true
    && value.audit?.derived_from_netting_engine === true;
}

function authorityError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = 409;
  return error;
}
