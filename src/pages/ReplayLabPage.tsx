import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi, type ReplayPreparationJob } from "@/api/operationsApi";
import { Card, Drawer, ErrorView, Icon, LoadingView } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys, useOperationsEvents, useReplays } from "@/hooks/useOperations";
import { findActiveReplayDay, findCertifiedReplayDay, replayLabel, replayPulseHeadline } from "@/lib/presentation";
import type { ReplayDaySummary, ReplayList, WorkflowSummary } from "@/operationsTypes";

type ReplayFilters = { q: string; status: string; session: string; strategyId: string; from: string; to: string; versionScope: string };

const emptyFilters: ReplayFilters = { q: "", status: "", session: "", strategyId: "", from: "", to: "", versionScope: "v5" };

export default function ReplayLabPage() {
  useOperationsEvents();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<ReplayFilters>(emptyFilters);
  const deferredFilters = useDeferredValue(filters);
  const apiFilters = useMemo(() => ({
    q: deferredFilters.q || null,
    status: deferredFilters.status || null,
    session: deferredFilters.session || null,
    strategy_id: deferredFilters.strategyId || null,
    version_scope: deferredFilters.versionScope,
    from: deferredFilters.from || null,
    to: deferredFilters.to || null,
    limit: 500,
  }), [deferredFilters]);
  const query = useReplays(apiFilters);
  const [form, setForm] = useState<{
    date: string;
    cadence: "5m" | "15m" | "30m" | "60m";
  }>({ date: new Date().toISOString().slice(0, 10), cadence: "15m" });
  const preparationQuery = useQuery({
    queryKey: ["operations", "replay-preparations", form.date],
    queryFn: () => operationsApi.listReplayPreparations({ date: form.date, limit: 20 }),
    enabled: creating,
    refetchInterval: creating ? 2_000 : false,
  });
  const create = useMutation({
    mutationFn: () => operationsApi.createReplayPreparation({
      trading_date: form.date,
      cadence: form.cadence,
      worker_group: "replay-v4",
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations", "replay-preparations", form.date] });
    },
  });
  const preparationAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "retry" | "cancel" }) =>
      operationsApi.executeReplayPreparationAction(id, action),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["operations", "replay-preparations", form.date] }),
        client.invalidateQueries({ queryKey: operationsKeys.all }),
      ]);
    },
  });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay Lab indisponible"} retry={() => query.refetch()}/>;

  const { days, items } = query.data;
  const { summary } = query.data;
  const hasFilters = filters.versionScope !== "v5"
    || Object.entries(filters).some(([key, value]) => key !== "versionScope" && Boolean(value));

  if (!summary) return <ErrorView message="Replay Lab incomplet : le backend n’a pas renvoyé le résumé matérialisé. Aucun résumé n’est recalculé côté frontend." retry={() => query.refetch()}/>;

  return <section className="view workspace-view replay-lab-v3">
    <PageHeading eyebrow="Research workstation" title="Replay Lab" subtitle="Journées, sessions, tentatives, décisions et processus GPT sur données persistées." actions={<><button className="secondary-btn" disabled={query.isFetching} onClick={() => query.refetch()}>{query.isFetching ? "Actualisation…" : "Actualiser"}</button><button className="primary-btn" onClick={() => setCreating(value => !value)}>Nouveau replay</button><Link className="secondary-btn" to="/replay/compare">Comparer</Link></>} tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>
    <Drawer open={creating} title="Préparer un replay V5" onClose={() => !create.isPending && !preparationAction.isPending && setCreating(false)}>
      <div className="replay-preparation-wizard">
        <ol className="replay-preparation-steps" aria-label="Étapes de préparation">
          <li className="is-active"><span>1</span>Journée</li>
          <li><span>2</span>Données & pack</li>
          <li><span>3</span>Confirmation</li>
          <li><span>4</span>File GPT</li>
        </ol>
        <p className="muted-copy">Choisissez la journée. Le backend prépare un seul run continu, audite PostgreSQL, construit un pack immuable couvrant toute la fenêtre, crée les IDs puis publie le replay dans la file dédiée.</p>
        <div className="replay-create-form replay-preparation-form">
          <label>Date de marché<input type="date" value={form.date} onChange={event => setForm(value => ({ ...value, date: event.target.value }))}/></label>
          <div className="replay-session-choice replay-day-window"><Icon name="timeline" size={18}/><span><strong>Journée continue · 00:15 → 22:00 Paris</strong><small>Master initial 00:15 · analyses GPT M15 sans coupure · suivi déterministe M1 · replan Master New York 15:30 dans le même run</small></span></div>
          <label>Cadence d’analyse GPT<select value={form.cadence} onChange={event => setForm(value => ({ ...value, cadence: event.target.value as "5m" | "15m" | "30m" | "60m" }))}><option value="15m">15 minutes — référence active</option><option value="5m">5 minutes — historique / diagnostic</option><option value="30m">30 minutes</option><option value="60m">60 minutes</option></select></label>
          <div className="replay-preparation-callout"><Icon name="audit" size={16}/><div><strong>Aucun ID technique à saisir</strong><span>Pack, build, config et run restent traçables dans les détails avancés.</span></div></div>
          <button className="primary-btn replay-preparation-submit" disabled={!form.date || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Mise en file…" : "Auditer et préparer la journée"}</button>
        </div>
        {create.isError && <p className="form-error">{create.error.message}</p>}
        {preparationQuery.isError && <p className="form-error">{preparationQuery.error.message}</p>}
        {!!preparationQuery.data?.items.length && <section className="replay-preparation-jobs">
          <header><div><p className="eyebrow">Préparations de la journée</p><h3>Validation et publication</h3></div><button className="text-btn" onClick={() => preparationQuery.refetch()}>Actualiser</button></header>
          {preparationQuery.data.items.map(job => <ReplayPreparationCard key={job.preparation_id} job={job} pending={preparationAction.isPending} onAction={(action) => preparationAction.mutate({ id: job.preparation_id, action })}/>)}
        </section>}
        <div className="modal__actions"><button className="secondary-btn" disabled={create.isPending || preparationAction.isPending} onClick={() => setCreating(false)}>Fermer</button></div>
      </div>
    </Drawer>

    <ReplayPulseCard summary={summary} days={days}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={summary.executions} detail={`${summary.days} journées · ${scopeLabel(filters.versionScope)}`}/>
      <MetricCard label="Actives" value={summary.active} detail={`${summary.waitingGpt} attente GPT`} tone={summary.active ? "info" : "neutral"}/>
      <MetricCard label="Progression moy." value={`${Math.round(summary.averageProgress)}%`}/>
      <MetricCard label="Résultat éligible" value={`${summary.totalR.toFixed(2)} R`} detail={`${summary.resultEligible ?? 0} runs terminés`} tone={summary.totalR >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={summary.gptProcesses}/>
      <MetricCard label="Échecs" value={summary.failed} detail={`${summary.blocked} bloqués`} tone={summary.failed ? "critical" : "neutral"}/>
    </MetricStrip>

    <Card className="replay-filter-bar" aria-label="Filtres Replay Lab">
      <label className="replay-filter-search"><span>Recherche</span><div><Icon name="search" size={14}/><input aria-label="Rechercher un replay" placeholder="Journée, stratégie ou état…" value={filters.q} onChange={event => setFilters(value => ({ ...value, q: event.target.value }))}/></div></label>
      <label><span>Version</span><select aria-label="Filtrer par version du moteur" value={filters.versionScope} onChange={event => setFilters(value => ({ ...value, versionScope: event.target.value }))}><option value="v5">V5 — moteur actuel</option><option value="active">Runs actifs</option><option value="certified">Runs certifiés</option><option value="v4">V4 — historique</option><option value="legacy">Legacy antérieur</option><option value="all">Tous les runs</option></select></label>
      <label><span>État</span><select aria-label="Filtrer par état" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">En pause</option></select></label>
      <label><span>Session</span><select aria-label="Filtrer par session" value={filters.session} onChange={event => setFilters(value => ({ ...value, session: event.target.value }))}><option value="">Toutes</option><option value="asia_open">Session Asie</option><option value="ny_open">Session New York</option></select></label>
      <label><span>Stratégie</span><input aria-label="Filtrer par stratégie" placeholder="Nom de la stratégie…" value={filters.strategyId} onChange={event => setFilters(value => ({ ...value, strategyId: event.target.value }))}/></label>
      <label><span>Du</span><input aria-label="Date de début" type="date" value={filters.from} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))}/></label>
      <label><span>Au</span><input aria-label="Date de fin" type="date" value={filters.to} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))}/></label>
      <div className="replay-filter-bar__result"><strong>{query.data.count}</strong><span>résultats</span>{hasFilters && <button className="text-btn" onClick={() => setFilters(emptyFilters)}>Réinitialiser</button>}</div>
    </Card>

    {!days.length ? <Card className="workspace-empty replay-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_REPLAY" : "NO_REPLAY_MATERIALIZED"}</span><h3>{hasFilters ? "Aucun replay ne correspond aux filtres" : "Aucun replay enregistré"}</h3><p>Le Lab lit PostgreSQL directement. Aucun résultat, statut ou prix n’est simulé côté front.</p>{hasFilters && <button className="secondary-btn" onClick={() => setFilters(emptyFilters)}>Effacer les filtres</button>}</Card> : <>
      <ReplayEvolution days={days}/>
      <section className="replay-terminal-section">
        <header><div><p className="eyebrow">Vue consolidée</p><h2>Journées de backtest</h2></div><span>{days.length} journées · tri décroissant</span></header>
        <div className="data-table-wrap"><table className="data-table replay-overview-table">
          <thead><tr><th>Date</th><th>État</th><th>Sessions</th><th>Répartition</th><th>Progression</th><th>Résultat</th><th>Flux</th><th/></tr></thead>
          <tbody>{days.map(day => <ReplayDayRow key={day.date} day={day}/>)}</tbody>
        </table></div>
      </section>
      <section className="replay-terminal-section">
        <header><div><p className="eyebrow">Exécutions unitaires</p><h2>Runs, variantes et tentatives</h2></div><span>{items.length} lignes matérialisées</span></header>
        <div className="data-table-wrap"><table className="data-table replay-run-table">
          <thead><tr><th>Run</th><th>Session</th><th>Stratégie / variante</th><th>État</th><th>Progression</th><th>R</th><th>GPT</th><th>Mise à jour</th><th/></tr></thead>
          <tbody>{items.map(item => <ReplayRunRow key={item.id} item={item}/>)}</tbody>
        </table></div>
      </section>
    </>}
  </section>;
}

function ReplayPreparationCard({ job, pending, onAction }: {
  job: ReplayPreparationJob;
  pending: boolean;
  onAction: (action: "publish" | "retry" | "cancel") => void;
}) {
  const status = preparationStatus(job.status);
  return <article className="replay-preparation-job" data-status={job.status.toLowerCase()}>
    <header><div><strong>Journée continue · Run #{job.run_number}</strong><span>{job.start_time.slice(11, 16)} → {job.end_time.slice(11, 16)} · {job.cadence} · {job.aggregate_role === "primary" ? "agrégat principal" : "comparaison"}</span></div><StatusTag status={status}/></header>
    <ProgressBar value={job.progress_percent} status={status}/>
    <p>{job.error?.message || job.stages.at(-1)?.message || "Préparation en cours…"}</p>
    {job.status === "AWAITING_CONFIRMATION" && <div className="replay-preparation-confirm"><Icon name="check" size={15}/><span>Pack immuable validé {job.pack_reused ? "et réutilisé" : "et construit"}. Confirmez sa publication dans la file Replay GPT.</span></div>}
    <div className="inline-actions">
      {job.status === "AWAITING_CONFIRMATION" && <button className="primary-btn" disabled={pending} onClick={() => onAction("publish")}>Confirmer et publier</button>}
      {job.status === "FAILED" && <button className="primary-btn" disabled={pending} onClick={() => onAction("retry")}>Relancer l’audit</button>}
      {["QUEUED", "DATA_CHECK", "PACK_BUILDING", "AWAITING_CONFIRMATION"].includes(job.status) && <button className="text-btn" disabled={pending} onClick={() => onAction("cancel")}>Annuler</button>}
      {job.status === "QUEUED_FOR_GPT" && <span className="replay-preparation-published"><Icon name="check" size={13}/>Disponible pour le prochain claim GPT</span>}
    </div>
    <details><summary>Détails avancés</summary><dl><div><dt>Préparation</dt><dd>{job.preparation_id}</dd></div><div><dt>Exécution</dt><dd>{job.execution_id || "en attente"}</dd></div><div><dt>Pack</dt><dd>{job.pack_id || "en attente"}</dd></div><div><dt>Build</dt><dd>{job.pack_build_id || "en attente"}</dd></div><div><dt>Config</dt><dd>{job.config_id || "non publiée"}</dd></div><div><dt>Run futur</dt><dd>{job.backtest_id || "créé au premier claim"}</dd></div></dl></details>
  </article>;
}

function preparationStatus(status: ReplayPreparationJob["status"]) {
  if (status === "QUEUED_FOR_GPT") return "waiting_gpt";
  if (status === "AWAITING_CONFIRMATION") return "blocked";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "paused";
  return "running";
}

function ReplayPulseCard({ summary, days }: { summary: ReplayList["summary"]; days: ReplayDaySummary[] }) {
  const headline = replayPulseHeadline(summary);
  const certifiedDay = findCertifiedReplayDay(days);
  const activeDay = findActiveReplayDay(days);
  const context = certifiedDay
    ? `Dernier résultat certifié : ${certifiedDay.totalR.toFixed(2)} R · ${certifiedDay.date}`
    : "Aucun résultat certifié pour l’instant";

  const actionTarget = activeDay || certifiedDay;
  const actionParent = actionTarget ? (actionTarget.primaryRunId || actionTarget.sessions[0]?.sourceId || "") : "";
  const actionHref = !actionTarget ? null
    : activeDay
      ? `/replay/runs/${encodeURIComponent(actionParent)}`
      : `/replay/runs/${encodeURIComponent(actionParent)}/days/${actionTarget.date}`;
  const actionLabel = activeDay ? "Voir le replay en cours →" : "Voir le dernier résultat →";

  return <Card className="replay-pulse-card">
    <p className="eyebrow">Pouls du Replay</p>
    <h2>{headline}</h2>
    <p>{context}</p>
    {actionHref && <Link className="primary-btn" to={actionHref}>{actionLabel}</Link>}
  </Card>;
}

function ReplayEvolution({ days }: { days: ReplayDaySummary[] }) {
  const ordered = [...days].sort((left, right) => left.date.localeCompare(right.date));
  const active = [...ordered].filter((day) => !["completed", "cancelled"].includes(day.status)).reverse();
  const maxAbsR = Math.max(1, ...ordered.map((day) => Math.abs(day.totalR || 0)));
  return <Card className="replay-evolution-panel">
    <header><div><p className="eyebrow">Évolution des backtests</p><h2>Progression des runs et résultats certifiés</h2></div><span>{active.length} en cours · {ordered.length} journées</span></header>
    {!!active.length && <div className="replay-active-progress" aria-label="Progression des replays actifs">
      {active.map((day) => {
        const parent = day.primaryRunId || day.sessions[0]?.sourceId || "";
        return <Link key={day.date} to={`/replay/runs/${encodeURIComponent(parent)}`}>
          <div className="replay-active-progress__head"><strong>{day.date}</strong><StatusTag status={day.status}/></div>
          <ProgressBar value={day.totalProgress} status={day.status}/>
          <div className="replay-active-progress__meta">
            <span>{formatReplayCheckpoint(day.currentReplayTime)} / {formatReplayCheckpoint(day.endTime)}</span>
            <strong className={Number(day.provisionalR || 0) >= 0 ? "positive" : "negative"}>{day.provisionalR === null || day.provisionalR === undefined ? "R en calcul" : `${day.provisionalR.toFixed(2)} R provisoire`}</strong>
          </div>
        </Link>;
      })}
    </div>}
    <div className="replay-evolution-chart" role="img" aria-label="Évolution des journées de backtest">
      {ordered.map((day) => {
        const resultAvailable = Number(day.resultEligibleSessions || 0) > 0;
        const height = 12 + Math.round((Math.abs(day.totalR || 0) / maxAbsR) * 72);
        const parent = day.primaryRunId || day.sessions[0]?.sourceId || "";
        return <Link key={day.date} to={`/replay/runs/${encodeURIComponent(parent)}/days/${day.date}`} data-status={day.status} title={`${day.date} · ${resultAvailable ? `${day.totalR.toFixed(2)} R certifié` : "résultat en cours ou non certifié"} · ${day.sessionCount} exécutions`}>
          <i style={{ height }} data-positive={day.totalR >= 0}/><span>{day.date.slice(5)}</span><strong>{day.sessionCount}</strong>
        </Link>;
      })}
    </div>
  </Card>;
}

function ReplayDayRow({ day }: { day: ReplayDaySummary }) {
  const sessionCounts = countValues(day.sessions.map(item => item.session || "global"));
  const gpt = day.sessions.reduce((total, item) => total + Number(item.metrics.gptProcesses || 0), 0);
  const parent = day.primaryRunId || day.sessions[0]?.sourceId || "";
  const hasCertifiedResult = Number(day.resultEligibleSessions || 0) > 0;
  const hasProvisionalResult = day.provisionalR !== null && day.provisionalR !== undefined;
  const displayedResult = hasCertifiedResult ? day.totalR : day.provisionalR;
  return <tr>
    <td data-label="Date"><strong>{day.date}</strong><small>{day.sessionCount} exécutions</small></td>
    <td data-label="État"><StatusTag status={day.status}/></td>
    <td data-label="Sessions"><div className="replay-attempt-track" aria-label={`${day.sessionCount} exécutions`}>{day.sessions.slice(0, 12).map(session => <i key={session.id} data-status={session.status} title={`${session.session || "session"} · ${session.status}`}/>)}</div></td>
    <td data-label="Répartition"><div className="replay-session-counts">{Object.entries(sessionCounts).map(([label, count]) => <span key={label}>{shortSession(label)} <strong>{count}</strong></span>)}</div></td>
    <td data-label="Progression"><ProgressBar value={day.totalProgress} status={day.status}/><small>{formatReplayCheckpoint(day.currentReplayTime)} / {formatReplayCheckpoint(day.endTime)}</small></td>
    <td data-label="Résultat" className={Number(displayedResult || 0) >= 0 ? "positive" : "negative"}><strong>{displayedResult === null || displayedResult === undefined ? "En calcul" : `${displayedResult.toFixed(2)} R`}</strong><small>{hasCertifiedResult ? "certifié" : hasProvisionalResult ? "provisoire" : "aucune position valorisée"}</small></td>
    <td data-label="Flux"><span className="mono">{gpt} GPT</span><small>{day.running} actifs · {day.failed} échecs</small></td>
    <td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(parent)}/days/${day.date}`}>Explorer <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function ReplayRunRow({ item }: { item: WorkflowSummary }) {
  const result = item.metrics.totalR;
  const hasResult = result !== null && result !== undefined && Number.isFinite(Number(result));
  return <tr>
    <td data-label="Replay"><strong>{replayLabel(item.sourceId)}</strong><small>{item.tradingDate || "Date inconnue"} · {replayVersionLabel(item)} · exécution #{item.runNumber || item.attempt || 1}</small></td>
    <td data-label="Session"><strong>{item.runScope === "full_day" ? "Journée continue" : shortSession(item.session || "global")}</strong><small>{item.aggregateEligible ? "Agrégat principal" : item.resultEligibleCandidate ? "Comparaison" : item.currentPhase || item.kind}</small></td>
    <td data-label="Stratégie"><span>{item.strategyId || "—"}</span><small>{item.variantId || "default"}</small></td>
    <td data-label="État"><StatusTag status={item.status}/></td>
    <td data-label="Progression"><ProgressBar value={item.progress} status={item.status}/><small>{formatReplayCheckpoint(item.currentReplayTime)} / {formatReplayCheckpoint(item.endTime)}</small></td>
    <td data-label="Résultat" className={Number(result || 0) >= 0 ? "positive" : "negative"}>{hasResult ? <><strong>{Number(result).toFixed(2)} R</strong><small>{item.resultEligible ? "certifié" : "provisoire"}</small></> : "En calcul"}</td>
    <td data-label="GPT">{Number(item.metrics.gptProcesses || 0)}</td>
    <td data-label="Mise à jour"><time>{formatDateTime(item.updatedAt)}</time></td>
    <td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(item.sourceId)}`}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((output, value) => ({ ...output, [value]: (output[value] || 0) + 1 }), {});
}

function shortSession(value: string) {
  return value === "asia_open" ? "ASIE" : value === "ny_open" ? "NEW YORK" : value.replaceAll("_", " ").toUpperCase();
}

function replayVersionLabel(item: WorkflowSummary) {
  if (item.engineVersion === "autopilot_v5") return item.v4Certified ? "V5 certifié" : "V5 contractuel";
  if (item.v4Certified) return "V4 certifié";
  if (item.engineVersion === "autopilot_v4") return "V4 contractuel";
  return "Legacy";
}

function scopeLabel(value: string) {
  return value === "v5" ? "V5 actuel"
    : value === "certified" ? "runs certifiés"
      : value === "active" ? "runs actifs"
        : value === "v4" ? "historique V4"
          : value === "legacy" ? "legacy antérieur"
            : "tous moteurs";
}

function formatReplayCheckpoint(value?: string | null) {
  if (!value) return "—";
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : formatDateTime(value);
}
