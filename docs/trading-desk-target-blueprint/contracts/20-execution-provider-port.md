# Contract — Execution Provider Port

- **But** : convertir un `OrderIntent` approuvé en commande provider-neutral, puis normaliser les événements broker.
- **Producteur** : Execution Gateway.
- **Consommateurs** : provider adapters, réconciliation, audit, front exécution.
- **Invariant** : changer de provider ne modifie ni stratégie, ni risque, ni génération d'`OrderIntent`.

## Commande canonique

| Champ | Type | Requis | Notes |
|---|---:|---:|---|
| `schema_version` | string | oui | `execution_provider_command_v1` |
| `execution_provider_command_id` | string | oui | Dérivé du scope d'idempotence |
| `command_type` | enum | oui | `SUBMIT_ORDER`, `CANCEL_ORDER`, `REPLACE_ORDER`, `MOVE_STOP`, `MOVE_TARGET`, `SYNC_POSITIONS`, `SYNC_ORDERS` |
| `provider_id` | string | oui | Provider cible, neutre |
| `adapter_id` | string | oui | Adaptateur d'exécution |
| `order_intent_id` | string | selon commande | Obligatoire pour `SUBMIT_ORDER` |
| `account_ref` | object | oui | Compte desk + compte provider |
| `contract_ref` | object | oui | Contrat provider |
| `action` | enum | selon commande | `BUY` ou `SELL` |
| `quantity` | integer | selon commande | Contrats entiers |
| `order_type` | string | selon commande | Exemple : `MARKET` |
| `time_in_force` | string | selon commande | Exemple : `DAY` |
| `protection` | object | oui | Stop, target, OCO, slippage |
| `idempotency_key` | string | oui | Anti-double envoi |
| `command_hash` | string | oui | Hash canonique |

## États du plan

| État | Sens |
|---|---|
| `COMMAND_READY` | Commande éligible pour l'adaptateur |
| `BLOCKED` | Entrée incomplète, provider désactivé, halt ou OrderIntent non soumettable |
| `DUPLICATE_PROTECTED` | Une commande active existe déjà avec la même idempotence |
| `UNSUPPORTED_COMMAND` | Type de commande hors contrat |

## Événement provider

| Champ | Type | Requis | Notes |
|---|---:|---:|---|
| `schema_version` | string | oui | `broker_provider_event_v1` |
| `broker_provider_event_id` | string | oui | Dérivé de `external_event_key` |
| `external_event_key` | string | oui | Dédoublonnage adapter/provider |
| `event_type` | enum | oui | Événement normalisé |
| `provider_id` | string | oui | Provider émetteur |
| `order_intent_id` | string | non | Lien si disponible |
| `provider_order_ref` | string | non | Référence provider |
| `fill_quantity` / `fill_price` | number | non | Fills |
| `position_size` | number | non | Position nette provider |
| `occurred_at_utc` | timestamp | oui | Instant provider |
| `payload_hash` | string | oui | Preuve du payload normalisé |
| `event_hash` | string | oui | Hash canonique complet |

## Stockage

La migration `045_execution_provider_port.sql` crée :

- `broker_provider_commands` ;
- `broker_provider_events`.

Ces tables coexistent avec l'outbox et les tables NinjaTrader historiques pendant la transition.

## Addendum TD2-901

L'adaptateur NinjaTrader transitoire est décrit dans `docs/engineering/ninjatrader-provider-adapter-v1.md`.

Il traduit uniquement une commande canonique testée vers le protocole AddOn, puis renvoie les événements AddOn dans `broker_provider_event_v1`. Le reste du desk continue de dépendre du port, pas du protocole NinjaTrader.

## Addendum TD2-904

Les tests de contrat multi-provider sont décrits dans `docs/engineering/execution-provider-multi-provider-contract-v1.md`.

Ils certifient que NinjaTrader et PickMyTrade PAPER consomment la même sémantique `OrderIntent -> ExecutionProviderCommand`, normalisent les événements critiques dans `broker_provider_event_v1`, et bloquent les commandes non implémentées au bord des adapters.

## Addendum TD2-907

Le circuit breaker provider est décrit dans `docs/engineering/execution-provider-circuit-breaker-v1.md`.

Il décide le routage `PRIMARY_READY` / `FALLBACK_READY` / `BLOCKED_*` avant toute traduction adapter. Le fallback cross-provider n'est autorisé que si les preuves connues excluent un double envoi pour le même `order_intent_id`. Toute commande active, position, protection ou erreur provider incertaine bloque le fallback jusqu'à réconciliation ou approbation opérateur explicite selon la politique configurée.

## Addendum TD2-905 / TD2-906

Le shadow cutover provider est décrit dans `docs/engineering/execution-provider-shadow-cutover-v1.md`.

La promotion d'un provider alternatif exige une parité d'événements primaire/shadow, une fenêtre d'observation minimale et un circuit breaker non bloquant. Le retrait de NinjaTrader reste impossible sans certification du remplaçant, approbation opérateur dédiée et preuve de rollback.
