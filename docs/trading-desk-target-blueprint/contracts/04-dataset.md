# Contract — Dataset

- **But** : ensemble de données historiques figé et tracé, consommé par un Run de simulation.
- **Producteur** : Dataset Builder (`06`, Phase 2).
- **Consommateurs** : Simulation Engine (`08`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `dataset_key` | string | oui | Clé idempotente/opérateur du dataset |
| `name` | string | oui | Nom lisible du dataset |
| `source_refs` | array[uuid] | oui | Références aux Ingestion Batch inclus |
| `time_range` | object | oui | `{ "from": ISO8601, "to": ISO8601 }` |
| `cutoff_utc` | ISO8601 | oui si `READY` | Cutoff anti-lookahead utilisé pour sceller la disponibilité |
| `cutoff_paris` | ISO8601 | oui si `READY` | Même cutoff exprimé côté opérateur Europe/Paris |
| `schema_version` | string | oui | Version du schéma de données |
| `source_batch_count` | integer | oui | Nombre de lots d’ingestion inclus dans la composition |
| `content_hash` | string | oui si `READY` | Hash du contenu assemblé, format `sha256:<64 hex>` |
| `provenance_hash` | string | oui | Hash calculé sur l'ensemble, garantit la reproductibilité (SC-3) |
| `status` | enum | oui | `BUILDING`\|`READY`\|`ARCHIVED` |

## Invariants

- Un Dataset `READY` est scellé : fenêtre, cutoff, `source_batch_count > 0`, `content_hash` et `provenance_hash` sont obligatoires.
- La composition détaillée est portée par la table de liaison `dataset_ingestion_batches`.
- Toute correction de données produit un nouveau Dataset ; un Dataset `READY` n’est pas édité en place.

## Exemple JSON

```json
{
  "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "dataset_key": "mnq-mes-v5-2026-06-11-full-day",
  "name": "MNQ/MES V5 2026-06-11 full day",
  "source_refs": ["ib-001", "ib-002"],
  "time_range": { "from": "2026-01-01T00:00:00Z", "to": "2026-06-30T23:59:59Z" },
  "cutoff_utc": "2026-06-30T23:59:59Z",
  "cutoff_paris": "2026-07-01T01:59:59+02:00",
  "schema_version": "market-data-v1",
  "source_batch_count": 2,
  "content_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "provenance_hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "status": "READY"
}
```
