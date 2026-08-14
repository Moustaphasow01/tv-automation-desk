# Point-in-Time Feature Catalog — TD2-208

TD2-208 publie le catalogue initial des features déterministes que le desk peut exposer aux simulations, au live, aux agents et au front.

La règle principale : une feature n’existe pas seulement par son nom. Elle doit exposer sa version, ses datasets, son cutoff, sa formule, son hash et son contrat point-in-time.

## Commandes

Résumé opérateur :

```bash
npm run catalog:features
```

Depuis le MCP :

```bash
npm --prefix mcp_gpt_desk run feature:catalog -- --summary
```

## Features publiées

| Feature | Catégorie | Sortie | Rôle |
|---|---|---|---|
| `wilder_atr_14` | `volatility` | `SERIES` | volatilité/risk sizing |
| `rsi_wilder_14` | `momentum` | `SERIES` | filtre momentum |
| `session_vwap` | `price` | `SERIES` | ancre de session |
| `volume_profile_poc` | `volume_profile` | `SCALAR` | acceptation volume |
| `volume_profile_vah` | `volume_profile` | `SCALAR` | borne haute value area |
| `volume_profile_val` | `volume_profile` | `SCALAR` | borne basse value area |
| `developing_volume_profile` | `volume_profile` | `MAP` | POC/VAH/VAL developing au cutoff |
| `initial_balance_range` | `session_structure` | `MAP` | structure début session |
| `overnight_high_low` | `session_structure` | `MAP` | contexte overnight |
| `prior_day_week_levels` | `session_structure` | `MAP` | niveaux prior day/week |
| `realized_volatility` | `volatility` | `SERIES` | volatilité réalisée sur rendements |
| `downside_semivariance` | `volatility` | `SERIES` | asymétrie de risque |
| `intermarket_mnq_mes_spread` | `intermarket` | `SERIES` | confirmation MNQ/MES |
| `rolling_correlation_beta` | `intermarket` | `MAP` | corrélation/beta roulants |
| `cross_asset_risk_state` | `cross_asset` | `MAP` | DXY/VIX/taux/or/pétrole |
| `macro_event_blackout_window` | `macro` | `EVENT` | veto macro point-in-time |

## Invariants

- `status=PUBLISHED` impose `formula_hash`, `deterministic=true`, `point_in_time_safe=true`, `published_at_utc`.
- Le dataset minimum est `dataset_v1`.
- Les features marché lisent uniquement des bougies clôturées `<= cutoff`.
- Les features session lisent `market_session_occurrences`.
- Les actuals macro sont invisibles tant que `published_at_utc > cutoff`.
- Les features cross-asset restent point-in-time : aucun prix, taux ou actual macro après cutoff.

## Persistance

Les migrations de catalogue seed :

- `feature_definitions`
- `feature_versions`

`031_feature_initial_point_in_time_catalog.sql` publie les 10 features initiales.
`054_data_engine_extended_point_in_time_features.sql` ajoute les features Lot011 : RSI, developing volume profile, prior day/week, realized volatility, downside semivariance et rolling correlation/beta.

Elles sont idempotentes et conservent une version publiée `1.0.0` par feature.

## Notes Lot011

- Le `developing_volume_profile` est une approximation déterministe OHLCV (`ohlcv_typical_price_volume_bucket`) tant que le desk ne dispose pas d’un vrai tick/order-flow historique certifié.
- Les features `realized_volatility`, `downside_semivariance`, `rolling_correlation_beta` sont calculées sur rendements de clôture appairés et strictement bornés au cutoff.
- Les capacités tick/bid/ask/open interest restent certifiées par le profilage `market_data_capability_profiles` et ne deviennent pas bloquantes tant que le provider ne les fournit pas.

## Accès API

Les métadonnées sont déjà exposées via :

```text
GET /api/v1/data-foundation/features
GET /api/v1/data-foundation/feature-computations
GET /api/v1/data-foundation/feature-values
```

Le front et les agents peuvent donc lire le lineage sans accéder directement à la base.
