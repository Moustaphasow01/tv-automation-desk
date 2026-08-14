# Agent Runtime Supervisor V1

> Ticket : `TD2-401`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Supervisor V1` est le service générique qui réveille les futurs workers IA à partir des tâches durables `agent_tasks`.

Il ne remplace pas encore les pipelines Live/Replay existants : il pose la tuyauterie commune qui permettra ensuite de migrer les workers par responsabilité, sans perdre les garanties de lease, d'idempotence et d'audit créées par `TD2-400`.

## Composants

- Domaine : `packages/desk-domain/src/agent-runtime-v1.js`.
- Tables : `infra/postgres/init/037_agent_runtime_registry.sql`.
- Notification : `infra/postgres/init/038_agent_runtime_notifications.sql`.
- Repository PostgreSQL : `mcp_gpt_desk/src/agent-runtime-postgres-repository.js`.
- Métriques PostgreSQL : `mcp_gpt_desk/src/agent-runtime-metrics-postgres.js`.
- Scheduler PostgreSQL optionnel : `mcp_gpt_desk/src/agent-runtime-scheduler-service.js`.
- Policy pools : `packages/desk-domain/src/agent-worker-pool-policy-v1.js`.
- Config host portable : `mcp_gpt_desk/src/agent-runtime-supervisor-host.js`.
- Service applicatif : `mcp_gpt_desk/src/agent-runtime-supervisor.js`.
- Runner CLI : `mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs`.
- Service Windows : `deploy/windows/services/DeskAgentRuntimeSupervisor.xml.template`.
- Bascule opérateur : `deploy/windows/Set-DeskAgentRuntimeSupervisorMode.ps1`.

## Modes

| Mode | Comportement |
| --- | --- |
| `disabled` | Service arrêté/désactivé côté Windows. Aucun claim. Aucun token. |
| `shadow` | Service démarré pour heartbeat/observabilité, mais aucun claim. Aucun token. Mode par défaut. |
| `active` | Claim autorisé uniquement si `DESK_AGENT_SUPERVISOR_RUNNER_COMMAND` est configuré. |

Le script de bascule refuse le passage en `active` si aucun runner n'est configuré. C'est volontaire : on évite qu'un service installé commence à consommer ou à muter des tâches sans exécuteur explicite.

## Déclenchement

Le superviseur combine deux mécanismes :

1. `LISTEN desk_agent_runtime_ready` pour réagir immédiatement aux tâches `PENDING` ou `READY`.
2. un polling de secours via `DESK_AGENT_SUPERVISOR_POLL_MS`, pour couvrir les notifications perdues ou un redémarrage.

La payload PostgreSQL est versionnée par `schema = desk_agent_runtime_ready_v1` et filtrée par `lane`. Un superviseur `live` ne réveille donc pas un worker `replay`.

## Cycle d'exécution

En mode `active`, un cycle fait exactement :

1. vérifie le pool worker déclaré par `DESK_AGENT_WORKER_POOL` ;
2. applique le gate scheduler optionnel si `DESK_AGENT_SCHEDULER_MODE=enforce` ;
3. cherche une tâche éligible dans `agent_tasks` avec `FOR UPDATE SKIP LOCKED`, filtrée par les `task_type_patterns` du pool ;
4. applique le claim domaine avec `worker_id + lease_token` ;
5. insère le lease et l'event `AGENT_TASK_CLAIMED` ;
6. résout l'affinité conversationnelle si le repository le supporte ;
7. résout l'`execution_policy` et son snapshot si le repository le supporte ;
8. lance le runner configuré en lui transmettant tâche, lease, conversation, policy et pool sur `stdin` ;
9. complète la tâche si le runner retourne un JSON valide `ok=true` ;
10. enregistre une métrique de run avec latence, tokens, coût, conversation et policy snapshot ;
11. marque l'échec via `failTask` si le runner échoue ou retourne `ok=false`, puis enregistre l'outcome retry/DLQ.

Le superviseur ne garde pas l'état métier en mémoire. La base PostgreSQL reste la source de vérité.

## Garanties

- Aucun token consommé en `disabled`, en `shadow`, ou en `active` sans runner.
- Une seule tâche claimée par cycle.
- Double-claim bloqué par transaction SQL et `FOR UPDATE SKIP LOCKED`.
- Reprise possible après expiration de lease.
- Completion/failure impossible sans le même `worker_id` et le même `lease_token`.
- Heartbeat écrit dans `desk_service_heartbeats` sous `service_kind = agent_runtime_supervisor`.
- Métriques de run écrites dans `agent_task_run_metrics` quand le repository le supporte.
- Scheduler désactivé par défaut ; en `enforce`, un refus retourne `DEFERRED_BY_SCHEDULER` avant claim et sans token.
- Pool incohérent bloqué avant claim via `POOL_CONFIGURATION_REJECTED`.
- Service inclus dans le kit Windows et dans les contrôles de release/frozen state.

## Variables d'environnement

- `DESK_AGENT_SUPERVISOR_MODE` : `disabled`, `shadow`, `active`.
- `DESK_AGENT_SUPERVISOR_HOST_PLATFORM` : `node-process`, `windows-service`, `systemd`, `container`.
- `DESK_AGENT_SUPERVISOR_LANE` : lane consommée, `live` par défaut.
- `DESK_AGENT_SUPERVISOR_ID` : identité worker stable.
- `DESK_AGENT_WORKER_POOL` : pool de responsabilité (`live`, `replay`, `research`, `validation`, `safety`, `operations`).
- `DESK_AGENT_POOL_POLICY_JSON` : override JSON optionnel des pools, vide par défaut.
- `DESK_AGENT_SUPERVISOR_POLL_MS` : polling fallback.
- `DESK_AGENT_SUPERVISOR_LEASE_SECONDS` : durée de lease.
- `DESK_AGENT_SUPERVISOR_RUNNER_COMMAND` : commande réelle du worker IA.
- `DESK_AGENT_SUPERVISOR_RUNNER_ARGS` : arguments optionnels.
- `DESK_AGENT_SUPERVISOR_RUNNER_TIMEOUT_MS` : timeout du runner.
- `DESK_AGENT_CONVERSATION_PROVIDER` : provider de conversation, `codex` par défaut.
- `DESK_AGENT_CONVERSATION_MAX_TURNS` : limite de reprise avant rotation bornée, `12` par défaut.
- `DESK_AGENT_MODEL` : modèle par défaut transmis à la policy.
- `DESK_AGENT_REASONING_EFFORT` : niveau par défaut, `xhigh` par défaut.
- `DESK_AGENT_TIMEOUT_MS` : timeout par défaut du runner.
- `DESK_AGENT_TOKEN_BUDGET` : budget indicatif transmis au runner.
- `DESK_AGENT_MAX_OUTPUT_TOKENS` : limite de sortie indicative transmise au runner.
- `DESK_AGENT_RETRY_BASE_DELAY_SECONDS` : délai initial avant retry.
- `DESK_AGENT_RETRY_MAX_DELAY_SECONDS` : plafond de backoff.
- `DESK_AGENT_RETRY_MULTIPLIER` : multiplicateur de backoff.
- `DESK_AGENT_RETRY_JITTER_SECONDS` : jitter déterministe optionnel.
- `DESK_AGENT_SCHEDULER_MODE` : `disabled`, `shadow`, `enforce`; `disabled` par défaut.

## Suite

- `TD2-402` ajoute l'affinité conversation/mission pour limiter les redémarrages de contexte.
- `TD2-403` branche le routing modèle/raisonnement/budget et snapshotte la policy effective.
- `TD2-404` durcit les retries, DLQ et reprises opérateur.
- `TD2-405` mesure latence, tokens, coût et résultat par tâche.
- `TD2-406` expose l'administration MCP contrôlée pour lecture, requeue et annulation opérateur.
- `TD2-408` ajoute la priorité Live et les quotas compute via un scheduler déterministe optionnel.
- `TD2-410` isole les pools de workers par responsabilité et expose la vue `get_agent_runtime_pool_overview`.
- `TD2-411` rend le host du supervisor indépendant de l'OS malgré l'adapter Windows initial.
- Les migrations Live/Replay devront être faites en vertical slices, avec non-régression face au moteur Replay validé.
