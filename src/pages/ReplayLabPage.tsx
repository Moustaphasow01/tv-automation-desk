import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";

export default function ReplayLabPage() {
  const query = useReplays();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), session: "asia_open", strategyId: "asia_open", packId: "", packBuildId: "", start: "02:00", end: "10:00", cadence: "15m" });
  const create = useMutation({ mutationFn: () => {
    const suffix = `${form.date}_${form.session}_${Date.now()}`.replace(/[^a-zA-Z0-9]+/g, "_");
    return operationsApi.createReplay({ backtest_id: `replay_${suffix}`, strategy_id: form.strategyId, trading_date: form.date, date: form.date, session: form.session, pack_id: form.packId, pack_build_id: form.packBuildId, start_time: `${form.date}T${form.start}:00+02:00`, end_time: `${form.date}T${form.end}:00+02:00`, cadence: form.cadence, automation_enabled: true, idempotency_key: crypto.randomUUID() });
  }, onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: operationsKeys.all }); } });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay Lab indisponible"} retry={() => query.refetch()}/>;
  const { days, items } = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/>
    <PageHeading eyebrow="Research workspace" title="Replay Lab" subtitle="Évolution de tous les backtests, journées, sessions et processus GPT." actions={<><button className="primary-btn" onClick={() => setCreating(value => !value)}>Nouveau replay</button><Link className="secondary-btn" to="/replay/compare">Comparer</Link></>}/>
    {creating && <Card className="workspace-panel"><p className="eyebrow">Création canonique</p><h2>Lancer une journée replay</h2><p className="muted-copy">Le pack et son build doivent déjà être prêts dans le backend. La création est persistée et déclenche l’orchestration réelle.</p><div className="replay-create-form"><label>Date<input type="date" value={form.date} onChange={event => setForm(value => ({ ...value, date: event.target.value }))}/></label><label>Session<select value={form.session} onChange={event => setForm(value => ({ ...value, session: event.target.value, strategyId: event.target.value === "ny_open" ? "ny_open_1530" : "asia_open" }))}><option value="asia_open">Asia Open</option><option value="ny_open">NY Open</option></select></label><label>Stratégie<input value={form.strategyId} onChange={event => setForm(value => ({ ...value, strategyId: event.target.value }))}/></label><label>Pack ID<input value={form.packId} onChange={event => setForm(value => ({ ...value, packId: event.target.value }))}/></label><label>Pack build ID<input value={form.packBuildId} onChange={event => setForm(value => ({ ...value, packBuildId: event.target.value }))}/></label><label>Début<input type="time" value={form.start} onChange={event => setForm(value => ({ ...value, start: event.target.value }))}/></label><label>Fin<input type="time" value={form.end} onChange={event => setForm(value => ({ ...value, end: event.target.value }))}/></label><label>Cadence<select value={form.cadence} onChange={event => setForm(value => ({ ...value, cadence: event.target.value }))}><option value="15m">15 min</option><option value="30m">30 min</option><option value="60m">60 min</option></select></label><button className="primary-btn" disabled={!form.packId || !form.packBuildId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Création…" : "Créer et démarrer"}</button><button className="text-btn" onClick={() => setCreating(false)}>Annuler</button></div>{create.isError && <p className="form-error">{create.error.message}</p>}</Card>}
    <div className="metric-grid metric-grid--compact">
      <MetricCard label="Exécutions" value={items.length}/><MetricCard label="Journées" value={days.length}/>
      <MetricCard label="En cours" value={items.filter(item => item.status === "running").length} tone="info"/>
      <MetricCard label="Échecs" value={items.filter(item => item.status === "failed").length} tone="critical"/>
    </div>
    {!days.length ? <Card className="workspace-empty"><h3>Aucun replay enregistré</h3><p>Le Lab est connecté à PostgreSQL. Les runs créés par l’autopilot apparaîtront ici, sans jeu de données simulé côté front.</p></Card> : <div className="replay-day-grid">{days.map(day => <Card key={day.date} className="replay-day-card">
      <header><div><p className="eyebrow">Journée</p><h2>{day.date}</h2></div><StatusTag status={day.status}/></header>
      <div className="replay-day-card__metrics"><span><strong>{day.sessionCount}</strong> sessions</span><span><strong>{day.totalR.toFixed(2)} R</strong> cumulé</span></div>
      <ProgressBar value={day.totalProgress}/>
      <div className="session-preview-list">{day.sessions.slice(0, 4).map((session, index) => <Link key={session.id} to={`/replay/runs/${encodeURIComponent(session.sourceId)}/days/${day.date}`}><span>{session.session || "session"} · tentative {index + 1}</span><StatusTag status={session.status}/></Link>)}</div>
      <Link className="row-link" to={`/replay/runs/${encodeURIComponent(day.sessions[0].sourceId)}/days/${day.date}`}>Explorer la journée <span>→</span></Link>
    </Card>)}</div>}
  </section>;
}
