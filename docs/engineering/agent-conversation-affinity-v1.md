# Agent Conversation Affinity V1

> Ticket : `TD2-402`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Conversation Affinity V1` généralise la reprise bornée des conversations IA pour le futur runtime multi-agent.

Objectif : un worker peut reprendre le même fil quand il traite la même mission/scope, mais PostgreSQL reste la source de vérité. La conversation n'est qu'un contexte de travail optimisé.

## Contrats

- Module domaine : `packages/desk-domain/src/agent-conversation-affinity-v1.js`.
- Repository : `mcp_gpt_desk/src/agent-runtime-postgres-repository.js`.
- Superviseur : `mcp_gpt_desk/src/agent-runtime-supervisor.js`.
- Migration : `infra/postgres/init/039_agent_conversation_affinity.sql`.

## Affinity key

La clé d'affinité par défaut est stable et scoped :

`provider:lane:mission_id:scope`

Elle empêche de reprendre par erreur un fil d'une autre mission, d'une autre lane ou d'un autre type de tâche.

## Modes

| Mode | Déclencheur | Action |
| --- | --- | --- |
| `CREATED` | aucune conversation ouverte compatible | création d'une nouvelle conversation |
| `RESUMED` | conversation ouverte compatible sous limite de tours | reprise + incrément de `turn_count` |
| `ROTATED` | conversation trouvée mais limite/dérive atteinte | ancienne conversation en `ROTATING`, nouvelle conversation créée |

La limite par défaut est `12` tours, pilotée par `DESK_AGENT_CONVERSATION_MAX_TURNS`.

## Rotation

Une rotation est forcée si :

- `turn_count >= max_turns` ;
- `runtime_hash` ne correspond plus à la policy ;
- `contract_hash` ne correspond plus à la policy.

La nouvelle conversation conserve dans `metadata` :

- `previous_conversation_id` ;
- `rotation_reason`.

## Flux superviseur

En mode `active`, après le claim :

1. le superviseur demande au repository une conversation pour la tâche ;
2. le repository verrouille la mission, planifie `CREATED/RESUMED/ROTATED`, puis attache `agent_conversation_id` à `agent_tasks` ;
3. le runner reçoit `conversation` avec le mode et le `external_conversation_ref` disponible ;
4. si le runner retourne un `thread_id`, le repository met à jour `external_conversation_ref`.

Le contenu de la conversation n'est jamais stocké dans PostgreSQL.

## Garanties

- Une seule conversation `OPEN` par `mission + provider + affinity_key`.
- La conversation ne peut pas compléter/fail une tâche : seul `worker_id + lease_token` le peut.
- Un changement de contrat/runtime déclenche une rotation au lieu de reprendre silencieusement.
- Le runner peut optimiser son contexte, mais doit relire l'état métier depuis les références de tâche.

## Suite

- `TD2-403` utilisera le Prompt Registry pour injecter modèle, raisonnement et budgets dans cette politique.
- `TD2-405` mesurera coût, latence, tokens, mode conversation et résultat.
