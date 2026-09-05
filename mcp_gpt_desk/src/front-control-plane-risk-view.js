import { countBy, firstValue, nested, number, rows, upper } from "./front-control-plane-projection-helpers.js";
import { frontTimeSeriesContracts } from "./front-control-plane-time-series-contracts.js";
import { isSameUtcDay, safeArrayFirst } from "./front-control-plane-view-values.js";
import { text } from "./front-control-plane-common.js";

export function riskCenter({ risk, execution, strategy, health, nowIso, warnings }) {
  if (!nested(risk, ["limits"])) warnings.push("risk-limits:UNAVAILABLE");
  const authoritative = nested(risk, ["risk_center"]) || null;
  const intents = rows(nested(execution, ["portfolioOrderIntents"]));
  const decisions = intents.map((intent) => riskDecisionRow(intent, nowIso)).filter(Boolean);
  return {
    summary: riskCenterSummary(risk, authoritative),
    authoritativeState: authoritative,
    limits: riskCenterLimits(authoritative, risk),
    exposures: riskCenterExposures(risk),
    correlations: rows(nested(risk, ["correlations"])),
    propConstraints: rows(nested(risk, ["prop_constraints"])),
    stressTests: rows(nested(risk, ["stress_tests"])),
    breaches: riskCenterPreferredRows(authoritative, risk, "breaches"),
    timeSeriesContracts: frontTimeSeriesContracts({ view: "risk", execution, risk, nowIso }),
    riskByAccount: riskByAccountRows(risk, decisions),
    riskByStrategy: riskByStrategyRows(decisions, strategy),
    riskByInstrument: riskByInstrumentRows(decisions),
    riskDecisions: {
      summary: riskDecisionsSummary(decisions, nowIso),
      items: [...decisions].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
    },
    circuitBreakers: circuitBreakerRows(execution, health),
    commandActions: [],
  };
}

function riskDecisionRow(intent, nowIso) {
  const payload = intent.order_intent_payload || intent.payload || {};
  const decision = safeArrayFirst(intent.risk_decisions);
  const requestedQty = finiteOrNull(firstValue(intent.quantity, payload.quantity));
  const authorizedQty = finiteOrNull(firstValue(decision?.authorized?.quantity, decision?.approved_size));
  if (requestedQty === null && authorizedQty === null) return null;
  return {
    at: text(intent.created_at_utc, "unavailable"),
    orderIntentId: text(intent.portfolio_order_intent_id, ""),
    signalId: text(payload.signal_id, "unavailable"),
    strategyInstanceId: text(payload.strategy_instance_id, "unavailable"),
    accountId: text(firstValue(intent.target_account_id, payload.account_id, payload.broker_account_id), ""),
    instrument: text(firstValue(intent.target_instrument, payload.instrument), "unavailable"),
    requestedQty: requestedQty ?? 0,
    authorizedQty: authorizedQty ?? 0,
    riskAmount: number(decision?.authorized?.risk_amount, 0),
    verdict: riskDecisionVerdict(requestedQty, authorizedQty),
    reason: text(firstValue(rows(decision?.reason_codes)[0], decision?.nearest_limit?.type), "unavailable"),
  };
}

function riskDecisionVerdict(requested, authorized) {
  if (authorized === null || authorized === 0) return "REJECTED";
  if (requested !== null && authorized < requested) return "REDUCED";
  return "APPROVED";
}

function riskDecisionsSummary(decisions, nowIso) {
  return {
    total: decisions.length,
    approved: countBy(decisions, (item) => item.verdict === "APPROVED"),
    reduced: countBy(decisions, (item) => item.verdict === "REDUCED"),
    rejected: countBy(decisions, (item) => item.verdict === "REJECTED"),
    today: countBy(decisions, (item) => isSameUtcDay(item.at, nowIso)),
  };
}

function riskByAccountRows(risk, decisions) {
  const accounts = rows(nested(risk, ["accounts"]));
  return accounts.map((account) => {
    const accountId = text(account.account_id, "");
    const accountDecisions = decisions.filter((item) => item.accountId === accountId);
    return {
      accountId,
      label: text(account.label, accountId),
      equityUsd: finiteOrNull(account.capital),
      openRiskUsd: number(aggregateSum(accountDecisions.map((item) => item.riskAmount)), 0),
      status: text(account.status, "UNKNOWN"),
    };
  });
}

function riskByStrategyRows(decisions, strategy) {
  const instances = rows(nested(strategy, ["instances"]));
  const nameById = new Map(instances.map((item) => [text(item.strategy_instance_id, ""), text(item.strategy_definition_id || item.name, item.strategy_instance_id)]));
  const groups = new Map();
  for (const item of decisions) {
    const key = item.strategyInstanceId;
    if (!key || key === "unavailable") continue;
    const current = groups.get(key) || { strategyInstanceId: key, label: nameById.get(key) || key, riskAmount: 0, decisions: 0 };
    current.riskAmount += item.riskAmount;
    current.decisions += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.riskAmount - a.riskAmount).slice(0, 10);
}

function riskByInstrumentRows(decisions) {
  const groups = new Map();
  for (const item of decisions) {
    const key = item.instrument;
    if (!key || key === "unavailable") continue;
    const current = groups.get(key) || { instrument: key, riskAmount: 0, decisions: 0 };
    current.riskAmount += item.riskAmount;
    current.decisions += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.riskAmount - a.riskAmount);
}

function aggregateSum(values) { return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0); }

export function circuitBreakerRows(execution, health) {
  const locks = rows(nested(execution, ["locks"]));
  const globalLock = locks.find((item) => item.scope_type === "global");
  const accountLocks = locks.filter((item) => item.scope_type === "account");
  const marketDataOk = nested(health, ["data_readiness", "market_closed"]) !== true && health != null;
  const infraOk = health?.ok !== false;
  return [
    { breakerId: "global_kill_switch", label: "Global Kill Switch", armed: Boolean(globalLock), detail: globalLock ? text(globalLock.reason, "Verrou actif") : "Aucun verrou global actif" },
    ...accountLocks.map((lock) => ({ breakerId: text(lock.execution_lock_id, lock.scope_value), label: `Protection compte · ${text(lock.scope_value, "")}`, armed: true, detail: text(lock.reason, "Verrou de protection actif") })),
    { breakerId: "market_data", label: "Flux de données marché", armed: !marketDataOk, detail: health ? (marketDataOk ? "Aucun problème détecté" : "Marché fermé ou données indisponibles") : "État santé non publié" },
    { breakerId: "infrastructure", label: "Infrastructure d'exécution", armed: !infraOk, detail: health ? (infraOk ? "Infrastructure saine" : "Dégradation détectée") : "État santé non publié" },
  ];
}

function riskCenterSummary(risk, authoritative) {
  const summary = nested(risk, ["summary"]) || {};
  // grossExposure/netExposure/dailyLoss/trailingDrawdown live on the risk_center
  // ("authoritative") snapshot as { availability, value, reasonCode } nodes, not as
  // flat risk.summary.* fields (those never existed - reading them always resolved
  // to 0). front-portfolio-risk-projection.js's riskCenterState() still hardcodes
  // all four to availability:"UNAVAILABLE" today, so these correctly read through
  // as unavailable/0 until that computation is implemented; openRisk *is* real
  // (aggregated from risk_decisions), so use it in place of a fabricated leverage figure.
  const openRisk = finiteOrNull(nested(authoritative, ["openRisk", "value"]));
  return {
    globalStatus: firstValue(nested(authoritative, ["globalStatus"]), summary.status, "DATA_UNAVAILABLE"),
    riskUsedPct: number(summary.risk_percent, 0),
    grossExposureUsd: number(nested(authoritative, ["grossExposure", "value"]), 0),
    netExposureUsd: number(nested(authoritative, ["netExposure", "value"]), 0),
    leverage: number(summary.leverage, 0),
    dailyLossR: number(nested(authoritative, ["dailyLoss", "value"]), 0),
    dailyLossLimitR: number(summary.daily_loss_limit_r, 0),
    trailingDrawdownR: number(nested(authoritative, ["trailingDrawdown", "value"]), 0),
    maxDrawdownR: number(nested(authoritative, ["trailingDrawdown", "value"]), 0),
    activeBreaches: firstValue(rows(nested(authoritative, ["breaches"])).length || undefined, rows(nested(risk, ["breaches"])).length),
    stressTestsToday: rows(nested(risk, ["stress_tests"])).length,
    openRiskUsd: openRisk ?? 0,
  };
}

export function finiteOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

function riskCenterPreferredRows(authoritative, risk, key) {
  const authoritativeRows = rows(nested(authoritative, [key]));
  return authoritativeRows.length ? authoritativeRows : rows(nested(risk, [key]));
}

const RISK_LIMIT_TYPE_LABELS = {
  PORTFOLIO_ABS_SIZE: "Taille absolue du portefeuille",
  ACCOUNT_ABS_SIZE: "Taille absolue du compte",
  INSTRUMENT_ABS_SIZE: "Taille absolue instrument",
  CORRELATION_GROUP_ABS_SIZE: "Taille absolue groupe de corrélation",
};

function riskCenterLimits(authoritative, risk) {
  const authoritativeRows = rows(nested(authoritative, ["limits"]));
  if (authoritativeRows.length) return authoritativeRows.map((item) => mapAuthoritativeRiskLimit(item, authoritative));
  return rows(nested(risk, ["limits"]));
}

function riskLimitScope(type) {
  const normalized = upper(type);
  if (normalized.startsWith("ACCOUNT")) return "ACCOUNT";
  if (normalized.startsWith("INSTRUMENT")) return "INSTRUMENT";
  if (normalized.startsWith("CORRELATION_GROUP")) return "ASSET_CLASS";
  return "GLOBAL";
}

function riskLimitStatus(item) {
  if (item?.breached) return "BREACH";
  const severity = upper(item?.severity);
  if (severity === "EMERGENCY" || severity === "CRITICAL") return "BLOCKED";
  const utilization = number(item?.current_utilization, 0);
  if (utilization >= 0.8 || severity === "HIGH" || severity === "WARN" || severity === "WARNING") return "WATCH";
  return "PASS";
}

function riskLimitLabel(type, scopeValue) {
  const base = RISK_LIMIT_TYPE_LABELS[upper(type)] || text(type, "Limite").replaceAll("_", " ").toLowerCase();
  return scopeValue ? `${base} · ${scopeValue}` : base;
}

function mapAuthoritativeRiskLimit(item, authoritative) {
  const value = number(item.value, 0);
  const utilization = number(item.current_utilization, 0);
  const scopeValue = text(item.scope, "");
  return {
    limitId: text(item.limit_id, `${text(item.type, "LIMIT")}:${scopeValue}`),
    scope: riskLimitScope(item.type),
    label: riskLimitLabel(item.type, scopeValue),
    targetId: scopeValue,
    limitValue: value,
    usedValue: value * utilization,
    unit: upper(item.unit) === "CONTRACTS" ? "CONTRACTS" : text(item.unit, "PCT"),
    usedPct: utilization * 100,
    headroomValue: number(item.remaining, value - value * utilization),
    status: riskLimitStatus(item),
    reasonCodes: [],
    lastChangedAt: text(authoritative?.asOf, "unavailable"),
    changedBy: "risk_engine",
    officialSource: text(authoritative?.source, "risk_center"),
    contributors: [],
  };
}

function riskCenterExposures(risk) {
  return rows(nested(risk, ["exposures"]))
    .filter((item) => item?.exposure_id || item?.instrument_code)
    .map((item) => ({
      exposureId: text(firstValue(item.exposure_id, item.instrument_code), ""),
      label: text(item.instrument_code, "Exposure"),
      valueUsd: number(item.value_usd, 0),
      riskPct: number(item.risk_pct, 0),
      status: riskExposureStatus(item.status),
    }));
}

function riskExposureStatus(status) {
  const normalized = upper(status);
  if (normalized === "BLOCK") return "BLOCK";
  return normalized === "PASS" ? "PASS" : "WATCH";
}
