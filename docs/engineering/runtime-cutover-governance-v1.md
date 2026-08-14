# Runtime Cutover Governance V1

TD2-1100, TD2-1101, TD2-1102, TD2-1103, TD2-1104 et TD2-1105 ajoutent les décisions déterministes de cutover programme.

TD2-1104 n'est plus une exclusion de scope : la refonte Front V3/VNext a été lancée comme application isolée `apps/desk-control-plane`, branchée au BFF réel `/front-api/v1`, avec guards anti-legacy et anti-mock silencieux. Le gate final doit donc bloquer sur les tickets réellement ouverts ou les guards en échec, pas sur une exclusion obsolète.

## Module

Fichier : `packages/desk-domain/src/runtime-cutover-governance-v1.js`.

Fonctions :

- `evaluateRuntimeComparisonV1(input)` ;
- `planStrategyInstanceCutoverV1(input)` ;
- `authorizeLiveActivationV1(input)` ;
- `planGptFirstLegacyRetirementV1(input)` ;
- `auditArchitectureProgramClosureV1(input)`.

## TD2-1100 — comparaison runtime

`runtime_comparison_v1` compare ancien runtime et runtime cible sur le même scope :

- même fenêtre ;
- même dataset ;
- écart net R borné ;
- écart de nombre de trades borné ;
- erreur runtime cible sous seuil ;
- shadow cutover prêt.

Sans ces preuves, le statut reste `COMPARISON_BLOCKED`.

## TD2-1101 — cutover par Strategy Instance

`strategy_instance_cutover_plan_v1` verrouille la bascule sur une seule `strategy_instance_id`.

Le plan produit :

- `scope_lock_key` par instance ;
- flags `legacy_runtime_enabled`, `target_runtime_enabled`, `live_submit_enabled` ;
- rollback vers le stage précédent ;
- blocage si un double-send est détecté.

## TD2-1102 — autorisation LIVE séparée

`live_activation_authorization_v1` bloque tout LIVE tant que l'approbation opérateur n'est pas :

- explicite : `APPROVE_LIVE` ;
- scellée sur la bonne `strategy_instance_id` ;
- liée à un compte et un provider ;
- non expirée ;
- dans la limite de risque configurée.

Cette brique n'active aucun live. Elle empêche seulement toute activation implicite.

## TD2-1103 — retrait GPT-first/legacy

`gpt_first_retirement_plan_v1` garde le retrait legacy bloqué tant que :

- l'observation minimale n'est pas atteinte ;
- des workflows legacy restent actifs ;
- des chemins d'ordre directs restent actifs côté LLM, MCP, frontend ou scripts ;
- la couverture de remplacement n'est pas complète ;
- le rollback n'est pas prouvé ;
- l'approbation opérateur `APPROVE_GPT_FIRST_RETIREMENT` est absente.

## TD2-1105 — clôture architecture

`architecture_closure_audit_v1` agrège les guards, exceptions actives, tickets ouverts et exclusions.

La clôture complète retourne `CLOSURE_BLOCKED` tant qu'un ticket programme reste ouvert, qu'une dérogation active existe, qu'un guard échoue ou qu'une exclusion volontaire reste déclarée. TD2-1104 doit être traité comme livré au niveau socle VNext ; les blocages attendus viennent désormais de TD2-1103/TD2-1105 et des preuves runtime.

## Preuve de test

```bash
node --test packages/desk-domain/test/runtime-cutover-governance-v1.test.js
```

Cas couverts :

- comparaison ancien/nouveau runtime ;
- cutover isolé par instance ;
- LIVE bloqué sans approbation explicite ;
- retrait GPT-first bloqué sans observation/coverage/approval ;
- clôture finale bloquée si un ticket programme reste ouvert ou si une exclusion volontaire reste déclarée.
