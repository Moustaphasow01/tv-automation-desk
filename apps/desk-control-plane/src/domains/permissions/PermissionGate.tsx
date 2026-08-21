import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeskAppConfig } from "@/app/appConfig";
import { createDeskTransport, type OperatorLoginCredentials } from "@/shared/transport";
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
  const [login, setLogin] = useState("MSO");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const authenticated = session?.summary.authenticated === true;
  if (authenticated) return <>{children}</>;
  if (loading) return <OperatorLoginShell status="Vérification de la session opérateur…" busy />;
  if (error || !session) {
    return (
      <OperatorLoginShell status="Session backend indisponible">
        <p role="alert">Le BFF ne peut pas vérifier les autorisations. Aucun accès interactif n’est accordé.</p>
        <button type="button" className="operator-login-gate__secondary" onClick={() => void refreshSession()}>Réessayer</button>
      </OperatorLoginShell>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const credentials = { login: login.trim(), password };
    if (!credentials.login || !credentials.password) {
      setLoginError("LOGIN_ET_MOT_DE_PASSE_REQUIS");
      return;
    }
    setSubmitting(true);
    setLoginError(null);
    try {
      await loginOperator(credentials);
      setPassword("");
      await refreshSession();
    } catch (authError) {
      setLoginError(authError instanceof Error ? authError.message : "OPERATOR_LOGIN_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OperatorLoginShell status="Accès opérateur requis">
      <form className="operator-login-gate__form" onSubmit={submit}>
        <label>
          <span>Login</span>
          <input
            autoComplete="username"
            autoFocus
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          <span>Mot de passe</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
        </label>
        <button type="submit" disabled={submitting || !login.trim() || !password}>
          {submitting ? "Ouverture de session…" : "Entrer dans le desk"}
        </button>
      </form>
      {loginError ? <p className="operator-login-gate__error" role="alert">{loginError}</p> : null}
      <p className="operator-login-gate__hint">Lecture et actions restent fermées tant que le backend ne publie pas une session opérateur active.</p>
    </OperatorLoginShell>
  );
}

function OperatorLoginShell({ status, busy = false, children }: { status: string; busy?: boolean; children?: ReactNode }) {
  return (
    <main className="operator-login-gate" aria-busy={busy}>
      <section className="operator-login-gate__card" aria-labelledby="operator-login-title">
        <p className="operator-login-gate__eyebrow">Desk Futures · Control Plane</p>
        <h1 id="operator-login-title">Authentification</h1>
        <p>{status}</p>
        {children}
      </section>
    </main>
  );
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
