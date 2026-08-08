# Contract — Mission

- **But** : unité de travail assignée à un Agent, avec objectif et traçabilité de corrélation.
- **Producteur** : scheduler (réutilise le mécanisme de réveil existant, `run_desk_ai_worker.mjs`).
- **Consommateurs** : Task, Conversation.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `agent_id` | uuid (FK, nullable) | non | Agent assigné (nullable tant que `CREATED`) |
| `objective` | string | oui | Objectif de la mission |
| `context_ref` | string | non | Référence au contexte fourni |
| `correlation_id` | string | oui | Racine de traçabilité (Event Envelope) |
| `status` | enum | oui | `CREATED`\|`ASSIGNED`\|`IN_PROGRESS`\|`COMPLETED`\|`FAILED` |

## Exemple JSON

```json
{
  "id": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "agent_id": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "objective": "Réévaluer la thèse ouverte sur ES pour la session US",
  "context_ref": "context/es-thesis-20260807.json",
  "correlation_id": "corr-20260807-1432-es",
  "status": "IN_PROGRESS"
}
```
