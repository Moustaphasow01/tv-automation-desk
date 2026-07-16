import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useWorkflow } from "@/hooks/useOperations";
import type { OperationsCommandInput } from "@/operationsTypes";

export default function WorkflowDetailPage() {
  const { workflowId = "" } = useParams();
  const query = useWorkflow(decodeURIComponent(workflowId));
  const client = useQueryClient();
  const [action, setAction] = useState<OperationsCommandInput["action"] | "">("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeWorkflowAction(decodeURIComponent(workflowId), input),
    onSuccess: async () => { setAction(""); setReason(""); setConfirmation(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); }
  });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Workflow introuvable"} retry={() => query.refetch()}/>;
  const { workflow, steps, events, allowedActions } = query.data;
  const expectedPhrase = action ? `CONFIRM_${action.toUpperCase()}` : "";
  const submit = () => action && mutation.mutate({ action, expectedRevision: workflow.revision, idempotencyKey: crypto.randomUUID(), confirmationPhrase: confirmation, reason });
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: workflow.name }]}/>
    <PageHeading eyebrow={workflow.kind} title={workflow.name} subtitle={workflow.sourceId} backTo="/operations" actions={<StatusTag status={workflow.status}/>}/>
    <div className="metric-grid metric-grid--compact">
      <MetricCard label="Progression" value={`${workflow.progress}%`} detail={workflow.rawStatus}/>
      <MetricCard label="Durée" value={formatDuration(workflow.durationMs)}/>
      <MetricCard label="Étapes" value={`${steps.filter(step => step.status === "completed").length}/${steps.length}`}/>
      <MetricCard label="Révision" value={workflow.revision}/>
    </div>
    <ProgressBar value={workflow.progress}/>
    {workflow.kind === "replay" && <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}`}>Ouvrir dans Replay Lab</Link>{workflow.currentWorkItemId && <Link className="secondary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}/gpt/${encodeURIComponent(workflow.currentWorkItemId)}`}>Processus GPT courant</Link>}</div>}
    {!!allowedActions.length && <Card className="command-panel">
      <div><p className="eyebrow">Actions contrôlées</p><h2>Intervenir sur le workflow</h2><p>Chaque action vérifie la révision, exige une clé d’idempotence et écrit un événement d’audit.</p></div>
      <div className="command-panel__form">
        <label>Action<select value={action} onChange={event => { setAction(event.target.value as typeof action); setConfirmation(""); }}><option value="">Sélectionner</option>{allowedActions.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
        <label>Motif<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Motif opérationnel"/></label>
        <label>Confirmation<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={expectedPhrase || "Choisissez une action"}/></label>
        <button className="danger-btn" disabled={!action || reason.trim().length < 3 || confirmation !== expectedPhrase || mutation.isPending} onClick={submit}>{mutation.isPending ? "Application…" : "Confirmer"}</button>
      </div>{mutation.isError && <p className="form-error">{mutation.error.message}</p>}
    </Card>}
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Étapes</h2>{!steps.length ? <p className="muted-copy">Ce workflow ne publie pas d’étapes détaillées.</p> : <ol className="step-list">{steps.map(step => <li key={step.id}><span>{step.sequence}</span><div><strong>{step.type}</strong><small>{formatDateTime(step.at)}</small></div><StatusTag status={step.status}/></li>)}</ol>}</Card>
      <Card className="workspace-panel"><h2>État canonique</h2><dl className="definition-grid"><dt>Stratégie</dt><dd>{workflow.strategyId || "—"}</dd><dt>Session</dt><dd>{workflow.session || "—"}</dd><dt>Date</dt><dd>{workflow.tradingDate || "—"}</dd><dt>Prochaine action</dt><dd>{workflow.nextAction || "—"}</dd><dt>Dernière mise à jour</dt><dd>{formatDateTime(workflow.updatedAt)}</dd></dl>{workflow.error && <div className="error-box"><strong>{workflow.error.code || "Erreur"}</strong><p>{workflow.error.message}</p></div>}</Card>
    </div>
    <div id="timeline-events"><h2>Événements</h2><EventTimeline events={events} runId={workflow.kind === "replay" ? workflow.sourceId : undefined} workflowId={workflow.id}/></div>
  </section>;
}
