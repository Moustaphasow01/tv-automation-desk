# Agent Runtime Scheduler Policy V1

> Ticket : `TD2-408`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Scheduler Policy V1` choisit quelles tâches IA peuvent consommer du compute dans une fenêtre donnée.

Le problème corrigé est simple : un pool replay ou research ne doit plus pouvoir saturer la machine alors qu'une tâche LIVE est prête. La décision devient déterministe, testable et observable avant d'être branchée en mode bloquant.

## Placement

- Module propriétaire : `agents`.
- Domaine pur : `packages/desk-domain/src/agent-runtime-scheduler-policy-v1.js`.
- Adapter PostgreSQL : `mcp_gpt_desk/src/agent-runtime-scheduler-service.js`.
- Consommateur optionnel : `mcp_gpt_desk/src/agent-runtime-supervisor.js`, via un `claimGate`.

Le domaine ne dépend pas de PostgreSQL, Windows, Codex, MCP, React ou d'un broker.

## Décision

La policy trie les tâches éligibles avec ces règles :

1. `live` passe avant `safety`, `operations`, `replay`, `validation`, `research` et `default`.
2. La priorité numérique de la tâche reste utilisée à l'intérieur d'une lane.
3. Les quotas bornent le nombre de tâches sélectionnées, les tâches déjà en cours, les tokens et le coût par fenêtre.
4. Une tâche non-live trop ancienne peut être promue pour éviter la starvation, mais jamais au-dessus d'un LIVE prêt.
5. Les tâches non éligibles (`not_before_utc` futur, lease actif, statut non claimable) sont rejetées avec une raison explicite.

La sortie contient un `plan_hash` canonique. Deux entrées identiques à la même horloge produisent donc le même plan.

## Service PostgreSQL

`AgentRuntimeSchedulerService.previewSchedule` lit :

- les tâches `PENDING`, `READY`, `CLAIMED` et `RUNNING` depuis `agent_tasks` ;
- les métriques récentes depuis `agent_task_run_metrics` ;
- les leases actifs pour calculer `running_count`.

Il retourne une projection sans `lease_token` et sans payload complet. Le service sert d'abord au cockpit et aux preuves opérateur ; il ne change pas le claim existant par défaut.

L'outil MCP read-only `get_agent_runtime_scheduler_plan` expose cette projection aux opérateurs et au futur cockpit Agents. Il exige seulement `desk.read`, accepte un `task_key_prefix` de diagnostic et ne fait aucun claim.

`evaluateLaneClaimGate` projette le plan pour une lane précise :

- `ALLOWED` si la lane est sélectionnée ou si aucun travail n'est sélectionné ;
- `DEFERRED` si une lane plus prioritaire doit consommer la fenêtre.

## Modes superviseur

Le superviseur lit `DESK_AGENT_SCHEDULER_MODE`. TD2-410 ajoute ensuite `DESK_AGENT_WORKER_POOL` pour isoler la responsabilité avant claim :

| Mode | Comportement |
| --- | --- |
| `disabled` | défaut ; aucun gate scheduler, comportement historique conservé. |
| `shadow` | calcule la décision mais force `allowed=true`, utile pour observer sans bloquer. |
| `enforce` | applique le gate ; un worker non prioritaire retourne `DEFERRED_BY_SCHEDULER` avant claim et sans token. |

Une valeur inconnue retombe en `disabled`.

## Rollback

Rollback immédiat : `DESK_AGENT_SCHEDULER_MODE=disabled`.

Comme aucun changement de claim n'est activé par défaut, le pipeline GPT-first actuel reste le fallback principal jusqu'au cutover explicite prévu par ADR-0020.

## Tests et preuves

- Domaine : `packages/desk-domain/test/agent-runtime-scheduler-policy-v1.test.js`.
- Service/gate : `mcp_gpt_desk/test/agent_runtime_scheduler_service.test.js`.
- Supervisor : `mcp_gpt_desk/test/agent_runtime_supervisor.test.js`.

Les tests couvrent la priorité LIVE, les quotas, l'anti-starvation, les tâches non éligibles, le hash déterministe et le fait qu'un supervisor replay ne claim pas si le gate choisit LIVE.
