# Contract — Risk Decision

- **But** : sortie du Global Risk Engine — approuve, réduit, ou annule une Candidate Allocation.
- **Producteur** : Global Risk Engine (`11`).
- **Consommateurs** : Broker Netting Engine.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `candidate_allocation_id` | uuid (FK) | oui | Candidate Allocation évaluée |
| `approved_size` | number | oui | Taille approuvée (peut être réduite ou nulle, jamais silencieusement absente) |
| `limits_applied` | array[string] | oui | Limites de risque effectivement appliquées |
| `decided_at` | timestamp | oui | Horodatage de décision |

## Précurseur TD2-701

Avant la création complète de `Risk Decision`, le domaine `portfolio_risk_budget_evaluation_v1` produit une évaluation budgétaire déterministe :

- `PASS` : taille demandée possible ;
- `REDUCE` : taille approuvable inférieure à la taille demandée ;
- `BLOCK` : taille approuvée `0` ;
- `CONFIG_MISSING` : aucun budget numérique configuré, fail-closed.

Cette évaluation alimente le futur Global Risk Engine sans créer encore de `Target Position` ni d’`OrderIntent`.

## Exemple JSON

```json
{
  "id": "d0e1f2a3-b4c5-4d6e-7f80-914263748596",
  "candidate_allocation_id": "c9d0e1f2-a3b4-4c5d-6e7f-809142637485",
  "approved_size": 1,
  "limits_applied": ["max_net_exposure_per_instrument"],
  "decided_at": "2026-08-07T14:32:25Z"
}
```
