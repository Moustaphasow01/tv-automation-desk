# Agent Runtime Metrics V1

> Ticket : `TD2-405`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Metrics V1` mesure chaque exécution réelle d'une tâche IA durable.

L'objectif est simple : ne plus piloter les workers Codex/GPT à l'intuition. Chaque run doit laisser une trace exploitable pour savoir :

- combien de temps la tâche attend en file avant claim ;
- combien de temps le worker met à produire sa réponse ;
- combien de tokens et quel coût le run a consommés ;
- quel modèle et quel niveau de raisonnement ont réellement été utilisés ;
- quelle conversation et quel snapshot de policy expliquent le résultat.

## Composants

- Domaine : `packages/desk-domain/src/agent-runtime-metrics-v1.js`.
- Persistance : `infra/postgres/init/042_agent_task_run_metrics.sql`.
- Repository PostgreSQL : `mcp_gpt_desk/src/agent-runtime-metrics-postgres.js`.
- Superviseur : `mcp_gpt_desk/src/agent-runtime-supervisor.js`.
- Tests : `packages/desk-domain/test/agent-runtime-metrics-v1.test.js` et `mcp_gpt_desk/test/agent_runtime_supervisor.test.js`.

## Donnée canonique

La table `agent_task_run_metrics` contient une ligne par `agent_task_id`.

Elle référence :

- `agent_tasks` ;
- `agent_missions` ;
- `agent_conversations` quand une conversation a été attachée ;
- `agent_execution_policy_snapshots` quand le routing modèle/raisonnement a été résolu ;
- `agent_task_dead_letters` quand le run termine en DLQ.

La colonne `metric` garde le snapshot JSON normalisé et `metric_hash` le scelle.

## Latences

Trois durées sont matérialisées :

- `queue_latency_ms` : `created_at_utc → claimed_at_utc`.
- `run_duration_ms` : début d'appel runner → fin métier.
- `total_latency_ms` : `created_at_utc → fin métier`.

Ces mesures permettent de distinguer un problème de planification des workers d'un problème de lenteur modèle.

## Outcomes

Les outcomes normalisés sont :

- `COMPLETED`
- `FAILED_RETRYABLE`
- `FAILED_TERMINAL`
- `DEAD_LETTERED`
- `CANCELLED`

Le superviseur enregistre les métriques après completion ou failure. Une erreur d'écriture métrique ne doit pas faire régresser la tâche métier : elle est retournée comme diagnostic non bloquant.

## Tokens et coût

Le superviseur extrait les champs suivants depuis `output.usage`, `output.telemetry.usage` ou `output.telemetry` :

- `input_tokens` / `prompt_tokens`
- `output_tokens` / `completion_tokens`
- `total_tokens`
- `cost_micros_usd`

Si le runner ne fournit pas encore ces valeurs, les colonnes restent `NULL`. Le contrat est donc compatible avec une adoption progressive par type de worker.

## Validation réelle

La preuve locale TD2-405 a exécuté :

1. insertion d'un agent, d'une mission et d'une tâche `READY` dans PostgreSQL Docker ;
2. claim par `AgentRuntimeSupervisorService` ;
3. résolution conversation + execution policy ;
4. runner factice avec tokens/coût ;
5. completion ;
6. lecture de `agent_task_run_metrics`.

Résultat observé :

- outcome `COMPLETED` ;
- modèle `codex-mission` ;
- raisonnement `ultra` ;
- conversation attachée ;
- snapshot de policy attaché ;
- tokens et coût persistés.
