import type { ReactNode } from "react";
import { ErrorView, LoadingView } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

export function DeskPage({ children }: { children: (data: DeskSession) => ReactNode }) {
  const { sessionId } = useDeskContext();
  const query = useDeskSession(sessionId);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error instanceof Error ? query.error.message : "Erreur inconnue"} retry={() => query.refetch()}/>;
  return <>{children(query.data)}</>;
}
