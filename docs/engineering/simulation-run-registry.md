# Simulation Run Registry

> Ticket : `TD2-302`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Le Run Registry minimal persiste les exécutions déterministes produites par le Canonical Simulation Engine. Il permet de prouver qu’un même couple Strategy Version + Dataset + paramètres + seed produit des métriques bit-à-bit reproductibles.

Ce registre est volontairement plus petit qu’un Experiment Registry : il stocke les runs et leurs artifacts bruts, mais il ne sélectionne pas de gagnant et ne porte pas encore l’interface de comparaison avancée.

## Placement

- Bounded context : `simulation`.
- Modèle pur : `packages/desk-replay-engine/src/simulation-run-registry-v1.js`.
- Adapter PostgreSQL transitoire : `mcp_gpt_desk/src/simulation-run-registry-repository.js`.
- Service applicatif : `mcp_gpt_desk/src/simulation-run-registry-service.js`.
- Migration : `infra/postgres/init/032_simulation_run_registry.sql`.

Ce découpage respecte la frontière cible : le package de simulation ne connaît pas PostgreSQL, et le host MCP reste uniquement l’adapter transitoire.

## Run Registry minimal

`simulation_runs` contient :

- `simulation_run_id` UUID stable ;
- `source_run_id` pour tracer l’identifiant interne du moteur ;
- `strategy_version_id` et `dataset_id` ;
- `parameters_hash` et `reproducibility_seed` ;
- statut : `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `REJECTED`, `REVIEW_REQUIRED` ;
- `dataset_hash`, `compiled_artifact_hash`, `result_hash`, `metrics_hash` ;
- `result_ref` et `metrics_ref`.

`simulation_run_artifacts` contient les payloads hashés :

- `INPUT_MANIFEST` ;
- `ORDER_SIMULATION_POLICY` ;
- `RESULT` ;
- `METRICS` ;
- `EVENTS` ;
- `POSITIONS` ;
- `ROBUSTNESS_REPORT` ;
- `ERROR`.

`simulation_run_audit_events` trace les enregistrements et idempotences.

## Invariants

- Un run `COMPLETED` doit avoir `result_hash`, `metrics_hash`, `result_ref` et `metrics_ref`.
- Un run terminal ne peut plus changer ses champs scellés.
- Un artifact est immuable : pas de changement de type, run, schema, hash ou payload.
- L’index `(strategy_version_id, dataset_id, parameters_hash, reproducibility_seed)` matérialise la clé de reproductibilité sans empêcher plusieurs exécutions comparables.
- L’idempotence applicative bloque les doubles écritures divergentes pour un même `simulation_run_id`.

## Extensions livrées

- `ORDER_SIMULATION_POLICY` : hypothèses d'exécution TD2-305.
- `ROBUSTNESS_REPORT` : rapport de robustesse TD2-307, utilisé pour bloquer ou autoriser la promotion d'une Strategy Version candidate.

## Hors périmètre

- Comparaison front/Replay Lab : `TD2-304`.
- Métriques avancées et segmentations : `TD2-306`.

## Rollback

La capacité n’active aucun live trading. Le rollback consiste à ne plus appeler `SimulationRunRegistryService` et à ignorer la migration `032` dans une base fraîche. Sur une base déjà migrée, les tables `simulation_*` sont isolées du reste et ne mutent pas les registres `strategy` ou `market-data`.
