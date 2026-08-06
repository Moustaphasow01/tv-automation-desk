import { Navigate, useParams } from "react-router-dom";

export default function ReplaySessionPage() {
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  return <Navigate to={`/replay/runs/${encodeURIComponent(id)}/days/${date}`} replace/>;
}
