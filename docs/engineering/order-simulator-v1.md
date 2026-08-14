# Order Simulator V1

> Ticket : `TD2-305`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Order Simulator V1` rend la simulation canonique plus proche d'une exécution réelle sans modifier la responsabilité du moteur stratégique.

Le Strategy DSL décide **quoi surveiller**. Le simulateur d'ordres décide ensuite **comment un ordre serait exécuté** sur les bougies disponibles au cutoff.

## Implémentation

- Module pur : `packages/desk-replay-engine/src/order-simulator-v1.js`.
- Branchement : `packages/desk-replay-engine/src/canonical-simulation-engine-v1.js`.
- Artifact scellé : `ORDER_SIMULATION_POLICY` dans `simulation_run_artifacts`.
- Migration additive : `infra/postgres/init/033_order_simulation_policy_artifact_kind.sql`.

## Policy versionnée

La policy normalisée est `order_simulation_policy_v1`.

Champs supportés :

- `spread_points` ;
- `slippage_points` ;
- `commission_r_per_contract` ;
- `entry_latency_rows` ;
- `exit_latency_rows` ;
- `gap_policy` : `FILL_AT_TRIGGER_PRICE` ou `FILL_AT_OPEN_IF_THROUGH_PRICE` ;
- `ambiguous_intrabar_policy` : `REVIEW_REQUIRED`, `CONSERVATIVE_STOP`, `FAVORABLE_TARGET`, `OHLC_DISTANCE` ;
- `partial_fill_enabled`, `partial_fill_ratio`, `minimum_fill_quantity`.

Par défaut, `spread/slippage/commission = 0` et `gap_policy = FILL_AT_TRIGGER_PRICE`. Ce choix préserve la parité des résultats existants. Les hypothèses plus réalistes doivent être activées explicitement par les paramètres de simulation.

## Ordres couverts

- `MARKET` ;
- `LIMIT` ;
- `STOP` ;
- `STOP_LIMIT`.

Le simulateur gère aussi :

- fill au prix d'ouverture si le gap traverse le trigger, quand la policy l'autorise ;
- partial fills déterministes ;
- cancel/replace horodatés ;
- ambiguïtés intrabar stop + target sans invention silencieuse.

## Résultat canonique

Chaque position peut porter :

- `entry_order`, `entry_fill`, `entry_raw_price`, `entry_commission_r` ;
- `exit_order`, `exit_fill`, `exit_raw_price` ;
- `gross_r`, `execution_cost_r`, `r_result`.

Les coûts de commission sont retirés du `r_result`. Le spread et le slippage sont intégrés dans les prix d'exécution.

## Invariant important

Si stop et target sont touchés dans la même bougie, le comportement par défaut reste `REVIEW_REQUIRED`. On évite ainsi de fabriquer une trajectoire intrabar inexistante. Une policy de stress test peut choisir `CONSERVATIVE_STOP`, `FAVORABLE_TARGET` ou `OHLC_DISTANCE`, mais cette hypothèse est alors visible dans l'artifact `ORDER_SIMULATION_POLICY`.
