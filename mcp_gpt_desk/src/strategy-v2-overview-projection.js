export async function loadStrategyV2Overview(store, args = {}) {
  const limit = args.limit ? Number(args.limit) : 500;
  const definitionId = args.strategy_definition_id || args.strategyDefinitionId || null;
  const versionId = args.strategy_version_id || args.strategyVersionId || null;
  const [definitions, versions, instances, audit, signalBus, runtimeEvaluations] = await Promise.all([
    store.strategyKernel.listDefinitions({ limit }),
    store.strategyKernel.listVersions({ strategyDefinitionId: definitionId, limit }),
    store.strategyKernel.listInstances({ strategyVersionId: versionId, limit }),
    store.strategyKernel.listAuditEvents({ limit: Math.min(limit, 200) }),
    typeof store.listStrategyV2Signals === "function"
      ? store.listStrategyV2Signals({ limit: Math.min(limit, 200) })
      : Promise.resolve({ items: [] }),
    store.strategyEvaluations ? store.strategyEvaluations.listRecent({ limit: Math.min(limit, 500) }) : Promise.resolve([]),
  ]);
  const scopedInstances = definitionId ? instances.filter((instance) => versions.some((version) => version.strategy_version_id === instance.strategy_version_id)) : instances;
  const nominalEvaluations = runtimeEvaluations.filter((item) => item.source_class !== "CERTIFICATION_REPLAY");
  const runtimeInstances = addRuntimeEvaluations(scopedInstances, nominalEvaluations);
  const nominalSignals = (signalBus.items || []).filter((item) => item.source_class !== "CERTIFICATION_REPLAY");
  const strategies = buildOverviewItems({ definitions, versions, instances: runtimeInstances, audit });
  return response("DeskStrategyV2Overview", {
    generated_at_utc: store.clock.now().utc,
    summary: buildSummary({ definitions, versions, instances: runtimeInstances }),
    count: strategies.length,
    strategies,
    definitions,
    versions,
    instances: runtimeInstances,
    signals: nominalSignals,
    runtime_evaluations: nominalEvaluations,
    certification: { isolated: true, evaluation_count: runtimeEvaluations.length - nominalEvaluations.length, signal_count: (signalBus.items || []).length - nominalSignals.length },
    audit,
    source: { canonical: "strategy_kernel_v2", runtime: "strategy_runtime_evaluations", legacy_strategy_endpoint: "/api/v1/strategies" },
  });
}

function addRuntimeEvaluations(instances, evaluations) {
  const latest = new Map();
  for (const evaluation of evaluations) if (!latest.has(String(evaluation.strategy_instance_id))) latest.set(String(evaluation.strategy_instance_id), evaluation);
  return instances.map((instance) => {
    const evaluation = latest.get(String(instance.strategy_instance_id));
    if (!evaluation) return { ...instance, scheduler_health: "NOT_OBSERVED" };
    return { ...instance, last_evaluation_at_utc: evaluation.completed_at_utc, next_evaluation_at_utc: evaluation.next_evaluation_at_utc, last_evaluation_result: evaluation.status, last_evaluation_reason_codes: evaluation.reason_codes || [], artifact_version: evaluation.artifact_version || instance.artifact_version || null, scheduler_health: "OBSERVED" };
  });
}

function buildSummary({ definitions = [], versions = [], instances = [] }) {
  return {
    definitions: definitions.length, versions: versions.length, instances: instances.length,
    published_versions: versions.filter((item) => upper(item.status) === "PUBLISHED").length,
    live_instances: instances.filter((item) => upper(item.execution_mode) === "LIVE").length,
    paper_instances: instances.filter((item) => upper(item.execution_mode) === "PAPER").length,
    shadow_instances: instances.filter((item) => upper(item.execution_mode) === "SHADOW").length,
    version_statuses: statusCounts(versions, "status"), runtime_states: statusCounts(instances, "runtime_state"), execution_modes: statusCounts(instances, "execution_mode"),
  };
}

function buildOverviewItems({ definitions = [], versions = [], instances = [], audit = [] }) {
  const versionsByDefinition = groupBy(versions, "strategy_definition_id");
  const instancesByVersion = groupBy(instances, "strategy_version_id");
  const auditByAggregate = groupBy(audit, "aggregate_id");
  return definitions.map((definition) => buildOverviewItem({ definition, versionsByDefinition, instancesByVersion, auditByAggregate }));
}

function buildOverviewItem({ definition, versionsByDefinition, instancesByVersion, auditByAggregate }) {
  const strategyVersions = [...(versionsByDefinition.get(definition.strategy_definition_id) || [])].sort((a, b) => String(b.updated_at_utc || b.updated_at || "").localeCompare(String(a.updated_at_utc || a.updated_at || "")));
  const strategyInstances = strategyVersions.flatMap((version) => instancesByVersion.get(version.strategy_version_id) || []);
  const published = strategyVersions.find((item) => upper(item.status) === "PUBLISHED") || null;
  const live = strategyInstances.find((item) => upper(item.execution_mode) === "LIVE") || null;
  const paper = strategyInstances.find((item) => upper(item.execution_mode) === "PAPER") || null;
  const ids = new Set([definition.strategy_definition_id, ...strategyVersions.map((item) => item.strategy_version_id), ...strategyInstances.map((item) => item.strategy_instance_id)].filter(Boolean));
  const recentAudit = [...auditByAggregate.entries()].filter(([id]) => ids.has(id)).flatMap(([, items]) => items).sort((a, b) => String(b.created_at_utc || b.created_at || "").localeCompare(String(a.created_at_utc || a.created_at || ""))).slice(0, 10);
  return { ...definition, latest_version: strategyVersions[0] || null, published_version: published, live_instance: live, paper_instance: paper, version_count: strategyVersions.length, instance_count: strategyInstances.length, audit_count: recentAudit.length, versions: strategyVersions, instances: strategyInstances, recent_audit: recentAudit, operator_state: operatorState({ strategyVersions, strategyInstances, published, live, paper }) };
}

function operatorState({ strategyVersions, strategyInstances, published, live, paper }) {
  const next = !strategyVersions.length ? "CREATE_VERSION" : !published ? "VALIDATE_AND_PUBLISH_VERSION" : !strategyInstances.length ? "CREATE_SHADOW_INSTANCE" : live ? "MONITOR_LIVE_INSTANCE" : paper ? "EVALUATE_PAPER_PROMOTION" : "RUN_SHADOW_VALIDATION";
  return { has_definition: true, has_published_version: Boolean(published), has_runtime_instance: strategyInstances.length > 0, has_live_instance: Boolean(live), recommended_next_step: next };
}

function groupBy(items, key) { return items.reduce((groups, item) => { const value = item?.[key]; if (value) { if (!groups.has(value)) groups.set(value, []); groups.get(value).push(item); } return groups; }, new Map()); }
function statusCounts(items, key) { return items.reduce((counts, item) => { const status = upper(item?.[key] || "UNKNOWN"); counts[status] = (counts[status] || 0) + 1; return counts; }, {}); }
function response(contract, payload) { return { contract, schemaVersion: "strategy_registry_rest_v2", ...payload }; }
function upper(value) { return String(value || "").toUpperCase(); }
