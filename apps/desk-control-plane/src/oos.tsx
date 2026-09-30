import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeskConfigContext } from "@/app/AppProviders";
import { OosBatchWorkspace } from "@/features/oos-batch/OosBatchWorkspace";
import "@/design-system/styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const config = { dataMode: "bff" as const, frontApiBaseUrl: "/oos/front-api/v1", operatorAuthBaseUrl: "/oos/login",
  frontApiTimeoutMs: 30000, features: { jarvisWorkspace: false } };
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <DeskConfigContext.Provider value={config}><QueryClientProvider client={queryClient}>
    <HashRouter><main><OosBatchWorkspace /></main></HashRouter>
  </QueryClientProvider></DeskConfigContext.Provider>
</React.StrictMode>);
