# Portfolio Execution Reconciliation V1

TD2-704 ajoute une couche de sécurité autour des `OrderIntent` TD2-703.

## Objectif

Avant tout envoi broker réel, le desk doit savoir si l’état exécution est sain :

- pas de double intent concurrent ;
- pas de double envoi après redémarrage ;
- fills partiels suivis ;
- divergence broker/desk mise en état contrôlé.

## Moteur

`evaluatePortfolioExecutionReconciliationV1` consomme :

- `order_intents[]` actifs ;
- `broker_fills[]` ou événements broker normalisés ;
- `target_positions[]` ;
- `broker_positions[]`.

Il retourne `portfolio_execution_reconciliation_v1` avec :

- `intent_audits[]` ;
- `duplicate_issues[]` ;
- `divergences[]` ;
- `controls[]` ;
- `reconciliation_hash`.

## Matrice TD2-704 automatisée

| Scénario | Résultat attendu |
|---|---|
| Redémarrage avec intent actif identique | aucun nouvel ordre, skip `DUPLICATE_INTENT_EXISTS` |
| Deux intents actifs avec même idempotency key | `CONTROLLED_DIVERGENCE` + `HALT_BROKER_SUBMIT` |
| Fill partiel | `FILL_INCOMPLETE`, quantité restante auditable |
| Broker position incompatible avec target + outstanding | `CONTROLLED_DIVERGENCE` |
| Même input rejoué | `reconciliation_hash` stable |

## Règle de divergence

Une divergence est calculée par clé :

```text
account_id + instrument
```

Le moteur compare :

```text
broker_net_size + outstanding_order_delta
```

à :

```text
target_position.net_target_size
```

Ainsi un fill partiel sain n’est pas traité comme une divergence si le restant ouvert permet encore d’atteindre la cible.

## Contrôles

- `WAIT_FOR_FILLS` : état incomplet mais attendu.
- `HALT_BROKER_SUBMIT` : aucun nouvel envoi broker avant réconciliation.
- `RECONCILE_BROKER_SNAPSHOT` : relire provider positions + ordres actifs.
- `OPERATOR_REVIEW` : validation opérateur requise avant reprise.

## Hors périmètre

TD2-704 ne crée pas encore le port provider-neutral complet.

Ce port arrive en P10 / TD2-900.
