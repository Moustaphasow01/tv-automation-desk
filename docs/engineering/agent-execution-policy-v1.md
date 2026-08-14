# Agent Execution Policy V1

> Ticket : `TD2-403`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Execution Policy V1` choisit de façon déterministe le modèle, le niveau de raisonnement, les budgets et le timeout à utiliser pour une tâche agent.

Elle évite de figer ces choix dans chaque prompt ou chaque service Windows. Le runner IA reçoit une policy effective déjà résolue, et PostgreSQL conserve un snapshot hashé de cette décision.

## Ordre de résolution

Les couches sont fusionnées dans cet ordre, du moins prioritaire au plus prioritaire :

1. defaults du superviseur ;
2. `agents.model_policy` ;
3. `agent_missions.model_policy` ;
4. `agent_tasks.model_policy` si présent côté domaine/mocks ;
5. `agent_tasks.payload.execution_policy` ;
6. `agent_tasks.metadata.execution_policy`.

Cela permet un défaut global stable sur le VPS, une spécialisation par agent ou mission, puis une surcharge ponctuelle par tâche.

## Routage

| Task type contient | Routing profile |
| --- | --- |
| `CONTEXT_DECISION` ou `AI_CONTEXT` | `CONTEXT_DECISION` |
| `MASTER` | `ANALYSIS_MASTER` |
| `MONITOR` | `ANALYSIS_MONITOR` |
| `RESEARCH` | `RESEARCH` |
| `SIMULATION` | `SIMULATION` |
| autre | `GENERIC_AGENT_TASK` |

TD2-801 ajoute le profil `CONTEXT_DECISION` au router. Il est prioritaire sur `MASTER`/`MONITOR` afin qu’une tâche nommée par exemple `LIVE_CONTEXT_DECISION_MONITOR` reste dans la voie consultative de l’AI Context Gate.

Le profil peut aussi être forcé explicitement par une couche de policy résolue (`routing_profile=CONTEXT_DECISION`) lorsque le work item est déjà typé par le service applicatif.

## Liaison prompt

La policy ne modifie pas le Prompt Registry. Elle indique seulement la source à utiliser :

- `TASK_RENDER_SNAPSHOT` si la tâche référence un `prompt_render_snapshot_id` ;
- `MISSION_COMPOSITION` si la mission référence un `prompt_composition_id` ;
- `UNBOUND` si aucun prompt versionné n'est attaché.

Si `prompt_required=true`, `UNBOUND` est rejeté avant exécution.

## Garde-fous

- Le modèle doit être renseigné.
- Le raisonnement doit être parmi `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.
- Les alias contenant `latest` sont rejetés par défaut, sauf `allow_unpinned_model=true`.
- Le timeout est borné entre 5 secondes et 30 minutes.
- Les budgets token/output sont bornés.

## Persistance et audit

La migration `infra/postgres/init/040_agent_execution_policy_snapshots.sql` ajoute `agent_execution_policy_snapshots` et l'event `EXECUTION_POLICY_RESOLVED`.

À chaque tâche claimée par le superviseur agent :

1. le repository résout la policy ;
2. il insère ou réutilise le snapshot `(agent_task_id, policy_hash)` ;
3. il écrit un event append-only avec `model`, `reasoning_effort`, `routing_profile`, `prompt_source` et `policy_hash` ;
4. le runner reçoit `execution_policy` et `execution_policy_snapshot` sur `stdin`.

## Variables d'environnement

- `DESK_AGENT_MODEL=codex`
- `DESK_AGENT_REASONING_EFFORT=xhigh`
- `DESK_AGENT_TIMEOUT_MS=780000`
- `DESK_AGENT_TOKEN_BUDGET=0`
- `DESK_AGENT_MAX_OUTPUT_TOKENS=0`

Ces valeurs sont des defaults. Les policies agent/mission/task peuvent les surcharger.

## Non-régression

TD2-403 ne change pas encore les moteurs Live/Replay existants. Il prépare la couche commune des futurs workers Codex permanents, sans toucher aux contrats stratégie validés.
