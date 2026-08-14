# Simulation Run Front API

> Ticket : `TD2-304`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Le Replay Lab peut consulter les runs de simulation canoniques sans recalculer la vérité métier côté front.

Le backend expose :

- la liste des `simulation_runs` ;
- le détail d’un run ;
- ses artifacts scellés ;
- une comparaison de reproductibilité entre plusieurs runs ;
- l’enrichissement opportuniste des comparaisons Replay avec les preuves de simulation liées.

## Routes REST

Base : `/api/v1`.

| Route | Méthode | Contrat |
|---|---:|---|
| `/simulation-runs` | `GET` | `DeskSimulationRunList` |
| `/simulation-runs/{simulationRunId}` | `GET` | `DeskSimulationRunDetail` |
| `/simulation-runs/{simulationRunId}/artifacts` | `GET` | `DeskSimulationRunArtifactList` |
| `/simulation-runs/compare?ids=a,b` | `GET` | `DeskSimulationRunComparison` |

Filtres supportés :

- `strategy_version_id` ;
- `dataset_id` ;
- `status` ;
- `artifact_kind` pour les artifacts ;
- `limit`.

## Replay Lab

`/replays/compare` continue de comparer les exécutions replay existantes. Chaque ligne est enrichie avec `simulationEvidence` quand le Run Registry contient un run lié par :

- `metadata.backtest_id` ;
- `metadata.replay_run_id` ;
- `metadata.run_id` ;
- `metadata.workflow_id` ;
- `source_run_id`.

Le front affiche :

- un KPI `Preuves sim` ;
- un panneau `Run Registry` avec runs liés, dataset, metrics hash et kinds d’artifacts ;
- un flag `preuve sim absente` si le registry est disponible mais qu’aucun run n’est lié.

## Résilience

Si le registry n’est pas monté, `/simulation-runs` retourne un contrat réel avec `available:false` au lieu de simuler des données.

Les détails/comparaisons directes restent stricts : une demande ciblée sur un run absent ou un registry indisponible remonte une erreur HTTP explicite.

## Validation

- `node --test mcp_gpt_desk/test/front_operations_api.test.js mcp_gpt_desk/test/front_operations_service.test.js mcp_gpt_desk/test/simulation_run_registry_service.test.js`
- `npm run build`
