import { describe, expect, it } from "vitest";
import { activeNavigationSpace, navigationCatalog, navigationSpaces } from "@/navigation";
import {
  deskStatusText,
  dataQualityLabel,
  findActiveReplayDay,
  findCertifiedReplayDay,
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  replayPulseHeadline,
  sessionLabel,
  shortReference,
  workflowLabel,
} from "@/lib/presentation";
import type { ReplayDaySummary, ReplayList } from "@/operationsTypes";

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

function buildReplaySummary(overrides: Partial<ReplayList["summary"]> = {}): ReplayList["summary"] {
  return {
    executions: 0,
    days: 0,
    active: 0,
    running: 0,
    waitingGpt: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
    averageProgress: 0,
    totalR: 0,
    gptProcesses: 0,
    ...overrides,
  };
}

function buildReplayDay(overrides: Partial<ReplayDaySummary> = {}): ReplayDaySummary {
  return {
    date: "2026-08-01",
    status: "completed",
    sessionCount: 0,
    running: 0,
    failed: 0,
    totalProgress: 0,
    totalR: 0,
    sessions: [],
    ...overrides,
  };
}

describe("pouls du Replay", () => {
  it("signale un échec unique au singulier", () => {
    expect(replayPulseHeadline(buildReplaySummary({ failed: 1 }))).toBe("1 échec");
  });

  it("signale plusieurs échecs au pluriel", () => {
    expect(replayPulseHeadline(buildReplaySummary({ failed: 3 }))).toBe("3 échecs");
  });

  it("signale un blocage unique au singulier", () => {
    expect(replayPulseHeadline(buildReplaySummary({ blocked: 1 }))).toBe("1 bloqué");
  });

  it("signale plusieurs blocages au pluriel", () => {
    expect(replayPulseHeadline(buildReplaySummary({ blocked: 2 }))).toBe("2 bloqués");
  });

  it("cumule échecs et blocages et priorise ce cas sur les replays actifs", () => {
    const headline = replayPulseHeadline(buildReplaySummary({ failed: 2, blocked: 1, active: 5 }));
    expect(headline).toBe("2 échecs · 1 bloqué");
    expect(headline).not.toContain("actif");
  });

  it("signale un replay actif unique sans blocage", () => {
    expect(replayPulseHeadline(buildReplaySummary({ active: 1 }))).toBe("1 replay actif · aucun blocage");
  });

  it("signale plusieurs replays actifs sans blocage", () => {
    expect(replayPulseHeadline(buildReplaySummary({ active: 4 }))).toBe("4 replays actifs · aucun blocage");
  });

  it("retombe sur le message par défaut quand tout est à zéro", () => {
    expect(replayPulseHeadline(buildReplaySummary())).toBe("Aucun replay en cours");
  });
});

describe("recherche du jour de Replay certifié", () => {
  it("retrouve l'unique jour avec des sessions éligibles au résultat", () => {
    const eligible = buildReplayDay({ date: "2026-08-02", resultEligibleSessions: 2 });
    const days = [
      buildReplayDay({ date: "2026-08-01", resultEligibleSessions: 0 }),
      eligible,
      buildReplayDay({ date: "2026-08-03", resultEligibleSessions: 0 }),
    ];
    expect(findCertifiedReplayDay(days)).toEqual(eligible);
  });

  it("choisit le jour éligible le plus récent, pas le premier du tableau", () => {
    const earlier = buildReplayDay({ date: "2026-08-01", resultEligibleSessions: 5 });
    const later = buildReplayDay({ date: "2026-08-05", resultEligibleSessions: 2 });
    expect(findCertifiedReplayDay([earlier, later])).toEqual(later);
  });

  it("retourne null si aucun jour n'a de session éligible", () => {
    const days = [
      buildReplayDay({ date: "2026-08-01", resultEligibleSessions: 0 }),
      buildReplayDay({ date: "2026-08-02" }),
      buildReplayDay({ date: "2026-08-03", resultEligibleSessions: undefined }),
    ];
    expect(findCertifiedReplayDay(days)).toBeNull();
  });

  it("retourne null sur un tableau vide", () => {
    expect(findCertifiedReplayDay([])).toBeNull();
  });
});

describe("recherche du jour de Replay actif", () => {
  it("ignore les statuts terminaux et retient le jour non terminal le plus récent", () => {
    const completed = buildReplayDay({ date: "2026-08-01", status: "completed" });
    const cancelled = buildReplayDay({ date: "2026-08-02", status: "cancelled" });
    const runningEarly = buildReplayDay({ date: "2026-08-03", status: "running" });
    const waitingLater = buildReplayDay({ date: "2026-08-04", status: "waiting_gpt" });
    expect(findActiveReplayDay([completed, cancelled, runningEarly, waitingLater])).toEqual(waitingLater);
  });

  it("retourne null si tous les jours sont terminés ou annulés", () => {
    const days = [
      buildReplayDay({ date: "2026-08-01", status: "completed" }),
      buildReplayDay({ date: "2026-08-02", status: "cancelled" }),
    ];
    expect(findActiveReplayDay(days)).toBeNull();
  });

  it("retourne null sur un tableau vide", () => {
    expect(findActiveReplayDay([])).toBeNull();
  });
});
