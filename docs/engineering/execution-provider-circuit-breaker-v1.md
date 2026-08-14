# Execution Provider Circuit Breaker V1

TD2-907 ajoute la barrière de routage qui décide si une intention d'ordre peut partir vers le provider primaire ou vers un fallback.

## Objectif

Empêcher le double envoi cross-provider pendant la transition NinjaTrader → PickMyTrade.

Le module ne déclenche aucun ordre. Il produit uniquement un plan déterministe à partir :

- de l'`OrderIntent` ;
- des providers candidats ;
- de l'état de circuit de chaque provider ;
- des commandes provider déjà actives ;
- des événements broker déjà connus ;
- de la politique opérateur de fallback.

## Module domaine

Fichier : `packages/desk-domain/src/execution-provider-circuit-breaker-v1.js`.

Exports principaux :

- `planExecutionProviderCircuitBreakerV1(input)` ;
- `EXECUTION_PROVIDER_ROUTE_STATUSES_V1` ;
- `EXECUTION_PROVIDER_CIRCUIT_STATES_V1` ;
- `EXECUTION_PROVIDER_FALLBACK_MODES_V1`.

## États de routage

| État | Sens |
|---|---|
| `PRIMARY_READY` | Le provider primaire est disponible et aucune preuve d'ordre existant n'est détectée. |
| `FALLBACK_READY` | Le fallback est autorisé par la politique et aucun double envoi n'est possible selon les preuves connues. |
| `BLOCKED_NO_PROVIDER` | Aucun provider actif n'est disponible. |
| `BLOCKED_CIRCUIT_OPEN` | Le provider primaire est ouvert/indisponible et aucun fallback sûr n'est autorisé. |
| `BLOCKED_DOUBLE_SEND_RISK` | Une commande, un ordre, une position ou une protection peut déjà exister pour le même `order_intent_id`. |
| `BLOCKED_RECONCILIATION_REQUIRED` | L'état provider est incertain ; la réconciliation doit trancher avant tout fallback. |
| `BLOCKED_OPERATOR_APPROVAL_REQUIRED` | Le fallback nécessite une validation opérateur explicite. |

## États de circuit

| État | Sens |
|---|---|
| `CLOSED` | Provider utilisable. |
| `HALF_OPEN` | Provider surveillé mais encore utilisable si la politique l'autorise. |
| `OPEN` | Provider indisponible pour une nouvelle soumission primaire. |

## Modes de fallback

| Mode | Effet |
|---|---|
| `DISABLED` | Aucun fallback cross-provider. |
| `OPERATOR_APPROVAL` | Fallback seulement si l'approbation opérateur est présente dans le payload. |
| `AUTOMATIC_SAFE` | Fallback automatique uniquement si les preuves prouvent l'absence de double envoi. |

## Règle anti double envoi

Le circuit breaker bloque tout fallback si le même `order_intent_id` possède :

- une commande provider encore active : `PENDING`, `READY`, `LEASED`, `RENDERED`, `DELIVERED`, `SUBMITTED`, `ACKNOWLEDGED`, `ACCEPTED`, `WORKING`, `PARTIALLY_FILLED` ;
- un événement broker montrant qu'un ordre, une position ou une protection existe : `ORDER_ACCEPTED`, `ORDER_WORKING`, `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `POSITION_UPDATED`, `PROTECTION_UPDATED`.

Les erreurs incertaines (`PROVIDER_ERROR`, `UNKNOWN`, timeout ou échec non prouvé safe) ne déclenchent jamais un fallback direct. Elles retournent `BLOCKED_RECONCILIATION_REQUIRED`.

## Fallback sûr

Un fallback peut être préparé seulement si :

1. le primaire est en circuit `OPEN`, ou le provider primaire a renvoyé un rejet terminal sûr ;
2. aucun ordre/position/protection n'existe pour le même `order_intent_id` ;
3. la politique de fallback l'autorise ;
4. en mode `OPERATOR_APPROVAL`, l'approbation opérateur est explicite.

## Preuve de test

```bash
node --test \
  packages/desk-domain/test/execution-provider-circuit-breaker-v1.test.js \
  packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js \
  packages/desk-domain/test/execution-provider-port-v1.test.js \
  packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js \
  packages/desk-domain/test/pickmytrade-provider-adapter-v1.test.js
```

Cette preuve couvre le routage primaire, le fallback automatique, l'approbation opérateur, le blocage double-send, l'incertitude provider et le retour au primaire.
