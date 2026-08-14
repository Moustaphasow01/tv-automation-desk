# Execution Provider Port V1

TD2-900 introduit le port provider-neutral entre les `OrderIntent` approuvés et les adaptateurs broker.

## Objectif

Découpler le desk de NinjaTrader sans changer la chaîne stratégique :

```text
Strategy Signal → Candidate Allocation → Risk Budget → Target Position → OrderIntent → Execution Provider Port → Provider Adapter
```

Le port ne décide pas l'opportunité et ne recalcule pas le risque. Il transforme un `OrderIntent` déjà autorisé en commande canonique, puis normalise les événements remontés par le provider.

## Contrats domaine

Module : `packages/desk-domain/src/execution-provider-port-v1.js`.

Exports principaux :

- `buildExecutionProviderCommandV1(input)` ;
- `normalizeBrokerProviderEventV1(input)` ;
- `EXECUTION_PROVIDER_COMMAND_TYPES_V1` ;
- `BROKER_PROVIDER_EVENT_TYPES_V1`.

### Commande provider-neutral

`execution_provider_command_v1` contient :

- `command_type` : `SUBMIT_ORDER`, `CANCEL_ORDER`, `REPLACE_ORDER`, `MOVE_STOP`, `MOVE_TARGET`, `SYNC_POSITIONS`, `SYNC_ORDERS` ;
- `provider_id` et `adapter_id` ;
- `order_intent_id` source ;
- `account_ref` ;
- `contract_ref` ;
- action, quantité, type d'ordre, durée de validité ;
- protections stop/target/slippage ;
- `idempotency_key` et `command_hash`.

Le plan `execution_provider_port_v1` peut retourner :

- `COMMAND_READY` si la commande est éligible ;
- `BLOCKED` si le provider, le contrat, l'account ou l'OrderIntent ne sont pas soumis ;
- `DUPLICATE_PROTECTED` si une commande active existe déjà pour la même idempotence ;
- `UNSUPPORTED_COMMAND` si le type de commande est hors contrat.

### Événement broker normalisé

`broker_provider_event_v1` normalise les événements adapter en :

- `ORDER_ACCEPTED` ;
- `ORDER_REJECTED` ;
- `ORDER_WORKING` ;
- `ORDER_CANCELLED` ;
- `ORDER_FILLED` ;
- `ORDER_PARTIALLY_FILLED` ;
- `POSITION_UPDATED` ;
- `ACCOUNT_UPDATED` ;
- `PROTECTION_UPDATED` ;
- `PROVIDER_HEARTBEAT` ;
- `PROVIDER_ERROR`.

Chaque événement a une `external_event_key` déterministe ou fournie par l'adaptateur, plus `payload_hash` et `event_hash`.

## PostgreSQL

Migration : `infra/postgres/init/045_execution_provider_port.sql`.

Tables :

- `broker_provider_commands` : file neutre des commandes provider ;
- `broker_provider_events` : ledger neutre des événements broker.

Les tables appartiennent au bounded context `execution`.

## Frontière de sécurité

Le port :

- ne lit pas les prompts ;
- ne peut pas être appelé directement par un LLM ;
- ne crée pas de `OrderIntent` ;
- ne contourne pas l'Execution Gateway ;
- ne contient aucune commande spécifique à un adapter.

Les adaptateurs spécifiques, dont NinjaTrader pendant la transition, consommeront cette commande canonique dans TD2-901+.
