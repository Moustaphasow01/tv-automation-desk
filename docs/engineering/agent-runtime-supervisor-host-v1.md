# Agent Runtime Supervisor Host V1

> Ticket : `TD2-411`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Runtime Supervisor Host V1` sépare le supervisor applicatif de l'OS qui l'héberge.

Le desk reste aujourd'hui déployé sur Windows Server via WinSW, mais le runtime ne doit pas devenir prisonnier de Windows. Le module host fournit donc une configuration portable que l'on peut réutiliser demain depuis :

- un service Windows ;
- `systemd` sur Linux ;
- un conteneur ;
- un simple processus Node local.

## Placement

- Config host portable : `mcp_gpt_desk/src/agent-runtime-supervisor-host.js`.
- Supervisor applicatif : `mcp_gpt_desk/src/agent-runtime-supervisor.js`.
- CLI Node : `mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs`.
- Adapter Windows : `deploy/windows/services/DeskAgentRuntimeSupervisor.xml.template`.

Le domaine `packages/desk-domain` ne connaît toujours pas Windows.

## Host platforms

Valeurs supportées :

- `node-process` : défaut portable, utile en local/dev/test.
- `windows-service` : adapter VPS Windows actuel.
- `systemd` : cible Linux future.
- `container` : cible Docker/Kubernetes future.

Une valeur inconnue retombe sur `node-process`.

## Invariants

- Le parsing env/argv est testé sans Windows.
- Les secrets d'environnement ne sont pas projetés dans les heartbeats.
- Le runner reste optionnel tant que le supervisor est en `shadow`.
- Le comportement d'exécution reste dans `AgentRuntimeSupervisorService`.
- Le script CLI assemble seulement les adapters réels : PostgreSQL, notifications, lock, signaux process et runner CLI.

## Variables

- `DESK_AGENT_SUPERVISOR_HOST_PLATFORM=windows-service` dans le template VPS actuel.
- `DESK_AGENT_SUPERVISOR_LANE`, `DESK_AGENT_WORKER_POOL`, `DESK_AGENT_SUPERVISOR_ID` restent portables.
- `DESK_AGENT_SUPERVISOR_PROJECT_ROOT` reste un chemin d'exécution, pas une hypothèse Windows.

## Migration future

Pour Linux/systemd :

1. conserver `mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs` ;
2. remplacer uniquement le manifeste WinSW par une unité systemd ;
3. définir `DESK_AGENT_SUPERVISOR_HOST_PLATFORM=systemd` ;
4. garder les mêmes variables `lane`, `worker_pool`, `runner`, `scheduler_mode`.

Pour conteneur :

1. utiliser le même script en entrypoint ;
2. définir `DESK_AGENT_SUPERVISOR_HOST_PLATFORM=container` ;
3. injecter `DATABASE_URL`, `DESK_AGENT_*`, secrets et healthchecks via l'orchestrateur.

## Tests

- `mcp_gpt_desk/test/agent_runtime_supervisor_host.test.js`.
- `node --check mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs`.
- Tests supervisor existants, sans Windows.
