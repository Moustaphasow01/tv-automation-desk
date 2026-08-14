# PickMyTrade Provider Adapter V1

TD2-903 ajoute un pont PickMyTrade limité au mode `PAPER_ONLY`.

## Objectif

Permettre un pilote d'exécution paper sans réintroduire TradingView dans le chemin principal :

```text
OrderIntent approuvé → ExecutionProviderCommand → PickMyTrade webhook envelope
PickMyTrade status/callback → BrokerProviderEvent
```

Le desk garde la vérité métier : stratégie, risque, idempotence, stops, targets et réconciliation restent dans le domaine `execution`.

## Module

`packages/desk-domain/src/pickmytrade-provider-adapter-v1.js`

Exports :

- `adaptExecutionProviderCommandToPickMyTradeWebhookV1(input)` ;
- `adaptPickMyTradeWebhookEventToBrokerProviderEventV1(input)` ;
- `PICKMYTRADE_EXECUTION_MODES_V1`.

## Slice couvert

Cette tranche couvre uniquement :

- `SUBMIT_ORDER` ;
- mode `PAPER_ONLY` ;
- compte provider explicite ;
- symbole provider explicite ;
- quantité entière positive ;
- action `BUY` ou `SELL` ;
- stop loss, take profit et OCO obligatoires ;
- enveloppe de transport `POST application/json` sans secret ;
- normalisation des statuts entrants vers `broker_provider_event_v1`, dont fill, reject, protection, account, position et heartbeat.

Les commandes `CANCEL_ORDER`, `MOVE_STOP`, `MOVE_TARGET`, `SYNC_ORDERS` et `SYNC_POSITIONS` restent hors tranche tant qu'elles ne sont pas couvertes par un contrat fournisseur vérifié et des tests de réconciliation.

## Sécurité

L'adapter est fail-closed :

- tout mode autre que `PAPER_ONLY` bloque ;
- aucun token, clé API, mot de passe ou bearer ne peut entrer dans l'adapter domaine ;
- une URL webhook avec user info, query string ou fragment est bloquée ;
- aucune enveloppe n'est produite sans stop et target ;
- aucune enveloppe n'est produite si OCO est explicitement désactivé ;
- aucune requête réseau n'est effectuée par le package domaine.

Les secrets et l'appel HTTP appartiennent à un adapter infrastructure séparé.

## Limite assumée

PickMyTrade reste un pont externe à observabilité limitée. Tant que les callbacks ack/reject/fill/position, l'idempotence, les limites de débit et le mapping bracket n'ont pas été prouvés en environnement paper, il ne devient pas provider primaire et ne remplace pas la réconciliation interne.

## Tests

Preuves unitaires :

- mapping d'une commande provider-neutral vers enveloppe paper ;
- blocage d'un mode live ;
- blocage de matériel sensible dans l'input ;
- normalisation d'un statut PickMyTrade en `broker_provider_event_v1`.

Commande ciblée :

```bash
node --test packages/desk-domain/test/pickmytrade-provider-adapter-v1.test.js packages/desk-domain/test/execution-provider-port-v1.test.js packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js
```
