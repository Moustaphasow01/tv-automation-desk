import { Link, useParams, useSearchParams } from "react-router-dom";
import { DataTable } from "@/design-system/data";
import { Card, KpiCard, StatusBadge } from "@/design-system/primitives";
import { MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView } from "@/domains/front-api/repositories";
import type { ExplorerView } from "@/domains/front-api/viewModels";

type ExplorerViewName =
  | "research-experiments" | "research-candidates" | "research-dataset-detail" | "strategy-deployments"
  | "replay-overview" | "replay-runs" | "replay-run-detail" | "replay-compare"
  | "performance-overview" | "performance-calendar" | "performance-day-detail" | "performance-strategies" | "performance-trades"
  | "workflow-detail" | "event-detail" | "operations-runbooks" | "governance-prompts" | "governance-policies";

type ExplorerProps = { viewName: ExplorerViewName; title: string; description: string; backTo: string; backLabel: string; params?: Readonly<Record<string, string | undefined>> };

function ExplorerPage({ viewName, title, description, backTo, backLabel, params = {} }: ExplorerProps) {
  const query = useFrontView(viewName, params);
  if (query.isLoading) return <main className="route-loading" aria-busy="true" aria-live="polite"><span>Chargement · {title}…</span></main>;
  if (query.isError || !query.data) return <Card title={`${title} indisponible`} eyebrow="ERREUR CONTRAT" tone="danger" density="compact"><p>{query.error instanceof Error ? query.error.message : "Projection BFF absente."}</p></Card>;
  const { data, meta } = query.data;
  const selected = data.items[0] ?? null;
  return (
    <div className="operator-page explorer-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader title={title} description={description || data.summary.description} actions={<Link className="operator-primary-action" to={backTo}>{backLabel}</Link>} />
      <section className="operator-kpi-strip explorer-kpi-strip" aria-label={`Indicateurs ${title}`}>
        <KpiCard label="TOTAL" value={`${data.summary.total}`} delta="objets backend" />
        {data.summary.metrics.slice(0, 5).map((metric) => <KpiCard key={metric.label} label={metric.label.toUpperCase()} value={metric.value} delta="projection autoritaire" tone={metricTone(metric.value)} />)}
      </section>
      <section className="operator-grid operator-grid--top explorer-grid" aria-label={`${title} et détails`}>
        <Card title="Objets publiés" eyebrow={data.summary.title.toUpperCase()} density="compact">
          <DataTable columns={explorerColumns} rows={data.items} rowKey={(row) => row.id} caption={title} emptyLabel="Aucun objet publié pour ce périmètre." />
        </Card>
        <Card title="Objet en focus" eyebrow={selected?.status ?? "EMPTY"} density="compact" state={selected ? "nominal" : "empty"}>
          {selected ? <div className="explorer-focus"><div><strong>{selected.title}</strong><p>{selected.subtitle}</p><small className="explorer-object-id"><span>Identifiant</span>{selected.id}</small><StatusBadge tone={statusTone(selected.status)}>{selected.status}</StatusBadge></div><div className="reconciliation-grid"><MetricBox label="Valeur" value={selected.primary} /><MetricBox label="Contexte" value={selected.secondary} />{selected.facts.slice(0, 6).map((item) => <MetricBox key={item.label} label={item.label} value={item.value} />)}</div>{selected.route ? <Link to={selected.route}>Ouvrir le détail partagé</Link> : null}</div> : <p className="empty-state">Le backend n'a publié aucun objet. Aucun exemple fictif n'est injecté.</p>}
        </Card>
        <Card title="Contexte & filtres" eyebrow="URL STATE" density="compact"><div className="operational-detail-list">{Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => <article key={key}><div><strong>{key}</strong><small>Paramètre de requête</small></div><b>{value}</b></article>)}</div><p>{meta.warnings?.length ? meta.warnings.join(" · ") : "Toutes les sources demandées ont répondu."}</p></Card>
      </section>
      <section className="operator-grid operator-grid--bottom explorer-bottom" aria-label={`${title} classification et provenance`}>
        <Card title="États publiés" eyebrow="BREAKDOWN" density="compact"><StatusBreakdown items={data.items} /></Card>
        <Card title="Tags & relations" eyebrow="CONTEXT" density="compact"><ExplorerTagCloud tags={data.items.flatMap((item) => item.tags)} /></Card>
        <Card title="Vérité de la vue" eyebrow="PROVENANCE" density="compact"><div className="reconciliation-grid"><MetricBox label="Disponibilité" value={meta.availability ?? "AVAILABLE"} /><MetricBox label="Stale" value={meta.stale ? "Oui" : "Non"} /><MetricBox label="Latence" value={`${meta.latencyMs} ms`} /><MetricBox label="Corrélation" value={meta.correlationId} /></div></Card>
      </section>
    </div>
  );
}

function StatusBreakdown({ items }: { items: ExplorerView["items"] }) {
  const counts = [...items.reduce((map, item) => map.set(item.status, (map.get(item.status) ?? 0) + 1), new Map<string, number>())];
  return counts.length ? <div className="operational-detail-list">{counts.map(([status, count]) => <article key={status}><StatusBadge tone={statusTone(status)}>{status}</StatusBadge><b>{count}</b></article>)}</div> : <p className="empty-state">Aucun état à agréger.</p>;
}

function ExplorerTagCloud({ tags }: { tags: readonly string[] }) {
  const publishedTags = unique(tags).slice(0, 24);
  if (!publishedTags.length) return <p className="empty-state">Aucun tag ou relation publié.</p>;
  return <div className="tag-cloud" role="region" tabIndex={0} aria-label="Tags et relations publiés">{publishedTags.map((tag) => <StatusBadge key={tag} tone="info">{tag}</StatusBadge>)}</div>;
}

const explorerColumns = [
  { key: "object", header: "Objet", render: (row: ExplorerView["items"][number]) => row.route ? <Link to={row.route}><strong>{row.title}</strong></Link> : <strong>{row.title}</strong> },
  { key: "context", header: "Contexte", render: (row: ExplorerView["items"][number]) => row.subtitle },
  { key: "status", header: "État", render: (row: ExplorerView["items"][number]) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
  { key: "primary", header: "Valeur", render: (row: ExplorerView["items"][number]) => <b>{row.primary}</b> },
  { key: "secondary", header: "Détail", render: (row: ExplorerView["items"][number]) => row.secondary }
] as const;

function unique(values: readonly string[]) { return [...new Set(values.filter(Boolean))]; }
function statusTone(value: string) { const normalized = value.toUpperCase(); if (["OK", "READY", "ACTIVE", "MATCHED", "COMPLETED", "DONE", "SUCCEEDED", "POSITIVE", "WIN", "PASS"].includes(normalized)) return "success" as const; if (["ERROR", "FAILED", "BLOCKED", "CRITICAL", "DOWN", "MISMATCH", "NEGATIVE", "LOSS", "REJECTED"].includes(normalized)) return "danger" as const; if (["WARNING", "WATCH", "DEGRADED", "LATE", "DELAYED", "INCOMPLETE", "NOT_RUN", "DRIFT"].includes(normalized)) return "warning" as const; if (["WAITING", "SCHEDULED", "RUNNING", "QUEUED", "UNDER_REVIEW"].includes(normalized)) return "info" as const; return "neutral" as const; }
function metricTone(value: string) { return value.startsWith("-") ? "danger" as const : value.startsWith("+") ? "success" as const : "neutral" as const; }

export function ResearchExperimentsPage() { return <ExplorerPage viewName="research-experiments" title="Expériences" description="Hypothèses, progression, évaluations et accès aux runs." backTo="/research" backLabel="Research Lab" />; }
export function ResearchCandidatesPage() { return <ExplorerPage viewName="research-candidates" title="Candidats stratégie" description="Verdicts et éligibilité de promotion publiés par la Research Factory." backTo="/research" backLabel="Research Lab" />; }
export function ResearchDatasetDetailPage() { const { datasetId } = useParams(); return <ExplorerPage viewName="research-dataset-detail" title="Détail dataset" description="Lineage, couverture, cutoff et qualité point-in-time." backTo="/research/data" backLabel="Data Foundation" params={{ datasetId }} />; }
export function StrategyDeploymentsPage() { return <ExplorerPage viewName="strategy-deployments" title="Déploiements stratégie" description="Instances runtime, environnements, modes et heartbeat." backTo="/strategies" backLabel="Catalogue" />; }
export function ReplayOverviewPage() { return <ExplorerPage viewName="replay-overview" title="Replay" description="Vue globale des journées, progression et résultats éligibles." backTo="/command-center" backLabel="Command Center" />; }
export function ReplayRunsPage() { return <ExplorerPage viewName="replay-runs" title="Runs Replay" description="Runs filtrables, versions moteur et classification résultat." backTo="/replay" backLabel="Replay" />; }
export function ReplayRunDetailPage() { const { runId } = useParams(); return <ExplorerPage viewName="replay-run-detail" title="Détail Replay" description="Run, moteur, timeline et processus GPT." backTo="/replay/runs" backLabel="Runs Replay" params={{ runId }} />; }
export function ReplayComparePage() { const [search] = useSearchParams(); return <ExplorerPage viewName="replay-compare" title="Comparaison Replay" description="Comparaison backend de baselines et variantes." backTo="/replay/runs" backLabel="Runs Replay" params={{ ids: search.get("ids") ?? undefined }} />; }
export function PerformanceOverviewPage() { return <ExplorerPage viewName="performance-overview" title="Performance" description="Résultats officiels en R, risque et attribution." backTo="/command-center" backLabel="Command Center" />; }
export function PerformanceCalendarPage() { return <ExplorerPage viewName="performance-calendar" title="Calendrier de performance" description="Résultats par journée et accès au trade tape." backTo="/performance" backLabel="Performance" />; }
export function PerformanceDayDetailPage() { const { dayId } = useParams(); return <ExplorerPage viewName="performance-day-detail" title="Détail performance jour" description="Trades et attribution de la journée." backTo="/performance/calendar" backLabel="Calendrier" params={{ dayId }} />; }
export function PerformanceStrategiesPage() { return <ExplorerPage viewName="performance-strategies" title="Performance stratégies" description="Comparaison officielle par stratégie." backTo="/performance" backLabel="Performance" />; }
export function PerformanceTradesPage() { return <ExplorerPage viewName="performance-trades" title="Trade tape" description="Liste des trades utilisés par l'agrégation officielle." backTo="/performance" backLabel="Performance" />; }
export function WorkflowDetailPage() { const { workflowId } = useParams(); return <ExplorerPage viewName="workflow-detail" title="Détail workflow" description="Étapes, progression et résultat du workflow." backTo="/operations" backLabel="Operations Hub" params={{ workflowId }} />; }
export function EventDetailPage() { const { eventId } = useParams(); return <ExplorerPage viewName="event-detail" title="Détail événement" description="Payload, causalité et corrélation de l'événement." backTo="/operations/events" backLabel="Événements" params={{ eventId }} />; }
export function OperationsRunbooksPage() { return <ExplorerPage viewName="operations-runbooks" title="Runbooks" description="Procédures et étapes de reprise issues des anomalies réelles." backTo="/operations" backLabel="Operations Hub" />; }
export function GovernancePromptsPage() { return <ExplorerPage viewName="governance-prompts" title="Prompts & IA" description="Registre versionné, bindings, parité et évaluations." backTo="/settings" backLabel="Réglages" />; }
export function GovernancePoliciesPage() { return <ExplorerPage viewName="governance-policies" title="Policies" description="Politiques publiées par execution et observabilité." backTo="/settings" backLabel="Réglages" />; }
