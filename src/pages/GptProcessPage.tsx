import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, statusLabel, StatusTag, TechnicalDetails } from "@/components/operations";
import { ResearchProgressPanel } from "@/components/ResearchProgressPanel";
import { useGptProcess } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, workflowLabel } from "@/lib/presentation";
import type { GptOperationsContext, GptProcess, GptTransportContract } from "@/operationsTypes";

export default function GptProcessPage() {
  const { runId = "", processId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const id = decodeURIComponent(processId);
  const query = useGptProcess(id);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Processus GPT introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  return <section className="view workspace-view gpt-inspector-v3">
    <Breadcrumbs items={[{ label: "Journées de test", to: "/replay" }, { label: replayLabel(parent), to: `/replay/runs/${encodeURIComponent(parent)}` }, { label: gptProcessLabel(data.process.id) }]}/>
    <PageHeading eyebrow="Analyse GPT détaillée" title={workflowDisplayLabel(data.process.workflow)} subtitle={`${statusLabel(data.process.status)} · ${formatDateTime(data.process.completedAt || data.process.startedAt)}`} backTo={`/replay/runs/${encodeURIComponent(parent)}`} actions={<StatusTag status={data.process.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Tentative" value={`${data.process.attempt}/${data.process.maxAttempts || "—"}`}/>
      <MetricCard label="Durée" value={formatDuration(data.process.durationMs)}/>
      <MetricCard label="Prise en charge" value={data.process.worker ? "Oui" : "En attente"}/>
      <MetricCard label="Données" value={bundleQuality(data.process)}/>
      <MetricCard label="Fin" value={formatDateTime(data.process.completedAt)}/>
      <MetricCard label="Modèle" value={data.process.telemetry.model || "N/D"} detail={data.process.telemetry.provider || "Télémétrie absente"}/>
      <MetricCard label="Tokens" value={data.process.telemetry.totalTokens === null ? "N/D" : data.process.telemetry.totalTokens.toLocaleString("fr-FR")} detail={tokenDetail(data.process)}/>
      <MetricCard label="Coût observé" value={data.process.telemetry.costUsd === null ? "N/D" : `$${data.process.telemetry.costUsd.toFixed(4)}`} detail="Aucune estimation locale"/>
    </MetricStrip>

    <GptLifecycle process={data.process}/>
    <ResearchProgressPanel progress={data.process.researchProgress || data.researchProgress}/>
    <GptContractPanel transport={data.transport}/>
    <GptOperationsCommandPanel context={data.operationsContext} process={data.process}/>

    {data.process.error && <Card className="error-box gpt-error-box"><div><span>PROCESS_FAILURE</span><strong>{data.process.error.code || "Erreur GPT"}</strong></div><p>{data.process.error.message}</p></Card>}

    <div className="gpt-inspector-workbench">
      <Card className="gpt-conclusion-panel">
        <header><div><p className="eyebrow">Sortie canonique sauvegardée</p><h2>{data.process.decision || "Décision GPT en attente"}</h2></div><StatusTag status={data.process.conclusion ? "completed" : data.process.status}/></header>
        <p className="conclusion-copy">{data.process.conclusion || "Aucune conclusion n’a encore été sauvegardée par le workflow."}</p>
        <div className="gpt-output-meta"><span>ÉTAT <strong>{statusLabel(data.process.status)}</strong></span><span>TENTATIVE <strong>{data.process.attempt}</strong></span><span>FIN <strong>{formatDateTime(data.process.completedAt)}</strong></span></div>
      </Card>
      <Card className="gpt-transport-panel">
        <header><p className="eyebrow">Continuité du traitement</p><StatusTag status={data.process.status}/></header>
        <dl className="definition-grid"><dt>Prise en charge</dt><dd>{data.process.worker ? "Worker GPT attribué" : "En attente d’un worker GPT"}</dd><dt>Expiration</dt><dd>{formatDateTime(data.transport.lease.expiresAt)}</dd><dt>Sauvegarde</dt><dd>{data.transport.saveTargetAvailable ? "Cible prête" : "Cible non disponible"}</dd><dt>Qualité des données</dt><dd>{bundleQuality(data.process)}</dd><dt>Latence API</dt><dd>{formatDuration(data.process.telemetry.apiLatencyMs)}</dd></dl>
      </Card>
    </div>

    <TechnicalDetails items={[
      { label: "Processus", value: data.process.id },
      { label: "Étape", value: data.process.stepId },
      { label: "Run", value: data.process.runId || parent },
      { label: "Worker", value: data.process.worker },
      { label: "Révision", value: data.process.revision },
      { label: "État source", value: data.process.rawStatus },
      { label: "Outil de sauvegarde", value: data.transport.saveTool },
      { label: "Jeton de lease", value: data.transport.leaseProtected ? "Protégé côté serveur" : "Absent" },
      { label: "Bundle", value: data.process.bundle?.bundleId },
      { label: "Request ID", value: data.process.telemetry.requestId },
    ]}/>

    <div className="gpt-payload-grid">
      <details className="raw-inspector"><summary>Manifest du bundle</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Save target</summary><pre>{JSON.stringify(data.saveTarget, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Prompt d’exécution</summary><pre>{data.prompt || "Non exposé"}</pre></details>
    </div>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Audit du worker</p><h2>Cycle de vie GPT</h2></div><span>{data.process.events.length} événements persistés</span></header>
      <EventTimeline events={data.process.events} runId={parent}/>
    </section>
  </section>;
}

function GptOperationsCommandPanel({ context, process }: { context?: GptOperationsContext; process: GptProcess }) {
  const workflow = context?.workflow || null;
  const command = context?.workflowCommand || null;
  const health = context?.transportHealth || null;
  return <Card className="gpt-command-center" aria-label="Command Center GPT">
    <header>
      <div><p className="eyebrow">P9 · orchestration liée</p><h2>Command Center GPT</h2></div>
      <StatusTag status={workflow?.status || process.status}/>
    </header>

    <div className="gpt-command-center__grid">
      <section className="gpt-parent-workflow-panel">
        <p className="eyebrow">Workflow parent</p>
        <h3>{workflow?.name || "Workflow non retrouvé"}</h3>
        <dl>
          <span><dt>État</dt><dd>{workflow ? statusLabel(workflow.status) : "Non retrouvé"}</dd></span>
          <span><dt>Progression</dt><dd>{workflow ? `${workflow.progress}%` : "—"}</dd></span>
          <span><dt>Session</dt><dd>{workflow ? `${workflow.tradingDate || "—"} · ${workflow.session || workflow.kind}` : process.runId || "—"}</dd></span>
          <span><dt>Prochaine action</dt><dd>{workflow?.nextAction || "—"}</dd></span>
        </dl>
        <TechnicalDetails items={[
          { label: "Workflow", value: workflow?.id },
          { label: "Révision", value: workflow?.revision },
          { label: "Work item courant", value: workflow?.currentWorkItemId || process.id },
        ]}/>
      </section>

      <section className="gpt-corrective-action-panel">
        <p className="eyebrow">Action opérateur</p>
        <h3>Action corrective workflow</h3>
        {command ? <Link className={`workflow-action-cta tone-${command.tone}`} to={command.href}>
          <Icon name={command.action === "retry" ? "retry" : command.action === "pause" ? "pause" : command.action === "resume" ? "play" : "cancel"} size={15}/>
          <span>Préparer {command.action}</span>
          <small>rev {command.expectedRevision} · {command.confirmationPhrase}</small>
        </Link> : <div className="workflow-action-cta is-disabled">
          <Icon name="check" size={15}/>
          <span>Aucune action workflow exposée</span>
          <small>état terminal ou parent absent</small>
        </div>}
        <p>{command?.reason || "Le backend ne propose pas d’action corrective pour ce processus dans son état actuel."}</p>
      </section>

      <section className="gpt-save-health-panel">
        <p className="eyebrow">Save / lease / payload</p>
        <h3>{healthLabel(health?.state)}</h3>
        <div className="gpt-health-grid">
          <HealthCell label="Can save" value={health?.canSave ? "oui" : "non"} ok={Boolean(health?.canSave)}/>
          <HealthCell label="Lease" value={health?.leaseState || "none"} ok={health?.leaseState === "active" || health?.state === "saved"}/>
          <HealthCell label="Handle" value={health?.hasLeaseHandle ? "complet" : "incomplet"} ok={Boolean(health?.hasLeaseHandle)}/>
          <HealthCell label="Target" value={health?.saveReady ? "présent" : "absent"} ok={Boolean(health?.saveReady)}/>
          <HealthCell label="Prompt" value={health?.promptReady ? "exposé" : "absent"} ok={Boolean(health?.promptReady)}/>
          <HealthCell label="Manifest" value={health?.manifestReady ? "présent" : "absent"} ok={Boolean(health?.manifestReady)}/>
        </div>
        <small>{health?.leaseExpiresAt ? `Lease expire ${formatDateTime(health.leaseExpiresAt)} · ${health.leaseRemainingMs === null ? "durée N/D" : formatDuration(Math.abs(health.leaseRemainingMs))}` : "Aucun lease matérialisé"}</small>
      </section>
    </div>

    <div className="gpt-linked-ops-grid">
      <section>
        <header><p className="eyebrow">Risques</p><strong>{context?.riskFlags?.length || 0}</strong></header>
        <div className="risk-flags gpt-risk-flags">{(context?.riskFlags || []).map(flag => <span key={flag.code} data-tone={flag.tone}>{flag.label}</span>)}</div>
      </section>
      <section>
        <header><p className="eyebrow">Incidents liés</p><strong>{context?.incidents?.length || 0}</strong></header>
        <div className="gpt-linked-list">{context?.incidents?.length ? context.incidents.slice(0, 4).map(incident => <Link key={incident.id} to={`/operations/incidents?incident=${encodeURIComponent(incident.id)}`}><span>{incident.severity}</span><strong>{incident.title}</strong><small>{incident.lifecycleStatus}</small></Link>) : <small>Aucun incident actif lié au processus.</small>}</div>
      </section>
      <section>
        <header><p className="eyebrow">Runbooks liés</p><strong>{context?.runbooks?.length || 0}</strong></header>
        <div className="gpt-linked-list">{context?.runbooks?.length ? context.runbooks.slice(0, 4).map(runbook => <Link key={runbook.id} to={`/operations/runbooks?runbook=${encodeURIComponent(runbook.id)}`}><span>{runbook.kind}</span><strong>{runbook.title}</strong><small>{runbook.nextAction?.title || runbook.status}</small></Link>) : <small>Aucun runbook opérateur lié.</small>}</div>
      </section>
      <section>
        <header><p className="eyebrow">Liens rapides</p><strong>{context?.links?.length || 0}</strong></header>
        <div className="gpt-link-strip">{context?.links?.map(link => <Link key={`${link.kind}:${link.href}`} to={link.href}>{link.label}<Icon name="arrow" size={12}/></Link>)}</div>
      </section>
    </div>
  </Card>;
}

function HealthCell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <span data-ok={ok ? "true" : "false"}><small>{label}</small><strong>{value}</strong></span>;
}

function healthLabel(state?: GptOperationsContext["transportHealth"]["state"]) {
  return ({
    saved: "Sortie sauvegardée",
    ready_to_save: "Prêt à sauvegarder",
    attention: "Contrat incomplet",
    lease_expired: "Lease expiré",
    waiting: "En attente",
  } as Record<string, string>)[String(state || "")] || "État transport N/D";
}

function GptContractPanel({ transport }: { transport: GptTransportContract }) {
  return <TechnicalDetails title="Transmission technique GPT" items={[
    { label: "État du lease", value: <LeaseBadge state={transport.lease.state}/> },
    { label: "Outil de sauvegarde", value: transport.saveTool },
    { label: "Work item", value: transport.workItemId },
    { label: "Worker payload", value: transport.workerId },
    { label: "Jeton de lease", value: transport.leaseProtected ? "Protégé côté serveur" : "Absent" },
    { label: "Handle", value: transport.hasLeaseHandle ? "Complet" : "Incomplet" },
    { label: "Prompt", value: transport.promptAvailable ? "Exposé" : "Absent" },
    { label: "Manifest", value: transport.manifestAvailable ? "Présent" : "Absent" },
    { label: "Cible de sauvegarde", value: transport.saveTargetAvailable ? "Présente" : "Absente" },
  ]}/>;
}

function LeaseBadge({ state }: { state: GptTransportContract["lease"]["state"] }) {
  return <span className="lease-badge" data-state={state}>{state === "active" ? "ACTIVE" : state === "expiring" ? "EXPIRING" : state === "expired" ? "EXPIRED" : "NO LEASE"}</span>;
}

function GptLifecycle({ process }: { process: GptProcess }) {
  const terminal = process.status === "completed";
  const failed = process.status === "failed";
  const claimed = Boolean(process.worker) || process.events.some(event => /CLAIM/i.test(event.type));
  const executed = terminal || failed || process.status === "running" || process.events.some(event => /RUN|EXECUT|SAV/i.test(event.type));
  const current = terminal ? 3 : executed ? 2 : claimed ? 1 : 0;
  const stages = [
    { key: "01", label: "Work item", detail: "Créé / prêt" },
    { key: "02", label: "Claim", detail: process.worker || "Worker attendu" },
    { key: "03", label: "Exécution", detail: process.rawStatus },
    { key: "04", label: "Sauvegarde", detail: process.decision || "Sortie attendue" },
  ];
  return <div className="gpt-lifecycle-rail" aria-label="Progression du processus GPT">{stages.map((stage, index) => {
    const state = failed && index === current ? "failed" : terminal || index < current ? "completed" : index === current ? "current" : "pending";
    return <div key={stage.key} data-state={state}><span>{stage.key}</span><i/><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></div>;
  })}</div>;
}

function bundleQuality(process: GptProcess) {
  const quality = process.bundle?.dataQuality;
  if (quality && typeof quality === "object" && "status" in quality) return String((quality as { status?: unknown }).status || "—");
  return quality ? String(quality) : "—";
}

function tokenDetail(process: GptProcess) {
  const telemetry = process.telemetry;
  if (telemetry.inputTokens === null && telemetry.outputTokens === null) return "Télémétrie absente";
  return `${telemetry.inputTokens ?? "N/D"} in · ${telemetry.outputTokens ?? "N/D"} out`;
}

function workflowDisplayLabel(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("master")) return "Analyse initiale de la journée";
  if (normalized.includes("monitor")) return "Mise à jour du plan";
  return workflowLabel(value);
}
