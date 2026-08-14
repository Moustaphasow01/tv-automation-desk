# Research Agent Role Catalog V1 — TD2-505

## Objectif

`TD2-505` formalise les neuf rôles IA du Research Lab. Le catalogue sert de source canonique pour créer les futures missions/tâches Agent Runtime sans donner à un agent research la moindre capacité broker.

## Placement

- **Bounded context** : `research`.
- **Domaine pur** : `packages/desk-domain/src/research-agent-role-catalog-v1.js`.
- **Consommateurs attendus** : workflows P6 (`TD2-501`, `TD2-502`, `TD2-506`, `TD2-510`) et Agent Runtime.
- **Persistance** : aucune en V1 ; le catalogue est un contrat versionné Git. Les exécutions concrètes restent persistées dans `agent_tasks`, `agent_missions` et `research_*`.

## Rôles V1

| Rôle | ID | Pool | Profil |
|---|---|---|---|
| Research Planner | `research_planner` | `research` | `STANDARD_RESEARCH` |
| Pattern Miner | `pattern_miner` | `research` | `STANDARD_RESEARCH` |
| Strategy Builder | `strategy_builder` | `research` | `DEEP_STRATEGY_REVIEW` |
| Experiment Agent | `experiment_agent` | `research` | `STANDARD_RESEARCH` |
| Backtest Validator | `backtest_validator` | `validation` | `SAFETY_REVIEW` |
| Robustness Auditor | `robustness_auditor` | `validation` | `DEEP_STRATEGY_REVIEW` |
| Regime Analyst | `regime_analyst` | `research` | `STANDARD_RESEARCH` |
| Research Reviewer | `research_reviewer` | `validation` | `SAFETY_REVIEW` |
| Live Performance Monitor | `live_performance_monitor` | `research` | `CONTEXT_DECISION` |

## Garde-fous

Le catalogue interdit explicitement :

- `BROKER_ORDER_SUBMIT`
- `BROKER_ORDER_CANCEL`
- `BROKER_POSITION_MANAGE`
- `ORDER_INTENT_CREATE`
- `EXECUTION_PROVIDER_WRITE`

Même le `Live Performance Monitor` ne peut que recommander une revue ; il ne produit pas d’ordre, ne modifie pas une position et ne bypasse pas Portfolio Risk/Execution.

## Utilisation prévue

- `listResearchAgentRolesV1` expose le catalogue complet ou filtré par pool.
- `resolveResearchAgentRoleV1` résout un rôle par ID stable.
- `authorizeResearchAgentCapabilityV1` vérifie une capability avant de créer/claim une tâche.
- `buildResearchAgentMissionPolicyV1` produit la base de mission consommable par Agent Runtime : `lane`, `worker_pool_id`, `task_type`, `capabilities`, `model_policy`.

## Limites

Le catalogue ne crée pas encore les missions concrètes et ne définit pas le processus scientifique complet. Ces points sont portés par `TD2-501` et `TD2-506`.
