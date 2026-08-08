# Contract — Run

- **But** : une exécution unique de simulation d'une Strategy Version sur un Dataset, avec ses métriques et sa graine de reproductibilité.
- **Producteur** : Simulation Engine (`08`, Phase 3).
- **Consommateurs** : Run Registry, Experiment (`08`, Phase 4).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `strategy_version_id` | uuid (FK) | oui | Strategy Version simulée |
| `dataset_id` | uuid (FK) | oui | Dataset utilisé |
| `parameters_hash` | string | oui | Hash des paramètres d'exécution |
| `status` | enum | oui | `QUEUED`\|`RUNNING`\|`COMPLETED`\|`FAILED`\|`CANCELLED` |
| `metrics_ref` | string (nullable) | non | Référence aux métriques produites |
| `reproducibility_seed` | string | oui | Graine garantissant la reproductibilité bit-à-bit (SC-3) |
| `started_at` / `completed_at` | timestamp | non | Horodatages d'exécution |

## Exemple JSON

```json
{
  "id": "6c1a3e00-1111-4a2b-9c3d-abcdef012345",
  "strategy_version_id": "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11",
  "dataset_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "parameters_hash": "sha256:abcd...",
  "status": "COMPLETED",
  "metrics_ref": "runs/6c1a3e00/metrics.json",
  "reproducibility_seed": "seed-2026-08-07-001",
  "started_at": "2026-08-07T10:00:00Z",
  "completed_at": "2026-08-07T10:04:12Z"
}
```
