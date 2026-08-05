import { describe, expect, it } from "vitest";
import { activeNavigationSpace, navigationSpaces } from "@/navigation";
import {
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  shortReference,
  workflowLabel,
} from "@/lib/presentation";

describe("information architecture V3", () => {
  it("expose exactement six espaces principaux stables", () => {
    expect(navigationSpaces.map(space => space.id)).toEqual([
      "today",
      "replay",
      "performance",
      "operations",
      "execution",
      "settings",
    ]);
  });

  it("garde les écrans zoom dans leur espace métier", () => {
    expect(activeNavigationSpace("/operations/incidents/incident_123").id).toBe("operations");
    expect(activeNavigationSpace("/operations/notifications/notification_123").id).toBe("operations");
    expect(activeNavigationSpace("/operations/runbooks/runbook_123").id).toBe("operations");
    expect(activeNavigationSpace("/replay/runs/replay_2026-06-11").id).toBe("replay");
  });
});

describe("présentation des références techniques", () => {
  it("transforme les références datées en libellés métier", () => {
    expect(replayLabel("replay_2026-06-11_full_day_15m_884febb3ba7b")).toContain("Replay du 11 juin");
    expect(workflowLabel("replay:replay_2026-06-11_full_day_15m")).toContain("Replay du 11 juin");
    expect(gptProcessLabel("deskwork__monitor__2026_06_11T03_00")).toContain("Analyse GPT du 11 juin · 03:00");
  });

  it("raccourcit sans perdre la référence complète dans les données", () => {
    const reference = "incident_0123456789abcdef";
    expect(incidentLabel(reference)).not.toBe(reference);
    expect(shortReference(reference)).toBe("#89ABCDEF");
  });
});
