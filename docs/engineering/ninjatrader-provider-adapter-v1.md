# NinjaTrader Provider Adapter V1

TD2-901 enveloppe NinjaTrader derrière le port provider-neutral TD2-900.

## Objectif

Isoler NinjaTrader comme un adapter remplaçable :

```text
ExecutionProviderCommand → NinjaTrader AddOn Command
NinjaTrader AddOn Event → BrokerProviderEvent
```

Le domaine `strategy`, `portfolio-risk` et `OrderIntent` ne dépend plus directement de la forme NinjaTrader.

## Module

`packages/desk-domain/src/ninjatrader-provider-adapter-v1.js`

Exports :

- `adaptExecutionProviderCommandToNinjaAddonV1(input)` ;
- `adaptNinjaAddonEventToBrokerProviderEventV1(input)`.

## Slice couvert

Cette première tranche couvre :

- commande `SUBMIT_ORDER` vers AddOn entry ;
- restriction explicite aux comptes `Sim*` ;
- exigence d'un template ATM et d'un `atm_strategy_id` ;
- mapping du symbole provider, quantité, side, order type, TIF, stop et target ;
- normalisation des événements AddOn en `broker_provider_event_v1`.
- normalisation d'un statut de commande `protection_updated`, `stop_moved` ou `target_moved` en `PROTECTION_UPDATED`.

Les commandes de management provider-neutral (`MOVE_STOP`, `MOVE_TARGET`, `CANCEL_ORDER`, etc.) restent bloquées par l'adapter tant qu'elles ne sont pas couvertes par des tests de contrat dédiés.

## Sécurité

L'adapter est fail-closed :

- pas de compte live ;
- pas de commande sans protection ;
- pas de commande sans ATM ;
- pas de commande si le type n'est pas explicitement supporté ;
- pas de décision métier ou recalcul de risque.

## Transition

Le service legacy peut continuer à utiliser l'outbox AddOn existante pendant la transition. TD2-901 fournit la traduction contractuelle nécessaire pour que le service bascule progressivement vers `broker_provider_commands` / `broker_provider_events`.
