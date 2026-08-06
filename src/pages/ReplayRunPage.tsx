import { Navigate, useParams } from "react-router-dom";
import { ErrorView, LoadingView } from "@/components/common";
import { useReplay } from "@/hooks/useOperations";

export default function ReplayRunPage() {
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const date = query.data.run.tradingDate;
  if (!date) return <ErrorView message="Ce replay n'a pas de journée associée." retry={() => query.refetch()}/>;
  return <Navigate to={`/replay/runs/${encodeURIComponent(id)}/days/${date}`} replace/>;
}
