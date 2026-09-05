import { number, objectFacts, rows, upper } from "./front-control-plane-projection-helpers.js";
import { explorerItem, explorerView, metric, requiredQuery } from "./front-control-plane-view-values.js";
import { codedError, text } from "./front-control-plane-common.js";

export function researchExperimentsExplorer({ research }) {
  const items = rows(research?.experiments).filter((item) => item?.research_experiment_id).map((item) => explorerItem({
    id: item.research_experiment_id,
    title: item.name,
    subtitle: item.objective,
    status: item.status,
    primary: `${number(item.counts?.evaluation_reports, 0)} rapports`,
    secondary: text(item.comparison_metric, "métrique non publiée"),
    route: `/research/experiments/${encodeURIComponent(String(item.research_experiment_id))}`,
    tags: [item.owner, item.metadata?.mission_id],
  }));
  return explorerView("Expériences", "Hypothèses, évaluations et progression des expériences de recherche.", items, [
    metric("Actives", items.filter((item) => ["ACTIVE", "RUNNING"].includes(upper(item.status))).length),
    metric("Terminées", items.filter((item) => upper(item.status) === "COMPLETED").length),
    metric("Rapports", rows(research?.evaluation_reports).length),
  ]);
}

export function researchCandidatesExplorer({ research }) {
  const reports = new Map(rows(research?.evaluation_reports).map((item) => [item.research_candidate_id, item]));
  const items = rows(research?.candidates).filter((item) => item?.research_candidate_id).map((item) => {
    const report = reports.get(item.research_candidate_id) || {};
    return explorerItem({
      id: item.research_candidate_id,
      title: item.primary_change_summary || item.name || "Candidat stratégie",
      subtitle: `Expérience ${text(item.research_experiment_id, "—")}`,
      status: item.status,
      primary: text(item.last_evaluation_verdict || report.verdict, "Verdict indisponible"),
      secondary: report.score == null ? "Score indisponible" : `Score ${number(report.score, 0).toFixed(2)}`,
      route: item.research_experiment_id ? `/research/experiments/${encodeURIComponent(String(item.research_experiment_id))}` : undefined,
      tags: [report.report_kind],
    });
  });
  return explorerView("Candidats stratégie", "Verdicts, preuves et statut de promotion sans décision reconstruite côté UI.", items, [
    metric("À revoir", items.filter((item) => upper(item.status).includes("REVIEW")).length),
    metric("Promotion ready", items.filter((item) => upper(item.status) === "PROMOTION_READY").length),
    metric("Rejetés", items.filter((item) => upper(item.status) === "REJECTED").length),
  ]);
}

export function researchDatasetDetailExplorer({ dataFoundation, query }) {
  const datasetId = requiredQuery(query, "datasetId", "DATASET_ID_REQUIRED");
  const source = rows(dataFoundation).find((item) => String(item.dataset_id) === datasetId);
  if (!source) throw codedError("DATASET_NOT_FOUND", `Unknown dataset: ${datasetId}`, 404);
  const metadata = source.metadata || {};
  return explorerView("Détail dataset", text(source.name || source.dataset_key, datasetId), [explorerItem({
    id: datasetId,
    title: text(source.name || source.dataset_key, datasetId),
    subtitle: `${text(source.time_range_start_utc, "—")} → ${text(source.time_range_end_utc, "—")}`,
    status: source.status,
    primary: text(source.provenance_hash, "Provenance indisponible"),
    secondary: source.cutoff_utc ? `Cutoff ${source.cutoff_utc}` : "Cutoff indisponible",
    tags: [metadata.instrument, metadata.timeframe, metadata.timezone],
    facts: objectFacts(source, ["dataset_id", "dataset_key", "status", "cutoff_utc", "provenance_hash", "schema_version"]),
  })], [metric("Point-in-time", source.cutoff_utc ? "Oui" : "Non"), metric("Instrument", text(metadata.instrument, "—")), metric("Granularité", text(metadata.timeframe, "—"))]);
}
