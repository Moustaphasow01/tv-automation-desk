# Research Scientific Process V1 — TD2-506

## Objectif

`TD2-506` transforme le Research Lab en processus scientifique contrôlé : une mission ne démarre pas par “chercher une bonne idée”, mais par une hypothèse falsifiable, un périmètre dataset, un budget explicite, des gates de preuve et une décision auditée.

## Contrat domaine

Le contrat canonique est porté par `packages/desk-domain/src/research-scientific-process-v1.js`.

Exports principaux :

- `buildResearchScientificProcessPolicyV1` : construit la politique versionnée, les phases, les budgets et les gates.
- `validateResearchHypothesisProtocolV1` : refuse une hypothèse non falsifiable ou sans périmètre dataset.
- `buildResearchScientificMissionV1` : produit une mission research prête pour Agent Runtime.
- `evaluateResearchBudgetUsageV1` : applique les budgets tokens, temps mur, CPU, simulations, candidates et itérations.
- `evaluateResearchScientificProcessV1` : décide `WAIT_FOR_EVIDENCE`, `STOP_REJECT`, `STOP_BUDGET_EXHAUSTED` ou `PROMOTE_TO_REVIEW`.
- `buildResearchDecisionAuditV1` : impose preuves et rétention des résultats négatifs pour toute décision terminale.

## Phases V1

1. `HYPOTHESIS`
2. `DATASET_SELECTION`
3. `BASELINE`
4. `CANDIDATE_GENERATION`
5. `SIMULATION`
6. `ROBUSTNESS`
7. `CONTRADICTORY_REVIEW`
8. `DECISION`

## Budgets appliqués

La politique V1 expose un budget total par défaut :

- `max_tokens = 500000`
- `max_wall_clock_seconds = 86400`
- `max_compute_seconds = 14400`
- `max_simulation_runs = 20`
- `max_candidates = 12`
- `max_iterations = 6`

Chaque phase a aussi un budget local. Le moteur d’évaluation retourne les dimensions épuisées au lieu de laisser une mission consommer sans borne.

## Garde-fous

- Une hypothèse doit porter `statement`, `falsifiable_question`, `expected_outcome`, `invalidation_criteria` et `dataset_scope`.
- Baseline, validation, robustesse et revue contradictoire sont requis avant promotion en review.
- Un rapport négatif (`FAIL`) ne peut pas être perdu : il déclenche `STOP_REJECT` et exige une trace `negative_result_ref` ou une preuve persistée.
- Toute décision finale exige un audit avec preuves ; une décision de stop exige aussi la référence du résultat négatif.

## Relation avec TD2-500 et TD2-505

- `TD2-500` fournit le registre d’expériences, hypothèses, candidates et rapports.
- `TD2-505` fournit les neuf rôles IA et leurs capabilities.
- `TD2-506` fournit la politique scientifique qui dira à ces rôles comment travailler dans le bon ordre, sans fuite broker/exécution.

## Limites

La V1 ne persiste pas encore de nouvelle table et ne crée pas encore le workflow complet de génération. Les tickets suivants (`TD2-501`, `TD2-507`, `TD2-510`) consommeront ce contrat pour construire les missions concrètes, la taxonomie/génome et le lifecycle candidate.
