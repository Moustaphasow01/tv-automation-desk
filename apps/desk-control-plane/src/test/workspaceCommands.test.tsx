// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureMeta, fixtureNow, workspaceCard, workspaceDossier, workspaceFocus, workspaceGate, workspaceLiveModel } from "./tradingWorkspaceFixtures";
import { useWorkspaceCommand, type WorkspaceCommand } from "@/features/live-trading/workspace/useWorkspaceCommand";
import { workspaceTickets } from "@/features/live-trading/workspace/workspaceModel";
import type { WorkspaceHealth } from "@/features/live-trading/workspace/commandPolicy";

const harness = vi.hoisted(() => ({
  getView: vi.fn(), submitCommand: vi.fn(), snapshot: { data: undefined as { status: string } | undefined, isError: false }, dossier: null as unknown,
}));
vi.mock("@/domains/front-api/repositories", () => ({
  useFrontViewRepository: () => ({ getView: harness.getView, submitCommand: harness.submitCommand }),
  useCommandStatus: () => harness.snapshot,
}));
vi.mock("@/features/order-intent/mapper", () => ({ buildOrderIntentDossier: () => harness.dossier }));

let root: Root;
let api: WorkspaceCommand;
let element: HTMLDivElement;
const refresh = vi.fn();
const health: WorkspaceHealth = { connected: true, paused: false, failed: false, meta: fixtureMeta };
function Probe({ currentHealth = health, selected = "trade:intent-test" }: { currentHealth?: WorkspaceHealth; selected?: string }) {
  api = useWorkspaceCommand(currentHealth, selected, refresh);
  return null;
}

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(fixtureNow);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockReset(); harness.getView.mockReset(); harness.submitCommand.mockReset();
  harness.snapshot = { data: undefined, isError: false }; harness.dossier = workspaceDossier();
  const model = workspaceLiveModel();
  harness.getView.mockImplementation(async (name: string) => name === "live-focus" ? { meta: fixtureMeta, data: workspaceFocus() } : name === "live-trading" ? { meta: fixtureMeta, data: model.source } : {});
  harness.submitCommand.mockResolvedValue({ commandId: "command-test", status: "ACCEPTED", correlationId: "correlation-test", idempotencyKey: "idempotency-test", acceptedAt: fixtureMeta.generatedAt });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });
const request = () => api.submit({ kind: "gate", action: workspaceGate() }, { reason: "Operator checked" }, workspaceTickets(workspaceFocus())[0]);

describe("Workspace command orchestration (isolated transport, no VPS writes)", () => {
  it("revalidates all three authority views before preserving the command revision and environment", async () => {
    let result = false; await act(async () => { result = await request(); });
    expect(result).toBe(true); expect(harness.getView).toHaveBeenCalledTimes(3);
    expect(harness.submitCommand).toHaveBeenCalledWith(expect.objectContaining({ environment: "SHADOW", expectedVersion: "rev-4", payload: { portfolioOrderIntentId: "intent-test", actionId: "confirm-test" } }));
    expect(api.status).toBe("ACCEPTED"); expect(api.busy).toBe(true); expect(api.receipt?.ticket).toContain("intent-test");
  });
  it("does not send a command after a revoked capability or changed revision", async () => {
    harness.dossier = workspaceDossier(workspaceGate({ expectedRevision: "rev-new" }));
    await act(async () => { await request(); });
    expect(harness.submitCommand).not.toHaveBeenCalled(); expect(api.error).toContain("autorisations ont changé");
  });
  it("does not send when the selected card has disappeared from the refreshed projection", async () => {
    harness.getView.mockResolvedValue({ meta: fixtureMeta, data: workspaceFocus([]) });
    await act(async () => { await request(); }); expect(harness.submitCommand).not.toHaveBeenCalled();
  });
  it("rejects a changed plan even if an upstream publisher forgot to advance its action revision", async () => {
    harness.getView.mockResolvedValue({ meta: fixtureMeta, data: workspaceFocus([workspaceCard({ authorizedQuantity: 2 })]) });
    await act(async () => { await request(); }); expect(harness.submitCommand).not.toHaveBeenCalled();
  });
  it("rejects a changed account at preflight", async () => {
    await act(async () => { await api.submit({ kind: "gate", action: workspaceGate() }, { reason: "checked" }, workspaceTickets(workspaceFocus())[0], "OTHER_ACCOUNT"); });
    expect(harness.submitCommand).not.toHaveBeenCalled();
  });
  it("retains an explicit no-send error when preflight fails", async () => {
    harness.getView.mockRejectedValue(new Error("connection failed"));
    await act(async () => { await request(); });
    expect(harness.submitCommand).not.toHaveBeenCalled(); expect(api.error).toContain("Aucune commande envoyée"); expect(api.busy).toBe(false);
  });
  it("does not convert an uncertain send into success or automatically retry it", async () => {
    harness.submitCommand.mockRejectedValue(new Error("connection lost after dispatch"));
    await act(async () => { await request(); });
    expect(api.receipt).toBeNull(); expect(api.error).toContain("Résultat non confirmé"); expect(api.busy).toBe(true);
    await act(async () => { await request(); }); expect(harness.submitCommand).toHaveBeenCalledTimes(1);
  });
  it("serializes double clicks before a receipt exists", async () => {
    await act(async () => { await Promise.all([request(), request()]); });
    expect(harness.submitCommand).toHaveBeenCalledTimes(1);
  });
  it("blocks on pause or loss of connection even if the action object still exists", async () => {
    await act(async () => root.render(createElement(Probe, { currentHealth: { ...health, paused: true } })));
    await act(async () => { await request(); }); expect(harness.getView).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Probe, { currentHealth: { ...health, connected: false } })));
    await act(async () => { await request(); }); expect(harness.submitCommand).not.toHaveBeenCalled();
  });
  it("cancels preflight if the user switches tickets while authorities are being checked", async () => {
    let release: (() => void) | undefined;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    const model = workspaceLiveModel();
    harness.getView.mockImplementation(async (name: string) => { await delay; return name === "live-focus" ? { meta: fixtureMeta, data: workspaceFocus() } : name === "live-trading" ? { meta: fixtureMeta, data: model.source } : {}; });
    let pending: Promise<boolean>;
    await act(async () => { pending = request(); });
    await act(async () => root.render(createElement(Probe, { selected: "trade:other" })));
    await act(async () => { release!(); await pending!; }); expect(harness.submitCommand).not.toHaveBeenCalled();
  });
  it("does not label a receipt as a broker fill; completion refreshes the actual views", async () => {
    await act(async () => { await request(); });
    harness.snapshot = { data: { status: "SUCCEEDED" }, isError: false };
    await act(async () => root.render(createElement(Probe)));
    expect(api.status).toBe("SUCCEEDED"); expect(api.busy).toBe(false); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("keeps a pending receipt bound to its original ticket after selection changes", async () => {
    await act(async () => { await request(); });
    await act(async () => root.render(createElement(Probe, { selected: "trade:another" })));
    expect(api.receipt?.ticket).toContain(workspaceCard().orderIntentId); expect(api.busy).toBe(true);
  });
});
