import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag, TechnicalDetails } from "@/components/operations";
import { useWorkflow } from "@/hooks/useOperations";

export default function WorkflowEventPage() {
  const { workflowId = "", eventId = "" } = useParams();
  const id = decodeURIComponent(workflowId);
  const query = useWorkflow(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Événement introuvable"} retry={() => query.refetch()}/>;
  const event = query.data.events.find(item => item.id === decodeURIComponent(eventId));
  if (!event) return <ErrorView message="Cet événement n’existe plus dans la projection du workflow." retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: query.data.workflow.name, to: `/operations/workflows/${encodeURIComponent(id)}` }, { label: event.title }]}/><PageHeading eyebrow="Transition d’automatisation" title={event.title} subtitle={formatDateTime(event.at)} backTo={`/operations/workflows/${encodeURIComponent(id)}`} actions={<StatusTag status={event.status}/>}/><Card className="workspace-panel"><h2>Ce qui s’est passé</h2><p className="conclusion-copy">{event.detail || "Aucun détail complémentaire."}</p><dl className="definition-grid"><dt>Type</dt><dd>{event.type}</dd><dt>Déclenché par</dt><dd>{event.actor ? JSON.stringify(event.actor) : "Backend du desk"}</dd></dl></Card><TechnicalDetails items={[{ label: "Identifiant événement", value: event.id }, { label: "Référence source", value: event.ref ? JSON.stringify(event.ref) : "N/D" }]}/><details className="raw-inspector"><summary>Données brutes</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></section>;
}
