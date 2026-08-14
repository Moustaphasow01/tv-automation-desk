# Agent Runtime Admin API V1

> Ticket : `TD2-406`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Admin API V1` expose une surface MCP contrôlée pour administrer le runtime agents sans accès SQL direct.

Depuis TD2-407, la même source applicative alimente aussi le BFF front via `/api/v1/agent-runtime/*`, pour le cockpit opérateur `Agents IA`.

Elle sert à :

- lire l'état des tâches durables ;
- inspecter les dead letters ;
- consulter les métriques de run ;
- observer les pools de workers isolés ;
- requeue une DLQ validée par opérateur ;
- annuler une tâche non finale.

## Outils MCP

Lectures, scope `desk.read` :

- `get_agent_runtime_overview`
- `list_agent_runtime_tasks`
- `get_agent_runtime_task`
- `list_agent_runtime_dead_letters`
- `list_agent_runtime_metrics`
- `get_agent_runtime_pool_overview`

Mutations, scope `desk.write` :

- `requeue_agent_runtime_dead_letter`
- `cancel_agent_runtime_task`

Les outils sont déclarés dans la slice `agent-runtime.admin` et exposés par le profil MCP `autopilot_v4`.

## Contrôles de mutation

Toute action mutante doit fournir :

- `operator_id`
- `reason`
- `idempotency_key`

Le contrat domaine `authorizeAgentRuntimeAdminActionV1` rejette les commandes incomplètes avant d'appeler PostgreSQL.

Le requeue passe par `PostgresAgentRuntimeRepository.requeueDeadLetter`. La tâche source reste terminale ; une nouvelle tâche `READY` est créée avec `depends_on_task_id`.

Le cancel passe par `PostgresAgentRuntimeRepository.cancelTask`. Une tâche finale (`DONE`, `ERROR`, `EXPIRED`) n'est pas modifiée silencieusement.

## Projection sûre

Les lectures de tâches n'exposent pas `lease_token`.

La payload d'une tâche est masquée par défaut. `get_agent_runtime_task` peut l'inclure uniquement avec `include_payload=true`, pour inspection opérateur explicite.

Les métriques exposent les champs utiles :

- outcome ;
- modèle et niveau de raisonnement ;
- latences ;
- tokens/coût ;
- conversation et policy snapshot ;
- `metric_hash`.

`get_agent_runtime_pool_overview`, ajouté par TD2-410, expose les responsabilités `live`, `safety`, `operations`, `replay`, `validation`, `research` et `default`, avec compteurs de tâches et métriques récentes par pool. Il ne retourne ni payload de tâche ni `lease_token`.

La projection REST du front garde les mêmes garanties : pas de `lease_token`, pas de payload complète, commandes `requeue`/`cancel` idempotentes et opérateur contrôlé.

## Validation réelle

La preuve locale TD2-406 a exécuté dans PostgreSQL Docker :

1. création d'un agent, d'une mission et de deux tâches `READY` ;
2. claim + fail terminal sur une tâche pour produire une DLQ `OPEN` ;
3. lecture des DLQ via le service admin ;
4. `requeue_agent_runtime_dead_letter` équivalent service avec `operator_id`, `reason`, `idempotency_key` ;
5. `cancel_agent_runtime_task` équivalent service sur une tâche non finale ;
6. lecture overview.

Résultat observé :

- DLQ ouverte avant requeue : `1` ;
- requeue : `REQUEUED`, recovery task `READY` ;
- cancel : `CANCELLED` ;
- overview : plus aucune DLQ ouverte sur la lane de preuve.
