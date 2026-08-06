import { Navigate, useParams } from "react-router-dom";

export default function ReplaySessionPage() {
  const { runId = "", date = "" } = useParams();
  return <Navigate to={`/replay/runs/${runId}/days/${date}`} replace/>;
}
