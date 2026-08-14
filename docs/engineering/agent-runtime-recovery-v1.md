# Agent Runtime Recovery V1

> Ticket : `TD2-404`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Recovery V1` durcit la file durable des workers IA :

- retry borné avec `not_before_utc` ;
- dead-letter persistante quand une tâche devient terminale ;
- reprise opérateur idempotente ;
- annulation opérateur auditée.

## Retry

Une erreur `retryable=true` ne remet plus la tâche immédiatement en file. Le domaine calcule :

- `retry_after_seconds` ;
- `next_retry_at_utc` ;
- `not_before_utc` sur `agent_tasks`.

La policy par défaut est :

- `base_delay_seconds=60` ;
- `max_delay_seconds=900` ;
- `multiplier=2` ;
- `jitter_seconds=0`.

Le jitter est déterministe quand il est activé : il dépend du `task_id`, de `attempt_count` et de `error_code`.

## Dead letter

La migration `infra/postgres/init/041_agent_task_recovery.sql` ajoute :

- `agent_dead_letter_status` ;
- `agent_task_dead_letters` ;
- les events `TASK_DEAD_LETTERED`, `TASK_REQUEUED`, `TASK_CANCELLED`.

Quand une tâche passe `ERROR`, le repository écrit une DLQ avec :

- tâche source ;
- mission/agent ;
- erreur ;
- `attempt_count` ;
- snapshot JSON de la tâche terminale.

## Reprise opérateur

`PostgresAgentRuntimeRepository.requeueDeadLetter` crée une nouvelle tâche `READY` depuis la tâche source, avec :

- `depends_on_task_id` pointant vers la tâche tombée ;
- payload enrichie avec `recovered_from_task_id` et `dead_letter_id` ;
- idempotence par `task_key` de recovery ;
- status DLQ passé à `REQUEUED`.

La tâche source reste terminale : on ne réécrit pas l'histoire.

## Annulation opérateur

`PostgresAgentRuntimeRepository.cancelTask` passe une tâche non finale en `CANCELLED`, nettoie le lease et écrit `TASK_CANCELLED`.

L'appel est idempotent si la tâche est déjà `CANCELLED`. Les statuts finaux (`DONE`, `ERROR`, `EXPIRED`) ne sont pas mutés.

## Correction adjacente

Le test réel a révélé que `complete/fail` tentaient de réinsérer le même lease que le claim. `insertLease` fait maintenant un upsert sur `(agent_task_id, lease_token)` et retourne l'ID réel du lease. Cela rend les transitions Postgres compatibles avec la contrainte unique existante.

## Variables d'environnement

- `DESK_AGENT_RETRY_BASE_DELAY_SECONDS=60`
- `DESK_AGENT_RETRY_MAX_DELAY_SECONDS=900`
- `DESK_AGENT_RETRY_MULTIPLIER=2`
- `DESK_AGENT_RETRY_JITTER_SECONDS=0`

## Validation

Validation locale :

- tests domaine ;
- tests supervisor/schema ;
- migration Docker ;
- matrice Postgres réelle `claim → fail terminal → DLQ → requeue → cancel`.
