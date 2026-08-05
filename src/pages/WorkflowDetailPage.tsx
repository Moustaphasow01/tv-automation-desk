import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, ProgressBar, statusLabel, StatusTag, TechnicalDetails } from "@/components/operations";
import { operationsKeys, useWorkflow } from "@/hooks/useOperations";
import { workflowLabel } from "@/lib/presentation";
import type { OperationsCommandInput, WorkflowActionDescriptor, WorkflowCommandAction, WorkflowCommandCenter } from "@/operationsTypes";

export default function WorkflowDetailPage() {
  const { workflowId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const query = useWorkflow(decodeURIComponent(workflowId));
  const client = useQueryClient();
  const requestedAction = params.get("action") as WorkflowCommandAction | null;
  const [action, setAction] = useState<WorkflowCommandAction | "">("");
  const [preparedAction, setPreparedAction] = useState<WorkflowCommandAction | null>(requestedAction);
  const mutation = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeWorkflowAction(decodeURIComponent(workflowId), input),
    onSuccess: async () => { setAction(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); }
  });
  useEffect(() => {
    if (requestedAction) setPreparedAction(requestedAction);
  }, [requestedAction]);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Workflow introuvable"} retry={() => query.refetch()}/>;
  const { workflow, steps, events, commandCenter } = query.data;
  const selectedDescriptor = commandCenter.actions.find(item => item.action === (action || preparedAction)) || null;
  const expectedPhrase = action ? `CONFIRM_${action.toUpperCase()}` : "";
  const prepareAction = (next: WorkflowCommandAction) => {
    setPreparedAction(next);
    setParams(current => {
      const params = new URLSearchParams(current);
      params.set("action", next);
      return params;
    }, { replace: true });
  };
  const displayName = workflowLabel(workflow.sourceId || workflow.id);
  return <section className="view workspace-view workflow-command-view">
    <Breadcrumbs items={[{ label: "Automatisations", to: "/operations" }, { label: displayName }]}/>
    <PageHeading eyebrow="Automatisation détaillée" title={displayName} subtitle={`${workflow.name} · ${statusLabel(workflow.status)}`} backTo="/operations" actions={<StatusTag status={workflow.status}/>}/>
    <div className="metric-grid metric-grid--compact">
      <MetricCard label="Progression" value={`${workflow.progress}%`} detail={statusLabel(workflow.status)}/>
      <MetricCard label="Durée" value={formatDuration(workflow.durationMs)}/>
      <MetricCard label="Étapes" value={`${steps.filter(step => step.status === "completed").length}/${steps.length}`}/>
      <MetricCard label="Mise à jour" value={formatDateTime(workflow.updatedAt)}/>
    </div>
    <ProgressBar value={workflow.progress}/>
    {workflow.kind === "replay" && <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}`}>Ouvrir dans Replay Lab</Link>{workflow.currentWorkItemId && <Link className="secondary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}/gpt/${encodeURIComponent(workflow.currentWorkItemId)}`}>Processus GPT courant</Link>}</div>}
    <WorkflowCommandCenterPanel commandCenter={commandCenter} preparedAction={preparedAction} onPrepare={prepareAction} onExecute={setAction}/>
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Étapes</h2>{!steps.length ? <p className="muted-copy">Ce workflow ne publie pas d’étapes détaillées.</p> : <ol className="step-list">{steps.map(step => <li key={step.id}><span>{step.sequence}</span><div><strong>{step.type}</strong><small>{formatDateTime(step.at)}</small></div><StatusTag status={step.status}/></li>)}</ol>}</Card>
      <Card className="workspace-panel"><h2>État canonique</h2><dl className="definition-grid"><dt>Stratégie</dt><dd>{workflow.strategyId || "—"}</dd><dt>Session</dt><dd>{workflow.session || "—"}</dd><dt>Date</dt><dd>{workflow.tradingDate || "—"}</dd><dt>Prochaine action</dt><dd>{workflow.nextAction || "—"}</dd><dt>Dernière mise à jour</dt><dd>{formatDateTime(workflow.updatedAt)}</dd></dl>{workflow.error && <div className="error-box"><strong>{workflow.error.code || "Erreur"}</strong><p>{workflow.error.message}</p></div>}</Card>
    </div>
    <TechnicalDetails items={[
      { label: "Workflow", value: workflow.id },
      { label: "Référence source", value: workflow.sourceId },
      { label: "Révision", value: workflow.revision },
      { label: "Work item courant", value: workflow.currentWorkItemId },
      { label: "État source", value: workflow.rawStatus },
    ]}/>
    <div id="timeline-events"><h2>Événements</h2><EventTimeline events={events} runId={workflow.kind === "replay" ? workflow.sourceId : undefined} workflowId={workflow.id}/></div>
    <Modal open={Boolean(action)} title={`Confirmer · ${action}`} onClose={() => !mutation.isPending && setAction("")}>
      {action && <ConfirmActionForm
        key={action}
        target={workflow.name}
        revision={workflow.revision}
        expectedPhrase={expectedPhrase}
        onCancel={() => setAction("")}
        danger={action === "cancel"}
        confirmLabel={selectedDescriptor?.label || "Confirmer l’action"}
        onConfirm={({ confirmationPhrase, reason }) => mutation.mutateAsync({ action, expectedRevision: workflow.revision, idempotencyKey: crypto.randomUUID(), confirmationPhrase, reason }).then(() => undefined)}
      >
        {selectedDescriptor && <div className="workflow-command-modal-context"><strong>{selectedDescriptor.reason}</strong><small>Révision {selectedDescriptor.expectedRevision} · {selectedDescriptor.confirmationPhrase}</small></div>}
      </ConfirmActionForm>}
    </Modal>
  </section>;
}

function WorkflowCommandCenterPanel({ commandCenter, preparedAction, onPrepare, onExecute }: { commandCenter: WorkflowCommandCenter; preparedAction: WorkflowCommandAction | null; onPrepare: (action: WorkflowCommandAction) => void; onExecute: (action: WorkflowCommandAction) => void }) {
  const enabled = commandCenter.actions.filter(item => item.enabled);
  const prepared = commandCenter.actions.find(item => item.action === preparedAction) || commandCenter.actions.find(item => item.action === commandCenter.recommendedAction) || null;
  const terminal = enabled.length === 0;
  return <section id="command-center" className="workflow-command-center" aria-label="Workflow Command Center">
    <Card className="workflow-command-header">
      <header><div><p className="eyebrow">Pilotage</p><h2>Actions disponibles</h2></div><StatusTag status={commandCenter.status}/></header>
      <div className="workflow-command-stats">
        <span>Révision <strong>{commandCenter.expectedRevision}</strong></span>
        <span>Actions <strong>{enabled.length}</strong></span>
        <span>Appliquées <strong>{commandCenter.commandBus.applied}</strong></span>
        <span>Échecs <strong>{commandCenter.commandBus.failed}</strong></span>
      </div>
      <div className="workflow-command-links">{commandCenter.links.map(link => <Link key={`${link.kind}:${link.href}`} to={link.href}><Icon name={link.kind === "gpt" ? "brain" : link.kind === "replay" ? "timeline" : "arrow"} size={13}/>{link.label}</Link>)}</div>
    </Card>

    <Card className="workflow-command-actions">
      <header><div><p className="eyebrow">Préparer l’action</p><h2>{terminal ? "Workflow terminal · aucune action disponible" : prepared ? prepared.label : "Aucune action disponible"}</h2></div>{!terminal && commandCenter.recommendedAction && <span>Recommandée · {commandCenter.recommendedAction}</span>}</header>
      {terminal && <p className="workflow-command-notice">Ce workflow est dans un état terminal. Les actions ci-dessous sont conservées pour audit, mais elles ne peuvent pas être préparées ni exécutées.</p>}
      <div className="workflow-action-grid">{commandCenter.actions.map(item => <WorkflowActionCard key={item.action} item={item} selected={prepared?.action === item.action} onPrepare={onPrepare} onExecute={onExecute}/>)}</div>
    </Card>

    <Card className="workflow-command-bus">
      <header><div><p className="eyebrow">Journal opérateur</p><h2>Historique des actions</h2></div><span>{commandCenter.commandBus.history.length} commandes</span></header>
      {!commandCenter.commandBus.history.length ? <div className="terminal-empty-state"><span>NO_COMMAND_HISTORY</span><small>Aucune commande opérateur appliquée sur ce workflow.</small></div> : <ol className="workflow-command-history">{commandCenter.commandBus.history.map(item => <li key={item.id} data-status={item.status.toLowerCase()}>
        <time>{formatDateTime(item.updatedAt || item.createdAt)}</time>
        <span><strong>{item.action.toUpperCase()}</strong><small>{item.actor} · rev {item.expectedRevision}</small></span>
        <em>{item.status}</em>
      </li>)}</ol>}
    </Card>
  </section>;
}

function WorkflowActionCard({ item, selected, onPrepare, onExecute }: { item: WorkflowActionDescriptor; selected: boolean; onPrepare: (action: WorkflowCommandAction) => void; onExecute: (action: WorkflowCommandAction) => void }) {
  return <article className={`workflow-action-card ${selected ? "is-selected" : ""}`} data-tone={item.tone} data-disabled={!item.enabled}>
    <header><span>{item.action}</span>{item.recommended && <em>REC</em>}</header>
    <strong>{item.label}</strong>
    <p>{item.enabled ? item.reason : item.disabledReason}</p>
    <small>{item.confirmationPhrase} · rev {item.expectedRevision}</small>
    <div><button type="button" className="secondary-btn" disabled={!item.enabled} onClick={() => onPrepare(item.action)}>Préparer</button><button type="button" className={item.tone === "critical" ? "danger-btn" : "primary-btn"} disabled={!item.enabled} onClick={() => onExecute(item.action)}>Exécuter</button></div>
  </article>;
}
