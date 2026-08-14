# Contract — Run

- **But** : une exécution unique de simulation d'une Strategy Version sur un Dataset, avec ses métriques et sa graine de reproductibilité.
- **Producteur** : Simulation Engine (`08`, Phase 3).
- **Consommateurs** : Run Registry, Experiment (`08`, Phase 4).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` / `simulation_run_id` | uuid | oui | Identifiant stable du registre |
| `source_run_id` | string | non | Identifiant technique émis par le moteur canonique si différent du UUID du registre |
| `strategy_version_id` | uuid (FK) | oui | Strategy Version simulée |
| `dataset_id` | uuid (FK) | oui | Dataset utilisé |
| `parameters_hash` | string | oui | Hash des paramètres d'exécution |
| `status` | enum | oui | `QUEUED`\|`RUNNING`\|`COMPLETED`\|`FAILED`\|`CANCELLED`\|`REJECTED`\|`REVIEW_REQUIRED` |
| `result_hash` | string | si terminal | Hash du résultat canonique complet |
| `metrics_hash` | string | si terminal | Hash des métriques versionnées |
| `result_ref` | string (nullable) | non | Référence à l'artifact résultat |
| `metrics_ref` | string (nullable) | non | Référence à l'artifact métriques |
| `reproducibility_seed` | string | oui | Graine garantissant la reproductibilité bit-à-bit (SC-3) |
| `started_at` / `completed_at` | timestamp | non | Horodatages d'exécution |

## Persistance TD2-302

Le Run Registry minimal est matérialisé en PostgreSQL par :

- `simulation_runs` : enveloppe de run, statut, hashes, seed, références d'artifacts ;
- `simulation_run_artifacts` : artifacts hash-addressed `INPUT_MANIFEST`, `ORDER_SIMULATION_POLICY`, `RESULT`, `METRICS`, `EVENTS`, `POSITIONS`, `ROBUSTNESS_REPORT`, `ERROR` ;
- `simulation_run_audit_events` : audit append-only des enregistrements/idempotences.

Un run terminal ne peut plus changer ses champs scellés. Un artifact ne peut plus changer son `payload`, son `content_hash`, son type ni son rattachement au run.

## Preuve TD2-303

La reproductibilité est contrôlée par `simulation_reproducibility_proof_v1`.

La clé de comparaison est :

- `strategy_version_id` ;
- `dataset_id` ;
- `parameters_hash` ;
- `reproducibility_seed`.

Deux runs comparables doivent ensuite matcher sur :

- `dataset_hash` ;
- `simulation_engine_version` ;
- `metrics_hash` ;
- `result_hash`.

Le moteur canonique reste anti-lookahead : les rows postérieures au cutoff sont ignorées avant calcul des métriques. Elles peuvent être comptées dans `data_quality.ignored_post_cutoff_rows`, mais elles ne doivent jamais améliorer ou dégrader le `metrics_hash` du cutoff.

## Exposition TD2-304

Les runs et artifacts sont exposés au front transitoire via :

- `/api/v1/simulation-runs` ;
- `/api/v1/simulation-runs/{simulationRunId}` ;
- `/api/v1/simulation-runs/{simulationRunId}/artifacts` ;
- `/api/v1/simulation-runs/compare`.

Le Replay Lab peut afficher les preuves liées sans recalculer les résultats : la projection front consomme `simulationEvidence`, construite depuis le Run Registry.

## Exécution d'ordres TD2-305

La simulation canonique embarque `order_simulator_version` et `order_simulation_policy`.

Le simulateur d'ordres couvre `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, les coûts `spread/slippage/commission`, la latence en nombre de bougies, les gaps, les partial fills, le cancel/replace et les ambiguïtés intrabar.

Par défaut, la policy conserve la parité historique : coûts à zéro et gaps remplis au prix trigger. Les hypothèses plus réalistes sont explicites dans l'artifact `ORDER_SIMULATION_POLICY`.

## Métriques TD2-306

Les métriques sont calculées par le backend avec :

- `metric_definition_id = desk_simulation_metrics_core_v2` ;
- `metric_version = 2.0.0`.

Elles incluent `total_r`, `gross_r`, `execution_cost_r`, win/loss, `profit_factor`, `expectancy_r`, drawdown, Sharpe, Sortino, Calmar, MAE/MFE, exposition et segmentations par instrument, direction, session, date et raison de sortie.

Le front doit consommer `metrics` ou l'artifact `METRICS` sans recalculer la vérité métier depuis les logs.

## Compute worker TD2-309

Les calculs lourds peuvent être déclenchés via `simulation_compute_job_v1`.

Le worker Python est contractuel : il valide `job_id`, `idempotency_key`, `task_type`, mesure durée/erreurs et délègue la simulation au CLI Node. Il retourne `simulation_compute_result_v1` avec le résultat canonique, la run registry entry et les artifacts prêts à persister.

Invariant : Python ne redéfinit pas la stratégie et ne calcule pas une version parallèle de la simulation.

## Splits train / validation / OUT_OF_SAMPLE TD2-308

Les expériences utilisent `dataset_temporal_split_manifest_v1` pour sceller les périodes train, validation et out-of-sample.

Persistance cible :

- `dataset_temporal_splits` : manifest, policy, bornes temporelles et `split_hash` immuable ;
- `simulation_run_split_usage` : rôle du run, cutoff, fin de données source et rapport anti-fuite.

Convention temporelle : chaque split est `[start_utc, end_utc)`, donc la borne de début est incluse et la borne de fin est exclue.

Règles :

- `TRAIN` ne lit que le train ;
- `VALIDATION` peut être évalué après entraînement, mais `training_cutoff_utc` doit rester dans le train ;
- `OUT_OF_SAMPLE` ne peut pas influencer la sélection candidate : `candidate_selection_cutoff_utc` doit rester inférieur ou égal à la fin validation ;
- chaque manifest expose `split_hash`, `policy_hash`, couverture par rôle et rapport de validation.

## Robustness Engine TD2-307

La promotion d'une Strategy Version candidate passe par `strategy_robustness_report_v1`.

Le rapport est produit par `buildRobustnessReportV1` et inclut :

- acceptance baseline ;
- walk-forward ;
- bootstrap ;
- Monte-Carlo ;
- stress coûts/slippage ;
- perturbation de paramètres.

Chaque test est paramétré par `desk_robustness_policy_core_v1`. Un test en `FAIL` bloque la promotion. Une preuve manquante passe en `REVIEW` et bloque aussi la promotion jusqu'à revue explicite.

Le rapport expose `gate.promotion_allowed`, `policy_hash`, `input_hash`, `content_hash` et l'observabilité coût/temps de calcul. Il peut être persisté comme artifact `ROBUSTNESS_REPORT`.

## Parité Simulation / SHADOW TD2-602

La preuve `strategy_shadow_parity_report_v1` compare une sortie Simulation figée et une sortie SHADOW sur le même scénario.

Invariants :

- la comparaison utilise le contrat `Signal` (`14-signal.md`) ;
- un `signal_id` différent ne casse pas la parité sémantique ;
- le payload métier, la direction, l’instrument, la fenêtre de validité et la corrélation doivent matcher ;
- un no-op d’expiration peut être prouvé sans publier de signal live ;
- toute preuve incomplète passe en `PARITY_INVALID`, jamais en succès implicite.

## Exemple JSON

```json
{
  "simulation_run_id": "6c1a3e00-1111-4a2b-9c3d-abcdef012345",
  "source_run_id": "sim_fixture_2026_06_11",
  "strategy_version_id": "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11",
  "dataset_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "parameters_hash": "sha256:abcd...",
  "status": "COMPLETED",
  "result_hash": "sha256:1234...",
  "metrics_hash": "sha256:5678...",
  "result_ref": "artifact://simulation-runs/6c1a3e00-1111-4a2b-9c3d-abcdef012345/result",
  "metrics_ref": "artifact://simulation-runs/6c1a3e00-1111-4a2b-9c3d-abcdef012345/metrics",
  "reproducibility_seed": "seed-2026-08-07-001",
  "started_at": "2026-08-07T10:00:00Z",
  "completed_at": "2026-08-07T10:04:12Z"
}
```
