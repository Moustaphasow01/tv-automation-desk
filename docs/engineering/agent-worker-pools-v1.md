# Agent Worker Pools V1

> Ticket : `TD2-410`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Worker Pools V1` isole les workers IA par responsabilité.

Avant cette couche, un supervisor était surtout limité par `lane`. C'était déjà mieux que la file GPT unique, mais pas suffisant pour un desk durable : un service mal configuré pouvait encore consommer une lane non prévue ou prendre un type de tâche qui ne correspondait pas à son rôle.

La séparation devient explicite :

| Pool | Lane | Responsabilité |
| --- | --- | --- |
| `live` | `live` | décisions Master/Monitor/Setup live. |
| `safety` | `safety` | gates risque, broker et escalades opérateur. |
| `operations` | `operations` | DLQ, recovery et runbooks opérateur. |
| `replay` | `replay` | Replay V4, backtests et réconciliation replay. |
| `validation` | `validation` | robustesse, simulations et out-of-sample. |
| `research` | `research` | recherche de stratégies et hypothèses. |
| `default` | `default` | fallback contrôlé pour tâches non classées. |

## Placement

- Domaine pur : `packages/desk-domain/src/agent-worker-pool-policy-v1.js`.
- Claim Postgres filtré : `mcp_gpt_desk/src/agent-runtime-postgres-repository.js`.
- Supervisor : `mcp_gpt_desk/src/agent-runtime-supervisor.js`.
- Outil MCP read-only : `get_agent_runtime_pool_overview`.

La policy ne dépend pas de PostgreSQL, Windows, Codex, MCP, React, NinjaTrader ou d'un broker.

## Invariants

- Un worker actif doit résoudre un `worker_pool` cohérent avec son `worker_id` et sa `lane`.
- Une tâche liée explicitement à un pool ne peut pas être prise par un autre pool.
- Le claim Postgres applique les `task_type_patterns` du pool avant de locker la tâche.
- Un échec de pool retourne `POOL_CONFIGURATION_REJECTED` avant claim, donc sans lease et sans token consommé.
- Les erreurs restent confinées au pool : un replay dégradé ne bloque pas le live, un research lent ne bloque pas safety.
- Le scheduler TD2-408 reste responsable des quotas inter-lanes ; les pools TD2-410 ajoutent la responsabilité métier intra-runtime.

## Configuration

Variables principales :

- `DESK_AGENT_WORKER_POOL=live` : pool déclaré du service supervisor.
- `DESK_AGENT_POOL_POLICY_JSON=` : override optionnel de policy, vide par défaut.
- `DESK_AGENT_SUPERVISOR_LANE=live` : lane consommée.
- `DESK_AGENT_SUPERVISOR_ID=agent-runtime-live-01` : worker id attendu par les préfixes du pool.

Le mode reste contrôlé par `DESK_AGENT_SUPERVISOR_MODE`. En `shadow`, aucun claim n'est effectué. En `active`, le gate pool est bloquant.

## Observabilité

`get_agent_runtime_pool_overview` retourne :

- les pools et responsabilités ;
- les compteurs de tâches par statut ;
- les tâches actives/échouées ;
- les métriques récentes par pool : runs, succès, échecs, tokens et coût.

La projection ne retourne ni payload de tâche, ni `lease_token`.

## Rollback

Rollback immédiat :

1. laisser `DESK_AGENT_SUPERVISOR_MODE=shadow` ou `disabled` ;
2. ou retirer `DESK_AGENT_WORKER_POOL` pour retomber sur l'inférence lane/worker.

Aucun changement métier Live/Replay n'est activé automatiquement par TD2-410.

## Tests

- `packages/desk-domain/test/agent-worker-pool-policy-v1.test.js`.
- `mcp_gpt_desk/test/agent_runtime_supervisor.test.js`.
- `mcp_gpt_desk/test/agent_runtime_admin_service.test.js`.
