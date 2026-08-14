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
| `long_size` | number | oui | Taille brute longue agrégée |
| `short_size` | number | oui | Taille brute courte agrégée |
| `net_size` | number | oui | Taille signée après neutralisation |
| `status` | enum | oui | `PROPOSED` ou `NEUTRALIZED` |
| `contributing_signals` | array[object] | oui | Contributions par signal/Strategy Instance |

## Politique TD2-700

La V1 applique `NET_BY_DIRECTION` :

- les signaux `LONG` et `SHORT` du même instrument sont agrégés ensemble ;
- les directions opposées se neutralisent partiellement ;
- une neutralisation parfaite produit une allocation `FLAT` de taille `0`, mais reste auditée.

Le moteur produit aussi un snapshot `virtual_strategy_portfolio_v1` par `strategy_instance_id` pour suivre exposition et résultat R virtuel.

## Exemple JSON

```json
{
  "id": "c9d0e1f2-a3b4-4c5d-6e7f-809142637485",
  "signal_ids": ["a7b8c9d0-e1f2-4a3b-4c5d-6e7f80914263"],
  "instrument": "ES",
  "net_direction": "LONG",
  "proposed_size": 2,
  "long_size": 2,
  "short_size": 0,
  "net_size": 2,
  "status": "PROPOSED"
}
```
