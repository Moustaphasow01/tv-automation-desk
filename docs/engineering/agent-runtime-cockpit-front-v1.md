# Agent Runtime Cockpit Front V1

> Ticket : `TD2-407`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Cockpit Front V1` ajoute au front transitoire une vue opérateur dédiée aux workers IA Codex.

Le cockpit ne remplace pas les anciens écrans :

- `Files GPT` garde la séparation Live/Replay historique ;
- `Observabilité` garde les anciens processus GPT et coûts mesurés ;
- `Agents IA` supervise le nouveau runtime durable `agent_tasks`, ses pools, scheduler, métriques et DLQ.

## Endpoints REST

Lecture :

- `GET /api/v1/agent-runtime/overview`
- `GET /api/v1/agent-runtime/tasks`
- `GET /api/v1/agent-runtime/pools`
- `GET /api/v1/agent-runtime/scheduler-plan`
- `GET /api/v1/agent-runtime/metrics`
- `GET /api/v1/agent-runtime/dead-letters`

Actions opérateur :

- `POST /api/v1/agent-runtime/dead-letters/{deadLetterId}/requeue`
- `POST /api/v1/agent-runtime/tasks/{taskId}/cancel`

Les actions exigent `reason` et `idempotency_key`. Le BFF injecte l'identité opérateur issue de l'acteur HTTP si `operator_id` n'est pas fourni.

## Sécurité de projection

La page consomme uniquement les endpoints BFF. Elle n'accède pas aux tables PostgreSQL.

La projection de tâches :

- affiche `lease_active` mais jamais `lease_token` ;
- affiche seulement `payload_keys`, pas la payload complète ;
- raccourcit les identifiants techniques, avec titre complet au survol quand c'est utile ;
- garde les états vides réels au lieu de remplir des données artificielles.

## Parcours UI

Route : `/operations/agents`.

Navigation :

- espace `Opérations` ;
- onglet `Agents IA` disponible depuis Cockpit, Files GPT, Exécution, Observabilité, Incidents, Notifications et Runbooks.

Blocs de la page :

1. KPI runtime : tâches prêtes, leases actifs, DLQ, scheduler, runs mesurés, coût fenêtre ;
2. pools isolés : `live`, `safety`, `operations`, `replay`, `validation`, `research`, `default` ;
3. scheduler live-first : tâches sélectionnées, différées et rejetées ;
4. ledger `agent_tasks` avec action contrôlée `cancel` ;
5. DLQ ouverte avec action contrôlée `requeue` ;
6. métriques LLM : modèle, niveau de réflexion, latence, tokens et coût.

## Validation

La livraison TD2-407 doit passer :

- tests routeur REST `front_operations_api.test.js` ;
- tests ViewModel `agentRuntimeViewModel.test.ts` ;
- typecheck front ;
- build front ;
- guards architecture/static/Jira.
