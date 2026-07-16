import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function HistoryPage() {
  const query = useQuery({ queryKey: operationsKeys.history, queryFn: operationsApi.getHistory });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Historique indisponible"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><PageHeading eyebrow="Long-term memory" title="Historique des sessions" subtitle="Sessions, workflows, incidents et performance réunis sans perdre la traçabilité."/>{!query.data.sessions.length ? <Card className="workspace-empty"><h3>Aucune session historique</h3><p>L’historique se construit directement à partir des workflows persistés.</p></Card> : query.data.sessions.map(session => <Link className="history-session" key={session.id} to={`/history/sessions/${encodeURIComponent(session.id)}`}><div><strong>{session.tradingDate || "Date inconnue"}</strong><span>{session.session || "global"} · {session.workflowCount} workflows</span></div><StatusTag status={session.status}/><span className="row-link">Ouvrir →</span></Link>)}</section>;
}
