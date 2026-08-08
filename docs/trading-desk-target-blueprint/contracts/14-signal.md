# Contract — Signal

- **But** : sortie du Live Strategy Runtime, publiée sur le Standardized Signal Bus, immuable une fois émise.
- **Producteur** : Live Strategy Runtime (`10`).
- **Consommateurs** : Portfolio Arbitration Engine (`11`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `strategy_instance_id` | uuid (FK) | oui | Strategy Instance émettrice |
| `instrument` | string | oui | Instrument concerné |
| `direction` | enum | oui | `LONG`\|`SHORT`\|`FLAT` |
| `confidence` | number | non | Score de confiance |
| `execution_mode_origin` | enum | oui | `SHADOW`\|`PAPER`\|`LIVE` — mode de l'instance émettrice |
| `generated_at` / `expires_at` | timestamp | oui | Fenêtre de validité |
| `correlation_id` | string | oui | Traçabilité |

## Exemple JSON

```json
{
  "id": "a7b8c9d0-e1f2-4a3b-4c5d-6e7f80914263",
  "strategy_instance_id": "d4e5f6a7-8b9c-4d1e-9f2a-3b4c5d6e7f80",
  "instrument": "ES",
  "direction": "LONG",
  "confidence": 0.72,
  "execution_mode_origin": "PAPER",
  "generated_at": "2026-08-07T14:32:15Z",
  "expires_at": "2026-08-07T14:47:15Z",
  "correlation_id": "corr-20260807-1432-es"
}
```
