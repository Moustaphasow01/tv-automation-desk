# Contract — Agent

- **But** : type d'exécutant du Multi-Agent Runtime généralisé, correspondant à l'un des 3 pipelines LLM migrés (ou futur).
- **Producteur** : Research Lab (`09`, Phase 5).
- **Consommateurs** : Mission.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `type` | enum | oui | `market-analysis`\|`thesis-monitor`\|`replay-orchestrator`\|... |
| `capabilities` | array[string] | non | Capacités déclarées |
| `status` | enum | oui | `IDLE`\|`BUSY`\|`OFFLINE` |

## Exemple JSON

```json
{
  "id": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "type": "thesis-monitor",
  "capabilities": ["read-market-context", "read-open-positions"],
  "status": "IDLE"
}
```
