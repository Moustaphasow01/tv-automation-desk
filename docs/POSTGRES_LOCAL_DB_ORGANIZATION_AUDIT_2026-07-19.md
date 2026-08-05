# Audit organisation BDD locale PostgreSQL PREPROD — 2026-07-19

## Objectif

Définir une organisation propre de la base locale avant tout import Firestore prod.

But : ne pas reproduire Firestore tel quel dans PostgreSQL. Firestore est pratique pour accumuler des documents, mais PostgreSQL doit être organisé pour :

- lire vite le front ;
- servir le MCP local ;
- rejouer/backtester sans latence ;
- isoler les flux massifs de marché ;
- garder une base maintenable avant le futur chantier VPS/OVH.

## Verdict court

Le modèle actuel `desk_documents(collection, document_id, data jsonb)` est une bonne base pour les objets métier, mais il ne doit pas recevoir tous les flux Firestore.

Recommandation cible :

1. garder `desk_documents` pour le métier, les workflows, replays, bundles, contrats, thèses, monitors ;
2. créer une table spécialisée `market_candles` pour `market_feeds/*/candles` ;
3. créer une table spécialisée ou archive pour les évènements TradingView ;
4. exclure `desk_cross_asset_deltas` de l’import ;
5. ajouter une table de checkpoints d’import/migration ;
6. ajouter des indexes métier avant P0/P1/P2 ;
7. ne pas importer les gros historiques indicateurs tant que leur usage actuel n’est pas confirmé.

## État actuel PostgreSQL PREPROD

Table unique :

```sql
desk_documents(
  collection text not null,
  document_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(collection, document_id)
)
```

Indexes actuels :

- `(collection, document_id)` primary key
- `(collection, updated_at desc)`
- `gin(data)`
- `(collection, data->>'backtest_id')`
- `(collection, data->>'status')`
- `(collection, data->>'trading_date')`
- `(collection, data->>'work_item_id')`

État local constaté :

| Collection | Docs | Payload JSON |
|---|---:|---:|
| `desk_cross_asset_deltas` | 338 161 | 103 MB |
| `desk_alert_events` | 236 | 317 kB |
| `desk_notification_outbox` | 4 | 11 kB |
| `desk_alerts` | 3 | 8.9 kB |
| `desk_contracts` | 2 | 38 kB |
| `desk_contract_registry` | 1 | 1.1 kB |
| `desk_tool_logs` | 1 | 440 B |

Taille base locale :

| Objet | Taille |
|---|---:|
| Base `desk` | 312 MB |
| `desk_documents` total + indexes | 304 MB |
| heap `desk_documents` | 146 MB |

Diagnostic : la base locale est déjà gonflée principalement par une collection qu’on ne veut plus écrire ni importer.

## Volumes Firestore prod utiles à la décision

Rapport source : `docs/FIRESTORE_PROD_AUDIT_PREPROD_2026-07-19.json`.

| Famille | Documents |
|---|---:|
| Marché top-level / indicateurs / webhook | 1 925 014 |
| `market_feeds/*/candles` sous-collections | 1 182 601 |
| Métier core | 1 172 |
| Replay / work queue GPT | 7 608 |
| Packs / bundles / prep jobs | 951 |
| Features métier | 8 440 |
| Logs / archives | 28 186 |
| `desk_cross_asset_deltas` à exclure | 31 579 |

Conclusion : le vrai risque de performance n’est pas le métier, mais les time-series marché et les logs.

## Analyse des accès code

### Accès métier

Le code lit souvent :

- par `collection + document_id` ;
- par `status` ;
- par `trading_date` ;
- par `backtest_id` ;
- par `work_item_id` ;
- par `run_id` / `replay_run_id` ;
- par `workflow` ;
- par `updated_at_utc` ou timestamps métier pour les vues opérations.

Ces accès peuvent rester dans `desk_documents`, avec des indexes JSONB ciblés.

### Accès marché

Le code fait des fenêtres temporelles sur :

```text
market_feeds/{feed_id}/candles
timestamp_utc >= from
timestamp_utc <= to
order by timestamp_utc asc
```

C’est un profil time-series. Le stocker uniquement en JSONB dans `desk_documents` est possible, mais pas optimal pour 1M+ candles.

### Accès logs

Les logs et outputs sont utiles en audit mais rarement critiques en lecture chaude :

- `desk_agent_outputs`
- `desk_tool_logs`
- `desk_cycle_snapshots`
- `tradingview_webhook_events`
- `live_data_feed_status`

Ils doivent être séparés ou archivés, pas mélangés aux documents métier chauds.

## Organisation cible recommandée

### 1. `desk_documents` — document store métier

À conserver comme noyau principal.

Collections adaptées :

- contrats ;
- thèses ;
- Master / Monitor ;
- positions ;
- replay runs ;
- replay steps ;
- replay bundles ;
- replay monitors ;
- replay timeline ;
- work items GPT ;
- packs / pack builds ;
- jobs de préparation ;
- notifications / incidents / runbooks ;
- front projections.

Pourquoi : ces objets sont hétérogènes, versionnés, et déjà consommés par le port `PostgresDeskPersistence`.

### 2. `market_candles` — table spécialisée candles

Table cible proposée :

```sql
CREATE TABLE market_candles (
  feed_id text NOT NULL,
  provider text,
  environment text,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp_utc timestamptz NOT NULL,
  timestamp_paris text,
  trading_date text,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  is_closed boolean,
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_collection text,
  source_document_id text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(feed_id, timestamp_utc)
);

CREATE INDEX market_candles_symbol_tf_time_idx
  ON market_candles(symbol, timeframe, timestamp_utc DESC);

CREATE INDEX market_candles_feed_time_idx
  ON market_candles(feed_id, timestamp_utc DESC);

CREATE INDEX market_candles_trading_date_idx
  ON market_candles(trading_date, symbol, timeframe);
```

Mapping :

```text
Firestore: market_feeds/{feed_id}/candles/{doc_id}
Postgres:  market_candles(feed_id, timestamp_utc, raw)
```

Le port `queryDocuments()` pourra router les lectures `market_feeds/*/candles` vers cette table, en reconstruisant le format attendu par le code.

Avantage : on évite de scanner du JSONB pour les fenêtres de replay/live.

### 3. `market_feed_status` — état flux

Proposition :

```sql
CREATE TABLE market_feed_status (
  status_id text PRIMARY KEY,
  feed_id text,
  symbol text,
  timeframe text,
  timestamp_utc timestamptz,
  status text,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_feed_status_feed_time_idx
  ON market_feed_status(feed_id, timestamp_utc DESC);
```

À utiliser pour `live_data_feed_status`.

### 4. `tradingview_events` — webhook brut / audit ingestion

Option recommandée : table séparée, éventuellement partitionnée mensuellement plus tard.

```sql
CREATE TABLE tradingview_events (
  event_id text PRIMARY KEY,
  symbol text,
  timeframe text,
  timestamp_utc timestamptz,
  received_at timestamptz,
  alert_id text,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tradingview_events_symbol_tf_time_idx
  ON tradingview_events(symbol, timeframe, timestamp_utc DESC);
```

À utiliser pour :

- `tradingview_webhook_events`
- éventuellement `tradingview_alert_queue`

### 5. `desk_import_runs` et `desk_import_checkpoints`

Avant tout import sérieux, il faut tracer l’import.

```sql
CREATE TABLE desk_import_runs (
  import_id text PRIMARY KEY,
  source_project text NOT NULL,
  source_kind text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  mode text NOT NULL,
  status text NOT NULL,
  requested_collections jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_collections jsonb NOT NULL DEFAULT '[]'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE desk_import_checkpoints (
  import_id text NOT NULL REFERENCES desk_import_runs(import_id),
  source_collection text NOT NULL,
  target_table text NOT NULL,
  last_document_id text,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(import_id, source_collection)
);
```

Objectif : import idempotent, reprenable, auditable.

### 6. `desk_document_quarantine`

Pour les documents Firestore qu’on ne veut pas perdre mais qu’on ne veut pas intégrer.

```sql
CREATE TABLE desk_document_quarantine (
  source_collection text NOT NULL,
  source_document_id text NOT NULL,
  reason text NOT NULL,
  data jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_collection, source_document_id)
);
```

Usage :

- documents invalides ;
- collections legacy ;
- docs sans timestamps exploitables ;
- docs dépassant une taille/politique.

## Indexes à ajouter à `desk_documents`

Avant import P0/P1/P2, ajouter :

```sql
CREATE INDEX IF NOT EXISTS desk_documents_collection_run_id_idx
  ON desk_documents (collection, ((data ->> 'run_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_replay_run_id_idx
  ON desk_documents (collection, ((data ->> 'replay_run_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_workflow_idx
  ON desk_documents (collection, ((data ->> 'workflow')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_step_id_idx
  ON desk_documents (collection, ((data ->> 'step_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_updated_at_utc_idx
  ON desk_documents (collection, ((data ->> 'updated_at_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_created_at_utc_idx
  ON desk_documents (collection, ((data ->> 'created_at_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_timestamp_utc_idx
  ON desk_documents (collection, ((data ->> 'timestamp_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_date_session_idx
  ON desk_documents (
    collection,
    ((data ->> 'date')),
    ((data ->> 'session'))
  );
```

À noter : les indexes JSONB génériques ne remplacent pas les indexes expression ciblés pour les listes opérationnelles.

## Collections à router par cible

### Vers `desk_documents`

Importer ici :

- `desk_contracts`
- `desk_contract_registry`
- `desk_runtime_control`
- `desk_active_theses`
- `desk_master_analyses`
- `desk_hourly_monitors`
- `desk_live_run_cursor`
- `desk_positions`
- `desk_position_states`
- `desk_alerts`
- `desk_decisions`
- `macro_calendar_events`
- `desk_replay_*`
- `desk_agent_work_items`
- `desk_agent_work_events`
- `desk_packs`
- `desk_pack_builds`
- `desk_master_cutoff_bundles`
- `desk_manual_monitor_bundles`
- `desk_master_prep_jobs`
- `desk_monitor_prep_jobs`
- `desk_context_transmissions`

### Vers `market_candles`

Importer ici :

- `market_feeds/{feed_id}/candles`

Priorité d’import :

1. `MNQ1!`, `MES1!`
2. `NQ1!`, `ES1!`
3. `DXY`, `VIX`, `US10Y`, `US02Y`
4. `GC1!`, `CL1!`
5. mega caps / ETFs seulement si front ou stratégie les consomme réellement

### Vers `market_feed_status`

Importer ici :

- `live_data_feed_status`

### Vers `tradingview_events`

Importer ici :

- `tradingview_webhook_events`
- `tradingview_alert_queue`, si nécessaire

### Vers quarantine ou exclusion

Ne pas importer dans la base chaude :

- `desk_cross_asset_deltas`
- `market_candles`
- `study_candles`
- `desk_cloud_run_slots`
- `broker_order_intents`
- `broker_order_intent_events`

`market_candles` peut être gardé en archive si on veut conserver l’ancien format, mais il ne doit pas alimenter le runtime cible.

## Politique de rétention recommandée

### Base chaude

Garder en chaud :

- état actif complet ;
- replays/autopilot récents ou utiles ;
- candles nécessaires au live/replay local ;
- macro calendar ;
- packs actifs.

### Archive locale

Mettre en archive ou ne pas importer :

- tool logs anciens ;
- agent outputs anciens ;
- webhook events bruts anciens ;
- study candles doublons ;
- cross asset deltas recalculables.

### Nettoyage PREPROD actuel

À faire seulement après accord explicite :

```sql
DELETE FROM desk_documents
WHERE collection = 'desk_cross_asset_deltas';

VACUUM (ANALYZE) desk_documents;
```

Option plus sûre :

```sql
CREATE TABLE desk_documents_backup_cross_asset AS
SELECT * FROM desk_documents
WHERE collection = 'desk_cross_asset_deltas';
```

puis suppression après validation.

## Ordre recommandé avant import

### Étape 0 — Schéma

- ajouter indexes `desk_documents` ;
- créer `market_candles` ;
- créer `market_feed_status` ;
- créer `tradingview_events` ;
- créer `desk_import_runs` ;
- créer `desk_import_checkpoints` ;
- créer `desk_document_quarantine`.

### Étape 1 — Import dry-run P0/P1/P2

Collections métier uniquement.

Pas de candles.
Pas de cross-asset.
Pas de logs massifs.

### Étape 2 — Import réel P0/P1/P2

Upsert idempotent dans `desk_documents`.

Validation :

- counts source/target ;
- échantillons hashés ;
- smoke tests MCP ;
- smoke tests front.

### Étape 3 — Import marché borné

Importer les candles nécessaires à PREPROD :

- symboles : `MNQ1!`, `MES1!`, `NQ1!`, `ES1!`, `DXY`, `VIX`, `US10Y`, `US02Y`, `GC1!`, `CL1!`
- timeframes : `1`, `5`, `15`, `1H`, `4H`
- fenêtre : à choisir, par exemple 90 jours ou depuis le premier replay migré.

### Étape 4 — Recalcul features

Recalculer localement :

- `desk_level_maps`
- `desk_session_snapshots`
- `desk_technical_events`
- éventuellement un nouveau cross-asset propre plus tard.

## Risques si on importe maintenant sans réorganisation

| Risque | Impact |
|---|---|
| Mélanger 3M docs dans `desk_documents` | table lourde, indexes énormes, lenteur front/MCP |
| Importer `desk_cross_asset_deltas` | bruit, stockage inutile, confusion métier |
| Importer `study_candles` + `live_study_values` | doublon massif probable |
| Garder les candles en JSONB uniquement | fenêtres de replay/live plus lentes |
| Pas de checkpoints d’import | reprise difficile après interruption |
| Pas de quarantine | documents sales mélangés au runtime |

## Décision recommandée

Avant l’import Firestore → PostgreSQL :

1. appliquer une migration SQL de schéma cible ;
2. ne pas supprimer encore les données locales ;
3. créer l’importeur dry-run avec routing par collection ;
4. importer P0/P1/P2 seulement ;
5. valider ;
6. importer le marché dans `market_candles` seulement après validation.

Cette approche garde la flexibilité du modèle documentaire tout en évitant que les séries temporelles transforment `desk_documents` en décharge JSONB.
