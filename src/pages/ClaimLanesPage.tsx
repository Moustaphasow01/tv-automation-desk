import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi, type ClaimLaneState } from "@/api/operationsApi";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading, PageTabs, StatusTag, formatDateTime } from "@/components/operations";

export default function ClaimLanesPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["operations", "claim-lanes"],
    queryFn: operationsApi.getClaimLanes,
    refetchInterval: 10_000,
  });
  const action = useMutation({
    mutationFn: ({ lane, state }: { lane: "live" | "replay"; state: ClaimLaneState }) =>
      operationsApi.executeClaimLaneAction(lane, {
        action: state.enabled ? "pause" : "resume",
        expected_revision: state.revision,
        reason: state.enabled ? "Pause opérateur depuis le cockpit des files" : "Reprise opérateur depuis le cockpit des files",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operations", "claim-lanes"] }),
  });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Supervision des files indisponible"} retry={() => query.refetch()}/>;
  const { live, replay } = query.data.lanes;

  return <section className="view workspace-view claim-lanes-view">
    <PageHeading eyebrow="Automatisation" title="Files LIVE & REPLAY" subtitle="Deux chaînes de claim indépendantes, pilotées et observées depuis PostgreSQL." actions={<><DataSourceBadge label="POSTGRES"/><button className="secondary-btn" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button></>} tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Files GPT", to: "/operations/claim-lanes" }, { label: "Exécution", to: "/operations/execution" }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }]}/>}/>
    <MetricStrip className="metric-strip--six">
      <MetricCard label="File LIVE" value={live.status} tone={live.enabled ? "positive" : "critical"} detail={`${live.counts.due || 0} dus · ${live.counts.leased || 0} réclamé`}/>
      <MetricCard label="Curseurs LIVE" value={live.counts.total_cursors || 0} detail={`${live.counts.degraded || 0} dégradés`}/>
      <MetricCard label="File REPLAY" value={replay.status} tone={replay.enabled ? "positive" : "critical"} detail={`${replay.counts.ready || 0} prêts · ${replay.counts.claimed || 0} réclamés`}/>
      <MetricCard label="Configs Replay" value={replay.counts.ready_configs || 0} detail="disponibles replay-v4"/>
      <MetricCard label="Préparations" value={replay.counts.preparations_waiting || 0} detail="en audit ou confirmation"/>
      <MetricCard label="Échecs Replay" value={replay.counts.failed || 0} tone={replay.counts.failed ? "critical" : "neutral"}/>
    </MetricStrip>
    {action.isError && <Card className="claim-lane-error"><strong>Commande refusée</strong><span>{action.error.message}</span></Card>}
    <div className="claim-lane-grid">
      <LaneCard lane={live} pending={action.isPending} onToggle={() => action.mutate({ lane: "live", state: live })}/>
      <LaneCard lane={replay} pending={action.isPending} onToggle={() => action.mutate({ lane: "replay", state: replay })}/>
    </div>
    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Ledger courant</p><h2>Éléments visibles par les workers</h2></div><span>{live.items.length + replay.items.length} éléments récents</span></header>
      <div className="claim-lane-ledgers">
        <LaneLedger title="Curseurs LIVE" lane="live" items={live.items}/>
        <LaneLedger title="Work items REPLAY" lane="replay" items={replay.items}/>
      </div>
    </section>
  </section>;
}

function LaneCard({ lane, pending, onToggle }: { lane: ClaimLaneState; pending: boolean; onToggle: () => void }) {
  const live = lane.lane === "live";
  return <Card className="claim-lane-card" data-enabled={lane.enabled}>
    <header><div><p className="eyebrow">{live ? "Temps réel" : "Recherche"}</p><h2>File {lane.lane.toUpperCase()}</h2></div><StatusTag status={lane.enabled ? "running" : "paused"}/></header>
    <p>{live ? "Master et Monitors GPT M15, plus événements critiques, avec suivi déterministe M1. Aucun fallback vers Replay." : "Configs Replay et work items séquentiels. Aucun accès aux curseurs LIVE."}</p>
    <dl>
      {Object.entries(lane.counts).slice(0, 8).map(([label, value]) => <div key={label}><dt>{label.replaceAll("_", " ")}</dt><dd>{value}</dd></div>)}
    </dl>
    <footer><span>Révision {lane.revision}{lane.updated_at_utc ? ` · ${formatDateTime(lane.updated_at_utc)}` : ""}</span><button className={lane.enabled ? "danger-btn" : "primary-btn"} disabled={pending} onClick={onToggle}>{lane.enabled ? "Mettre en pause" : "Réactiver la file"}</button></footer>
  </Card>;
}

function LaneLedger({ title, lane, items }: { title: string; lane: "live" | "replay"; items: Array<Record<string, unknown>> }) {
  return <Card className="claim-lane-ledger"><header><h3>{title}</h3><span>{items.length}</span></header>{!items.length ? <p className="muted-copy">Aucun élément matérialisé.</p> : <ol>{items.map((item, index) => {
    const id = String(item.cursor_id || item.work_item_id || `item-${index}`);
    const status = String(item.cursor_status || item.status || "unknown");
    const detail = lane === "live"
      ? `${String(item.trading_date || "—")} · ${String(item.session || "—")}`
      : `${String(item.workflow || "REPLAY")} · ${String(item.backtest_id || "—")}`;
    return <li key={id}><div><strong>{id}</strong><small>{detail}</small></div><StatusTag status={status}/></li>;
  })}</ol>}</Card>;
}
