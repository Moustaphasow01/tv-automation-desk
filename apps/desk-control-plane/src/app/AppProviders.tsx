import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useMemo } from "react";
import { readDeskAppConfig, type DeskAppConfig } from "@/app/appConfig";
import { RealtimeProvider } from "@/domains/realtime/RealtimeProvider";
import { PermissionProvider, useOperatorSession } from "@/domains/permissions/PermissionGate";
import { emitFrontTelemetry } from "@/core/telemetry/frontendTelemetry";

export const DeskConfigContext = createContext<DeskAppConfig | null>(null);

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  const config = useMemo(() => readDeskAppConfig(import.meta.env), []);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onSuccess: (_data, query) => emitFrontTelemetry("front.query.succeeded", { query: JSON.stringify(query.queryKey) }),
          onError: (error, query) => emitFrontTelemetry("front.query.failed", { query: JSON.stringify(query.queryKey), error: error instanceof Error ? error.message : "UNKNOWN" })
        }),
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 15_000,
            refetchOnWindowFocus: false
          }
        }
      }),
    []
  );

  return (
    <DeskConfigContext.Provider value={config}>
      <QueryClientProvider client={queryClient}>
        <PermissionProvider config={config}>
          <AuthenticatedRealtimeProvider config={config} queryClient={queryClient}>{children}</AuthenticatedRealtimeProvider>
        </PermissionProvider>
      </QueryClientProvider>
    </DeskConfigContext.Provider>
  );
}

function AuthenticatedRealtimeProvider({ children, config, queryClient }: { children: ReactNode; config: DeskAppConfig; queryClient: QueryClient }) {
  const { session } = useOperatorSession();
  if (session?.summary.authenticated !== true) return <>{children}</>;
  return <RealtimeProvider config={config} queryClient={queryClient}>{children}</RealtimeProvider>;
}
