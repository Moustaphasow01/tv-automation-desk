# Simulation Metrics V2

> Ticket : `TD2-306`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Simulation Metrics V2` rend les performances du replay déterministes, versionnées et consommables par le front sans recalcul ad hoc.

Le front doit lire `metrics` depuis le résultat canonique ou depuis l'artifact `METRICS` du Run Registry. Il ne doit pas recalculer la vérité métier à partir des logs.

## Implémentation

- Module pur : `packages/desk-replay-engine/src/simulation-metrics-v1.js`.
- Export package : `buildVersionedSimulationMetricsV1`.
- Branchement canonique : `buildMetrics(positions, { rows })` dans `canonical-simulation-result-v1.js`.
- Tests : `packages/desk-replay-engine/test/simulation-metrics.test.js`.

## Version

- `schema_version` : `canonical_simulation_metrics_v1`.
- `metric_definition_id` : `desk_simulation_metrics_core_v2`.
- `metric_version` : `2.0.0`.

Le suffixe `v2` indique une évolution de définition, pas une nouvelle enveloppe incompatible.

## Métriques calculées

- `total_r`, `gross_r`, `execution_cost_r`, `final_equity_r` ;
- `trade_count`, `open_position_count`, `win_count`, `loss_count`, `win_rate` ;
- `profit_factor`, `expectancy_r`, `average_win_r`, `average_loss_r` ;
- `max_drawdown_r`, `sharpe_r`, `sortino_r`, `calmar_r` ;
- `mae_r`, `mfe_r`, `max_adverse_excursion_r`, `max_favorable_excursion_r` ;
- `exposure.bars`, `exposure.ratio`.

## Segmentations

Les segments sont calculés côté backend :

- `by_instrument` ;
- `by_direction` ;
- `by_session` ;
- `by_date` ;
- `by_exit_reason`.

Chaque segment expose un résumé déterministe : `trade_count`, `total_r`, `win_rate`, `profit_factor`, `max_drawdown_r`, `expectancy_r`.

## Anti-lookahead

Les MAE/MFE et l'exposition utilisent uniquement les rows déjà filtrées par cutoff dans le moteur canonique. Les bougies futures ignorées par `data_quality.ignored_post_cutoff_rows` ne participent donc pas aux excursions ni aux métriques.

## Invariant produit

Le Replay Lab et Performance doivent afficher les métriques persistées. Si un écran a besoin d'une nouvelle métrique, elle doit être ajoutée ici puis scellée dans l'artifact `METRICS`.
