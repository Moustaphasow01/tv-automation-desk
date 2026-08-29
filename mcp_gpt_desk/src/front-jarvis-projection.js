import { canonicalSha256 } from "@tv-automation/desk-domain";
import { canonicalIncidentMetrics } from "./front-control-plane-incident-projection.js";

export function jarvisWorkspace(input = {}) {
  const source = jarvisSources(input);
  const providers = providerRows(source.execution);
  const signals = rows(source.strategySignals).filter(hasSignalId).map(signalRow);
  const sourceAgents = rows(source.runtime).filter(hasAgentRuntimeIdentity);
  const sourceIncidents = canonicalIncidentMetrics(source.incidents).rawOpen;
  const datasets = rows(source.dataFoundation).filter(hasDatasetId);
  const experiments = rows(source.researchExperiments).filter(hasExperimentId);
  const candidates = rows(source.researchCandidates).filter(hasCandidateId);
  const reports = rows(source.researchReports).filter(hasEvaluationReportId);
  const riskUsedPct = riskUsagePercent(source.risk, source.execution);
  const freshnessSeconds = dataReadinessAge(source.health);
  const citations = jarvisCitations({ datasets, health: source.health, providers, risk: source.risk, sourceIncidents });
  const brief = jarvisBrief({ ...source, candidates, datasets, experiments, providers, reports, riskUsedPct, signals, sourceIncidents });
  const suggestions = jarvisSuggestions({ candidates, datasets, providers, reports, sourceIncidents });
  const missions = jarvisDomainMissions({ sourceAgents, experiments, signals, providers, datasets, risk: source.risk });
  return {
    summary: {
      activeAgents: missions.length,
      openSuggestions: suggestions.length,
      pendingActions: 0,
      freshnessSeconds,
      morningBriefStatus: morningBriefStatus(brief, freshnessSeconds),
      voiceStatus: "OFF",
    },
    missions,
    morningBrief: brief,
    suggestions,
    conversation: jarvisConversation({ ai: source.ai, assistantRuntime: source.assistantRuntime, nowIso: source.nowIso, sourceIncidents }),
    citations,
    deskSnapshot: {
      liveSignals: signals.length,
      riskUsedPct,
      providersOk: countBy(providers, (item) => item.status === "OK"),
      providersTotal: providers.length,
      researchExperiments: experiments.length,
      openIncidents: sourceIncidents.length,
    },
    pendingActions: [],
    alerts: sourceIncidents.slice(0, 6).map(jarvisAlertRow),
    voice: {
      serviceStatus: "OFF",
      pushToTalkAvailable: false,
      lastTranscript: "",
      degradationReason: "TD2-419: assistants conversationnels certifiés en lecture seule avant toute commande sensible.",
    },
    commands: [],
  };
}

function jarvisCitations({ datasets, health, providers, risk, sourceIncidents }) {
  const dataFreshness = dataFreshnessLabel(health);
  const providerFreshness = providerFreshnessLabel(providers);
  const riskSummary = riskSummaryView(risk);
  return [
    { citationId: "src_research_lab", label: `Research Lab · ${datasets.length} dataset(s)`, route: "/research", freshness: datasets.length ? "fresh" : "stale" },
    { citationId: "src_strategy_center", label: "Strategy Center · versions et instances", route: "/strategies", freshness: "fresh" },
    { citationId: "src_live_trading", label: "Live Trading · signal bus", route: "/live-trading", freshness: dataFreshness },
    { citationId: "src_portfolio_risk", label: `Portfolio/Risk · ${riskSummary.status}`, route: "/portfolio", freshness: riskSummary.freshness },
    { citationId: "src_execution_gateway", label: `Execution Gateway · ${providers.length} provider(s)`, route: "/execution/providers", freshness: providerFreshness },
    { citationId: "src_operations_incidents", label: `Incidents · ${sourceIncidents.length} ouvert(s)`, route: "/operations/incidents", freshness: sourceIncidents.length ? "degraded" : "fresh" },
  ];
}

function jarvisSources(input) {
  const research = object(input.research);
  const strategy = object(input.strategy);
  return {
    ai: input.ai,
    incidents: input.incidents,
    runtime: input.runtime,
    dataFoundation: input.dataFoundation,
    execution: input.execution,
    strategy,
    risk: input.risk,
    health: input.health,
    assistantRuntime: input.assistantRuntime,
    nowIso: input.nowIso,
    researchExperiments: research.experiments,
    researchCandidates: research.candidates,
    researchReports: research.evaluation_reports,
    strategySignals: strategy.signals,
  };
}

function morningBriefStatus(brief, freshnessSeconds) {
  if (!brief.length) return "MISSING";
  if (freshnessSeconds > 300) return "STALE";
  return "READY";
}

function dataFreshnessLabel(health) {
  const readiness = object(object(health).data_readiness);
  if (readiness.ok === false) return "degraded";
  if (dataReadinessAge(health) > 300) return "stale";
  return "fresh";
}

function providerFreshnessLabel(providers) {
  if (!providers.length) return "stale";
  if (providers.every((item) => item.status === "OK")) return "fresh";
  return "degraded";
}

function riskSummaryView(risk) {
  const summary = object(object(risk).summary);
  return { status: text(summary.status, "DATA_UNAVAILABLE"), freshness: Object.keys(summary).length ? "fresh" : "stale" };
}

function jarvisBrief({ ai, candidates, datasets, execution, experiments, health, providers, reports, riskUsedPct, signals, sourceIncidents, strategy }) {
  const dataState = dataBriefState(health);
  const providerStatus = providerBriefState(providers);
  const riskStatus = riskBriefState({ execution, strategy, riskUsedPct });
  const incidentStatus = incidentBriefState(sourceIncidents);
  const strategyView = strategySummaryView(strategy);
  const liveState = dataReadinessState(health);
  const aiStatus = aiSummaryStatus(ai);
  const incidentText = firstIncidentText(sourceIncidents);
  return [
    briefSection("brief_research", "Research", experiments.length ? "OK" : "WATCH", `${experiments.length} expérience(s), ${candidates.length} candidate(s), ${reports.length} rapport(s)`, experiments.length ? "Research Lab publié par le backend, exploitable en lecture seule." : "Aucune expérience active publiée dans la projection.", ["src_research_lab"]),
    briefSection("brief_strategy", "Strategies", strategyView.status, `${strategyView.definitions} stratégie(s), ${strategyView.instances} instance(s)`, "Jarvis ne crée pas de stratégie : il expose seulement les états publiés par Strategy Center.", ["src_strategy_center"]),
    briefSection("brief_live", "Live", dataState, `${signals.length} signal(aux) live visible(s), données ${liveState}`, aiStatus, ["src_live_trading"]),
    briefSection("brief_risk", "Risk", riskStatus, `Risque utilisé ${Math.round(riskUsedPct)}%`, "Le Risk Engine reste autoritaire ; Jarvis ne publie ni Target Position ni OrderIntent.", ["src_portfolio_risk"]),
    briefSection("brief_execution", "Execution", providerStatus, `${countBy(providers, (item) => item.status === "OK")}/${providers.length} provider(s) OK`, "Projection provider-neutral : aucun succès HTTP/provider n’est assimilé à un fill.", ["src_execution_gateway"]),
    briefSection("brief_incidents", "Incidents", incidentStatus, `${sourceIncidents.length} incident(s) ouvert(s)`, incidentText, ["src_operations_incidents"]),
  ];
}

function dataBriefState(health) {
  const readiness = object(object(health).data_readiness);
  if (readiness.ok === false) return "HIGH";
  if (dataReadinessAge(health) > 300) return "WATCH";
  return "OK";
}

function providerBriefState(providers) {
  if (!providers.length) return "HIGH";
  if (providers.every((item) => item.status === "OK")) return "OK";
  return "WATCH";
}

function riskBriefState({ execution, strategy, riskUsedPct }) {
  if (!object(execution).safety && !Object.keys(object(strategy)).length) return "WATCH";
  if (riskUsedPct > 80) return "HIGH";
  if (riskUsedPct > 50) return "WATCH";
  return "OK";
}

function incidentBriefState(sourceIncidents) {
  if (sourceIncidents.some((item) => severity(item.severity) === "HIGH")) return "HIGH";
  if (sourceIncidents.length) return "WATCH";
  return "OK";
}

function strategySummaryView(strategy) {
  const definitions = rows(object(strategy).definitions).length;
  const instances = rows(object(strategy).instances).length;
  return { definitions, instances, status: instances ? "OK" : "WATCH" };
}

function dataReadinessState(health) {
  return text(object(object(health).data_readiness).state, "unknown");
}

function aiSummaryStatus(ai) {
  return text(object(object(ai).summary).status, "AI Context est consultatif ; les signaux restent produits par le runtime déterministe.");
}

function firstIncidentText(sourceIncidents) {
  if (!sourceIncidents.length) return "Aucun incident ouvert dans la projection Jarvis.";
  const incident = sourceIncidents[0];
  return text(incident.title || incident.message, "Incident ouvert");
}

function jarvisSuggestions({ candidates, datasets, providers, reports, sourceIncidents }) {
  const suggestions = [{ suggestionId: "sug_jarvis_read_only_first", title: "Maintenir Jarvis en lecture seule", impact: "TD2-419 : les assistants contextualisent et diagnostiquent sans commande sensible ni accès broker.", sourceIds: ["src_operations_incidents", "src_execution_gateway"] }];
  if (candidates.length || reports.length) suggestions.push({ suggestionId: "sug_review_research_candidates", title: "Revoir les candidates Research publiées", impact: `${candidates.length} candidate(s) et ${reports.length} rapport(s) peuvent être inspectés avant promotion.`, sourceIds: ["src_research_lab"] });
  if (!datasets.length) suggestions.push({ suggestionId: "sug_restore_data_catalog", title: "Vérifier le catalogue data", impact: "Aucun dataset publié : Jarvis ne doit pas extrapoler les analyses Research.", sourceIds: ["src_research_lab"] });
  if (providers.some((item) => item.status !== "OK")) suggestions.push({ suggestionId: "sug_provider_health_watch", title: "Surveiller les providers dégradés", impact: "La projection Execution signale au moins un provider non OK ; rester en read-only/degraded.", sourceIds: ["src_execution_gateway"] });
  if (sourceIncidents.length) suggestions.push({ suggestionId: "sug_triage_open_incidents", title: "Trier les incidents ouverts", impact: "Les incidents sont exposés comme diagnostic, pas comme actions automatiques.", sourceIds: ["src_operations_incidents"] });
  return suggestions.slice(0, 6);
}

function jarvisConversation({ ai, assistantRuntime, nowIso, sourceIncidents }) {
  const persisted = rows(object(assistantRuntime).messages).map(jarvisPersistedMessage).filter(Boolean);
  return [
    { messageId: "msg_jarvis_system_read_only", role: "system", at: nowIso, text: "TD2-419 : Jarvis est un superviseur read-only. Il passe par le BFF, cite ses sources et ne contourne jamais Risk, Portfolio, Human Gate ou Execution.", citationIds: ["src_portfolio_risk", "src_execution_gateway"] },
    { messageId: "msg_jarvis_brief_current", role: "jarvis", at: nowIso, text: `Snapshot opérateur disponible : ${sourceIncidents.length} incident(s) ouvert(s), AI Context ${text(ai?.summary?.status, "consultatif")}.`, citationIds: ["src_live_trading", "src_operations_incidents"] },
    ...persisted,
  ].slice(-20);
}

function jarvisPersistedMessage(message) {
  const role = lower(message.role) === "operator" ? "operator" : lower(message.role) === "assistant" ? "jarvis" : "system";
  const textValue = text(message.text || message.content);
  if (!textValue) return null;
  return {
    messageId: text(message.messageId || message.assistant_message_id, `msg_${hash(textValue).slice(0, 12)}`),
    role,
    at: text(message.at || message.created_at_utc),
    text: textValue,
    citationIds: rows(message.citationIds || message.citation_refs).map((item) => text(item)).filter(Boolean),
  };
}

function jarvisDomainMissions({ sourceAgents, experiments, signals, providers, datasets, risk }) {
  return [
    { missionId: "assistant_research", title: "Assistant Research · expériences et candidates", ownerAgent: "jarvis-research-assistant", state: experiments.length ? "RUNNING" : "WAITING" },
    { missionId: "assistant_live_runtime", title: "Assistant Live · signaux et stratégie", ownerAgent: "jarvis-live-assistant", state: signals.length ? "RUNNING" : "WAITING" },
    { missionId: "assistant_portfolio_risk", title: "Assistant Portfolio/Risk · contraintes autoritaires", ownerAgent: "jarvis-risk-assistant", state: risk?.summary ? "RUNNING" : "NEEDS_OPERATOR" },
    { missionId: "assistant_execution", title: "Assistant Execution · providers et réconciliation", ownerAgent: "jarvis-execution-assistant", state: providers.length ? "RUNNING" : "NEEDS_OPERATOR" },
    { missionId: "assistant_data", title: "Assistant Data · fraîcheur et datasets", ownerAgent: "jarvis-data-assistant", state: datasets.length ? "DONE" : "NEEDS_OPERATOR" },
    { missionId: "assistant_platform_ops", title: "Assistant Ops · workers et incidents", ownerAgent: "jarvis-ops-assistant", state: sourceAgents.length ? "RUNNING" : "WAITING" },
  ];
}

function jarvisAlertRow(item) {
  return { alertId: text(item.incident_id, `incident_${hash(text(item.title || item.message, "incident")).slice(0, 8)}`), severity: severity(item.severity), title: text(item.title || item.message, "Incident ouvert"), route: `/operations/incidents/${encodeURIComponent(String(item.incident_id || ""))}` };
}

function briefSection(sectionId, domain, status, headline, detail, sourceIds) { return { sectionId, domain, status, headline, detail, sourceIds }; }
function providerRows(execution) { return rows(execution?.providers || execution?.providerStatus).map((item) => ({ status: providerState(item) })); }
function providerState(item) { const state = upper(item?.status || item?.health); if (item?.enabled === false || ["DOWN", "DISCONNECTED", "FAILED"].includes(state)) return "DOWN"; if (["DEGRADED", "STALE", "WATCH"].includes(state)) return "DEGRADED"; return "OK"; }
function signalRow(item) { return { signalId: text(item.signal_outbox_id || item.signal_id), state: upper(item.status || item.state || "ACTIVE") }; }
function riskUsagePercent(risk, execution) { return number(firstDefined([object(object(risk).summary).risk_percent, object(object(execution).safety).riskPercent]), 0); }
function dataReadinessAge(health) { return number(object(object(health).data_readiness).core_age_seconds, 0); }
function hasAgentRuntimeIdentity(item) { return Boolean(item?.worker_id || item?.task_id); }
function hasDatasetId(item) { return Boolean(item?.dataset_id); }
function hasExperimentId(item) { return Boolean(item?.research_experiment_id); }
function hasCandidateId(item) { return Boolean(item?.research_candidate_id); }
function hasEvaluationReportId(item) { return Boolean(item?.research_evaluation_report_id); }
function hasSignalId(item) { return Boolean(item?.signal_outbox_id || item?.signal_id); }
function hasIncidentId(item) { return Boolean(item?.incident_id || item?.id || item?.title || item?.message); }
function countBy(value, predicate) { return rows(value).filter(predicate).length; }
function rows(value) { return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []; }
function firstDefined(values, fallback = undefined) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function severity(value) { const normalized = upper(value); if (normalized === "CRITICAL") return "HIGH"; return ["LOW", "MEDIUM", "HIGH"].includes(normalized) ? normalized : "LOW"; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function upper(value) { return String(value ?? "").toUpperCase(); }
function lower(value) { return String(value ?? "").toLowerCase(); }
function hash(value) { return canonicalSha256(value); }
