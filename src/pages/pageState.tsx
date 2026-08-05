import type { ReactNode } from "react";
import { ErrorView, LoadingView } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

export interface DeskPageMeta {
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

export function DeskPage({ children }: { children: (data: DeskSession, meta: DeskPageMeta) => ReactNode }) {
  const { sessionId } = useDeskContext();
  const query = useDeskSession(sessionId);
  if (query.isLoading) return <LoadingView title="Chargement de la session Live" message="Lecture de la projection live canonique pour la session automatique." source="desk_front_current_states"/>;
  if (query.isError || !query.data) return <ErrorView title="Session Live indisponible" message={query.error instanceof Error ? query.error.message : "Erreur inconnue"} retry={() => query.refetch()}/>;
  return <>{children(query.data, {
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  })}</>;
}
