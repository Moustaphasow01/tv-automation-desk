# Strategy Live Performance Drift V1

TD2-605 ajoute le contrat minimal de détection de dérive entre une baseline validée et les observations réelles d’une `Strategy Instance`.

## Objectif

Le desk doit pouvoir signaler rapidement qu’une stratégie qui semblait valide en simulation ou en replay ne se comporte plus pareil en `SHADOW`, `PAPER` ou `LIVE`.

La détection ne décide pas seule d’un arrêt définitif. Elle produit une preuve opérable pour :

- alerter l’opérateur ;
- bloquer une promotion automatique ;
- recommander une pause si la dérive est critique ;
- rendre visible la différence entre “pas de données” et “performance réellement dégradée”.

## Sources attendues

| Donnée | Source cible | Source transitoire |
|---|---|---|
| Baseline | `strategy_versions.metadata.performance_baseline` | `baseline_metrics`, `validated_metrics` |
| Observé | table métriques runtime future | `strategy_instances.metadata.performance_observed`, `paper_metrics`, `shadow_metrics`, `live_metrics` |
| Projection front | `/api/v1/strategy-v2/overview` | `StrategyV2Overview.instances` |

Le front ne fabrique aucune métrique : si baseline ou observations sont absentes, il affiche explicitement `Baseline absente` ou `Observation insuff.`.

## Statuts

| Statut | Sens opérateur |
|---|---|
| `OK` | L’observé reste aligné à la baseline |
| `WATCH` | Dérive visible mais non critique |
| `DRIFT` | Dérive critique, pause/revue recommandée |
| `BASELINE_MISSING` | Impossible de comparer, baseline absente |
| `INSUFFICIENT_DATA` | Observations absentes ou échantillon insuffisant |

## Métriques comparées

- nombre de trades ;
- performance totale en R ;
- expectancy en R ;
- win rate ;
- profit factor ;
- max drawdown en R.

La politique par défaut est volontairement conservatrice :

- warning si `total_r` perd au moins `2 R`, expectancy perd `0.25 R`, drawdown empire de `1.5 R` ou trade frequency tombe sous 50 % ;
- critique si `total_r` perd au moins `4 R`, expectancy perd `0.5 R`, drawdown empire de `3 R` ou trade frequency tombe sous 25 %.

## Contrat domaine

Le moteur pur est exposé dans `packages/desk-domain/src/strategy-live-performance-drift-v1.js` :

```js
buildStrategyLivePerformanceDriftReportV1({
  strategy_instance_id,
  strategy_version_id,
  execution_mode,
  baseline_metrics,
  observed_metrics,
  policy
})
```

Il retourne un rapport hashé avec :

- `schema_version`;
- `status`;
- `severity`;
- `baseline`;
- `observed`;
- `comparisons`;
- `reasons`;
- `gate`.

## Front transitoire

La page `/strategies` affiche une colonne `Dérive live` dans le tableau des instances.

Priorité de lecture :

1. `instance.performance_drift` si le back fournit déjà un rapport complet ;
2. calcul transitoire depuis `metadata.performance_baseline` et les métriques observées ;
3. état explicite “baseline absente” ou “observation insuffisante”.

Cette étape prépare la table/runtime métriques future sans bloquer l’usage immédiat.
