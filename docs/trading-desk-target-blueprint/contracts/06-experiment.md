# Contract — Experiment Registry V1

- **But** : regrouper des `SimulationRun` existants pour comparer des hypothèses et candidates de recherche de façon reproductible.
- **Producteur** : Experiment Registry (`08`, Phase 4 / P6).
- **Consommateurs** : Research Lab, opérateur, futur dashboard Research/Experiments.
- **Statut** : `CIBLE REQUISE`, implémentation initiale `TD2-500`.

## Entités V1

| Entité | Rôle | Source de vérité |
|---|---|---|
| `ResearchExperiment` | Conteneur scientifique : objectif, owner, métrique de comparaison, budget et cutoff de sélection. | `research_experiments` |
| `ResearchHypothesis` | Question falsifiable avec population, variables, résultat attendu et invalidation. | `research_hypotheses` |
| `ResearchCandidate` | Variante testable reliée à une hypothèse ; distincte de `StrategyVersion` tant qu’elle n’est pas promue. | `research_candidates` |
| `ResearchEvaluationReport` | Verdict scellé sur une candidate à partir d’un `SimulationRun` et de métriques déterministes. | `research_evaluation_reports` |
| `ResearchExperimentRunLink` | Lien explicite entre expérience, run et rôle du run (`TRAIN`, `VALIDATION`, etc.). | `research_experiment_run_links` |

## États

| Concept | États V1 |
|---|---|
| Experiment | `DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `ARCHIVED` |
| Hypothesis | `PROPOSED`, `TESTING`, `SUPPORTED`, `FALSIFIED`, `INCONCLUSIVE`, `RETIRED` |
| Candidate | `IDEA`, `BASELINE_REQUIRED`, `IN_SIMULATION`, `UNDER_REVIEW`, `PROMOTION_READY`, `REJECTED`, `RETIRED` |
| Evaluation verdict | `PASS`, `FAIL`, `INCONCLUSIVE`, `NEEDS_REVIEW` |

## Invariants

- `ResearchExperiment` consomme le Run Registry : il ne duplique pas les résultats bruts de simulation.
- Une `ResearchCandidate` appartient à une seule `ResearchHypothesis` et une seule `ResearchExperiment`.
- Toute mission Research issue de ce registre doit passer par `Research Scientific Process V1` (`TD2-506`) : hypothèse falsifiable, dataset scope, budget explicite, gates de preuve et audit.
- Toute transition de `ResearchCandidate` doit passer par `Research Candidate Lifecycle V1` (`TD2-510`) : transition autorisée, preuves, idempotence et event audit.
- Toute candidate destinée à simulation doit porter un `Research Candidate Genome V1` (`TD2-507`) pour mesurer nouveauté, doublon et similarité avant consommation compute.
- Toute candidate doit être comparée à la `Research Failure Memory V1` (`TD2-508`) avant de relancer du compute : un doublon d’échec actif est bloqué, une idée trop proche exige une révision, et les preuves négatives restent consultables.
- Les relations entre expériences, hypothèses, candidates, génomes, échecs, preuves et rapports doivent être projetables dans `Research Knowledge Graph V1` (`TD2-509`) pour consultation agent/front.
- Les prochaines recherches doivent pouvoir être priorisées par `Research Coverage & Priority V1` (`TD2-511`) : couverture des trous, nouveauté, potentiel, coût, risque et audit des facteurs.
- Une idée ne devient candidate testable qu’en passant par `Research Strategy Generation Workflow V1` (`TD2-501`) : protocole falsifiable, rôles IA explicites, génome, novelty, mémoire d’échec et transition lifecycle.
- Une candidate simulée ne peut pas atteindre la revue de promotion sans `Research Contradictory Validation Workflow V1` (`TD2-502`) : baseline, validation, robustesse, critique contradictoire, liens `SimulationRun`, novelty, failure memory, decision audit et transition lifecycle.
- Une candidate ne peut pas devenir `PROMOTION_READY` sans `Research Promotion Matrix V1` (`TD2-503`) : seuils versionnés, verdict TD2-502 prêt, priorité TD2-511, `strategy_version_id`, approbation opérateur et plan rollback/retrait.
- Une candidate `PROMOTION_READY` doit référencer une `strategy_version_id`; la promotion réelle reste hors TD2-500.
- Un `ResearchEvaluationReport` est immuable : score, verdict, métriques, critères et artefacts ne sont pas réécrits.
- Un verdict négatif n’est jamais jeté : il doit rester exploitable comme preuve de rejet, d’apprentissage et de déduplication future.
- Les scores `novelty_score`, `evaluation_score` et `score` sont bornés entre `0` et `1`.
- Un `winner_simulation_run_id` n’est autorisé que lorsque l’expérience est `COMPLETED`.

## Exemple JSON minimal

```json
{
  "research_experiment_id": "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
  "name": "Breakout Retest MNQ — validation compression overnight",
  "objective": "Valider une hypothèse falsifiable de continuation après compression.",
  "owner": "research",
  "status": "ACTIVE",
  "comparison_metric": "composite_score",
  "hypotheses": [
    {
      "research_hypothesis_id": "6c1a3e00-1111-4a2b-9c3d-abcdef012345",
      "statement": "Les cassures MNQ après range overnight comprimé continuent mieux après retest.",
      "falsifiable_question": "La continuation bat-elle la baseline après coûts ?"
    }
  ],
  "candidates": [
    {
      "research_candidate_id": "6c1a3e00-2222-4a2b-9c3d-abcdef012346",
      "source_type": "AI_GENERATED",
      "status": "IN_SIMULATION",
      "primary_change_summary": "Ajoute compression range + confirmation retest."
    }
  ]
}
```
