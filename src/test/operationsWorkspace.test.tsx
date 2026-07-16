import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Breadcrumbs, DecisionChart, statusLabel, WorkflowTable } from "@/components/operations";
import type { OperationsEvent, PricePoint, WorkflowSummary } from "@/operationsTypes";

describe("operations workspace", () => {
  it("rend un fil d’Ariane navigable et des statuts métier lisibles", () => {
    const html = renderToStaticMarkup(<MemoryRouter><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: "2026-07-16" }]}/></MemoryRouter>);
    expect(html).toContain('href="/replay"');
    expect(html).toContain("2026-07-16");
    expect(statusLabel("waiting_gpt")).toBe("Attente GPT");
  });

  it("rend la timeline prix/décisions sans dépendre d’un mock de composant chart", () => {
    const prices: PricePoint[] = [
      { time: "2026-07-16T00:00:00.000Z", open: 100, high: 102, low: 99, close: 101 },
      { time: "2026-07-16T00:15:00.000Z", open: 101, high: 104, low: 100, close: 103 },
    ];
    const events: OperationsEvent[] = [{ id: "decision-1", type: "MONITOR", status: "running", at: "2026-07-16T00:15:00.000Z", title: "MAINTAIN", detail: "Thèse valide", actor: null, ref: null, layer: "decision" }];
    const html = renderToStaticMarkup(<MemoryRouter><DecisionChart prices={prices} events={events} runId="run-1"/></MemoryRouter>);
    expect(html).toContain("Évolution du prix et décisions du replay");
    expect(html).toContain("price-line");
    expect(html).toContain("MAINTAIN");
  });

  it("route les lignes workflow vers un véritable écran de détail", () => {
    const workflow: WorkflowSummary = { id: "replay:run-1", sourceId: "run-1", kind: "replay", name: "Replay Asia", status: "running", rawStatus: "MONITOR_DATA_PREPARING", revision: 2, tradingDate: "2026-07-16", session: "asia_open", strategyId: "asia_open", variantId: "asia_open:15m", progress: 50, startedAt: null, completedAt: null, updatedAt: null, durationMs: null, error: null, metrics: {}, currentStepId: null, currentWorkItemId: null, nextAction: null, automationEnabled: true };
    const html = renderToStaticMarkup(<MemoryRouter><WorkflowTable items={[workflow]}/></MemoryRouter>);
    expect(html).toContain("/operations/workflows/replay%3Arun-1");
    expect(html).toContain("Ouvrir");
  });
});
