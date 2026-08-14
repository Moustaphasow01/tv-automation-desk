# Data Foundation Registry — TD2-200

TD2-200 introduit les deux premières briques PostgreSQL de la couche Data Foundation :

- `data_sources` : registre générique des sources amont avec format, fréquence, SLA de fraîcheur, statut et configuration ;
- `ingestion_batches` : journal idempotent des lots ingérés, rattaché à une source et scellable par `content_hash` + `provenance_hash`.

Ces tables ne remplacent pas `market_feeds`, `market_candles`, `tradingview_events`, `news_sources` ou `news_ingestion_runs`. Elles ajoutent une couche de gouvernance/provenance au-dessus de l’existant pour préparer les tickets suivants :

- TD2-201 : Dataset scellé, cutoff, hash et provenance ;
- TD2-202 : Feature Definition/Version reproductible ;
- TD2-204 : API contrôlée de lecture data/features.

## Frontière d’architecture

Le module propriétaire reste `market-data`, même si les noms sont génériques. La raison : dans l’architecture cible, la Data Foundation couvre les prix, les news, le calendrier macro et les sources alternatives consommées par les simulations et le live.

Le runtime actuel continue donc de lire ses tables existantes. Un futur Dataset scellé référencera les `ingestion_batches`, pas directement un flux live.

## Invariants SQL

- Une `data_source` possède une clé stable `source_key`, un type `kind`, un provider, un format, une fréquence et un `freshness_sla_seconds`.
- Un `ingestion_batch` référence exactement une `data_source`.
- Un batch `COMPLETED` doit être scellé avec fenêtre source, `completed_at_utc`, `content_hash` et `provenance_hash`.
- Un batch `FAILED` doit exposer `failure_code`.
- Les hashes utilisent le format `sha256:<64 hex>`.

## Ce qui reste hors TD2-200

- Assemblage de datasets : TD2-201.
- Calcul de features point-in-time : TD2-202/TD2-208.
- Profilage de profondeur historique ticks/bid/ask/open interest : TD2-206.
- Stockage Parquet/object storage : TD2-207.

## Addendum TD2-201 — Dataset Registry

TD2-201 ajoute :

- `datasets` : registre des datasets scellables, avec `BUILDING` / `READY` / `ARCHIVED`, fenêtre temporelle, cutoff, `content_hash`, `provenance_hash` et compteur de batches source ;
- `dataset_ingestion_batches` : composition ordonnée du dataset, rattachant chaque dataset aux `ingestion_batches` TD2-200 inclus.

Un Dataset `READY` doit avoir :

- une fenêtre source complète ;
- un cutoff UTC + Paris ;
- au moins un batch source déclaré (`source_batch_count > 0`) ;
- un `content_hash` et un `provenance_hash` au format `sha256:<64 hex>`.

Cette migration ne branche pas encore le Replay/Live runtime sur `datasets`. Elle rend simplement possible le futur invariant : même Strategy Version + même Dataset + mêmes paramètres = mêmes résultats reproductibles.

## Addendum TD2-202 — Feature Registry

TD2-202 ajoute la frontière `features` au socle SQL :

- `feature_definitions` : identité canonique de la feature (`atr_14`, `SESSION_VWAP`, `POC`, etc.) ;
- `feature_versions` : version immuable du calcul avec `formula_ref`, `formula_hash`, schémas et flags `deterministic` / `point_in_time_safe` ;
- `feature_computation_runs` : journal reproductible par `(feature_version_id, dataset_id, parameters_hash)` ;
- `feature_value_points` : valeurs point-in-time immuables, prêtes pour l’API contrôlée TD2-204 et le catalogue initial TD2-208.

Ce ticket ne déplace pas encore `run_feature_engine`. Il formalise la cible pour que l’ATR Wilder actuel (`wilder_atr_14_v1`) et les prochains niveaux/session features puissent être publiés sans redéfinition silencieuse.

## Addendum TD2-203 — calendrier, sessions et rollover

TD2-203 complète la Data Foundation avec les tables `market_calendars`, `market_calendar_days`, `market_session_templates`, `market_session_occurrences` et `market_futures_rollovers`.

Objectif : rendre la date de trading, la session, le cutoff et le contrat futures actif lisibles depuis une source canonique avant de migrer progressivement les constantes Live/Replay existantes.

## Addendum TD2-204 — API data/feature contrôlée

TD2-204 expose la Data Foundation via une API REST read-only sous `/api/v1/data-foundation/*`.

Endpoints ajoutés :

- `/data-foundation/overview` : catalogue, compteurs et ressources récentes ;
- `/data-foundation/sources` : `data_sources` filtrées par statut/type/provider/environnement ;
- `/data-foundation/ingestion-batches` : lots d’ingestion reliés à leur source gouvernée ;
- `/data-foundation/datasets` : datasets scellés avec lineage `dataset_ingestion_batches` ;
- `/data-foundation/features` : définitions et versions de features ;
- `/data-foundation/feature-computations` : runs reproductibles par feature/dataset ;
- `/data-foundation/feature-values` : valeurs point-in-time avec `dataset_key`, cutoff, `feature_version`, hashes de formule/provenance.

Invariants d’architecture :

- aucune lecture directe des tables internes par les consommateurs front/simulation/agents ;
- aucune mutation dans TD2-204 ;
- audiences autorisées : `front`, `simulation`, `agent`, `operator` ;
- une audience inconnue retourne une erreur 403 avec Problem Details (`desk_problem_details_v1`) ;
- les projections exposent explicitement `source.direct_table_access=false`, `storage=postgres`, `canonical=data_foundation_v1`.

## Addendum TD2-205 — front transitoire coverage & lineage

TD2-205 ajoute l’écran `/data-foundation`.

Il consomme les endpoints TD2-204/206/207/208 et traduit les IDs techniques en libellés opérateur pour :

- datasets et lineage ;
- catalogue features point-in-time ;
- couverture market data ;
- objets froids / séries chaudes ;
- alertes d’accès direct table ou sources bloquantes.

Voir `docs/engineering/front-data-foundation-lineage.md`.

## Addendum TD2-206 — profilage capacités market data

TD2-206 ajoute deux tables de profilage :

- `market_data_capability_profile_runs` : run d’audit global par provider/environnement/date ;
- `market_data_capability_profiles` : capacité mesurée par feed, instrument, timeframe et source.

Le profil distingue :

- les manques bloquants pour V5 (`ohlcv`, `volume` sur feeds requis) ;
- les manques non bloquants mais importants à suivre (`tick`, `bid`, `ask`, `open_interest`) ;
- la profondeur historique, les gaps de bougies et la recommandation de stockage `HOT_SERIES`, `COLD_RAW`, `HOT_AND_COLD` ou `IGNORE`.

Les profils sont exposés par l’endpoint contrôlé `/api/v1/data-foundation/market-data-profiles`.

La documentation opérateur détaillée est dans `docs/engineering/market-data-capability-profiling.md`.

## Addendum TD2-207 — stockage brut Parquet et séries chaudes

TD2-207 ajoute la cible de stockage hot/cold :

- `market_data_storage_objects` : objets froids/bruts, typiquement Parquet ou JSONL, avec URI, partitions, hashes de reconstruction et lineage dataset/batch/capability ;
- `market_data_hot_series_windows` : fenêtres PostgreSQL chaudes, reliées optionnellement à l’objet froid qui permet de les reconstruire.

La règle cible est :

- les séries chaudes servent le live, le replay et le front ;
- le Parquet froid devient la source de vérité reconstructible quand il existe ;
- l’archive brute évite de perdre une source avant transformation ;
- l’API Data Foundation expose `/api/v1/data-foundation/storage-objects` et `/api/v1/data-foundation/hot-series-windows`.

Voir `docs/engineering/market-data-storage-architecture.md`.

## Addendum TD2-208 — catalogue initial de features point-in-time

TD2-208 publie un seed idempotent de `feature_definitions` et `feature_versions` avec 10 features initiales :

- volatilité : `wilder_atr_14` ;
- prix/session : `session_vwap`, `initial_balance_range`, `overnight_high_low` ;
- volume profile : `volume_profile_poc`, `volume_profile_vah`, `volume_profile_val` ;
- intermarket/cross-asset : `intermarket_mnq_mes_spread`, `cross_asset_risk_state` ;
- macro : `macro_event_blackout_window`.

Chaque version publiée expose `formula_ref`, `formula_hash`, schémas d’entrée/sortie/paramètres, `deterministic=true`, `point_in_time_safe=true` et `min_dataset_schema_version=dataset_v1`.

Voir `docs/engineering/point-in-time-feature-catalog.md`.

## Addendum Lot011 — extension Data Engine certification

Lot011 étend le catalogue point-in-time via `054_data_engine_extended_point_in_time_features.sql`.

Features ajoutées :

- `rsi_wilder_14` ;
- `developing_volume_profile` ;
- `prior_day_week_levels` ;
- `realized_volatility` ;
- `downside_semivariance` ;
- `rolling_correlation_beta`.

Le profil V5 conserve MNQ/MES comme instruments d’exécution principaux, enrichit le contexte big caps avec `AMZN`, `META`, `GOOGL` et `AVGO`, et garde `SMH`/`SOXX` comme contexte semi-conducteurs optionnel.

Limite explicite :

- OHLCV/volume restent les capacités bloquantes sur les feeds requis ;
- tick/bid/ask/open interest sont supportés par le profilage de capacité lorsqu’ils existent chez le provider, mais ils ne sont pas inventés et ne bloquent pas l’exécution tant que le feed ne les fournit pas.
