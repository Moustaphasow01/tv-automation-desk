# Contract — Task

- **But** : unité de travail atomique au sein d'une Mission.
- **Producteur** : Mission.
- **Consommateurs** : Batch.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `mission_id` | uuid (FK) | oui | Mission parente |
| `input_ref` | string | oui | Référence à l'entrée |
| `output_ref` | string (nullable) | non | Référence à la sortie produite |
| `status` | enum | oui | `PENDING`\|`RUNNING`\|`DONE`\|`ERROR` |

## Exemple JSON

```json
{
  "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
  "mission_id": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "input_ref": "input/es-thesis-context.json",
  "output_ref": "output/es-thesis-conclusion.json",
  "status": "DONE"
}
```
