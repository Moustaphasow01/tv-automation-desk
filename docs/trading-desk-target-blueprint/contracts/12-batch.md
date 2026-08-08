# Contract — Batch

- **But** : regrouper plusieurs Task avec une politique d'agrégation explicite (ADR-0014).
- **Producteur** : Mission.
- **Consommateurs** : consommateur final du résultat agrégé (ex. moniteur de thèse).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `task_ids` | array[uuid] | oui | Tasks regroupées |
| `policy` | enum | oui | `ALL`\|`ANY`\|`FIRST_SOCK`\|`QUORUM`\|`TIMEOUT_WITH_PARTIAL_RESULTS` |
| `status` | enum | oui | statut d'agrégation |
| `deadline_at` | timestamp | non | Échéance (pertinent pour `TIMEOUT_WITH_PARTIAL_RESULTS`) |

## Exemple JSON

```json
{
  "id": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091",
  "task_ids": ["d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80"],
  "policy": "TIMEOUT_WITH_PARTIAL_RESULTS",
  "status": "COMPLETED_PARTIAL",
  "deadline_at": "2026-08-07T14:35:00Z"
}
```
