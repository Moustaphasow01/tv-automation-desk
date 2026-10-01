import { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeskConfigContext } from "@/app/AppProviders";
import { isOosOverview, isOosDetail, isOosReceipt, type OosRequest } from "./oosBatchContract";
import { isPreparation, isPreparationDay, type PreparationRequest } from "./oosPreparationContract";

export function createOosClient(base: string) {
  const url = (name: string, params: Record<string, string> = {}) => `${base}/oos-batch/${name}?${new URLSearchParams(params)}`;
  async function request<T>(name: string, guard: (v: unknown) => v is T, params = {}, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url(name, params), { credentials: "include", cache: "no-store", method: body ? "POST" : "GET",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.code || value.error || `OOS_HTTP_${response.status}`);
    if (!guard(value)) throw new Error("OOS_RESPONSE_INVALID");
    return value;
  }
  return {
    newCommand: (input: OosRequest) => ({ input, id: crypto.randomUUID() }),
    overview: (batch: string, signal?: AbortSignal) => request("days", isOosOverview, batch ? { batch_id: batch } : {}, undefined, signal),
    detail: (batch: string, date: string, signal?: AbortSignal) => request("day", isOosDetail, { batch_id: batch, date }, undefined, signal),
    submit: (input: OosRequest, id: string) => request("commands", isOosReceipt, {}, { ...input, command_id: id }),
    receipt: (id: string, signal?: AbortSignal) => request("command", isOosReceipt, { command_id: id }, undefined, signal),
    artifact: (batch: string, date: string, name: string) => url("artifact", { batch_id: batch, date, name }),
    prepare: async (input: PreparationRequest) => "date" in input
      ? request("prepare-premarket", isPreparationDay, {}, input) : request("prepare-range", isPreparation, {}, input),
    preparations: (batchId: string, signal?: AbortSignal) => request("batch-status", isPreparation, batchId ? { batch_id: batchId } : {}, undefined, signal),
  };
}
export function useOosClient() {
  const config = useContext(DeskConfigContext);
  return useMemo(() => { if (!config) throw new Error("DESK_CONFIG_CONTEXT_MISSING"); return createOosClient(config.frontApiBaseUrl); }, [config]);
}
export function useOosOverview(batch: string) {
  const client = useOosClient();
  return useQuery({ queryKey: ["oos-batch", batch], queryFn: ({ signal }) => client.overview(batch, signal), refetchInterval: 5000, retry: false });
}
export function useOosDetail(batch: string, date: string) {
  const client = useOosClient();
  return useQuery({ queryKey: ["oos-day", batch, date], queryFn: ({ signal }) => client.detail(batch, date, signal), enabled: !!batch && !!date, refetchInterval: 5000, retry: false });
}
export function useOosReceipt(id: string) {
  const client = useOosClient();
  return useQuery({ queryKey: ["oos-command", id], queryFn: ({ signal }) => client.receipt(id, signal), enabled: !!id, retry: false,
    refetchInterval: query => query.state.data?.status === "COMPLETED" ? false : 2000 });
}
export function useOosPreparations(batchId: string) {
  const client = useOosClient();
  return useQuery({ queryKey: ["oos-preparation", batchId], queryFn: ({ signal }) => client.preparations(batchId, signal), refetchInterval: 5000, retry: false });
}
