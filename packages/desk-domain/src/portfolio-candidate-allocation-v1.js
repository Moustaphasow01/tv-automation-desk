import { canonicalSha256 } from "./execution-scope.js";
import { normalizeProposedTradePlanV1 } from "./trade-plan-economics-v1.js";
import { selectPortfolioSignalsV1 } from "./portfolio-signal-selection-v1.js";

export const PORTFOLIO_CANDIDATE_ALLOCATION_SCHEMA_VERSION_V1 = "portfolio_candidate_allocation_plan_v1";
export const VIRTUAL_STRATEGY_PORTFOLIO_SCHEMA_VERSION_V1 = "virtual_strategy_portfolio_v1";
export const PORTFOLIO_ALLOCATION_DIRECTIONS_V1 = Object.freeze(["LONG", "SHORT", "FLAT"]);
export const PORTFOLIO_STRATEGY_RUNTIME_STATES_V1 = Object.freeze(["ACTIVE", "SUSPENDED", "DISABLED"]);
export const PORTFOLIO_SIZING_MODES_V1 = Object.freeze(["REQUESTED_QUANTITY_CAP", "MONETARY_RISK_BUDGET"]);
export const DEFAULT_PORTFOLIO_CANDIDATE_ALLOCATION_POLICY_V1 = Object.freeze({
  conflict_resolution: "NET_BY_DIRECTION",
  default_signal_size: 1,
  active_signal_statuses: Object.freeze(["ACTIVE", "PENDING", "PUBLISHED"]),
  allowed_account_ids: Object.freeze([]),
  strategy_instance_states: Object.freeze({}),
  sizing_mode: "REQUESTED_QUANTITY_CAP",
});

export function buildCandidateAllocationPortfolioV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const defaultAccountId = text(firstDefined(input.account_id, input.accountId, input.default_account_id, input.defaultAccountId, input.portfolio_scope, input.scope, "default"));
  const policy = normalizePolicy(input.policy, input);
  const portfolioScope = text(firstDefined(input.portfolio_scope, input.scope, "default"));
  const signals = normalizeSignals(firstDefined(input.signals, input.signal_items, input.items, []), asOf, policy, defaultAccountId);
  const selection = selectPortfolioSignalsV1({ signals: signals.filter((item) => item.active).map((item) => item.signal),
    conflictResolution: policy.conflict_resolution });
  const activeSignals = selection.selected;
  const rejectedSignals = [...signals.filter((item) => !item.active).map((item) => item.rejected), ...selection.rejected];
  const allocations = allocateByAccountInstrument(activeSignals, portfolioScope, asOf);
  const base = {
    schema_version: PORTFOLIO_CANDIDATE_ALLOCATION_SCHEMA_VERSION_V1,
    status: activeSignals.length ? "ALLOCATED" : "NO_ACTIVE_SIGNALS",
    as_of_utc: asOf,
    portfolio_scope: portfolioScope,
    policy,
    candidate_allocations: allocations,
    rejected_signals: rejectedSignals,
    arbitration_summary: arbitrationSummary(allocations, rejectedSignals),
    virtual_portfolio: buildVirtualStrategyPortfolioV1({
      as_of_utc: asOf,
      portfolio_scope: portfolioScope,
      signals: activeSignals,
      positions: firstDefined(input.positions, input.virtual_positions, []),
      marks: input.marks,
    }),
  };
  return { ...base, plan_hash: hash(base) };
}

export function buildVirtualStrategyPortfolioV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const portfolioScope = text(firstDefined(input.portfolio_scope, input.scope, "default"));
  const signalLegs = normalizeSignalLegs(firstDefined(input.signals, []));
  const positionLegs = normalizePositions(firstDefined(input.positions, input.virtual_positions, []), input.marks);
  const byInstance = [...signalLegs, ...positionLegs].reduce(addLegToPortfolio, new Map());
  const positions = positionLegs.map((item) => item.position);
  const base = {
    schema_version: VIRTUAL_STRATEGY_PORTFOLIO_SCHEMA_VERSION_V1,
    as_of_utc: asOf,
    portfolio_scope: portfolioScope,
    totals: portfolioTotals([...byInstance.values()]),
    by_strategy_instance: [...byInstance.values()].sort(byInstanceId),
    positions,
  };
  return { ...base, portfolio_hash: hash(base) };
}

function normalizeSignals(items, asOf, policy, defaultAccountId) {
  return array(items).map((item) => normalizeSignal(item, asOf, policy, defaultAccountId));
}

function normalizeSignal(item, asOf, policy, defaultAccountId) {
  const source = signalSource(item);
  const signal = signalCore(item, source, defaultAccountId, policy);
  const issues = signalIssues(signal, asOf, policy);
  return { active: issues.length === 0, signal, rejected: { signal_id: signal.signal_id, issues } };
}

function signalCore(item, source, defaultAccountId, policy) {
  const direction = upper(firstDefined(source.direction, item.direction));
  const proposedTradePlanInput = record(firstDefined(source.proposed_trade_plan, source.proposedTradePlan, item.proposed_trade_plan, item.proposedTradePlan));
  const normalizedTradePlan = proposedTradePlanInput && !proposedTradePlanInput.schema_version
    ? normalizeProposedTradePlanV1({
      ...proposedTradePlanInput,
      instrument: firstDefined(source.instrument, item.instrument, proposedTradePlanInput.instrument),
      direction: firstDefined(direction, proposedTradePlanInput.direction),
      source_data_cutoff_utc: firstDefined(source.source_data_cutoff_utc, source.sourceDataCutoff, item.source_data_cutoff_utc, proposedTradePlanInput.source_data_cutoff_utc),
    })
    : null;
  const proposedTradePlan = normalizedTradePlan?.proposed_trade_plan || proposedTradePlanInput;
  const tradePlanEconomics = record(firstDefined(source.trade_plan_economics, source.tradePlanEconomics, proposedTradePlan?.economics, item.trade_plan_economics, item.tradePlanEconomics, normalizedTradePlan?.economics));
  const requestedSize = signalSize(item, source, direction);
  const contextSizing = contextAdjustedSize(item, source, requestedSize, policy);
  return {
    signal_id: text(firstDefined(source.signal_id, source.id, item.signal_id, item.signal_outbox_id, item.id)),
    strategy_definition_id: text(firstDefined(source.strategy_definition_id, source.strategyDefinitionId, item.strategy_definition_id)),
    strategy_instance_id: text(firstDefined(source.strategy_instance_id, source.strategyInstanceId, item.strategy_instance_id)),
    strategy_version_id: text(firstDefined(source.strategy_version_id, source.strategyVersionId, item.strategy_version_id)),
    account_id: text(firstDefined(source.account_id, source.accountId, item.account_id, item.accountId, defaultAccountId)),
    instrument: upper(firstDefined(source.instrument, item.instrument)),
    direction,
    requested_size: requestedSize,
    context_risk_multiplier: contextSizing.multiplier,
    context_risk_multiplier_source: contextSizing.source,
    proposed_size: contextSizing.size,
    sizing_mode: policy.sizing_mode,
    portfolio_block_reason: text(firstDefined(source.portfolio_block_reason, source.portfolioBlockReason, item.portfolio_block_reason, item.portfolioBlockReason)),
    context_sizing_issue: contextSizing.issue,
    confidence: numberOrNull(firstDefined(source.confidence, item.confidence)),
    execution_mode_origin: upper(firstDefined(source.execution_mode_origin, source.executionModeOrigin, item.execution_mode_origin)),
    generated_at_utc: iso(firstDefined(source.generated_at_utc, source.generated_at, source.generatedAt, item.generated_at_utc)),
    expires_at_utc: iso(firstDefined(source.expires_at_utc, source.expires_at, source.expiresAt, item.expires_at_utc)),
    source_data_cutoff_utc: iso(firstDefined(source.source_data_cutoff_utc, source.sourceDataCutoff, item.source_data_cutoff_utc)),
    correlation_id: text(firstDefined(source.correlation_id, source.correlationId, item.correlation_id)),
    status: upper(firstDefined(item.status, source.status, "ACTIVE")),
    proposed_trade_plan: proposedTradePlan,
    trade_plan_economics: tradePlanEconomics,
  };
}

function signalIssues(signal, asOf, policy) {
  const issues = [];
  requiredSignalIssues(signal, issues);
  signalStateIssues(signal, policy, issues);
  signalTimingIssues(signal, asOf, issues);
  signalSizingIssues(signal, policy, issues);
  return issues;
}

function requiredSignalIssues(signal, issues) {
  requireText(signal.signal_id, "signal_id", issues);
  requireText(signal.strategy_instance_id, "strategy_instance_id", issues);
  requireText(signal.account_id, "account_id", issues);
  requireText(signal.instrument, "instrument", issues);
  requireText(signal.generated_at_utc, "generated_at_utc", issues);
  requireText(signal.expires_at_utc, "expires_at_utc", issues);
}

function signalStateIssues(signal, policy, issues) {
  if (!PORTFOLIO_ALLOCATION_DIRECTIONS_V1.includes(signal.direction)) issues.push(issue("SIGNAL_DIRECTION_INVALID", "direction"));
  if (signal.direction === "FLAT") issues.push(issue("SIGNAL_FLAT_NOT_ALLOCATABLE", "direction"));
  if (!policy.active_signal_statuses.includes(signal.status)) issues.push(issue("SIGNAL_STATUS_NOT_ACTIVE", "status"));
  if (policy.allowed_account_ids.length && !policy.allowed_account_ids.includes(signal.account_id)) issues.push(issue("SIGNAL_ACCOUNT_NOT_IN_SCOPE", "account_id"));
  const runtimeState = strategyRuntimeState(signal.strategy_instance_id, policy);
  if (runtimeState === "DISABLED") issues.push(issue("STRATEGY_INSTANCE_DISABLED", "strategy_instance_id"));
  if (runtimeState === "SUSPENDED") issues.push(issue("STRATEGY_INSTANCE_SUSPENDED", "strategy_instance_id"));
}

function signalTimingIssues(signal, asOf, issues) {
  if (signal.generated_at_utc && Date.parse(signal.generated_at_utc) > Date.parse(asOf)) issues.push(issue("SIGNAL_GENERATED_AFTER_AS_OF", "generated_at_utc"));
  if (signal.expires_at_utc && Date.parse(signal.expires_at_utc) <= Date.parse(asOf)) issues.push(issue("SIGNAL_EXPIRED", "expires_at_utc"));
}

function signalSizingIssues(signal, policy, issues) {
  if (!PORTFOLIO_SIZING_MODES_V1.includes(policy.sizing_mode)) issues.push(issue("PORTFOLIO_SIZING_MODE_INVALID", "sizing_mode"));
  if (signal.proposed_size <= 0) issues.push(issue("SIGNAL_SIZE_NOT_POSITIVE", "proposed_size"));
  if (signal.context_sizing_issue) issues.push(issue(signal.context_sizing_issue, "context_risk_multiplier"));
  if (signal.portfolio_block_reason) issues.push(issue(`PORTFOLIO_${signal.portfolio_block_reason}`, "portfolio_block_reason"));
}

function allocateByAccountInstrument(signals, portfolioScope, asOf) {
  const groups = groupBy(signals, allocationGroupKey);
  return [...groups.entries()].sort(byKey).map(([, items]) => allocationForAccountInstrument(items, portfolioScope, asOf));
}

function allocationForAccountInstrument(signals, portfolioScope, asOf) {
  const accountId = signals[0]?.account_id || "default";
  const instrument = signals[0]?.instrument || "";
  const contributions = signals.slice().sort(bySignal).map(signalContribution);
  const longSize = sum(contributions.filter((item) => item.direction === "LONG"), "proposed_size");
  const shortSize = sum(contributions.filter((item) => item.direction === "SHORT"), "proposed_size");
  const netSize = round(longSize - shortSize);
  const base = {
    portfolio_scope: portfolioScope,
    as_of_utc: asOf,
    sizing_mode: signals[0]?.sizing_mode || "REQUESTED_QUANTITY_CAP",
    account_id: accountId,
    signal_ids: contributions.map((item) => item.signal_id),
    instrument,
    net_direction: directionFromSignedSize(netSize),
    proposed_size: Math.abs(netSize),
    long_size: longSize,
    short_size: shortSize,
    net_size: netSize,
    status: netSize === 0 ? "NEUTRALIZED" : "PROPOSED",
    conflict_status: allocationConflictStatus({ longSize, shortSize, netSize }),
    simultaneous_signal_count: contributions.length,
    strategy_instance_count: new Set(contributions.map((item) => item.strategy_instance_id)).size,
    long_strategy_instance_ids: unique(contributions.filter((item) => item.direction === "LONG").map((item) => item.strategy_instance_id)),
    short_strategy_instance_ids: unique(contributions.filter((item) => item.direction === "SHORT").map((item) => item.strategy_instance_id)),
    contributing_signals: contributions,
  };
  return { id: `candalloc:${canonicalSha256(base)}`, ...base };
}

function signalContribution(signal) {
  return {
    signal_id: signal.signal_id,
    strategy_definition_id: signal.strategy_definition_id,
    strategy_instance_id: signal.strategy_instance_id,
    strategy_version_id: signal.strategy_version_id,
    account_id: signal.account_id,
    direction: signal.direction,
    requested_size: signal.requested_size,
    context_risk_multiplier: signal.context_risk_multiplier,
    context_risk_multiplier_source: signal.context_risk_multiplier_source || null,
    sizing_mode: signal.sizing_mode,
    proposed_size: signal.proposed_size,
    signed_size: signedSize(signal.direction, signal.proposed_size),
    confidence: signal.confidence,
    source_data_cutoff_utc: signal.source_data_cutoff_utc,
    correlation_id: signal.correlation_id,
    proposed_trade_plan: signal.proposed_trade_plan || null,
    trade_plan_economics: signal.trade_plan_economics || null,
  };
}

function normalizeSignalLegs(signals) {
  return array(signals).map((signal) => ({
    strategy_instance_id: signal.strategy_instance_id,
    signal_ids: [signal.signal_id].filter(Boolean),
    account_id: signal.account_id || "default",
    instrument: signal.instrument,
    proposed_signed_size: signedSize(signal.direction, signal.proposed_size),
    open_signed_size: 0,
    gross_exposure: 0,
    unrealized_r: 0,
    realized_r: 0,
  }));
}

function normalizePositions(items, marks) {
  return array(items).map((item) => normalizePosition(item, marks));
}

function normalizePosition(item, marks) {
  const instrument = upper(item.instrument);
  const direction = upper(item.direction);
  const size = positive(firstDefined(item.size, item.quantity, item.contracts), 0);
  const mark = numberOrNull(firstDefined(item.mark_price, item.markPrice, markFor(instrument, marks)));
  const position = {
    position_id: text(firstDefined(item.position_id, item.id)),
    strategy_instance_id: text(firstDefined(item.strategy_instance_id, item.strategyInstanceId)),
    account_id: text(firstDefined(item.account_id, item.accountId, "default")),
    instrument,
    direction,
    size,
    signed_size: signedSize(direction, size),
    entry_price: numberOrNull(firstDefined(item.entry_price, item.entryPrice)),
    mark_price: mark,
    initial_risk_points: positive(firstDefined(item.initial_risk_points, item.initialRiskPoints), 0),
    realized_r: round(numberOrNull(firstDefined(item.realized_r, item.realizedR)) || 0),
  };
  const unrealized = positionUnrealizedR(position);
  return {
    position: { ...position, unrealized_r: unrealized },
    strategy_instance_id: position.strategy_instance_id,
    signal_ids: array(firstDefined(item.signal_ids, item.signalIds)),
    account_id: text(firstDefined(item.account_id, item.accountId, "default")),
    instrument,
    proposed_signed_size: 0,
    open_signed_size: position.signed_size,
    gross_exposure: Math.abs(position.signed_size),
    unrealized_r: unrealized || 0,
    realized_r: position.realized_r,
  };
}

function addLegToPortfolio(state, leg) {
  const id = leg.strategy_instance_id || "UNKNOWN";
  const row = state.get(id) || emptyPortfolioRow(id);
  row.signal_ids.push(...leg.signal_ids);
  row.account_ids = unique([...row.account_ids, leg.account_id].filter(Boolean));
  row.proposed_signed_size = round(row.proposed_signed_size + leg.proposed_signed_size);
  row.open_signed_size = round(row.open_signed_size + leg.open_signed_size);
  row.gross_exposure = round(row.gross_exposure + leg.gross_exposure);
  row.unrealized_r = round(row.unrealized_r + leg.unrealized_r);
  row.realized_r = round(row.realized_r + leg.realized_r);
  row.total_r = round(row.unrealized_r + row.realized_r);
  row.instruments = unique([...row.instruments, leg.instrument]);
  state.set(id, row);
  return state;
}

function emptyPortfolioRow(strategyInstanceId) {
  return {
    strategy_instance_id: strategyInstanceId,
    instruments: [],
    account_ids: [],
    signal_ids: [],
    proposed_signed_size: 0,
    open_signed_size: 0,
    gross_exposure: 0,
    unrealized_r: 0,
    realized_r: 0,
    total_r: 0,
  };
}

function portfolioTotals(rows) {
  return {
    strategy_instances: rows.length,
    proposed_abs_size: round(rows.reduce((total, row) => total + Math.abs(row.proposed_signed_size), 0)),
    open_abs_size: round(rows.reduce((total, row) => total + Math.abs(row.open_signed_size), 0)),
    gross_exposure: round(rows.reduce((total, row) => total + row.gross_exposure, 0)),
    unrealized_r: round(rows.reduce((total, row) => total + row.unrealized_r, 0)),
    realized_r: round(rows.reduce((total, row) => total + row.realized_r, 0)),
    total_r: round(rows.reduce((total, row) => total + row.total_r, 0)),
  };
}

function positionUnrealizedR(position) {
  if (!position.entry_price || !position.mark_price || !position.initial_risk_points) return null;
  const priceDelta = position.direction === "SHORT" ? position.entry_price - position.mark_price : position.mark_price - position.entry_price;
  return round((priceDelta / position.initial_risk_points) * position.size);
}

function signalSource(item) {
  const payload = record(item.payload) || {};
  return record(item.signal) || record(item.normalized_signal) || record(payload.signal) || payload || {};
}

function signalSize(item, source, direction) {
  if (direction === "FLAT") return 0;
  const explicit = firstDefined(source.proposed_size, source.size, source.quantity, source.contracts, item.proposed_size, item.size, item.quantity, item.contracts);
  return explicit === null
    ? DEFAULT_PORTFOLIO_CANDIDATE_ALLOCATION_POLICY_V1.default_signal_size
    : positive(explicit, 0);
}

function contextAdjustedSize(item, source, requestedSize, policy) {
  const multiplier = numberOrNull(contextMultiplier(item, source));
  const sourceRef = contextMultiplierSource(item, source);
  const invalid = multiplier === null || multiplier < 0 || multiplier > 1;
  if (invalid) return contextSizingInvalid(sourceRef);
  if (multiplier !== 1 && !sourceRef) return contextSizingUnproven(multiplier);
  return contextSizingResult(multiplier, sourceRef, requestedSize, policy);
}

function contextMultiplier(item, source) {
  return firstDefined(
    source.context_risk_multiplier,
    source.contextRiskMultiplier,
    source.context_gate?.risk_multiplier,
    source.contextGate?.risk_multiplier,
    item.context_risk_multiplier,
    item.contextRiskMultiplier,
    item.context_gate?.risk_multiplier,
    item.contextGate?.risk_multiplier,
    1,
  );
}

function contextMultiplierSource(item, source) {
  return text(firstDefined(
    source.context_risk_multiplier_source,
    source.contextRiskMultiplierSource,
    source.context_gate?.policy_version,
    source.contextGate?.policy_version,
    item.context_risk_multiplier_source,
    item.contextRiskMultiplierSource,
  ));
}

function contextSizingInvalid(sourceRef) {
  return { multiplier: null, source: sourceRef || null, size: 0, issue: "CONTEXT_RISK_MULTIPLIER_INVALID" };
}

function contextSizingUnproven(multiplier) {
  return { multiplier, source: null, size: 0, issue: "CONTEXT_RISK_MULTIPLIER_PROVENANCE_REQUIRED" };
}

function contextSizingResult(multiplier, sourceRef, requestedSize, policy) {
  const size = policy.sizing_mode === "MONETARY_RISK_BUDGET" ? requestedSize : Math.floor(requestedSize * multiplier);
  return {
    multiplier,
    source: sourceRef || null,
    size,
    issue: size > 0 ? null : "CONTEXT_RISK_MULTIPLIER_ZERO_SIZE",
  };
}

function normalizePolicy(policy, input = {}) {
  const source = record(policy) || {};
  return {
    conflict_resolution: text(firstDefined(source.conflict_resolution, "NET_BY_DIRECTION")),
    default_signal_size: positive(firstDefined(source.default_signal_size, 1), 1),
    sizing_mode: normalizeSizingMode(firstDefined(source.sizing_mode, source.sizingMode, input.sizing_mode, input.sizingMode)),
    active_signal_statuses: unique(array(firstDefined(source.active_signal_statuses, DEFAULT_PORTFOLIO_CANDIDATE_ALLOCATION_POLICY_V1.active_signal_statuses)).map(upper)),
    allowed_account_ids: unique(array(source.allowed_account_ids).map(text).filter(Boolean)),
    strategy_instance_states: normalizeStrategyInstanceStates(firstDefined(
      source.strategy_instance_states,
      source.strategy_states,
      input.strategy_instance_states,
      input.strategy_states,
      {},
    )),
  };
}

function normalizeSizingMode(value) {
  if (value === null || value === undefined || value === "") return "REQUESTED_QUANTITY_CAP";
  const mode = upper(value);
  return PORTFOLIO_SIZING_MODES_V1.includes(mode) ? mode : "INVALID";
}

function normalizeStrategyInstanceStates(input) {
  const source = record(input) || {};
  return Object.fromEntries(Object.entries(source).map(([key, value]) => {
    const raw = record(value) ? firstDefined(value.runtime_state, value.runtimeState, value.status, value.state) : value;
    const state = upper(raw);
    return [text(key), PORTFOLIO_STRATEGY_RUNTIME_STATES_V1.includes(state) ? state : "ACTIVE"];
  }).filter(([key]) => Boolean(key)));
}

function strategyRuntimeState(strategyInstanceId, policy) {
  return policy.strategy_instance_states[text(strategyInstanceId)] || "ACTIVE";
}

function allocationGroupKey(signal) {
  return `${signal.account_id}:${signal.instrument}`;
}

function allocationConflictStatus({ longSize, shortSize, netSize }) {
  if (longSize > 0 && shortSize > 0 && netSize === 0) return "NEUTRALIZED_CONFLICT";
  if (longSize > 0 && shortSize > 0) return "OPPOSING_SIGNALS_NETTED";
  return "ALIGNED";
}

function arbitrationSummary(allocations, rejectedSignals) {
  return {
    allocation_count: allocations.length,
    rejected_signal_count: rejectedSignals.length,
    simultaneous_signal_count: allocations.reduce((total, item) => total + Number(item.simultaneous_signal_count || 0), 0),
    conflict_count: allocations.filter((item) => item.conflict_status !== "ALIGNED").length,
    neutralized_count: allocations.filter((item) => item.status === "NEUTRALIZED").length,
    account_ids: unique(allocations.map((item) => item.account_id).filter(Boolean)),
    instruments: unique(allocations.map((item) => item.instrument).filter(Boolean)),
  };
}

function markFor(instrument, marks) {
  const source = record(marks) || {};
  return source[instrument] || source[instrument.toLowerCase()];
}

function directionFromSignedSize(value) {
  if (value > 0) return "LONG";
  if (value < 0) return "SHORT";
  return "FLAT";
}

function signedSize(direction, size) {
  if (direction === "SHORT") return -Math.abs(size || 0);
  if (direction === "LONG") return Math.abs(size || 0);
  return 0;
}

function requireText(value, path, issues) {
  if (!value) issues.push(issue("REQUIRED", path));
}

function issue(code, path) { return { code, path }; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positive(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function numberOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function sum(items, key) { return round(items.reduce((total, item) => total + Number(item[key] || 0), 0)); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function groupBy(items, selector) {
  return items.reduce((state, item) => {
    const key = selector(item);
    if (!state.has(key)) state.set(key, []);
    state.get(key).push(item);
    return state;
  }, new Map());
}
function byKey(left, right) { return left[0].localeCompare(right[0]); }
function bySignal(left, right) { return left.generated_at_utc.localeCompare(right.generated_at_utc) || left.signal_id.localeCompare(right.signal_id); }
function byInstanceId(left, right) { return left.strategy_instance_id.localeCompare(right.strategy_instance_id); }
