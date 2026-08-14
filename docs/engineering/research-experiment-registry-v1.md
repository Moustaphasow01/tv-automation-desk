# Research Experiment Registry V1 — TD2-500

## Objectif

`TD2-500` crée la fondation relationnelle et applicative du Research Lab : `ResearchExperiment`, `ResearchHypothesis`, `ResearchCandidate` et `ResearchEvaluationReport`.

Ce registre ne remplace pas le `SimulationRun Registry`. Il consomme des runs déjà produits et scellés pour comparer des hypothèses/candidates, conserver les résultats négatifs et préparer les workflows P6 suivants.

## Placement

- **Bounded context propriétaire** : `research`.
- **Domaine pur** : `packages/desk-domain/src/research-experiment-registry-v1.js`.
- **Application temporaire host** : `mcp_gpt_desk/src/research-experiment-registry-service.js`.
- **Adapter PostgreSQL** : `mcp_gpt_desk/src/research-experiment-registry-repository.js`.
- **Migration** : `infra/postgres/init/043_research_experiment_registry.sql`.

Le host legacy assemble encore l’application, mais les règles métier sont dans le domaine et la persistance dans l’adapter. Le front Research dédié reste hors scope jusqu’à `TD2-504`.

## Tables

| Table | Rôle |
|---|---|
| `research_experiments` | Expérience scientifique, objectif, budget, owner, métrique de comparaison. |
| `research_hypotheses` | Hypothèse falsifiable et critères d’invalidation. |
| `research_candidates` | Candidate testable, reliée à une hypothèse et éventuellement à une future `StrategyVersion`. |
| `research_evaluation_reports` | Rapport scellé : verdict, score, métriques, critères et artefacts. |
| `research_experiment_run_links` | Association explicite entre expérience, candidate et `SimulationRun`. |
| `research_audit_events` | Audit idempotent des commandes Research Registry. |

## Invariants V1

- Le registre référence `simulation_runs`; il ne recalcule pas les métriques.
- Une candidate `PROMOTION_READY` doit référencer une `strategy_version_id`.
- Les rapports d’évaluation sont immuables après écriture.
- Les candidates terminales `REJECTED`/`RETIRED` ne peuvent plus changer de contenu stratégique.
- Les scores sont bornés entre `0` et `1`.
- Les commandes applicatives sont idempotentes par `idempotency_key` et auditées.

## Scoring minimal

`buildResearchCandidateEvaluationSummaryV1` calcule un résumé opérable :

- moyenne des scores disponibles ;
- comptage `PASS` / `FAIL` / `INCONCLUSIVE` / `NEEDS_REVIEW` ;
- verdict `FAIL` si au moins un rapport échoue ;
- verdict `PASS` si au moins un rapport passe, aucun échec, et score moyen `>= 0.7` ;
- sinon `INCONCLUSIVE` ou `NEEDS_REVIEW`.

Ce scoring ne publie rien et ne promeut aucune stratégie. La matrice de promotion quantitative et l’approbation opérateur appartiennent à `TD2-503`.

## Hors scope

- Workflow IA de génération de stratégie : `TD2-501`.
- Validation contradictoire complète : `TD2-502`.
- Matrice de promotion : `TD2-503`.
- Front Research/Experiments : `TD2-504`.
- Génome, déduplication, mémoire d’échecs et knowledge graph : `TD2-507` à `TD2-509`.

## Rollback

La migration ajoute uniquement types/tables/index/triggers `research_*`. Aucun chemin LIVE/PAPER/Replay existant n’est modifié. Le rollback opérationnel consiste à ne pas exposer les use cases Research Registry aux workers/front tant que P6 n’est pas activé.
