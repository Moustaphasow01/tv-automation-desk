import { describe, expect, it } from "vitest";
import { isExplorerView } from "@/domains/front-api/viewModels";

describe("explorer view contract", () => {
  const view = {
    summary: {
      title: "Runs Replay",
      description: "Projection réelle",
      total: 1,
      metrics: [{ label: "Terminés", value: "1" }]
    },
    items: [{
      id: "run-1",
      title: "Replay du 11 juin",
      subtitle: "2026-06-11",
      status: "COMPLETED",
      primary: "+1.25 R",
      secondary: "Résultat éligible",
      route: "/replay/runs/run-1",
      tags: ["v4"],
      facts: [{ label: "Moteur", value: "v4" }]
    }]
  };

  it("accepts a normalized real-data explorer projection", () => {
    expect(isExplorerView(view)).toBe(true);
  });

  it("rejects a raw or incomplete backend payload", () => {
    expect(isExplorerView({ summary: view.summary })).toBe(false);
    expect(isExplorerView({ summary: { ...view.summary, metrics: null }, items: [] })).toBe(false);
  });
});
