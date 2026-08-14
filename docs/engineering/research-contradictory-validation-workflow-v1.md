# Research Contradictory Validation Workflow V1

Statut : implémenté pour `TD2-502`.

## Rôle

`Research Contradictory Validation Workflow V1` transforme une candidate simulée en décision auditée avant toute promotion :

- `WAIT_FOR_EVIDENCE` si baseline, validation, robustesse, critique contradictoire ou liens de runs manquent ;
- `REQUIRES_REVISION` si la candidate est trop proche, si la mémoire d'échec exige une révision, si une métrique est inconclusive ou si des objections contradictoires restent ouvertes ;
- `REJECT_CANDIDATE` si validation/robustesse échoue, si la critique contradictoire réfute la candidate, ou si la mémoire d'échec bloque le retest ;
- `READY_FOR_PROMOTION_REVIEW` uniquement lorsque les preuves, scores, novelty, failure memory et critique contradictoire passent.

## Entrées canoniques

- `ResearchCandidate` ou candidate issue du workflow `TD2-501`.
- `Research Candidate Genome V1`.
- `Research Failure Memory V1`.
- `ResearchEvaluationReport` reliés à des `SimulationRun` pour baseline, validation et robustesse.
- Rapport `CONTRADICTORY_REVIEW`.

## Sorties

- Plan hashé `research_contradictory_validation_plan_v1`.
- Inventaire des preuves présentes/manquantes.
- Verdict metric gate et contradictory gate.
- `ResearchDecisionAudit`.
- Transition lifecycle `REQUEST_REVIEW` vers `UNDER_REVIEW` quand la candidate est prête.
- Work items IA pour `backtest_validator`, `robustness_auditor` et `research_reviewer`.

## Invariants

- Une candidate ne progresse pas sans critique contradictoire structurée.
- Les rapports baseline, validation et robustesse doivent référencer un `simulation_run_id`.
- Tout rejet génère une référence déterministe de résultat négatif si aucune référence externe n'est fournie.
- La promotion effective reste hors scope : `TD2-502` prépare seulement la revue de promotion.
