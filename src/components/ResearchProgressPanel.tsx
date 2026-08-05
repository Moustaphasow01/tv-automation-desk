import { Card } from "@/components/common";
import { formatDateTime } from "@/components/operations";
import type {
  AnalyticalResearchPhaseName,
  AnalyticalResearchProgress,
  AnalyticalResearchStatus,
} from "@/operationsTypes";

export function ResearchProgressPanel({
  progress,
}: {
  progress?: AnalyticalResearchProgress | null;
}) {
  if (!progress) {
    return <Card className="research-progress research-progress--legacy" aria-label="Progression de la recherche analytique">
      <header>
        <div><p className="eyebrow">Recherche agentique</p><h2>Progression analytique</h2></div>
        <span data-state="unavailable">NON EXPOSÉE</span>
      </header>
      <p>Cette exécution provient d’une version du backend sans suivi détaillé des phases. Son résultat reste consultable normalement.</p>
    </Card>;
  }

  const current = progress.currentPhase
    ? researchPhaseLabel(progress.currentPhase)
    : progress.status === "COMPLETE"
      ? "Analyse terminée"
      : "Phase non déclarée";
  return <Card className="research-progress" aria-label="Progression de la recherche analytique">
    <header>
      <div><p className="eyebrow">Recherche agentique</p><h2>Progression analytique</h2></div>
      <span data-state={progress.status.toLowerCase()}>{researchStatusLabel(progress.status)}</span>
    </header>

    <div className="research-progress__summary">
      <span>Phase en cours<strong>{current}</strong></span>
      <span>Couverture<strong>{progress.coverage.complete}/{progress.coverage.required}</strong></span>
      <span>Preuves<strong>{progress.evidenceReceiptsCount}</strong></span>
      <span>Appels<strong>{progress.toolCallsCount}</strong></span>
      <span>Mise à jour<strong>{formatDateTime(progress.updatedAt)}</strong></span>
    </div>

    <div
      className="research-progress__coverage"
      role="progressbar"
      aria-label="Couverture des phases analytiques obligatoires"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress.coverage.percent)}
    >
      <i><b style={{ width: `${progress.coverage.percent}%` }}/></i>
      <span>{Math.round(progress.coverage.percent)}%</span>
    </div>

    <ol className="research-progress__phases">
      {progress.phases.map((phase, index) => <li
        key={phase.phase}
        data-state={phase.status.toLowerCase()}
        data-current={phase.phase === progress.currentPhase ? "true" : "false"}
        title={phase.degradedReasons.join(" · ") || researchStatusLabel(phase.status)}
      >
        <span>{String(index + 1).padStart(2, "0")}</span>
        <i/>
        <div>
          <strong>{researchPhaseLabel(phase.phase)}</strong>
          <small>{researchStatusLabel(phase.status)}</small>
        </div>
        <em>{phase.evidenceCount}P · {phase.toolCallCount}A</em>
      </li>)}
    </ol>
    <footer>
      <span>P = preuve persistée</span>
      <span>A = appel d’outil</span>
      <span>{progress.coverage.required} phases obligatoires</span>
    </footer>
  </Card>;
}

export function researchPhaseLabel(phase: AnalyticalResearchPhaseName) {
  return ({
    CONTINUITY: "Continuité",
    CORE_MARKET: "Marché central",
    INDEX_CONFIRMATION: "Confirmation indices",
    CROSS_ASSET: "Cross-asset",
    MEGACAPS: "Mégacaps",
    MACRO: "Macro",
    NEWS: "Actualités",
    THESIS_EVOLUTION: "Évolution de thèse",
    OPPORTUNITY: "Opportunités",
    CONCLUSION: "Conclusion",
  } as const)[phase];
}

export function researchStatusLabel(status: AnalyticalResearchStatus) {
  return ({
    NOT_STARTED: "À venir",
    IN_PROGRESS: "En cours",
    COMPLETE: "Terminée",
    DEGRADED: "Dégradée",
    UNAVAILABLE: "Indisponible",
    BLOCKED: "Bloquée",
  } as const)[status];
}
