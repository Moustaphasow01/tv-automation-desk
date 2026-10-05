import { requireResearch, missing } from './research-evidence.js';
import { researchCanonicalJson } from './research-canonical-json.js';
import { researchScorecard } from './research-scorecard.js';

export const PUBLISHED_AUDIT_VARIANTS = Object.freeze({
  'BE0.5': 'cf_BE_0_5', BE1: 'cf_BE_1', 'BE1.5': 'cf_BE_1_5', 'P1@1R': 'cf_P1_at_1R',
});
export const AUDIT_EXPERIMENT_VERSION = 'ENGINE_PUBLISHED_AUDIT_V1';
export const EXPERIMENT_METRICS = Object.freeze(['net_R', 'expectancy', 'profit_factor',
  'max_drawdown', 'trade_count', 'win_rate', 'average_winner', 'average_loser',
  'winner_concentration', 'outlier_dependence', 'trade_frequency', 'period_stability',
  'winner_preservation', 'robustness']);

/** Full eligible sample is fixed before reading variant outcomes; no manufactured trades. */
export function experimentSample(cases) {
  const trades = new Map();
  for (const item of cases) {
    if (!item.identity.scorable || item.identity.sample_purpose !== 'OOS') continue;
    for (const trade of item.observations.trades) {
      requireResearch(trade.source === 'ENGINE_PUBLISHED_ONLY' && trade.recalculated === false,
        'RESEARCH_EXPERIMENT_UNPUBLISHED_TRADE');
      requireResearch(trade.provenance?.source_sha256 || trade.provenance?.source_event_hash,
        'RESEARCH_EXPERIMENT_PROVENANCE_REQUIRED');
      const value = { case_id: item.case_id, date: item.identity.date,
        plan_sha256: item.identity.plan_sha256, manifest_sha256: item.identity.manifest_sha256, trade };
      const prior = trades.get(trade.trade_id);
      requireResearch(!prior || researchCanonicalJson(prior.trade) === researchCanonicalJson(trade),
        'RESEARCH_EXPERIMENT_TRADE_CONFLICT');
      if (!prior) trades.set(trade.trade_id, value);
    }
  }
  return [...trades.values()].sort((a, b) => a.trade.trade_id.localeCompare(b.trade.trade_id));
}

export function freezePublishedAudit({ cycle, hypothesis, design, cases, fingerprint, clock }) {
  requireResearch(Object.hasOwn(PUBLISHED_AUDIT_VARIANTS, design.variant), 'RESEARCH_AUDIT_VARIANT_UNSUPPORTED');
  requireResearch(typeof design.mechanism === 'string' && design.mechanism.trim(), 'RESEARCH_EXPERIMENT_MECHANISM_REQUIRED');
  const thresholds = design.thresholds;
  requireResearch(Number.isInteger(thresholds?.minimum_trades) && thresholds.minimum_trades > 0
    && Number.isInteger(thresholds.minimum_days) && thresholds.minimum_days > 0,
  'RESEARCH_EXPERIMENT_SAMPLE_THRESHOLD_REQUIRED');
  requireResearch(Number.isFinite(thresholds.minimum_expectancy_delta) && thresholds.minimum_expectancy_delta >= 0
    && Number.isFinite(thresholds.minimum_winner_preservation) && thresholds.minimum_winner_preservation >= 0
    && thresholds.minimum_winner_preservation <= 1, 'RESEARCH_EXPERIMENT_THRESHOLD_INVALID');
  const sample = experimentSample(cases).map(row => ({ case_id: row.case_id, date: row.date,
    trade_id: row.trade.trade_id, plan_sha256: row.plan_sha256, manifest_sha256: row.manifest_sha256,
    source_sha256: row.trade.provenance.source_sha256 ?? null,
    source_event_hash: row.trade.provenance.source_event_hash ?? null,
    trade_publication_sha256: fingerprint(researchCanonicalJson(row.trade)) }));
  const protocol = { schema: AUDIT_EXPERIMENT_VERSION, hypothesis_id: hypothesis.hypothesis_id,
    source_cycle_id: cycle.cycle_id, corpus_hash: cycle.corpus_hash, dataset_role: 'DISCOVERY',
    baseline: 'ENGINE_PUBLISHED_REAL', challenger: design.variant, mechanism: design.mechanism,
    sample, sample_sha256: fingerprint(researchCanonicalJson(sample)), metrics: EXPERIMENT_METRICS,
    success_condition: thresholds, failure_condition: 'PAIRED_EXPECTANCY_OR_WINNER_PROTECTION_FAILS',
    stop_rules: ['CORPUS_DRIFT', 'SOURCE_HASH_DRIFT', 'MISSING_OR_NON_ENGINE_PUBLICATION'],
    anti_hindsight: 'No new plan, price, replay, source edit or outcome-based sample selection.',
    false_discovery_control: 'Exploratory only. Log every tested candidate, including failed and incomplete tests.',
    equivalence: 'AUDIT_PROXY_NOT_A_NEW_STRATEGY_IMPLEMENTATION', validation: 'NOT_RUN', holdout: 'NONE_RESERVED',
    risk_limitations: 'Published single-trade counterfactuals do not establish new portfolio fills, timing or drawdown.',
    champion_mutable: false, promotion_allowed: false };
  return { ...protocol, status: 'FROZEN_RESEARCH_PROTOCOL', preregistered_at: clock(),
    protocol_sha256: fingerprint(researchCanonicalJson(protocol)), classification: 'RESEARCH_PROTOCOL' };
}

/** Only aggregate numbers already published by ENGINE. Never rerun financial arithmetic. */
export function executePublishedAudit({ protocol, cases, fingerprint }) {
  const field = PUBLISHED_AUDIT_VARIANTS[protocol.challenger];
  requireResearch(protocol.schema === AUDIT_EXPERIMENT_VERSION && field, 'RESEARCH_AUDIT_PROTOCOL_UNSUPPORTED');
  const { status, preregistered_at, protocol_sha256, classification, ...frozen } = protocol;
  requireResearch(status === 'FROZEN_RESEARCH_PROTOCOL'
    && fingerprint(researchCanonicalJson(frozen)) === protocol_sha256, 'RESEARCH_EXPERIMENT_PROTOCOL_DRIFT');
  const sample = experimentSample(cases), identity = sample.map(row => ({ case_id: row.case_id, date: row.date,
    trade_id: row.trade.trade_id, plan_sha256: row.plan_sha256, manifest_sha256: row.manifest_sha256,
    source_sha256: row.trade.provenance.source_sha256 ?? null,
    source_event_hash: row.trade.provenance.source_event_hash ?? null,
    trade_publication_sha256: fingerprint(researchCanonicalJson(row.trade)) }));
  requireResearch(fingerprint(researchCanonicalJson(identity)) === protocol.sample_sha256,
    'RESEARCH_EXPERIMENT_SAMPLE_DRIFT');
  const paired = sample.filter(row => Number.isFinite(row.trade.real_R) && Number.isFinite(row.trade[field]));
  const skipped = sample.filter(row => !paired.includes(row)).map(row => ({ trade_id: row.trade.trade_id,
    available: false, reason: 'NOT_PERSISTED', missing: !Number.isFinite(row.trade.real_R) ? 'REAL_R' : protocol.challenger }));
  const baseline = scorecardFor(paired, cases, 'real_R'), challenger = scorecardFor(paired, cases, field);
  const expectancyDelta = paired.length ? challenger.expectancy_R_per_published_trade - baseline.expectancy_R_per_published_trade : null;
  const { winners, preservation, days, sufficient, passed } = auditAssessment({ paired, skipped, field, expectancyDelta,
    threshold: protocol.success_condition });
  return { status: !sufficient ? 'INCOMPLETE_EVIDENCE' : passed ? 'DEVELOPMENT_AUDIT_SUPPORTED' : 'REJECTED_DEVELOPMENT_AUDIT',
    classification: 'DERIVED_LOCAL', source: 'ENGINE_PUBLISHED_ONLY', protocol_sha256, sample_sha256: protocol.sample_sha256,
    paired_trades: paired.length, independent_days: days, skipped, baseline, challenger,
    expectancy_delta: expectancyDelta, winner_preservation: preservation,
    winners_at_risk: winners.filter(row => row.trade[field] < row.trade.real_R).map(row => ({
      trade_id: row.trade.trade_id, date: row.date, case_id: row.case_id,
      published_real_R: row.trade.real_R, published_counterfactual_R: row.trade[field], provenance: row.trade.provenance })),
    period_stability: daySummary(paired, field), financial_recalculation: false,
    new_fills_simulated: false, portfolio_effects: missing('counterfactual_portfolio_path'),
    validated_edge: false, holdout_tested: false, champion_modified: false, promotion_allowed: false,
    next_action: passed ? 'RESEARCH_RUNTIME_PARITY_AND_UNTOUCHED_VALIDATION_REQUIRED' : 'SELECT_NEXT_HYPOTHESIS',
    limitations: ['Discovery-only comparison, not causal proof, OOS validation or future profitability.',
      'Counterfactual exits/fees/USD/equity paths are not inferred from REAL timestamps.',
      'Simulated fill count under a changed strategy remains unknown.'] };
}

function auditAssessment({ paired, skipped, field, expectancyDelta, threshold }) {
  const winners = paired.filter(row => row.trade.real_R > 0), preserved = winners.filter(row => row.trade[field] >= row.trade.real_R);
  const preservation = winners.length ? preserved.length / winners.length : null;
  const days = new Set(paired.map(row => row.date)).size;
  const sufficient = skipped.length === 0 && paired.length >= threshold.minimum_trades
    && days >= threshold.minimum_days && preservation !== null;
  return { winners, preservation, days, sufficient,
    passed: sufficient && expectancyDelta >= threshold.minimum_expectancy_delta && preservation >= threshold.minimum_winner_preservation };
}

function scorecardFor(rows, cases, field) {
  const byTrade = new Map(rows.map(row => [row.trade.trade_id, row.trade]));
  const projected = cases.filter(item => item.observations.trades.some(trade => byTrade.has(trade.trade_id)))
    .map(item => ({ ...item, observations: { ...item.observations,
    trades: item.observations.trades.filter(trade => byTrade.has(trade.trade_id)).map(trade => ({ ...trade,
      real_R: trade[field], ...(field === 'real_R' ? {} : { real_USD: null, exit_time: null }) })) } }));
  const scorecard = researchScorecard(projected), values = rows.map(row => row.trade[field]);
  const wins = values.filter(value => value > 0), losses = values.filter(value => value < 0), sumWins = wins.reduce((sum, value) => sum + value, 0);
  return { ...scorecard, metrics_basis: field === 'real_R' ? 'PAIRED_PUBLISHED_REAL' : 'PAIRED_PUBLISHED_COUNTERFACTUAL_NOT_REPLAY',
    win_rate: values.length ? wins.length / values.length : null,
    average_winner_R: wins.length ? sumWins / wins.length : null,
    average_loser_R: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null,
    winner_concentration: sumWins > 0 ? Math.max(...wins) / sumWins : null,
    outlier_dependence: missing('preregistered_outlier_sensitivity_rule'),
    trade_frequency: { published_paired_trades_per_day: rows.length ? rows.length / new Set(rows.map(row => row.date)).size : null,
      changed_strategy_frequency: missing('counterfactual_portfolio_fills') }, robustness: missing('untouched_validation_and_holdout') };
}

function daySummary(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, { date: row.date, paired_trades: 0, real_R: 0, counterfactual_R: 0 });
    const group = groups.get(row.date); group.paired_trades++; group.real_R += row.trade.real_R; group.counterfactual_R += row.trade[field];
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}
