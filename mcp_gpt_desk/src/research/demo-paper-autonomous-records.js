export function buildResearchExperiment(seed, ids) {
  return {
    research_experiment_id: ids.experimentId,
    experiment_key: `demo-paper:${seed.dataset.dataset_key}`,
    name: "Demo Paper — recherche stratégie MNQ M5",
    objective: "Trouver une première stratégie déterministe testable sur un mois de données réelles.",
    owner: "desk-research",
    status: "ACTIVE",
    comparison_metric: "total_r",
    candidate_selection_cutoff_utc: seed.dataset.cutoff_utc,
    budget: { max_candidates: 10, max_compute_jobs: 25 },
    metadata: { dataset_key: seed.dataset.dataset_key },
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  };
}

export function buildResearchHypothesis(seed, ids) {
  return {
    research_hypothesis_id: ids.hypothesisId,
    research_experiment_id: ids.experimentId,
    statement: "Une cassure/retest de l'opening range MNQ M5 peut produire une edge exploitable en shadow.",
    falsifiable_question: "Le backtest 1 mois génère-t-il des trades fermés avec total R positif et drawdown maîtrisé ?",
    instrument_scope: [seed.scope.instrument],
    timeframe_scope: ["M5"],
    population_scope: "one_month_cumulative_demo_paper",
    variable_set: { opening_range_bars: 36, tolerance_points: 4 },
    expected_outcome: "Au moins 2 trades fermés et total R supérieur à zéro.",
    invalidation_criteria: "Aucun trade fermé, total R négatif ou drawdown inférieur à -8R.",
    status: "TESTING",
    confidence_score: 0.55,
    metadata: { seed: "opening_range_breakout_retest" },
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  };
}

export function buildResearchCandidate(seed, ids) {
  return {
    research_candidate_id: ids.candidateId,
    research_experiment_id: ids.experimentId,
    research_hypothesis_id: ids.hypothesisId,
    candidate_key: `baseline:${seed.dataset.dataset_key}:opening-range-breakout-retest`,
    source_type: "BASELINE",
    status: "UNDER_REVIEW",
    strategy_definition_id: ids.definitionId,
    strategy_version_id: ids.versionId,
    primary_change_summary: "Baseline long/short breakout-retest avec entrées limit théoriques et gestion R canonique.",
    deterministic_plan_ref: `strategy-version://${ids.versionId}`,
    novelty_score: 0.35,
    promotion_blocked: true,
    promotion_block_reason: "Attente review IA après backtest initial.",
    metadata: { dataset_key: seed.dataset.dataset_key },
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  };
}

export function buildResearchEvaluation(seed, ids, run, metrics) {
  const verdict = evaluationVerdict(metrics);
  return {
    research_evaluation_report_id: ids.reportId,
    research_experiment_id: ids.experimentId,
    research_candidate_id: ids.candidateId,
    simulation_run_id: run.simulation_run_id,
    report_kind: "VALIDATION",
    verdict,
    score: evaluationScore(metrics, verdict),
    metric_snapshot: metrics,
    criteria_snapshot: { min_days: 30, min_rows: 1_000, min_trade_count: 2, min_total_r: 0, max_drawdown_floor_r: -8 },
    artifact_refs: [run.result_ref, run.metrics_ref].filter(Boolean),
    reviewer_ref: "deterministic-bootstrap",
    metadata: { source: "demo_paper_autonomous_bootstrap_v1" },
    created_at_utc: seed.timestamp,
  };
}

export function buildBootstrapResultPayload(input) {
  const metrics = input.simulation.metrics || {};
  return {
    status: "READY",
    generated_at_utc: new Date().toISOString(),
    dataset: datasetSummary(input.dataset, input.rows),
    strategy: strategySummary(input),
    simulation: simulationSummary(input.registered.run, metrics),
    research: input.research,
    agent_runtime: input.agentTask,
    e2e_readiness: e2eReadiness(metrics),
  };
}

function datasetSummary(dataset, rows) {
  return {
    dataset_id: dataset.dataset_id,
    dataset_key: dataset.dataset_key,
    rows: rows.length,
    trading_days: new Set(rows.map((row) => row.trading_date)).size,
    start_utc: dataset.time_range_start_utc,
    end_utc: dataset.time_range_end_utc,
    content_hash: dataset.content_hash,
  };
}

function strategySummary({ definition, version, compilation, instance }) {
  return {
    definition_id: definition.definition.strategy_definition_id,
    version_id: version.version.strategy_version_id,
    instance_id: instance.instance.strategy_instance_id,
    compile_status: compilation.status,
    compiled_artifact_hash: compilation.compilation.evidence.compiled_artifact_hash,
  };
}

function simulationSummary(run, metrics) {
  return {
    simulation_run_id: run.simulation_run_id,
    status: run.status,
    total_r: number(metrics.total_r),
    trade_count: number(metrics.trade_count),
    win_rate: number(metrics.win_rate),
    profit_factor: metrics.profit_factor ?? null,
    max_drawdown_r: number(metrics.max_drawdown_r),
    result_ref: run.result_ref,
    metrics_ref: run.metrics_ref,
  };
}

function e2eReadiness(metrics) {
  const tradeCount = number(metrics.trade_count);
  return {
    strategy_seed_created: true,
    one_month_backtest_completed: true,
    needs_human_review: tradeCount < 2 || number(metrics.total_r) <= 0,
    broker_execution_enabled: false,
    manual_telegram_workflow_required: true,
  };
}

function evaluationVerdict(metrics) {
  if (number(metrics.trade_count) < 2) return "NEEDS_REVIEW";
  if (number(metrics.total_r) <= 0 || number(metrics.max_drawdown_r) < -8) return "FAIL";
  return "PASS";
}

function evaluationScore(metrics, verdict) {
  const total = Math.max(-10, Math.min(10, number(metrics.total_r)));
  const drawdown = Math.max(0, 1 - Math.abs(number(metrics.max_drawdown_r)) / 8);
  const passScore = 0.65 + Math.min(0.25, total / 40) + drawdown * 0.1;
  const reviewScore = 0.45 + drawdown * 0.15;
  return Math.max(0.01, Math.min(0.99, Math.round((verdict === "PASS" ? passScore : reviewScore) * 100) / 100));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
