# Simulation Compute Worker Python

> Ticket : `TD2-309`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Le compute worker Python exécute des jobs lourds autour de la simulation sans redéfinir la stratégie.

Python ne contient pas la logique métier du Strategy DSL. Il valide le contrat de job, mesure l'exécution, gère l'idempotence, puis délègue le calcul canonique au CLI Node du package `desk-replay-engine`.

## Contrats

Entrée : `simulation_compute_job_v1`.

Champs obligatoires :

- `job_id` ;
- `idempotency_key` ;
- `task_type = CANONICAL_SIMULATION` ;
- `payload` : input de `runCanonicalSimulationV1`.

Sortie : `simulation_compute_result_v1`.

Champs clés :

- `worker_version` ;
- `job_hash` ;
- `status` ;
- `started_at_utc`, `completed_at_utc`, `duration_ms` ;
- `simulation_run_id`, `result_hash`, `metrics_hash` ;
- `result` canonique ;
- `simulation_run` registry entry ;
- `artifacts` prêts à être persistés ;
- `observability.input_bytes`, `observability.artifact_count`.

## Implémentation

- Worker : `packages/desk-replay-engine/src/compute_worker.py`.
- CLI Node délégué : `packages/desk-replay-engine/bin/run-canonical-simulation-cli.mjs`.
- Tests : `packages/desk-replay-engine/test/compute-worker.test.js`.

## Idempotence et reprise

Si `--output` pointe vers un résultat existant avec le même `job_hash`, le worker retourne ce résultat avec `resumed=true`.

Si le fichier existe mais correspond à un autre job, le worker échoue avec `IDEMPOTENCY_CONFLICT`.

## Invariant

La seule source de vérité sémantique reste `runCanonicalSimulationV1`. Le worker Python est une enveloppe d'orchestration, pas un second moteur stratégique.
