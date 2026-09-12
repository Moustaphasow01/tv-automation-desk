import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeskAppConfig } from "@/app/appConfig";
import { createDeskTransport, type OperatorLoginCredentials } from "@/shared/transport";
import { assertViewEnvelope } from "@/shared/contracts";
import { isAuthSessionView } from "@/domains/front-api/viewModels";
import type { AuthSessionView } from "@/domains/front-api/viewModels";
import { OperatorLoginScreen } from "./OperatorLoginScreen";

type PermissionGateProps = {
  capability: string;
  children: ReactNode;
};

type PermissionContextValue = {
  session: AuthSessionView | null;
  loading: boolean;
  error: Error | null;
  refreshSession(): Promise<void>;
  loginOperator(credentials: OperatorLoginCredentials | string): Promise<void>;
  logoutOperator(): Promise<void>;
};

const missingSessionAction = async () => {
  throw new Error("OPERATOR_SESSION_PROVIDER_MISSING");
};

const PermissionContext = createContext<PermissionContextValue>({
  session: null,
  loading: true,
  error: null,
  refreshSession: missingSessionAction,
  loginOperator: missingSessionAction,
  logoutOperator: missingSessionAction,
});

export function PermissionProvider({ children, config }: { children: ReactNode; config: DeskAppConfig }) {
  const transport = useMemo(() => createDeskTransport(config), [config]);
  const query = useQuery({
    queryKey: ["front-view", "auth-session"],
    queryFn: async () => assertViewEnvelope(await transport.getView<AuthSessionView>("auth-session"), isAuthSessionView),
    staleTime: 30_000
  });
  const value = useMemo<PermissionContextValue>(() => ({
    session: query.data?.data ?? null,
    loading: query.isLoading,
    error: query.error as Error | null,
    refreshSession: async () => { await query.refetch(); },
    loginOperator: (credentials) => transport.loginOperator(credentials),
    logoutOperator: () => transport.logoutOperator(),
  }), [query, transport]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function useOperatorSession() {
  return useContext(PermissionContext);
}

export function OperatorLoginGate({ children }: { children: ReactNode }) {
  const { session, loading, error, refreshSession, loginOperator } = useOperatorSession();
  if (session?.summary.authenticated === true) return <>{children}</>;
  return <OperatorLoginScreen state={loading ? "loading" : error || !session ? "unavailable" : "ready"}
    onLogin={loginOperator} onRefresh={refreshSession} />;
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
