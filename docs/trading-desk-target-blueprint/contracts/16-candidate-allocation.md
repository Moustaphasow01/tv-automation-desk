# Contract — Candidate Allocation

- **But** : sortie du Portfolio Arbitration Engine, avant application du risque global.
- **Producteur** : Portfolio Arbitration Engine (`11`).
- **Consommateurs** : Global Risk Engine.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `signal_ids` | array[uuid] | oui | Signaux agrégés |
| `instrument` | string | oui | Instrument concerné |
| `net_direction` | enum | oui | Direction nette résultante |
| `proposed_size` | number | oui | Taille proposée avant application des limites de risque |

## Exemple JSON

```json
{
  "id": "c9d0e1f2-a3b4-4c5d-6e7f-809142637485",
  "signal_ids": ["a7b8c9d0-e1f2-4a3b-4c5d-6e7f80914263"],
  "instrument": "ES",
  "net_direction": "LONG",
  "proposed_size": 2
}
```
