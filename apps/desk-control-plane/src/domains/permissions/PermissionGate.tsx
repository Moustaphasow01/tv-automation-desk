import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeskAppConfig } from "@/app/appConfig";
import { createDeskTransport } from "@/shared/transport";
import { assertViewEnvelope } from "@/shared/contracts";
import { isAuthSessionView } from "@/domains/front-api/viewModels";
import type { AuthSessionView } from "@/domains/front-api/viewModels";

type PermissionGateProps = {
  capability: string;
  children: ReactNode;
};

type PermissionContextValue = {
  session: AuthSessionView | null;
  loading: boolean;
  error: Error | null;
};

const PermissionContext = createContext<PermissionContextValue>({ session: null, loading: true, error: null });

export function PermissionProvider({ children, config }: { children: ReactNode; config: DeskAppConfig }) {
  const transport = useMemo(() => createDeskTransport(config), [config]);
  const query = useQuery({
    queryKey: ["front-view", "auth-session"],
    queryFn: async () => assertViewEnvelope(await transport.getView<AuthSessionView>("auth-session"), isAuthSessionView),
    staleTime: 30_000
  });
  return (
    <PermissionContext.Provider value={{ session: query.data?.data ?? null, loading: query.isLoading, error: query.error as Error | null }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function useOperatorSession() {
  return useContext(PermissionContext);
}

export function PermissionGate({ capability, children }: PermissionGateProps) {
  const { session, loading, error } = useOperatorSession();

  if (capability === "auth.read") return <>{children}</>;
  if (loading) return <main className="permission-state" aria-busy="true"><p>Vérification des autorisations…</p></main>;
  if (error || !session) {
    return <main className="permission-denied" role="alert"><h1>Session indisponible</h1><p>Les autorisations backend ne peuvent pas être vérifiées. Aucune capacité locale n’est accordée.</p></main>;
  }

  const canonicalCapability = capability.endsWith(".read") || capability.includes(".readiness.") || capability === "strategy.compare"
    ? "front.read"
    : capability;
  const permission = session.permissions.find((item) => item.capability === canonicalCapability);
  if (permission?.decision !== "ALLOW") {
    return (
      <main className="permission-denied" role="alert">
        <p className="eyebrow">Accès refusé</p>
        <h1>Capacité non autorisée</h1>
        <p>{permission?.reason || `Le backend n’a publié aucune autorisation pour ${capability}.`}</p>
      </main>
    );
  }

  return <>{children}</>;
}
