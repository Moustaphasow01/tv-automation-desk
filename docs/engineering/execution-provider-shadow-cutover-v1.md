# Execution Provider Shadow Cutover V1

TD2-905 livre la brique de décision qui prépare une bascule provider sans double envoi.

Elle ne passe aucun ordre et ne bascule aucun provider par elle-même. Elle évalue les preuves avant qu'un runtime applicatif puisse décider de promouvoir ou rollbacker.

## Périmètre

Module : `packages/desk-domain/src/execution-provider-shadow-cutover-v1.js`.

Fonctions :

- `evaluateExecutionProviderShadowCutoverV1(input)` ;
- `planNinjaTraderRetirementV1(input)`.

## Shadow cutover

Le rapport `execution_provider_shadow_cutover_v1` compare :

- les événements du provider primaire ;
- les événements du provider shadow/fallback ;
- l'état du circuit breaker TD2-907 ;
- la fenêtre minimale d'observation.

Statuts :

| Statut | Sens |
|---|---|
| `SHADOW_OBSERVING` | Les preuves sont cohérentes mais la durée/quantité d'observation est insuffisante. |
| `CUTOVER_READY` | Les événements primaire/shadow sont équivalents, le circuit breaker est sûr et l'observation minimale est satisfaite. |
| `CUTOVER_BLOCKED` | Divergence provider ou circuit breaker bloquant. |
| `ROLLBACK_REQUIRED` | Un cutover déjà engagé doit revenir au provider sûr précédent. |

## Retrait NinjaTrader

Le plan `ninjatrader_retirement_plan_v1` bloque tout retrait tant que :

- le provider de remplacement n'est pas certifié ;
- l'approbation opérateur explicite `APPROVE_NINJATRADER_RETIREMENT` est absente ;
- il reste des références directes NinjaTrader non enveloppées ;
- le rollback runtime n'est pas prouvé.

Ce ticket ne supprime donc pas NinjaTrader. Il rend sa suppression vérifiable et impossible à faire implicitement.

## Preuve de test

```bash
node --test \
  packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js \
  packages/desk-domain/test/execution-provider-circuit-breaker-v1.test.js \
  packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js
```

Cas couverts :

- observation shadow insuffisante ;
- cutover prêt après parité provider ;
- blocage sur divergence shadow ;
- rollback sur circuit breaker unsafe ;
- retrait NinjaTrader bloqué sans certification, approbation et rollback.
