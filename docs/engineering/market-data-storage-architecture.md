# Market Data Storage Architecture — TD2-207

TD2-207 définit la séparation entre les séries chaudes nécessaires au desk et les données brutes immuables nécessaires à la reconstruction.

L’objectif n’est pas encore de déployer un object storage externe. En préprod/VPS, la cible reste local-first : PostgreSQL pour les séries chaudes, filesystem local pour les objets froids, puis bascule possible vers MinIO/S3/OVH Object Storage en changeant la base URI.

## Commandes

Plan opérateur :

```bash
npm run plan:market-storage
```

Depuis le MCP :

```bash
npm --prefix mcp_gpt_desk run data:storage-plan -- --summary
```

Avec PostgreSQL réel :

```bash
DESK_POSTGRES_URL="postgres://..." npm run plan:market-storage
```

Changer la cible objet :

```bash
DESK_OBJECT_STORAGE_BASE_URI="file:///D:/desk-data/object-storage/market-data" npm run plan:market-storage
```

Plus tard, cette URI peut devenir :

```text
s3://desk-market-data/raw
```

ou une URI compatible OVH/MinIO.

## Tiers

| Tier | Usage | Format cible | Rétention indicative |
|---|---|---|---:|
| `HOT_SERIES` | Séries chaudes lues par live, replay et front | PostgreSQL `market_candles` | 45 jours |
| `COLD_PARQUET` | Historique brut immuable reconstructible | Parquet + compression zstd | 5 ans |
| `RAW_ARCHIVE` | Archive source brute quand Parquet n’est pas encore prêt | JSONL gzip | 5 ans |
| `HOT_AND_COLD` | Données utiles en direct et en reconstruction | PostgreSQL + Parquet | 45 jours chaud / 5 ans froid |
| `IGNORE` | Feed absent ou non exploitable | aucun | 0 |

## Tables

- `market_data_storage_objects` : objet brut/froid gouverné, avec URI, partition, hashes, dataset/batch/capability lineage.
- `market_data_hot_series_windows` : fenêtre chaude PostgreSQL, reliée optionnellement à l’objet brut qui permet de la reconstruire.

Les séries chaudes PostgreSQL restent donc des projections rapides et bornées, tandis que les objets froids conservent la preuve reconstructible.

## Invariants

- Une donnée brute active doit être scellée : fenêtre temporelle, `record_count`, `content_hash`, `provenance_hash`.
- Le front, les simulations et les agents lisent via `/api/v1/data-foundation/*`, jamais directement les tables.
- Les séries chaudes sont une projection exploitable, pas la source de vérité long terme.
- Le Parquet froid devient la source reconstructible dès qu’il existe pour un feed.
- Les recommandations TD2-206 alimentent le plan TD2-207.

## Accès API contrôlé

```text
GET /api/v1/data-foundation/storage-objects
GET /api/v1/data-foundation/hot-series-windows
```

Filtres supportés :

- `source_key`
- `instrument_code`
- `timeframe`
- `status`
- `storage_tier`
- `storage_format`
- `audience`
- `limit`

## Politique coût

La règle actuelle est volontairement pragmatique :

- `MNQ/MES` M1/M5 utilisés par exécution/replay restent chauds.
- Toute donnée tick/bid/ask/open interest doit être pensée `HOT_AND_COLD` si elle devient disponible.
- Les contextes macro/cross-asset peu consultés en direct peuvent rester froids ou dérivés.
- Aucun coût objet n’est engagé pour les feeds `IGNORE`.

Le planner estime les volumes à partir du profil TD2-206 (`cost_profile.estimated_total_mb`) et projette un coût annuel indicatif.
