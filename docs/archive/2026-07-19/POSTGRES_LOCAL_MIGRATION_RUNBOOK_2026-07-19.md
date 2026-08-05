# Archive — migration Firestore prod vers PostgreSQL local PREPROD — 2026-07-19

Ce runbook décrit le bootstrap initial terminé. Il ne fait pas partie du
runtime Autopilot V4 local.

## Objectif

Créer une base PostgreSQL locale structurée, puis alimenter PREPROD depuis Firestore prod sans refaire un dump brut.

Principe retenu :

- les données métier Desk restent dans `desk_documents` ;
- les feeds et candles marché vont dans les tables spécialisées ;
- les décisions/trades/broker/NinjaTrader ont leur propre modèle, prêt mais désactivé ;
- les collections bruitées ou legacy sont exclues par défaut.

## Schéma appliqué

Fichiers SQL :

- `infra/postgres/init/001_schema.sql`
- `infra/postgres/init/002_market_import_schema.sql`
- `infra/postgres/init/003_trade_automation_schema.sql`
- `infra/postgres/init/004_reference_seed.sql`

Commande :

```bash
npm run db:schema:apply
```

État vérifié localement :

| Table | Lignes seedées |
|---|---:|
| `market_instruments` | 18 |
| `market_symbols` | 18 |
| `market_timeframes` | 7 |
| `broker_providers` | 1 |
| `broker_accounts` | 2 |
| `broker_contracts` | 4 |

## Routage Firestore → PostgreSQL

| Source Firestore | Cible PostgreSQL |
|---|---|
| `market_feeds/{feed_id}` | `market_feeds` |
| `market_feeds/{feed_id}/candles/{doc_id}` | `market_candles` |
| `live_data_feed_status/{doc_id}` | `market_feed_status` |
| `tradingview_webhook_events/{doc_id}` | `tradingview_events` |
| Collections métier Desk | `desk_documents` |
| Anciennes collections broker/test | exclues par défaut |
| `desk_cross_asset_deltas` | exclue |
| `study_candles`, `live_study_values` | exclues par défaut |
| ancien top-level `market_candles` | exclu |

## Dry-run exécuté

Commande :

```bash
python3 scripts/db/firestore_to_postgres.py \
  --mode dry-run \
  --project-id tv-automation-23d50 \
  --auth auto \
  --include-candles \
  --max-docs-per-collection 5 \
  --max-candles-per-feed 5 \
  --sample-limit 3 \
  --output docs/FIRESTORE_TO_POSTGRES_DRY_RUN_2026-07-19.json
```

Résultat :

| Cible | Documents testés | Résultat |
|---|---:|---|
| `desk_documents` | 214 | OK |
| `market_feeds` | 5 | OK |
| `market_candles` | 25 | OK |
| `market_feed_status` | 5 | OK |
| `tradingview_events` | 5 | OK |

Quarantine : 0.

Rapport :

- [FIRESTORE_TO_POSTGRES_DRY_RUN_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_DRY_RUN_2026-07-19.json)

## Import cœur métier exécuté

Commande :

```bash
npm run db:firestore:import:core
```

Équivalent :

```bash
python3 scripts/db/firestore_to_postgres.py \
  --mode import \
  --profile core \
  --project-id tv-automation-23d50 \
  --auth auto \
  --max-docs-per-collection 0 \
  --max-candles-per-feed 0 \
  --sample-limit 3 \
  --output docs/FIRESTORE_TO_POSTGRES_IMPORT_CORE_2026-07-19.json
```

Résultat :

| Cible | Écrits |
|---|---:|
| `desk_documents` | 18 159 |
| `market_feeds` | 50 |

Quarantine : 0.

Rapport :

- [FIRESTORE_TO_POSTGRES_IMPORT_CORE_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_IMPORT_CORE_2026-07-19.json)

## Import marché primaire MNQ/MES exécuté

Feeds ciblés :

- `prod__tradingview__MNQ1!__1`
- `prod__tradingview__MNQ1!__5`
- `prod__tradingview__MNQ1!__15`
- `prod__tradingview__MNQ1!__1H`
- `prod__tradingview__MNQ1!__4H`
- `prod__tradingview__MES1!__1`
- `prod__tradingview__MES1!__5`
- `prod__tradingview__MES1!__15`
- `prod__tradingview__MES1!__1H`
- `prod__tradingview__MES1!__4H`

Fenêtre importée :

```text
2026-06-30T22:00:00Z → 2026-07-17T21:00:00Z
```

Options ajoutées à l’importeur :

- `--candle-from-doc-id`
- `--candle-to-doc-id`
- `--candle-from-utc`
- `--candle-to-utc`
- `--candle-page-size`

Ces options permettent de borner les sous-collections Firestore `candles` sans créer d’index prod supplémentaire. L’import réel utilise une pagination par ID de document pour éviter les timeouts de stream Firestore.

Résultat :

| Cible | Écrits |
|---|---:|
| `market_feeds` | 10 |
| `market_candles` | 40 384 |

Quarantine : 0.

Rapports :

- [FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_PRIMARY_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_PRIMARY_2026-07-19.json)
- [FIRESTORE_TO_POSTGRES_IMPORT_MARKET_PRIMARY_SAMPLE_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_IMPORT_MARKET_PRIMARY_SAMPLE_2026-07-19.json)
- [FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_PRIMARY_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_PRIMARY_WINDOW_2026-07-19.json)
- [FIRESTORE_TO_POSTGRES_IMPORT_MARKET_PRIMARY_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_IMPORT_MARKET_PRIMARY_WINDOW_2026-07-19.json)

Note importante : l’option `--recent-candles` n’est pas utilisable aujourd’hui sans créer un index Firestore prod sur les sous-collections `candles` triées par `__name__ DESC`. On ne crée pas cet index pendant la migration locale. Le contournement validé est l’import borné par ID/timestamp avec `--candle-from-utc`, `--candle-to-utc` et `--candle-page-size`.

Un premier run non paginé a été interrompu par un timeout Firestore et marqué `failed`. Il a été remplacé par le run paginé `firestore_import_20260719T180501Z`, terminé avec succès. Les upserts rendent la relance idempotente.

L’ancien échantillon de 1 000 candles a servi à valider le mapping. Après l’import complet de la fenêtre récente, les 800 candles d’échantillon hors fenêtre ont été retirées localement pour garder ce palier propre.

## Import marché primaire NQ/ES exécuté

Feeds ciblés :

- `prod__tradingview__NQ1!__5`
- `prod__tradingview__NQ1!__15`
- `prod__tradingview__NQ1!__1H`
- `prod__tradingview__NQ1!__4H`
- `prod__tradingview__ES1!__5`
- `prod__tradingview__ES1!__15`
- `prod__tradingview__ES1!__1H`
- `prod__tradingview__ES1!__4H`

Fenêtre importée :

```text
2026-06-30T22:00:00Z → 2026-07-17T21:00:00Z
```

Résultat :

| Cible | Écrits |
|---|---:|
| `market_feeds` | 8 |
| `market_candles` | 4 664 |

Quarantine : 0.

Contrôle local par feed :

| Feed | Candles | Première candle | Dernière candle |
|---|---:|---|---|
| `prod__tradingview__ES1!__15` | 1 180 | `2026-06-30 22:00 UTC` | `2026-07-17 20:45 UTC` |
| `prod__tradingview__ES1!__1H` | 295 | `2026-06-30 22:00 UTC` | `2026-07-17 20:00 UTC` |
| `prod__tradingview__ES1!__4H` | 77 | `2026-06-30 22:00 UTC` | `2026-07-17 18:00 UTC` |
| `prod__tradingview__ES1!__5` | 780 | `2026-06-30 22:00 UTC` | `2026-07-03 16:55 UTC` |
| `prod__tradingview__NQ1!__15` | 1 180 | `2026-06-30 22:00 UTC` | `2026-07-17 20:45 UTC` |
| `prod__tradingview__NQ1!__1H` | 295 | `2026-06-30 22:00 UTC` | `2026-07-17 20:00 UTC` |
| `prod__tradingview__NQ1!__4H` | 77 | `2026-06-30 22:00 UTC` | `2026-07-17 18:00 UTC` |
| `prod__tradingview__NQ1!__5` | 780 | `2026-06-30 22:00 UTC` | `2026-07-03 16:55 UTC` |

Note : contrairement à MNQ/MES, les feeds NQ/ES `15m` et `1H` vont jusqu’au 17 juillet 2026. Les feeds NQ/ES `5m` s’arrêtent au 3 juillet 2026 côté source, mais ce manque est assumé temporairement et non bloquant tant que les timeframes principaux NQ/ES restent disponibles.

Rapports :

- [FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_NQ_ES_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_NQ_ES_WINDOW_2026-07-19.json)
- [FIRESTORE_TO_POSTGRES_IMPORT_MARKET_NQ_ES_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_IMPORT_MARKET_NQ_ES_WINDOW_2026-07-19.json)

Correction adjacente appliquée : les imports `live_data_feed_status` et `tradingview_webhook_events` ne créent plus de faux feeds à partir de documents de log. Le lien `feed_id` est conservé seulement si le vrai feed existe déjà dans `market_feeds`; sinon il reste `NULL` et la donnée brute reste disponible dans `raw`. Après nettoyage, `market_feeds` contient à nouveau 50 vrais feeds et 0 feed parasite.

## Import cross-assets utile exécuté

Feeds ciblés :

- `prod__tradingview__DXY__5`
- `prod__tradingview__DXY__4H`
- `prod__tradingview__VIX__5`
- `prod__tradingview__VIX__4H`
- `prod__tradingview__US10Y__5`
- `prod__tradingview__US10Y__4H`
- `prod__tradingview__US02Y__5`
- `prod__tradingview__US02Y__4H`
- `prod__tradingview__GC1!__5`
- `prod__tradingview__GC1!__4H`
- `prod__tradingview__CL1!__5`
- `prod__tradingview__CL1!__4H`

Fenêtre importée :

```text
2026-06-30T22:00:00Z → 2026-07-17T21:00:00Z
```

Résultat :

| Cible | Écrits |
|---|---:|
| `market_feeds` | 12 |
| `market_candles` | 18 181 |

Quarantine : 0.

Contrôle local par feed :

| Feed | Candles | Première candle | Dernière candle |
|---|---:|---|---|
| `prod__tradingview__CL1!__4H` | 77 | `2026-06-30 22:00 UTC` | `2026-07-17 18:00 UTC` |
| `prod__tradingview__CL1!__5` | 3 533 | `2026-06-30 22:00 UTC` | `2026-07-17 20:55 UTC` |
| `prod__tradingview__DXY__4H` | 75 | `2026-06-30 23:00 UTC` | `2026-07-17 19:00 UTC` |
| `prod__tradingview__DXY__5` | 3 328 | `2026-06-30 22:00 UTC` | `2026-07-17 20:55 UTC` |
| `prod__tradingview__GC1!__4H` | 77 | `2026-06-30 22:00 UTC` | `2026-07-17 18:00 UTC` |
| `prod__tradingview__GC1!__5` | 3 533 | `2026-06-30 22:00 UTC` | `2026-07-17 20:55 UTC` |
| `prod__tradingview__US02Y__4H` | 72 | `2026-06-30 23:00 UTC` | `2026-07-17 19:00 UTC` |
| `prod__tradingview__US02Y__5` | 2 665 | `2026-07-01 00:10 UTC` | `2026-07-17 20:55 UTC` |
| `prod__tradingview__US10Y__4H` | 71 | `2026-06-30 23:00 UTC` | `2026-07-17 19:00 UTC` |
| `prod__tradingview__US10Y__5` | 2 846 | `2026-07-01 00:10 UTC` | `2026-07-17 20:55 UTC` |
| `prod__tradingview__VIX__4H` | 38 | `2026-07-01 07:15 UTC` | `2026-07-17 17:30 UTC` |
| `prod__tradingview__VIX__5` | 1 866 | `2026-07-01 07:15 UTC` | `2026-07-17 20:15 UTC` |

Note : les différences d’ouverture/fermeture sont liées aux sessions de marché et à la source TradingView, notamment pour `VIX`, `US02Y` et `US10Y`.

Rapports :

- [FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_CROSS_ASSET_ONLY_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_DRY_RUN_MARKET_CROSS_ASSET_ONLY_WINDOW_2026-07-19.json)
- [FIRESTORE_TO_POSTGRES_IMPORT_MARKET_CROSS_ASSET_WINDOW_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/FIRESTORE_TO_POSTGRES_IMPORT_MARKET_CROSS_ASSET_WINDOW_2026-07-19.json)

## Audit qualité candles exécuté

Script relançable :

- [audit_market_candles_quality.py](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/scripts/db/audit_market_candles_quality.py)

Rapports :

- [MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.md](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.md)
- [MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.json)

Résultat global :

| Contrôle | Résultat |
|---|---:|
| Feeds marché total | 50 |
| Feeds hot scope attendus | 30 |
| Feeds hot scope alimentés | 30 |
| Candles auditées | 63 229 |
| Quarantine | 0 |
| Feeds avec OHLC invalide | 0 |
| Feeds stale côté source, audit brut initial | 6 |
| Feeds avec gaps courts à revoir | 8 |

Feeds stale côté source, audit brut initial :

- `prod__tradingview__MNQ1!__15`
- `prod__tradingview__MNQ1!__1H`
- `prod__tradingview__MES1!__15`
- `prod__tradingview__MES1!__1H`
- `prod__tradingview__NQ1!__5`
- `prod__tradingview__ES1!__5`

Ces feeds ne sont pas en retard à cause de l’import : leur `latest_timestamp_utc` source correspond à la dernière candle locale. Le problème est donc côté alimentation/source Firestore.

Décision métier postérieure : `NQ1!__5` et `ES1!__5` sont maintenant considérés comme manquants assumés, non bloquants, car les timeframes principaux NQ/ES sont disponibles.

Gaps courts à revoir :

- micro-trous communs le `2026-07-16`, notamment `08:00→08:35 UTC` et `09:45→09:55 UTC`, visibles sur plusieurs feeds `5m` ;
- irrégularités plus nombreuses sur `US02Y__5` et `US10Y__5`, probablement liées à la nature/session TradingView des taux, à confirmer avant de les utiliser comme signal critique.

Les pauses de session/week-end et les pauses de maintenance usuelles ne sont pas comptées comme anomalies bloquantes par l’audit.

## Rattrapage local MNQ/MES 15m/1H exécuté

Script relançable :

- [derive_market_candles.py](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/scripts/db/derive_market_candles.py)

Rapport :

- [MARKET_CANDLES_DERIVATION_MNQ_MES_2026-07-20.md](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_DERIVATION_MNQ_MES_2026-07-20.md)

Stratégie appliquée :

- source locale : feeds `MNQ/MES 5m` ;
- cible locale : feeds `MNQ/MES 15m` et `MNQ/MES 1H` ;
- `15m` = `3` candles `5m` complètes ;
- `1H` = `12` candles `5m` complètes ;
- aucune candle existante n’a été écrasée ;
- les buckets partiels ont été ignorés ;
- les candles dérivées sont traçables via `source_collection = derived:*` et `raw.schema_version = local-derived-v1` ;
- les feeds cibles sont marqués `status = derived_local`.

Résultat :

| Feed | Candles ajoutées | Total après | Dernière candle |
|---|---:|---:|---|
| `prod__tradingview__MNQ1!__15` | 916 | 1 176 | `2026-07-17 20:45 UTC` |
| `prod__tradingview__MNQ1!__1H` | 228 | 293 | `2026-07-17 20:00 UTC` |
| `prod__tradingview__MES1!__15` | 916 | 1 176 | `2026-07-17 20:45 UTC` |
| `prod__tradingview__MES1!__1H` | 228 | 293 | `2026-07-17 20:00 UTC` |

Total ajouté : 2 288 candles.

Rapports :

- [MARKET_CANDLES_DERIVATION_MNQ_MES_DRY_RUN_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_DERIVATION_MNQ_MES_DRY_RUN_2026-07-20.json)
- [MARKET_CANDLES_DERIVATION_MNQ_MES_IMPORT_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_DERIVATION_MNQ_MES_IMPORT_2026-07-20.json)
- [MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.md](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.md)
- [MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.json](/mnt/c/users/ces/desktop/TV_Automation_PREPROD/docs/MARKET_CANDLES_QUALITY_AUDIT_AFTER_DERIVATION_2026-07-20.json)

Audit après rattrapage :

| Contrôle | Résultat |
|---|---:|
| Feeds hot scope alimentés | 30 / 30 |
| Candles auditées | 65 517 |
| Quarantine | 0 |
| Feeds avec OHLC invalide | 0 |
| Feeds dérivés localement | 4 |
| Feeds stale bloquants côté source | 0 |
| Feeds manquants assumés | 2 |

Feeds manquants assumés :

- `prod__tradingview__NQ1!__5`
- `prod__tradingview__ES1!__5`

Ces deux feeds ne sont pas bloquants pour l’instant : les timeframes principaux NQ/ES restent disponibles.

Les feeds `MNQ/MES 1H` sont `DERIVED_OK`. Les feeds `MNQ/MES 15m` sont maintenant alimentés jusqu’au 17 juillet, mais restent en `REVIEW` à cause d’un micro-trou hérité du `5m` source autour du `2026-07-16 09:30→10:00 UTC`.

## Contrôles locaux après import

Collections clés présentes dans `desk_documents` :

| Collection | Lignes locales |
|---|---:|
| `desk_contracts` | 2 |
| `desk_master_analyses` | 12 |
| `desk_hourly_monitors` | 22 |
| `desk_replay_runs` | 36 |
| `desk_replay_timeline` | 1 933 |
| `desk_agent_work_items` | 435 |
| `desk_agent_work_events` | 1 481 |
| `desk_packs` | 102 |
| `desk_technical_events` | 7 746 |
| `dashboard_commands` | 11 |
| `dashboard_command_events` | 22 |
| `desk_strategy_trades` | 12 |

`market_feeds` : 50.

`market_candles` : 65 517 sur les fenêtres récentes MNQ/MES + NQ/ES + cross-assets utiles, rattrapage local MNQ/MES inclus.

Note : certaines collections ont légèrement plus de lignes que l’audit prod parce que la base locale contenait déjà quelques documents PREPROD avant l’import. L’import est idempotent.

## Adaptation runtime MCP

`PostgresDeskPersistence` route maintenant :

- les lectures `market_feeds/{feed_id}/candles` vers `market_candles` ;
- les écritures `market_feeds` vers `market_feeds` ;
- les écritures candles vers `market_candles` ;
- `live_data_feed_status` vers `market_feed_status` ;
- `tradingview_webhook_events` vers `tradingview_events`.

Si le schéma spécialisé n’existe pas, le port retombe sur `desk_documents`, ce qui garde le runtime tolérant pendant les transitions.

## Sécurité NinjaTrader

Le modèle broker/trade existe, mais aucune exécution n’est activée :

- `broker_providers.enabled = false` ;
- `broker_accounts.read_only = true` ;
- `broker_accounts.order_submission_enabled = false` ;
- contrats NinjaTrader seedés avec `active = false`.

## Prochain palier recommandé

Importer le marché par paliers, pas en une seule passe aveugle :

1. décider si les gaps `5m` courts doivent bloquer les replays ou seulement produire un badge qualité dans le front ;
2. intégrer les statuts qualité/dérivation/manque assumé dans le front et le Replay Lab ;
3. décider ensuite si les mega caps/ETF sont nécessaires en chaud ;
4. optimiser l’importeur en batch SQL multi-row si on veut importer les 1M+ candles complètes.

À ne pas importer pour l’instant :

- `desk_cross_asset_deltas` ;
- `study_candles` ;
- `live_study_values` ;
- ancien top-level `market_candles` ;
- broker/test legacy.
