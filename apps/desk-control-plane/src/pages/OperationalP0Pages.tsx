import { Link } from "react-router-dom";
import { DataTable, Timeline } from "@/design-system/data";
import { Card, KpiCard, StatusBadge } from "@/design-system/primitives";
import { MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { presentAvailability, presentExecutionMode, presentQueueStatus, presentRuntimeStatus } from "@/design-system/labels";
import { useFrontView } from "@/domains/front-api/repositories";
import type {
  ExecutionReconciliationView,
  LiveNewsView,
  LiveTimelineView,
  OperationsObservabilityView,
  SessionsView
} from "@/domains/front-api/viewModels";

export function SessionsPage() {
  const query = useFrontView("sessions");
  if (query.isLoading) return <OperationalLoading title="Sessions" />;
  if (query.isError || !query.data) return <OperationalError title="Sessions" error={query.error} />;
  const { data, meta } = query.data;
  return (
    <div className="operator-page sessions-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader title="Sessions de trading" description={`${data.summary.tradingDate} · sessions réelles projetées par le backend.`} actions={<Link className="operator-primary-action" to="/live">Ouvrir le Live</Link>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs sessions">
        <KpiCard label="SESSIONS" value={`${data.summary.total}`} delta="scope journalier" />
        <KpiCard label="NOMINALES" value={`${data.summary.nominal}`} delta="sans alerte publiée" tone="success" />
        <KpiCard label="À SURVEILLER" value={`${data.summary.attention}`} delta="warning ou erreur" tone={data.summary.attention ? "warning" : "neutral"} />
        <KpiCard label="THÈSES ACTIVES" value={`${data.summary.activeTheses}`} delta="état backend" tone="info" />
        <KpiCard label="DATE" value={shortDate(data.summary.tradingDate)} delta="date de trading" />
        <KpiCard label="SOURCE" value={meta.availability ?? "AVAILABLE"} delta="projection BFF" tone={meta.stale ? "warning" : "success"} />
      </section>
      <section className="operator-grid operator-grid--top" aria-label="Sessions disponibles">
        <Card title="Registre des sessions" eyebrow="SCOPE LIVE" density="compact">
          <DataTable columns={sessionColumns} rows={data.sessions} rowKey={(row) => row.sessionId} caption="Sessions de trading" emptyLabel="Aucune session publiée par le backend." />
        </Card>
        <Card title="Lecture opérateur" eyebrow="ÉTAT COURANT" density="compact">
          <div className="operational-detail-list">
            {data.sessions.map((session) => <article key={session.sessionId}><div><strong>{session.label}</strong><small>{session.decision} · dernier monitor {session.lastMonitorAt}</small></div><StatusBadge tone={tone(session.status)}>{presentRuntimeStatus(session.status).label}</StatusBadge></article>)}
          </div>
        </Card>
        <Card title="Accès contextuels" eyebrow="ZOOM" density="compact">
          <div className="zoom-link-list">
            {data.sessions.map((session) => <Link key={session.sessionId} to={`${session.route}&date=${session.tradingDate}`}><strong>{session.label}</strong><small>Plan, signaux et cycle live</small></Link>)}
          </div>
        </Card>
      </section>
      <section className="operator-grid operator-grid--bottom" aria-label="Contrat et continuité des sessions">
        <Card title="Modèle de session" eyebrow="AUTORITÉ" density="compact"><p>Une session est une projection de la journée de trading. Les écrans Plan, Agenda et Timeline réutilisent le même scope backend.</p></Card>
        <Card title="Continuité" eyebrow="POINT-IN-TIME" density="compact"><div className="reconciliation-grid"><MetricBox label="Date de trading" value={data.summary.tradingDate} /><MetricBox label="Sessions" value={data.summary.total} /><MetricBox label="Thèses actives" value={data.summary.activeTheses} /></div></Card>
        <Card title="Vérité des données" eyebrow="AUCUN MOCK" density="compact"><p>{meta.warnings?.length ? meta.warnings.join(" · ") : "Aucun fallback local : toutes les lignes proviennent du BFF."}</p></Card>
      </section>
    </div>
  );
}

export function LivePlanPage() {
  const query = useFrontView("live-plan");
  if (query.isLoading) return <OperationalLoading title="Plan live" />;
  if (query.isError || !query.data) return <OperationalError title="Plan live" error={query.error} />;
  const { data, meta } = query.data;
  return (
    <div className="operator-page live-plan-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader title="Plan & Configuration" description={`${data.scope.tradingDate} · ${data.scope.sessionId} · plan déterministe courant.`} actions={<><Link to="/live/timeline">Voir la timeline</Link><Link className="operator-primary-action" to="/live">Retour Live</Link></>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs plan live">
        <KpiCard label="SESSION" value={presentRuntimeStatus(data.summary.sessionStatus).label} delta={presentExecutionMode(data.scope.mode).label} tone={tone(data.summary.sessionStatus)} />
        <KpiCard label="MASTER" value={data.summary.masterAvailable ? "PRÊT" : "ABSENT"} delta={data.master.decision} tone={data.summary.masterAvailable ? "success" : "warning"} />
        <KpiCard label="THÈSE" value={data.summary.thesisAvailable ? presentRuntimeStatus(data.thesis.status).label : "ABSENTE"} delta={`${data.thesis.confidence}% confiance`} tone={data.summary.thesisAvailable ? "info" : "warning"} />
        <KpiCard label="SETUP" value={presentRuntimeStatus(data.setup.status).label} delta={data.setup.instrument} tone={data.summary.setupAvailable ? "info" : "neutral"} />
        <KpiCard label="POSITION" value={presentRuntimeStatus(data.position.status).label} delta={presentExecutionMode(data.position.executionMode).label} tone={data.position.active ? "success" : "neutral"} />
        <KpiCard label="PROCHAIN" value={data.summary.nextMonitorAt} delta={data.claim.nextTaskLabel} />
      </section>
      <section className="operator-grid operator-grid--top" aria-label="Master, thèse et setup">
        <Card title="Master" eyebrow={data.master.available ? data.master.id : "NON MATÉRIALISÉ"} density="compact" state={data.master.available ? "nominal" : "empty"}><div className="operational-copy"><strong>{data.master.summary}</strong><p>{data.master.regime}</p><small>{data.master.macroThesis}</small><small>{data.master.assetSelection}</small></div></Card>
        <Card title="Thèse active" eyebrow={presentRuntimeStatus(data.thesis.status).label} density="compact" state={data.thesis.available ? "nominal" : "empty"}><div className="operational-copy"><strong>{data.thesis.instrument} · {data.thesis.direction}</strong><p>{data.thesis.dominantScenario}</p><small>Scénario secondaire : {data.thesis.secondaryScenario}</small><small>Focus : {data.thesis.nextFocus}</small></div></Card>
        <Card title="Setup canonique" eyebrow={presentRuntimeStatus(data.setup.status).label} density="compact" state={data.setup.available ? "nominal" : "empty"}><div className="reconciliation-grid"><MetricBox label="Entrée basse" value={price(data.setup.entryLower)} /><MetricBox label="Entrée haute" value={price(data.setup.entryUpper)} /><MetricBox label="Stop" value={price(data.setup.stop)} /><MetricBox label="TP1" value={price(data.setup.tp1)} /><MetricBox label="RR" value={nullable(data.setup.rr)} /><MetricBox label="Déclenchable" value={data.setup.backendCanTrigger ? "Oui" : "Non"} /></div><p>{data.setup.reason}</p></Card>
      </section>
      <section className="operator-grid operator-grid--bottom" aria-label="Claim, position et niveaux">
        <Card title="Prochaine tâche" eyebrow="CLAIM" density="compact"><div className="reconciliation-grid"><MetricBox label="État" value={presentQueueStatus(data.claim.nextTaskStatus).label} /><MetricBox label="Échéance" value={data.claim.dueCheckpoint} /><MetricBox label="Suivante" value={data.claim.followingCheckpoint} /><MetricBox label="Dernier claim" value={data.claim.lastClaimAt} /><MetricBox label="Worker" value={data.claim.workerId} /><MetricBox label="Latence" value={durationSeconds(data.claim.latencySeconds)} /></div></Card>
        <Card title="Position théorique" eyebrow={presentRuntimeStatus(data.position.status).label} density="compact" state={data.position.active ? "nominal" : "empty"}><div className="reconciliation-grid"><MetricBox label="Instrument" value={data.position.instrument} /><MetricBox label="Sens" value={data.position.direction} /><MetricBox label="Entrée" value={price(data.position.entry)} /><MetricBox label="Prix" value={price(data.position.current)} /><MetricBox label="P&L" value={data.position.unrealizedR == null ? "—" : `${signed(data.position.unrealizedR)} R`} /><MetricBox label="Broker" value={data.position.brokerExecution ? "Oui" : "Non"} /></div><p>{data.position.note}</p></Card>
        <Card title="Niveaux suivis" eyebrow="NIVEAUX DE MARCHÉ" density="compact">{data.levels.length ? <div className="operational-detail-list">{data.levels.slice(0, 6).map((level) => <article key={level.levelId}><div><strong>{level.label}</strong><small>{level.kind}</small></div><b>{price(level.value)}</b></article>)}</div> : <p className="empty-state">Aucun niveau structuré publié pour ce scope.</p>}</Card>
      </section>
    </div>
  );
}

export function LiveNewsPage() {
  const query = useFrontView("live-news");
  if (query.isLoading) return <OperationalLoading title="Agenda & Actualités" />;
  if (query.isError || !query.data) return <OperationalError title="Agenda & Actualités" error={query.error} />;
  const { data, meta } = query.data;
  const nextEvent = data.macroEvents.find((event) => event.isNext) ?? null;
  return (
    <div className="operator-page live-news-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader title="Agenda & Actualités" description={`${data.scope.tradingDate} · fenêtre point-in-time · actuals et sources réelles.`} actions={<Link className="operator-primary-action" to="/live">Retour Live</Link>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs agenda et news"><KpiCard label="MACRO" value={`${data.summary.macroEvents}`} delta="événements fenêtre" /><KpiCard label="IMPACT FORT" value={`${data.summary.highImpactEvents}`} delta="événements élevés" tone="warning" /><KpiCard label="TITRES" value={`${data.summary.headlines}`} delta="actualités disponibles" /><KpiCard label="SOURCES" value={`${data.summary.providers}`} delta="providers distincts" tone="info" /><KpiCard label="PROCHAIN" value={data.summary.nextMacroAt} delta={nextEvent?.title ?? "événement non identifié"} /><KpiCard label="PROXIMITÉ" value={data.summary.nearEvent ? "IMMINENT" : "NORMAL"} delta="fenêtre macro" tone={data.summary.nearEvent ? "warning" : "success"} /></section>
      <section className="operator-grid operator-grid--top" aria-label="Agenda macro">
        <Card title="Calendrier macro" eyebrow="RÉEL / PRÉVISION / PRÉCÉDENT" density="compact"><DataTable columns={macroColumns} rows={data.macroEvents.slice(0, 6)} rowKey={(row) => row.eventId} caption="Événements macro" emptyLabel="Aucun événement macro publié." /></Card>
        <Card title="Prochain événement" eyebrow="FOCUS" density="compact" state={nextEvent ? "nominal" : "empty"}>{nextEvent ? <div className="operational-copy"><strong>{nextEvent.time} · {nextEvent.title}</strong><p>{nextEvent.currency} · {nextEvent.importance}</p><small>Précédent {nextEvent.previous} · consensus {nextEvent.forecast} · actual {nextEvent.actual}</small></div> : <p className="empty-state">Aucun événement marqué comme prochain.</p>}</Card>
        <Card title="Scope de lecture" eyebrow="ANTI-ANTICIPATION" density="compact"><div className="reconciliation-grid"><MetricBox label="Session" value={data.scope.sessionId} /><MetricBox label="Date" value={data.scope.tradingDate} /><MetricBox label="Mode" value={presentExecutionMode(data.scope.mode).label} /><MetricBox label="Disponibilité" value={presentAvailability(meta.availability ?? "AVAILABLE").label} /></div></Card>
      </section>
      <section className="operator-grid operator-grid--bottom" aria-label="Flux actualités">
        <Card title="Dernières actualités" eyebrow="FLUX D'ACTUALITÉS" density="compact"><DataTable columns={headlineColumns} rows={data.headlines.slice(0, 6)} rowKey={(row) => row.headlineId} caption="Actualités" emptyLabel="Aucune actualité publiée dans la fenêtre." /></Card>
        <Card title="Actifs couverts" eyebrow="MULTI-ACTIFS" density="compact"><div className="tag-cloud">{unique(data.headlines.flatMap((headline) => headline.assets)).slice(0, 18).map((asset) => <StatusBadge key={asset} tone="info">{asset}</StatusBadge>)}</div></Card>
        <Card title="Thématiques" eyebrow="CLASSIFICATION" density="compact"><div className="tag-cloud">{unique(data.headlines.flatMap((headline) => headline.topics)).slice(0, 18).map((topic) => <StatusBadge key={topic}>{topic}</StatusBadge>)}</div></Card>
      </section>
    </div>
  );
}

export function LiveTimelinePage() {
  const query = useFrontView("live-timeline");
  if (query.isLoading) return <OperationalLoading title="Timeline live" />;
  if (query.isError || !query.data) return <OperationalError title="Timeline live" error={query.error} />;
  const { data, meta } = query.data;
  return (
    <div className="operator-page live-timeline-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader title="Timeline live" description={`${data.scope.tradingDate} · prévu face au réalisé · horodatages backend.`} actions={<><Link to="/live/plan">Voir le plan</Link><Link className="operator-primary-action" to="/live">Retour Live</Link></>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs timeline"><KpiCard label="ÉVÉNEMENTS" value={`${data.summary.total}`} delta="cycle courant" /><KpiCard label="EXÉCUTÉS" value={`${data.summary.completed}`} delta="matérialisés" tone="success" /><KpiCard label="EN ATTENTE" value={`${data.summary.waiting}`} delta="planifiés ou ready" tone="info" /><KpiCard label="EN RETARD" value={`${data.summary.delayed}`} delta="en retard, échoué ou bloqué" tone={data.summary.delayed ? "warning" : "neutral"} /><KpiCard label="DERNIER" value={data.summary.lastCompletedAt} delta="checkpoint clôturé" /><KpiCard label="PROCHAIN" value={data.summary.nextCheckpointAt} delta="checkpoint backend" /></section>
      <section className="operator-grid operator-grid--top" aria-label="Chronologie live">
        <Card title="Planifié vs réalisé" eyebrow="CHRONOLOGIE AUTORITAIRE" density="compact"><DataTable columns={timelineColumns} rows={data.events.slice(0, 6)} rowKey={(row) => row.eventId} caption="Chronologie live" emptyLabel="Aucun événement de timeline publié." /></Card>
        <Card title="Lecture séquentielle" eyebrow="CYCLE" density="compact"><Timeline events={data.events.slice(0, 5).map((event) => ({ id: event.eventId, title: event.title, at: event.actualAt ?? event.plannedAt, description: `${presentQueueStatus(event.status).label} · ${event.summary}`, tone: tone(event.status) }))} /></Card>
        <Card title="Scope courant" eyebrow="SESSION" density="compact"><div className="reconciliation-grid"><MetricBox label="Session" value={data.scope.sessionId} /><MetricBox label="Date" value={data.scope.tradingDate} /><MetricBox label="Mode" value={presentExecutionMode(data.scope.mode).label} /><MetricBox label="Disponibilité" value={presentAvailability(meta.availability ?? "AVAILABLE").label} /></div></Card>
      </section>
      <section className="operator-grid operator-grid--bottom" aria-label="Détails timeline"><Card title="À traiter" eyebrow="SUIVANT" density="compact">{data.events.filter((event) => ["WAITING", "SCHEDULED", "READY"].includes(event.status.toUpperCase())).slice(0, 5).map((event) => <div className="detail-list-row" key={event.eventId}><div><strong>{event.title}</strong><small>{event.summary}</small></div><StatusBadge tone="info">{presentQueueStatus(event.status).label}</StatusBadge></div>)}</Card><Card title="Latence" eyebrow="SLO" density="compact"><div className="operational-detail-list">{data.events.filter((event) => event.latencySeconds != null).slice(0, 5).map((event) => <article key={event.eventId}><div><strong>{event.title}</strong><small>{event.plannedAt}</small></div><b>{durationSeconds(event.latencySeconds)}</b></article>)}</div></Card><Card title="Vérité temporelle" eyebrow="AUCUN ÉVÉNEMENT SYNTHÉTIQUE" density="compact"><p>Les événements absents ne sont pas reconstruits dans le navigateur. La timeline affiche uniquement les checkpoints et analyses publiés par le backend.</p></Card></section>
    </div>
  );
}

export function ExecutionReconciliationPage() {
  const query = useFrontView("execution-reconciliation");
  if (query.isLoading) return <OperationalLoading title="Réconciliation" />;
  if (query.isError || !query.data) return <OperationalError title="Réconciliation" error={query.error} />;
  const { data, meta } = query.data;
  return (
    <div className="operator-page execution-reconciliation-page"><ViewTruthBanner meta={meta} /><OperatorPageHeader title="Réconciliation" description="Écarts desk, adapters et broker sans supposer qu’un contrôle vide est réussi." actions={<Link className="operator-primary-action" to="/execution/providers">Voir les providers</Link>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs réconciliation"><KpiCard label="STATUT" value={data.summary.status === "MATCHED" ? "RÉCONCILIÉ" : data.summary.status === "MISMATCH" ? "ÉCART" : "NON EXÉCUTÉ"} delta="preuve disponible" tone={data.summary.status === "MATCHED" ? "success" : data.summary.status === "MISMATCH" ? "danger" : "warning"} /><KpiCard label="RUNS" value={`${data.summary.reconciliationRuns}`} delta="réconciliations" /><KpiCard label="PARITÉ" value={`${data.summary.parityRuns}`} delta="runs adapters" /><KpiCard label="ÉCARTS" value={`${data.summary.mismatches}`} delta="mismatches publiés" tone={data.summary.mismatches ? "danger" : "neutral"} /><KpiCard label="ORDRES ACTIFS" value={`${data.summary.activeOrders}`} delta="vue d'exécution" /><KpiCard label="TRADES OUVERTS" value={`${data.summary.openTrades}`} delta="vue d'exécution" /></section>
      <section className="operator-grid operator-grid--top" aria-label="Preuves de réconciliation"><Card title="Réconciliations" eyebrow="DESK ↔ BROKER" density="compact"><DataTable columns={reconciliationColumns} rows={data.reconciliations.slice(0, 6)} rowKey={(row) => row.reconciliationId} caption="Réconciliations" emptyLabel="Aucun run de réconciliation publié : le statut reste NOT_RUN." /></Card><Card title="Parité adapters" eyebrow="ATI ↔ ADDON" density="compact"><DataTable columns={parityColumns} rows={data.parityRuns.slice(0, 6)} rowKey={(row) => row.parityRunId} caption="Parité adapters" emptyLabel="Aucun run de parité publié." /></Card><Card title="Providers" eyebrow="CONNECTIVITÉ" density="compact"><div className="operational-detail-list">{data.providers.map((provider) => <article key={provider.providerId}><div><strong>{provider.label}</strong><small>{provider.mode} · {provider.lastHeartbeatAt}</small></div><StatusBadge tone={tone(provider.status)}>{presentAvailability(provider.status).label}</StatusBadge></article>)}</div></Card></section>
      <section className="operator-grid operator-grid--bottom" aria-label="Comptes et politique"><Card title="Comptes broker" eyebrow="PÉRIMÈTRE" density="compact"><div className="operational-detail-list">{data.accounts.map((account) => <article key={account.accountId}><div><strong>{account.label}</strong><small>{account.providerId} · {account.mode}</small></div><StatusBadge tone={tone(account.state)}>{presentAvailability(account.state).label}</StatusBadge></article>)}</div></Card><Card title="Interprétation" eyebrow="FAIL-CLOSED" density="compact"><p>NOT_RUN signifie qu’aucune preuve de réconciliation n’existe. Une liste vide n’est jamais interprétée comme MATCHED.</p></Card><Card title="Source" eyebrow="VUE EXÉCUTION" density="compact"><p>{meta.warnings?.length ? meta.warnings.join(" · ") : "Projection réelle execution, adapters et comptes."}</p></Card></section>
    </div>
  );
}

export function OperationsObservabilityPage() {
  const query = useFrontView("operations-observability");
  if (query.isLoading) return <OperationalLoading title="Observabilité" />;
  if (query.isError || !query.data) return <OperationalError title="Observabilité" error={query.error} />;
  const { data, meta } = query.data;
  return (
    <div className="operator-page operations-observability-page"><ViewTruthBanner meta={meta} /><OperatorPageHeader title="Observabilité" description="Files, workers IA, latences, consommation et violations SLO mesurées." actions={<Link className="operator-primary-action" to="/operations">Centre d'opérations</Link>} />
      <section className="operator-kpi-strip" aria-label="Indicateurs observabilité"><KpiCard label="PROCESS" value={`${data.summary.processes}`} delta={`${data.summary.running} en cours`} /><KpiCard label="FILE" value={`${data.queue.depth}`} delta={durationMs(data.queue.oldestQueuedMs)} tone={data.queue.depth ? "warning" : "success"} /><KpiCard label="ÉCHECS" value={`${data.summary.failed}`} delta={`${data.summary.retries} tentatives`} tone={data.summary.failed ? "danger" : "neutral"} /><KpiCard label="SLO" value={`${data.summary.slaBreaches}`} delta="violations" tone={data.summary.slaBreaches ? "warning" : "success"} /><KpiCard label="P95" value={durationMs(data.summary.p95ExecutionMs)} delta="exécution" /><KpiCard label="WORKERS" value={`${data.workerSummary.healthy}/${data.workerSummary.expected}`} delta="sains / attendus" tone={data.workerSummary.healthy >= data.workerSummary.expected && data.workerSummary.expected > 0 ? "success" : "warning"} /></section>
      <section className="operator-grid operator-grid--top" aria-label="Process, workers et queue"><Card title="Process observés" eyebrow="RUNTIME" density="compact"><DataTable columns={processColumns} rows={data.processes.slice(0, 6)} rowKey={(row) => row.processId} caption="Process observés" emptyLabel="Aucun process observé." /></Card><Card title="Workers IA" eyebrow="FLOTTE" density="compact"><DataTable columns={workerColumns} rows={data.workers.slice(0, 6)} rowKey={(row) => row.workerId} caption="Workers IA" emptyLabel="Aucun worker enregistré dans la télémétrie." /></Card><Card title="Queue & leases" eyebrow="CAPACITÉ" density="compact"><div className="reconciliation-grid"><MetricBox label="Profondeur" value={data.queue.depth} /><MetricBox label="Plus ancien" value={durationMs(data.queue.oldestQueuedMs)} /><MetricBox label="Leases actifs" value={data.queue.activeLeases} /><MetricBox label="Expirants" value={data.queue.expiringLeases} /><MetricBox label="Expirés" value={data.queue.expiredLeases} /><MetricBox label="En cours" value={data.summary.running} /></div></Card></section>
      <section className="operator-grid operator-grid--bottom" aria-label="Breakdown, runtime et couverture"><Card title="Par workflow" eyebrow="RÉPARTITION" density="compact"><DataTable columns={workflowColumns} rows={data.workflowBreakdown.slice(0, 6)} rowKey={(row) => row.label} caption="Breakdown par workflow" emptyLabel="Aucun breakdown workflow publié." /></Card><Card title="Runtime IA" eyebrow="RÉGLAGES" density="compact"><div className="reconciliation-grid"><MetricBox label="Reasoning" value={data.runtimeSettings.reasoningEffort} /><MetricBox label="Révision" value={data.runtimeSettings.revision} /><MetricBox label="Source" value={data.runtimeSettings.source} /><MetricBox label="Application" value={data.runtimeSettings.appliesTo} /><MetricBox label="Tokens" value={nullable(data.summary.totalTokens)} /><MetricBox label="Coût" value={data.summary.costUsd == null ? "—" : `$${data.summary.costUsd.toFixed(4)}`} /></div></Card><Card title="Couverture" eyebrow="TÉLÉMÉTRIE" density="compact"><Coverage coverage={data.coverage} /><p>{meta.warnings?.length ? meta.warnings.join(" · ") : "Aucune source BFF signalée indisponible."}</p></Card></section>
    </div>
  );
}

function Coverage({ coverage }: { coverage: OperationsObservabilityView["coverage"] }) {
  const entries = Object.entries(coverage).filter(([, value]) => value && typeof value === "object").slice(0, 6);
  return <div className="operational-detail-list">{entries.map(([label, value]) => { const metric = value as { percent?: number; available?: number; total?: number }; return <article key={label}><div><strong>{label}</strong><small>{metric.available ?? "—"} / {metric.total ?? "—"} disponibles</small></div><b>{metric.percent ?? "—"}%</b></article>; })}</div>;
}

function OperationalLoading({ title }: { title: string }) { return <main className="route-loading" aria-busy="true" aria-live="polite"><span>Chargement · {title}…</span></main>; }
function OperationalError({ title, error }: { title: string; error: unknown }) { return <Card title={`${title} indisponible`} eyebrow="ERREUR CONTRAT" tone="danger" density="compact"><p>{error instanceof Error ? error.message : "La projection BFF n'a pas répondu."}</p></Card>; }
function nullable(value: number | null) { return value == null ? "—" : String(value); }
function price(value: number | null | undefined) { return value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value); }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
function durationSeconds(value: number | null) { return value == null ? "—" : value < 60 ? `${Math.round(value)} s` : `${(value / 60).toFixed(1)} min`; }
function durationMs(value: number | null) { return value == null ? "—" : value < 1_000 ? `${Math.round(value)} ms` : value < 60_000 ? `${(value / 1_000).toFixed(1)} s` : `${(value / 60_000).toFixed(1)} min`; }
function shortDate(value: string) { const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(date); }
function unique(values: readonly string[]) { return [...new Set(values.filter(Boolean))]; }
function tone(value: string) { const normalized = value.toUpperCase(); if (["OK", "READY", "ACTIVE", "MATCHED", "COMPLETED", "DONE", "SUCCEEDED", "HEALTHY"].includes(normalized)) return "success" as const; if (["ERROR", "FAILED", "BLOCKED", "CRITICAL", "DOWN", "MISMATCH"].includes(normalized)) return "danger" as const; if (["WARNING", "WATCH", "DEGRADED", "LATE", "DELAYED", "INCOMPLETE", "NOT_RUN"].includes(normalized)) return "warning" as const; if (["WAITING", "SCHEDULED", "RUNNING", "QUEUED"].includes(normalized)) return "info" as const; return "neutral" as const; }

const sessionColumns = [
  { key: "session", header: "Session", render: (row: SessionsView["sessions"][number]) => <Link to={`${row.route}&date=${row.tradingDate}`}><strong>{row.label}</strong></Link> },
  { key: "status", header: "État", render: (row: SessionsView["sessions"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "decision", header: "Décision", render: (row: SessionsView["sessions"][number]) => row.decision },
  { key: "monitor", header: "Dernier monitor", render: (row: SessionsView["sessions"][number]) => row.lastMonitorAt }
] as const;
const macroColumns = [
  { key: "time", header: "Heure", render: (row: LiveNewsView["macroEvents"][number]) => row.time },
  { key: "event", header: "Événement", render: (row: LiveNewsView["macroEvents"][number]) => <strong>{row.title}</strong> },
  { key: "impact", header: "Impact", render: (row: LiveNewsView["macroEvents"][number]) => <StatusBadge tone={row.importance === "HIGH" ? "warning" : "neutral"}>{row.importance}</StatusBadge> },
  { key: "forecast", header: "Prévision", render: (row: LiveNewsView["macroEvents"][number]) => row.forecast },
  { key: "actual", header: "Réel", render: (row: LiveNewsView["macroEvents"][number]) => row.actual }
] as const;
const headlineColumns = [
  { key: "time", header: "Publié", render: (row: LiveNewsView["headlines"][number]) => row.publishedAt.slice(11, 16) || "—" },
  { key: "title", header: "Actualité", render: (row: LiveNewsView["headlines"][number]) => row.url ? <a href={row.url} target="_blank" rel="noreferrer"><strong>{row.title}</strong></a> : <strong>{row.title}</strong> },
  { key: "source", header: "Source", render: (row: LiveNewsView["headlines"][number]) => row.source },
  { key: "impact", header: "Impact", render: (row: LiveNewsView["headlines"][number]) => <StatusBadge tone={row.importance === "HIGH" ? "warning" : "neutral"}>{row.importance}</StatusBadge> }
] as const;
const timelineColumns = [
  { key: "planned", header: "Prévu", render: (row: LiveTimelineView["events"][number]) => row.plannedAt.slice(11, 16) || row.plannedAt },
  { key: "actual", header: "Réalisé", render: (row: LiveTimelineView["events"][number]) => row.actualAt?.slice(11, 16) ?? "—" },
  { key: "event", header: "Étape", render: (row: LiveTimelineView["events"][number]) => <strong>{row.title}</strong> },
  { key: "status", header: "État", render: (row: LiveTimelineView["events"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "latency", header: "Latence", render: (row: LiveTimelineView["events"][number]) => durationSeconds(row.latencySeconds) }
] as const;
const reconciliationColumns = [
  { key: "id", header: "Run", render: (row: ExecutionReconciliationView["reconciliations"][number]) => row.reconciliationId },
  { key: "account", header: "Compte", render: (row: ExecutionReconciliationView["reconciliations"][number]) => row.accountId },
  { key: "status", header: "État", render: (row: ExecutionReconciliationView["reconciliations"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "mismatch", header: "Écarts", render: (row: ExecutionReconciliationView["reconciliations"][number]) => row.mismatchCount }
] as const;
const parityColumns = [
  { key: "adapters", header: "Adapters", render: (row: ExecutionReconciliationView["parityRuns"][number]) => `${row.leftAdapter} ↔ ${row.rightAdapter}` },
  { key: "account", header: "Compte", render: (row: ExecutionReconciliationView["parityRuns"][number]) => row.accountId },
  { key: "status", header: "État", render: (row: ExecutionReconciliationView["parityRuns"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "mismatch", header: "Écarts", render: (row: ExecutionReconciliationView["parityRuns"][number]) => row.mismatchCount }
] as const;
const processColumns = [
  { key: "workflow", header: "Workflow", render: (row: OperationsObservabilityView["processes"][number]) => <strong>{row.workflow}</strong> },
  { key: "scope", header: "Scope", render: (row: OperationsObservabilityView["processes"][number]) => row.scope },
  { key: "status", header: "État", render: (row: OperationsObservabilityView["processes"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "queue", header: "Queue", render: (row: OperationsObservabilityView["processes"][number]) => durationMs(row.queueMs) },
  { key: "worker", header: "Worker", render: (row: OperationsObservabilityView["processes"][number]) => row.worker }
] as const;
const workerColumns = [
  { key: "worker", header: "Worker", render: (row: OperationsObservabilityView["workers"][number]) => <strong>{row.workerId}</strong> },
  { key: "status", header: "État", render: (row: OperationsObservabilityView["workers"][number]) => <StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge> },
  { key: "model", header: "Modèle", render: (row: OperationsObservabilityView["workers"][number]) => row.model },
  { key: "task", header: "Tâche", render: (row: OperationsObservabilityView["workers"][number]) => row.task }
] as const;
const workflowColumns = [
  { key: "workflow", header: "Workflow", render: (row: OperationsObservabilityView["workflowBreakdown"][number]) => <strong>{row.label}</strong> },
  { key: "process", header: "Process", render: (row: OperationsObservabilityView["workflowBreakdown"][number]) => row.processes },
  { key: "running", header: "Running", render: (row: OperationsObservabilityView["workflowBreakdown"][number]) => row.running },
  { key: "failed", header: "Échecs", render: (row: OperationsObservabilityView["workflowBreakdown"][number]) => row.failed },
  { key: "duration", header: "Durée", render: (row: OperationsObservabilityView["workflowBreakdown"][number]) => durationMs(row.avgExecutionMs) }
] as const;
