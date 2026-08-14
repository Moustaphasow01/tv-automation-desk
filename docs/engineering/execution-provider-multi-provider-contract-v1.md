# Execution Provider Multi-Provider Contract V1

TD2-904 certifie que les providers d'exécution couverts par P10 respectent le même contrat domaine.

## Providers couverts

| Provider | Adapter | Mode |
|---|---|---|
| NinjaTrader | `ninjatrader-addon` | transition paper/simulation |
| PickMyTrade | `pickmytrade-webhook` | `PAPER_ONLY` uniquement |

## Contrat vérifié

La suite `packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js` vérifie :

- une même intention d'ordre conserve action, quantité, type d'ordre, TIF, stop, target et OCO après traduction provider-specific ;
- le `ExecutionProviderCommand` ne fuit pas les détails d'adapter : pas de webhook dans la commande neutre, pas de `Sim101` dans la commande PickMyTrade ;
- l'idempotence bloque une deuxième soumission sur le même provider ;
- les scopes providers restent distincts pour éviter qu'un provider actif masque silencieusement l'autre ;
- les événements fill, reject, protection et heartbeat/reconnection sont normalisés en `broker_provider_event_v1` ;
- les commandes non encore implémentées (`MOVE_STOP`, `MOVE_TARGET`, `CANCEL_ORDER`, `SYNC_POSITIONS`) restent bloquées au bord de chaque adapter.

## Limites assumées

TD2-904 ne déclenche aucun ordre, aucun POST webhook et aucun flux live.

Les points suivants restent volontairement hors de ce ticket :

- circuit breaker de sélection provider et fallback sans double envoi : TD2-907 ;
- réconciliation shadow et rollback cutover : TD2-905 ;
- retrait NinjaTrader : TD2-906 ;
- preuve externe que PickMyTrade fournit callbacks/fills/positions complets et durables.

## Commande de preuve

```bash
node --test \
  packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js \
  packages/desk-domain/test/execution-provider-port-v1.test.js \
  packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js \
  packages/desk-domain/test/pickmytrade-provider-adapter-v1.test.js
```
