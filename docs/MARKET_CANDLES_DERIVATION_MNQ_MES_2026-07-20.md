# Rattrapage local MNQ/MES 15m/1H — 2026-07-20

Objectif : combler localement les feeds MNQ/MES `15m` et `1H` qui s’arrêtaient côté source Firestore au `2026-07-03`, sans modifier Firebase/GCloud.

## Stratégie

Les candles ont été dérivées depuis les feeds locaux `5m`, car ils offrent une meilleure couverture effective que les feeds `1m` pour cette fenêtre.

Règles de dérivation :

- `15m` = bucket complet de `3` candles `5m` ;
- `1H` = bucket complet de `12` candles `5m` ;
- aucune candle existante n’est écrasée ;
- les buckets partiels sont ignorés ;
- les candles dérivées sont traçables via `source_collection = derived:*` et `raw.schema_version = local-derived-v1` ;
- les feeds cibles sont marqués `status = derived_local` avec metadata `local_derivation`.

## Résultat

| Feed cible | Candles avant | Candles ajoutées | Candles après | Dernière candle |
|---|---:|---:|---:|---|
| `prod__tradingview__MNQ1!__15` | 260 | 916 | 1 176 | `2026-07-17 20:45 UTC` |
| `prod__tradingview__MNQ1!__1H` | 65 | 228 | 293 | `2026-07-17 20:00 UTC` |
| `prod__tradingview__MES1!__15` | 260 | 916 | 1 176 | `2026-07-17 20:45 UTC` |
| `prod__tradingview__MES1!__1H` | 65 | 228 | 293 | `2026-07-17 20:00 UTC` |

Total ajouté : `2 288` candles.

Buckets partiels ignorés : `10`.

Total local `market_candles` après rattrapage : `65 517`.

Quarantine : `0`.

## Contrôle runtime

Lecture validée via `PostgresDeskPersistence` sur la fenêtre `2026-07-17T20:00:00Z → 2026-07-17T21:00:00Z` :

| Feed | Candles lues | Dernière candle | Dernier close |
|---|---:|---|---:|
| `prod__tradingview__MNQ1!__15` | 4 | `2026-07-17T20:45:00.000Z` | 28768.75 |
| `prod__tradingview__MNQ1!__1H` | 1 | `2026-07-17T20:00:00.000Z` | 28768.75 |
| `prod__tradingview__MES1!__15` | 4 | `2026-07-17T20:45:00.000Z` | 7495 |
| `prod__tradingview__MES1!__1H` | 1 | `2026-07-17T20:00:00.000Z` | 7495 |

## Audit après rattrapage

Le nouvel audit qualité confirme :

- hot scope attendu : `30` feeds ;
- hot scope alimenté : `30` feeds ;
- candles auditées : `65 517` ;
- OHLC invalide : `0` ;
- feeds dérivés localement : `4` ;
- feeds stale bloquants côté source : `0` ;
- feeds manquants assumés : `2` (`NQ1!__5`, `ES1!__5`).

Décision métier : `NQ1!__5` et `ES1!__5` ne sont pas considérés comme stale bloquants pour l’instant, car les timeframes principaux NQ/ES restent disponibles.

Les feeds `MNQ/MES 1H` sont `DERIVED_OK`.

Les feeds `MNQ/MES 15m` restent en `REVIEW` uniquement à cause d’un micro-trou hérité du `5m` source autour du `2026-07-16 09:30→10:00 UTC`.

## Rapports JSON

- [MARKET_CANDLES_DERIVATION_MNQ_MES_DRY_RUN_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_DERIVATION_MNQ_MES_DRY_RUN_2026-07-20.json)
- [MARKET_CANDLES_DERIVATION_MNQ_MES_IMPORT_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_DERIVATION_MNQ_MES_IMPORT_2026-07-20.json)
- [MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.md](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.md)
- [MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.json)
