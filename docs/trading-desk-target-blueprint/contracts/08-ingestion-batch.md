# Contract — Ingestion Batch

- **But** : représenter un lot d’ingestion horodaté, rattaché à une `Data Source`, scellable par hash et réutilisable ensuite par un `Dataset`.
- **Producteur** : Ingestion Layer (`06`, Phase 2).
- **Consommateurs** : Dataset Builder (`06`) puis Simulation Engine (`08`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable du batch |
| `data_source_id` | uuid | oui | Source déclarée qui a produit le lot |
| `batch_key` | string | oui | Clé idempotente de reprise/import |
| `status` | enum | oui | `RUNNING`\|`COMPLETED`\|`FAILED` |
| `source_window` | object | oui si `COMPLETED` | Fenêtre temporelle couverte par le batch |
| `ingested_at_utc` | ISO8601 | oui | Horodatage d’ingestion |
| `completed_at_utc` | ISO8601 | oui si `COMPLETED` | Horodatage de scellement |
| `schema_version` | string | oui | Version du schéma brut/normalisé |
| `record_count` | integer | oui | Nombre d’enregistrements acceptés |
| `rejected_count` | integer | oui | Nombre d’enregistrements rejetés |
| `content_hash` | string | oui si `COMPLETED` | Hash du contenu du lot, format `sha256:<64 hex>` |
| `provenance_hash` | string | oui si `COMPLETED` | Hash de provenance incluant source, fenêtre, schéma et contenu |
| `storage_ref` | string | non | Référence du stockage brut ou normalisé |
| `failure_code` | string | oui si `FAILED` | Code d’échec exploitable |

## Invariants

- Un batch `COMPLETED` est scellé : il possède une fenêtre source complète, `completed_at_utc`, `content_hash` et `provenance_hash`.
- Un batch `FAILED` doit être expliqué par `failure_code`.
- Un batch `RUNNING` ne porte pas de `completed_at_utc` ni d’erreur terminale.
- Un `Dataset` futur ne consomme pas directement un flux live : il référence des `Ingestion Batch` déjà persistés.

## Exemple JSON

```json
{
  "id": "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "data_source_id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "batch_key": "tradingview.mnq.m1.2026-06-11.full-day.v1",
  "status": "COMPLETED",
  "source_window": {
    "from": "2026-06-11T00:00:00Z",
    "to": "2026-06-11T21:59:59Z"
  },
  "ingested_at_utc": "2026-08-09T08:00:00Z",
  "completed_at_utc": "2026-08-09T08:00:04Z",
  "schema_version": "market-ohlcv-v1",
  "record_count": 1320,
  "rejected_count": 0,
  "content_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "provenance_hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "storage_ref": "postgres://market_candles/feed/tradingview.mnq.m1/2026-06-11"
}
```
