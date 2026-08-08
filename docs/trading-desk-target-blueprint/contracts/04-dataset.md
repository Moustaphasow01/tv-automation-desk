# Contract — Dataset

- **But** : ensemble de données historiques figé et tracé, consommé par un Run de simulation.
- **Producteur** : Dataset Builder (`06`, Phase 2).
- **Consommateurs** : Simulation Engine (`08`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `source_refs` | array[uuid] | oui | Références aux Ingestion Batch inclus |
| `time_range` | object | oui | `{ "from": ISO8601, "to": ISO8601 }` |
| `schema_version` | string | oui | Version du schéma de données |
| `provenance_hash` | string | oui | Hash calculé sur l'ensemble, garantit la reproductibilité (SC-3) |
| `status` | enum | oui | `BUILDING`\|`READY`\|`ARCHIVED` |

## Exemple JSON

```json
{
  "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "source_refs": ["ib-001", "ib-002"],
  "time_range": { "from": "2026-01-01T00:00:00Z", "to": "2026-06-30T23:59:59Z" },
  "schema_version": "market-data-v1",
  "provenance_hash": "sha256:1234...",
  "status": "READY"
}
```
