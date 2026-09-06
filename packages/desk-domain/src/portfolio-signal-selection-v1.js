import { canonicalSha256 } from "./execution-scope.js";
import {
  TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1,
  TRADE_PLAN_SCHEMA_VERSION_V1,
  normalizeProposedTradePlanV1,
} from "./trade-plan-economics-v1.js";

export const PORTFOLIO_SIGNAL_SELECTION_POLICIES_V1 = Object.freeze([
  "NET_BY_DIRECTION", "BEST_COMPLETE_PLAN_V1",
]);

// Portfolio owns competition between proposals. Never blend executable terms
// or increase the size of the selected strategy's immutable proposal.
export function selectPortfolioSignalsV1({ signals, conflictResolution }) {
  if (conflictResolution === "NET_BY_DIRECTION") return { selected: signals, rejected: [] };
  if (conflictResolution !== "BEST_COMPLETE_PLAN_V1") return {
    selected: [], rejected: signals.map(signal => rejection(signal, {
      code: "PORTFOLIO_SELECTION_POLICY_INVALID", policy: conflictResolution,
    })),
  };
  const identity = deduplicateSignals(signals);
  const groups = new Map();
  for (const signal of identity.signals) {
    const key = JSON.stringify([signal.account_id, signal.instrument]);
    const group = groups.get(key) || [];
    group.push(signal); groups.set(key, group);
  }
  const result = { selected: [], rejected: [...identity.rejected] };
  for (const group of groups.values()) {
    const canonicalSignals = new Map(group.map(signal => [signal, canonicalCompleteSignal(signal)]));
    const eligible = [...canonicalSignals.values()].filter(Boolean).sort(compareSignals);
    const winner = eligible[0];
    if (winner) result.selected.push(winner);
    for (const signal of group) {
      if (signal.signal_id === winner?.signal_id) continue;
      const code = canonicalSignals.get(signal) ? "PORTFOLIO_COMPETING_SIGNAL_NOT_SELECTED" : "PORTFOLIO_TRADE_PLAN_INCOMPLETE";
      result.rejected.push(rejection(signal, { code, selectedSignalId: winner?.signal_id }));
    }
  }
  result.rejected.sort((a, b) => a.signal_id < b.signal_id ? -1 : a.signal_id > b.signal_id ? 1 : 0);
  return result;
}

function canonicalCompleteSignal(signal) {
  const suppliedPlan = signal.proposed_trade_plan;
  if (!suppliedPlan || suppliedPlan.schema_version !== TRADE_PLAN_SCHEMA_VERSION_V1) return null;
  const normalized = normalizeProposedTradePlanV1({
    ...suppliedPlan, instrument: signal.instrument, direction: signal.direction,
    source_data_cutoff_utc: signal.source_data_cutoff_utc,
  });
  if (!normalized.ok || normalized.proposed_trade_plan.plan_hash !== suppliedPlan.plan_hash) return null;
  if (!sameCanonicalEconomics(signal.trade_plan_economics, normalized.economics)) return null;
  if (suppliedPlan.economics && !sameCanonicalEconomics(suppliedPlan.economics, normalized.economics)) return null;
  return { ...signal, proposed_trade_plan: normalized.proposed_trade_plan, trade_plan_economics: normalized.economics };
}

function sameCanonicalEconomics(supplied, canonical) {
  return supplied?.availability === "KNOWN"
    && supplied.schema_version === TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1
    && supplied.economics_hash === canonical.economics_hash
    && canonicalSha256(economicsBody(supplied)) === canonicalSha256(economicsBody(canonical))
    && Number.isFinite(canonical.risk_per_contract) && canonical.risk_per_contract > 0;
}

function economicsBody(value = {}) {
  const { economics_hash: ignoredHash, ...body } = value;
  return body;
}

function deduplicateSignals(signals) {
  const byId = new Map();
  for (const signal of signals) {
    const row = byId.get(signal.signal_id) || { signal, hashes: new Set(), count: 0 };
    row.hashes.add(canonicalSha256(signal)); row.count += 1; byId.set(signal.signal_id, row);
  }
  const result = { signals: [], rejected: [] };
  for (const row of byId.values()) {
    const hashes = [...row.hashes].sort();
    if (hashes.length === 1) result.signals.push(row.signal);
    else result.rejected.push(rejection(row.signal, {
      code: "PORTFOLIO_DUPLICATE_SIGNAL_DIVERGENT",
      details: { duplicate_count: row.count, signal_hashes: hashes },
    }));
  }
  return result;
}

function compareSignals(left, right) {
  const confidence = signal => Number.isFinite(signal.confidence) ? signal.confidence : -Infinity;
  if (confidence(left) !== confidence(right)) return confidence(right) - confidence(left);
  const time = Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc);
  if (time) return time;
  return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
}

function rejection(signal, { code, selectedSignalId = null, policy = "BEST_COMPLETE_PLAN_V1", details = {} }) {
  return { signal_id: signal.signal_id, issues: [{ code, field: "conflict_resolution",
    selection_policy: policy ?? null, selected_signal_id: selectedSignalId || null, ...details }] };
}
