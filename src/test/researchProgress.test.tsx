import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ANALYTICAL_RESEARCH_PHASES,
  normalizeResearchProgress,
  researchProgressFromCarrier,
  withResearchProgress,
} from "@/api/researchProgress";
import { ResearchProgressPanel } from "@/components/ResearchProgressPanel";

describe("progression de recherche agentique", () => {
  it("normalise la projection snake_case et garantit les dix phases obligatoires", () => {
    const progress = normalizeResearchProgress({
      schema_version: "desk_analytical_research_progress_v1",
      status: "IN_PROGRESS",
      current_phase: "CROSS_ASSET",
      started_at_utc: "2026-08-02T08:00:00.000Z",
      updated_at_utc: "2026-08-02T08:01:00.000Z",
      phases: [{
        phase: "CROSS_ASSET",
        status: "IN_PROGRESS",
        required: true,
        evidence_count: 4,
        tool_call_count: 2,
        started_at_utc: "2026-08-02T08:01:00.000Z",
        completed_at_utc: null,
        degraded_reasons: [],
      }],
      coverage: { required: 10, total: 10, complete: 3, percent: 30 },
      tool_calls_count: 8,
      evidence_receipts_count: 17,
    });

    expect(progress).not.toBeNull();
    expect(progress?.currentPhase).toBe("CROSS_ASSET");
    expect(progress?.phases.map(phase => phase.phase)).toEqual(ANALYTICAL_RESEARCH_PHASES);
    expect(progress?.phases).toHaveLength(10);
    expect(progress?.phases.find(phase => phase.phase === "CROSS_ASSET")).toMatchObject({
      status: "IN_PROGRESS",
      evidenceCount: 4,
      toolCallCount: 2,
    });
    expect(progress?.phases.find(phase => phase.phase === "CONCLUSION")?.status).toBe("NOT_STARTED");
    expect(progress?.coverage).toEqual({ required: 10, total: 10, complete: 3, percent: 30 });
    expect(progress?.toolCallsCount).toBe(8);
    expect(progress?.evidenceReceiptsCount).toBe(17);
  });

  it("accepte les alias camelCase sur le process et ne fabrique rien pour un ancien backend", () => {
    const normalized = withResearchProgress({
      id: "process-1",
      researchProgress: {
        schemaVersion: "desk_analytical_research_progress_v1",
        status: "COMPLETE",
        currentPhase: "CONCLUSION",
        phases: [],
        coverage: { required: 10, total: 10, complete: 10, percent: 100 },
        toolCallsCount: 12,
        evidenceReceiptsCount: 24,
      },
    });

    expect(normalized.researchProgress?.status).toBe("COMPLETE");
    expect(normalized.researchProgress?.currentPhase).toBe("CONCLUSION");
    expect(researchProgressFromCarrier({ id: "legacy-process" })).toBeNull();
    expect("researchProgress" in withResearchProgress({ id: "legacy-process" })).toBe(false);
  });

  it("rend une vue desk compacte avec phase courante, couverture, preuves et appels", () => {
    const progress = normalizeResearchProgress({
      schema_version: "desk_analytical_research_progress_v1",
      status: "IN_PROGRESS",
      current_phase: "OPPORTUNITY",
      phases: [{
        phase: "OPPORTUNITY",
        status: "IN_PROGRESS",
        required: true,
        evidence_count: 6,
        tool_call_count: 3,
        degraded_reasons: ["Contexte secondaire partiel"],
      }],
      coverage: { required: 10, total: 10, complete: 8, percent: 80 },
      tool_calls_count: 21,
      evidence_receipts_count: 42,
    });
    const html = renderToStaticMarkup(<ResearchProgressPanel progress={progress}/>);

    expect(html).toContain("Progression analytique");
    expect(html).toContain("Opportunités");
    expect(html).toContain("8/10");
    expect(html).toContain("<strong>42</strong>");
    expect(html).toContain("<strong>21</strong>");
    expect(html).toContain('aria-valuenow="80"');
    expect((html.match(/data-state=/g) || [])).toHaveLength(11);
  });

  it("affiche un fallback explicite sans casser les processus historiques", () => {
    const html = renderToStaticMarkup(<ResearchProgressPanel progress={null}/>);
    expect(html).toContain("NON EXPOSÉE");
    expect(html).toContain("version du backend sans suivi détaillé");
  });
});
