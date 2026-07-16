import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, PageHeading, StatusTag, WorkspaceNav, WorkflowTable } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function HistorySessionPage() {
  const { sessionId = "" } = useParams();
  const id = decodeURIComponent(sessionId);
  const query = useQuery({ queryKey: operationsKeys.history, queryFn: operationsApi.getHistory });
  if (query.isLoading) return <LoadingView/>;
  const session = query.data?.sessions.find(item => item.id === id);
  if (query.isError || !session) return <ErrorView message={query.error?.message || "Session historique introuvable"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Historique", to: "/history" }, { label: session.tradingDate || id }]}/><PageHeading eyebrow="Session historique" title={`${session.tradingDate} · ${session.session || "global"}`} subtitle={`${session.workflowCount} workflows persistés`} backTo="/history" actions={<StatusTag status={session.status}/>}/><WorkflowTable items={session.workflows}/></section>;
}
