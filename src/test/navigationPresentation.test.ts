import { describe, expect, it } from "vitest";
import { activeNavigationSpace, navigationCatalog, navigationSpaces } from "@/navigation";
import {
  deskStatusText,
  dataQualityLabel,
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  sessionLabel,
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

  it("classe les facettes du Live dans l'espace Aujourd'hui, pas Réglages", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const settings = navigationSpaces.find(space => space.id === "settings")!;
    const todayPaths = today.items.map(item => item.to);
    const settingsPaths = settings.items.map(item => item.to);
    expect(todayPaths).toEqual(expect.arrayContaining(["/live/master", "/live/monitors", "/alerts", "/live/sessions"]));
    expect(settingsPaths).not.toEqual(expect.arrayContaining(["/live/master", "/live/monitors", "/alerts", "/live/sessions"]));
  });

  it("classe l'historique dans Performance, pas Replay", () => {
    const replay = navigationSpaces.find(space => space.id === "replay")!;
    const performance = navigationSpaces.find(space => space.id === "performance")!;
    expect(performance.items.map(item => item.to)).toContain("/history");
    expect(replay.items.map(item => item.to)).not.toContain("/history");
    expect(activeNavigationSpace("/history/sessions/session_123").id).toBe("performance");
  });

  it("n'expose qu'une seule fois chaque espace dans le catalogue de recherche", () => {
    const labels = navigationCatalog.map(group => group.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Documents de session");
  });

  it("pointe directement vers les nouvelles routes /live/* sans passer par une redirection", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const thesisItem = today.items.find(item => item.label === "Plan actif");
    expect(thesisItem?.to).toBe("/live/thesis");
    expect(today.items.some(item => item.to === "/setup")).toBe(false);
  });

  it("garde l'espace Aujourd'hui actif sur n'importe quel onglet /live/*", () => {
    expect(activeNavigationSpace("/live/thesis").id).toBe("today");
    expect(activeNavigationSpace("/live/master").id).toBe("today");
  });

  it("pointe les 5 onglets restants directement vers /live/* sans redirection", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const expected: Record<string, string> = {
      "Analyse initiale": "/live/master",
      "Suivis": "/live/monitors",
      "Agenda & actualités": "/live/news",
      "Journal": "/live/timeline",
      "Phases de marché": "/live/sessions",
    };
    for (const [label, to] of Object.entries(expected)) {
      expect(today.items.find(item => item.label === label)?.to).toBe(to);
    }
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

describe("traduction des sessions, de la qualité et des statuts", () => {
  it("traduit les codes de session connus et laisse passer les autres", () => {
    expect(sessionLabel("asia_open")).toBe("Session Asie");
    expect(sessionLabel("ny_open")).toBe("Session New York");
    expect(sessionLabel("full_day")).toBe("Journée continue");
    expect(sessionLabel("Asia Open")).toBe("Session Asie");
    expect(sessionLabel("NY Open")).toBe("Session New York");
    expect(sessionLabel("custom_scope")).toBe("custom scope");
    expect(sessionLabel(null)).toBe("");
  });

  it("traduit les statuts de qualité de donnée connus et laisse passer les autres", () => {
    expect(dataQualityLabel("ready")).toBe("prête");
    expect(dataQualityLabel("healthy")).toBe("opérationnelle");
    expect(dataQualityLabel("context_limited")).toBe("contexte partiel");
    expect(dataQualityLabel("degraded")).toBe("dégradée");
    expect(dataQualityLabel("waiting")).toBe("en attente");
    expect(dataQualityLabel("unmapped_status")).toBe("unmapped status");
    expect(dataQualityLabel(null)).toBe("");
    expect(dataQualityLabel("")).toBe("");
  });

  it("traduit les phrases et codes de statut du desk", () => {
    expect(deskStatusText("WAIT")).toBe("Attente");
    expect(deskStatusText("NO_SETUP")).toBe("Aucun setup");
    expect(deskStatusText("NO POSITION")).toBe("Aucune position");
    expect(deskStatusText("Master analysis required")).toBe("Analyse Master requise");
    expect(deskStatusText("")).toBe("");
    expect(deskStatusText(null)).toBe("");
    expect(deskStatusText("SOME_UNKNOWN_STATUS")).toBe("SOME_UNKNOWN_STATUS");
    expect(deskStatusText("Desk: NO_SETUP right now")).toBe("Desk: Aucun setup right now");
  });
});
