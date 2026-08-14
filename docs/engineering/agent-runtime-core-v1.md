# Agent Runtime Core V1

TD2-400 introduit le noyau durable générique des futurs workers IA : `Agent → Mission → Conversation → Task → Lease → Agent Event`.

## Placement

- Module propriétaire : `agents`.
- Domaine pur : `packages/desk-domain/src/agent-runtime-v1.js`.
- Persistance : `infra/postgres/init/037_agent_runtime_registry.sql`.
- Notifications superviseur : `infra/postgres/init/038_agent_runtime_notifications.sql`.
- Dépendances SQL : `025_data_source_ingestion_batch_registry.sql`, `026_dataset_registry.sql` et `036_prompt_instruction_registry.sql` doivent être présents avant `037`, car les tâches peuvent référencer un `prompt_render_snapshot_id`.
- Consommateurs prévus : superviseur Windows TD2-401, affinité conversation TD2-402, model routing TD2-403, recovery TD2-404, métriques TD2-405, administration MCP TD2-406, cockpit agents TD2-407, scheduler compute TD2-408, policies Batch TD2-409, pools isolés TD2-410, host OS-neutral TD2-411.

Le domaine ne dépend pas de PostgreSQL, HTTP, MCP, React, Codex, NinjaTrader ou d'un broker.

## Responsabilité

Le runtime fournit :

- la validation des contrats `Agent`, `Mission`, `Conversation` et `Task` ;
- les transitions déterministes de tâche : claim, prolongation de lease, completion, failure et expiration ;
- la protection par `worker_id + lease_token` ;
- le requeue d'un échec retryable tant que `attempt_count < max_attempts` ;
- des événements auditables scellés par hash canonique.

## Invariants

- La conversation IA n'est jamais la source de vérité. Elle sert à reprendre/optimiser le contexte, mais la tâche, son lease et ses events restent canoniques.
- Une tâche `CLAIMED` ou `RUNNING` nécessite `assigned_worker_id`, `lease_token` et `lease_expires_at_utc`.
- Un second worker ne peut pas prendre une tâche tant que le lease actif n'est pas expiré.
- `complete` et `fail` exigent le même `worker_id` et le même `lease_token` que le claim.
- Les events sont append-only côté SQL.
- Le Prompt Registry reste séparé : une tâche peut référencer un `prompt_render_snapshot_id`, mais ne modifie jamais une version de prompt.
- Le choix modèle/raisonnement/budget est snapshoté séparément par TD2-403 dans `agent_execution_policy_snapshots`.
- Les erreurs terminales sont externalisées par TD2-404 dans `agent_task_dead_letters`, puis reprises via nouvelle tâche.
- Les mesures coût/latence/tokens sont externalisées par TD2-405 dans `agent_task_run_metrics`.
- Les reprises et annulations opérateur passent par TD2-406 plutôt que par SQL manuel.
- La priorité inter-lanes et les quotas compute passent par TD2-408, désactivé par défaut côté superviseur.
- Les jointures de sous-tâches Batch passent par TD2-409 : les tâches ouvertes/échouées sont toujours listées.
- L'isolation des workers par responsabilité passe par TD2-410 : un pool live/replay/research/validation/safety ne peut pas réclamer une tâche hors lane ou hors type autorisé.
- L'hôte du superviseur est OS-neutral via TD2-411 : Windows n'est qu'un adapter de déploiement.

## Migration progressive

TD2-400 ne migre pas encore les claims Live/Replay existants. C'est volontaire : ADR-0013 demande d'encapsuler les pipelines actuels sans changement métier brutal.

Ordre prévu :

1. TD2-401 branche le superviseur Windows sur ces tables.
2. TD2-402 ajoute l'affinité mission/conversation.
3. TD2-403 résout le modèle/raisonnement/budget depuis les defaults agent, mission et tâche, puis lie le Prompt Registry sans le muter.
4. TD2-404 ajoute retry/backoff, DLQ et reprise opérateur.
5. TD2-405 ajoute les métriques d'exécution par tâche.
6. TD2-406 expose une surface MCP d'administration contrôlée.
7. TD2-408 ajoute la décision scheduler Live-first et quotas compute.
8. TD2-409 ajoute les politiques de jointure Batch.
9. TD2-410 isole les pools de workers par responsabilité.
10. TD2-411 extrait la configuration host portable du superviseur.
11. Les pipelines Replay puis Live migrent ensuite par vertical slice, avec non-régression.

## Tests

- `packages/desk-domain/test/agent-runtime-v1.test.js`.
- `mcp_gpt_desk/test/agent_runtime_sql_schema.test.js`.
- `packages/desk-domain/test/agent-runtime-scheduler-policy-v1.test.js`.
- `packages/desk-domain/test/agent-batch-join-policy-v1.test.js`.
- `packages/desk-domain/test/agent-worker-pool-policy-v1.test.js`.
- `npm run guard:sql-migrations`.
