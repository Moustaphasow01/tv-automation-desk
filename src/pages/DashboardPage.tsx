import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { refreshPolicyMs } from "@/api/endpoints";
import { operationsApi } from "@/api/operationsApi";
import { Card, DataSourceBadge, Icon, InlineStateCard } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading, ProgressBar, StatusTag } from "@/components/operations";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSessionBase } from "@/hooks/useDesk";
import { operationsKeys, useOperationsSummary, useReplays } from "@/hooks/useOperations";
import { replayLabel } from "@/lib/presentation";

export default function DashboardPage() {
  const { sessionId, phaseLabel, nextPhaseAt } = useDeskContext();
  const live = useDeskSessionBase(sessionId, {
    refetchInterval: refreshPolicyMs.projection,
    retry: 2,
    refetchOnMount: "always",
    refetchOnReconnect: true
  });
  const operations = useOperationsSummary();
  const replays = useReplays({ limit: 40 });
  const performance = useQuery({ queryKey: [...operationsKeys.performance, "dashboard"], queryFn: () => operationsApi.getPerformance({}), staleTime: 60_000, refetchInterval: 60_000 });

  const workflowTotals = operations.data?.totals;
  const perfTotals = performance.data?.totals;
  const healthStatus = worstStatus([queryStatus(live), queryStatus(operations), queryStatus(replays), queryStatus(performance)]);
  const activeReplay = replays.data?.items.find(item => ["running", "waiting_gpt", "blocked", "failed"].includes(item.status)) || replays.data?.items[0] || null;

  return <section className="view workspace-view dashboard-v1">
    <PageHeading
      eyebrow="Command center"
      title="Vue Aujourd’hui"
      subtitle={`Session automatique ${phaseLabel} · prochaine phase ${nextPhaseAt} · données locales réelles`}
      actions={<><DataSourceBadge label="POSTGRES + API"/><button className="secondary-btn" onClick={() => { live.refetch(); operations.refetch(); replays.refetch(); performance.refetch(); }}><Icon name="refresh" size={14}/>Actualiser</button></>}
    />

    <MetricStrip className="metric-strip--six dashboard-health-strip">
      <MetricCard label="Santé front/API" value={healthLabel(healthStatus)} tone={healthTone(healthStatus)} detail={healthDetail(healthStatus)}/>
      <MetricCard label="Session" value={live.data?.label || "—"} detail={live.isLoading ? "lecture live" : sessionId}/>
      <MetricCard label="Workflows" value={workflowTotals?.workflows ?? "—"} detail={`${workflowTotals?.running ?? 0} actifs · ${workflowTotals?.waitingGpt ?? 0} GPT`}/>
      <MetricCard label="Incidents ouverts" value={workflowTotals?.openIncidents ?? "—"} tone={workflowTotals?.openIncidents ? "warning" : "positive"}/>
      <MetricCard label="Performance nette" value={perfTotals ? `${signed(perfTotals.totalR)} R` : "—"} tone={perfTotals && perfTotals.totalR < 0 ? "critical" : "positive"} detail={perfTotals ? `${perfTotals.trades} trades` : "attente"}/>
      <MetricCard label="Replay actifs" value={replays.data?.items.filter(item => item.status !== "completed").length ?? "—"} detail={`${replays.data?.items.length ?? 0} runs lus`}/>
    </MetricStrip>

    <div className="dashboard-grid">
      <Card className="dashboard-system-card">
        <header><div><p className="eyebrow">Flux systèmes</p><h2>Latence et disponibilité perçues</h2></div><StatusTag status={healthStatus === "ok" ? "completed" : healthStatus === "warning" ? "waiting_gpt" : "failed"}/></header>
        <div className="system-flux-list">
          <SystemFluxRow label="Live session" query={live} href="/live"/>
          <SystemFluxRow label="Operations summary" query={operations} href="/operations"/>
          <SystemFluxRow label="Replay ledger" query={replays} href="/replay"/>
          <SystemFluxRow label="Performance overview" query={performance} href="/performance/analysis"/>
        </div>
      </Card>

      <Card className="dashboard-risk-card">
        <header><div><p className="eyebrow">Risk cockpit</p><h2>Ce qui mérite attention</h2></div><span>{warningCount([live, operations, replays, performance])} signaux</span></header>
        <ul>
          <li><strong>{workflowTotals?.failed ?? 0}</strong><span>workflows en échec</span></li>
          <li><strong>{workflowTotals?.blocked ?? 0}</strong><span>workflows bloqués</span></li>
          <li><strong>{workflowTotals?.waitingGpt ?? 0}</strong><span>en attente GPT</span></li>
          <li><strong>{perfTotals ? signed(perfTotals.maxDrawdownR) : "—"}</strong><span>max drawdown R</span></li>
        </ul>
        {activeReplay && <Link className="dashboard-active-run" to={`/replay/runs/${encodeURIComponent(activeReplay.sourceId)}`}>
          <span>Replay surveillé</span><strong>{replayLabel(activeReplay.sourceId)}</strong><ProgressBar value={activeReplay.progress} status={activeReplay.status}/>
        </Link>}
      </Card>
    </div>

    <div className="dashboard-grid dashboard-grid--three">
      <Card className="dashboard-shortcuts">
        <header><p className="eyebrow">Raccourcis opérateur</p><h2>Actions fréquentes</h2></header>
        <div>
          <Link to="/live"><Icon name="live"/><span><strong>Live Desk</strong><small>Décision et contexte live</small></span></Link>
          <Link to="/operations"><Icon name="monitor"/><span><strong>Workflows</strong><small>Runs, queue, actions</small></span></Link>
          <Link to="/replay/compare"><Icon name="change"/><span><strong>Comparer</strong><small>Baselines et variantes</small></span></Link>
          <Link to="/performance/analysis"><Icon name="chart"/><span><strong>Performance</strong><small>Equity, risk, trade tape</small></span></Link>
        </div>
      </Card>

      <Card className="dashboard-source-ledger">
        <header><p className="eyebrow">Audit source front</p><h2>Origine des données affichées</h2></header>
        <dl>
          <dt>Live</dt><dd>projection front courante · {queryStatus(live)}</dd>
          <dt>Operations</dt><dd>ledger workflows PostgreSQL · {queryStatus(operations)}</dd>
          <dt>Replay</dt><dd>runs et sessions PostgreSQL · {queryStatus(replays)}</dd>
          <dt>Performance</dt><dd>trades/equity matérialisés · {queryStatus(performance)}</dd>
        </dl>
      </Card>

      <InlineStateCard
        code="NO_MOCK_POLICY"
        title="Préprod locale sans donnée simulée"
        text="Les écrans peuvent afficher des états vides ou timeout si la base locale/API ne répond pas. C’est volontaire : mieux vaut un état réel incomplet qu’un cockpit faussement rassurant."
        action={<Link className="secondary-btn" to="/operations/observability">Voir observabilité</Link>}
      />
    </div>
  </section>;
}

function SystemFluxRow({ label, query, href }: { label: string; query: { isLoading: boolean; isError: boolean; error: unknown; data: unknown }; href: string }) {
  const status = queryStatus(query);
  return <Link to={href} data-status={status}>
    <i aria-hidden="true"/><span><strong>{label}</strong><small>{query.isError ? errorMessage(query.error) : query.isLoading ? "requête en cours" : "réponse réelle reçue"}</small></span><em>{status}</em>
  </Link>;
}

function queryStatus(query: { isLoading: boolean; isError: boolean; data?: unknown }) {
  if (query.isError) return "error";
  if (query.isLoading) return "loading";
  if (query.data) return "ok";
  return "empty";
}

function worstStatus(statuses: string[]) {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("loading")) return "warning";
  return "ok";
}

function healthLabel(status: string) {
  if (status === "ok") return "OK";
  if (status === "warning") return "ATTENTE";
  return "DÉGRADÉ";
}

function healthTone(status: string) {
  if (status === "ok") return "positive";
  if (status === "warning") return "warning";
  return "critical";
}

function healthDetail(status: string) {
  if (status === "ok") return "sources synchronisées";
  if (status === "warning") return "synchronisation en cours";
  return "reconnexion automatique active";
}

function warningCount(queries: Array<{ isLoading: boolean; isError: boolean }>) {
  return queries.filter(query => query.isLoading || query.isError).length;
}

function signed(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "erreur inconnue";
}
