# AI Context Front Cockpit V1

TD2-805 ajoute la vue opérateur transitoire de l'AI Context Gate.

## Objectif

Rendre visibles les avis contextuels IA sans leur donner de pouvoir d'exécution.

Le cockpit affiche :

- décisions `CONTEXT_DECISION` et `AI_CONTEXT` récentes ;
- mode `SHADOW` / `ADVISORY` / `ENFORCED` ;
- recommandation IA et effet portefeuille projeté ;
- fallbacks déterministes, notamment `WAIT` ;
- modèle, effort de raisonnement, latence, tokens et coût ;
- contrôles de source et dead letters ouvertes.

## Placement

- Backend : `mcp_gpt_desk/src/front-ai-context-projection.js`, bounded context `reporting`.
- REST : `GET /api/v1/ai-context/overview`.
- Front : `src/features/ai-context/*` + `src/pages/AiContextPage.tsx`.

La projection lit uniquement l'agent-runtime réel :

- `agent_tasks` via `listAgentRuntimeTasks` ;
- `agent_task_run_metrics` via `listAgentRuntimeMetrics` ;
- `agent_task_dead_letters` via `listAgentRuntimeDeadLetters`.

Si une source échoue, le contrat retourne `source.status=partial` ou `unavailable` et expose l'erreur. Le front conserve alors un état opérateur réel au lieu d'inventer une décision.

## Responsabilités

Le cockpit est une vue de supervision et d'audit.

Il ne :

- crée pas d'`OrderIntent` ;
- ne crée pas de `TargetPosition` ;
- ne modifie pas le risque portefeuille ;
- ne soumet pas d'ordre broker ;
- ne contourne pas l'Execution Gateway.

Les décisions affichées restent des preuves ou des avis consommables par le Portfolio Arbitration Engine selon sa politique, jamais une commande directe.

## Navigation

La page est exposée dans l'espace Opérations :

- `/operations/ai-context`

Elle complète `Agents IA` et `Portfolio Risk` : le premier montre l'exécution des workers, le second montre l'effet portefeuille, et `AI Context` montre la justification contextuelle et ses fallbacks.

## Critères de vérification

- L'endpoint est reconnu par l'API opérations et reste `GET` only.
- La projection ne fabrique aucune décision si l'agent-runtime n'en contient pas.
- Le ViewModel front reste React-free et API-free.
- Les fallbacks et sources dégradées sont visibles dans les warnings opérateur.
