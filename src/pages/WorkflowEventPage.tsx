import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useWorkflow } from "@/hooks/useOperations";

export default function WorkflowEventPage() {
  const { workflowId = "", eventId = "" } = useParams();
  const id = decodeURIComponent(workflowId);
  const query = useWorkflow(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Événement introuvable"} retry={() => query.refetch()}/>;
  const event = query.data.events.find(item => item.id === decodeURIComponent(eventId));
  if (!event) return <ErrorView message="Cet événement n’existe plus dans la projection du workflow." retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: query.data.workflow.name, to: `/operations/workflows/${encodeURIComponent(id)}` }, { label: event.title }]}/><PageHeading eyebrow={event.type} title={event.title} subtitle={formatDateTime(event.at)} backTo={`/operations/workflows/${encodeURIComponent(id)}`} actions={<StatusTag status={event.status}/>}/><Card className="workspace-panel"><h2>Détail de la transition</h2><p className="conclusion-copy">{event.detail || "Aucun détail complémentaire."}</p><dl className="definition-grid"><dt>Identifiant</dt><dd>{event.id}</dd><dt>Type</dt><dd>{event.type}</dd><dt>Acteur</dt><dd>{event.actor ? JSON.stringify(event.actor) : "backend"}</dd><dt>Référence</dt><dd>{event.ref ? JSON.stringify(event.ref) : "—"}</dd></dl></Card><details className="raw-inspector"><summary>Événement projeté</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></section>;
}
