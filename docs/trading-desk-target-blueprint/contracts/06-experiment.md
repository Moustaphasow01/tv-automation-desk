# Contract — Experiment

- **But** : regrouper plusieurs Run pour comparaison structurée.
- **Producteur** : Experiment Registry (`08`, Phase 4).
- **Consommateurs** : opérateur, dashboard de comparaison.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `name` | string | oui | Nom de l'expérience |
| `run_ids` | array[uuid] | oui | Runs comparés |
| `comparison_metric` | string | oui | Métrique utilisée pour la comparaison (voir `OP-11`) |
| `winner_run_id` | uuid (nullable) | non | Run gagnant sélectionné |

## Exemple JSON

```json
{
  "id": "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
  "name": "Breakout Retest ES — comparaison paramètres stop",
  "run_ids": ["6c1a3e00-1111-4a2b-9c3d-abcdef012345", "6c1a3e00-2222-4a2b-9c3d-abcdef012346"],
  "comparison_metric": "sharpe_ratio",
  "winner_run_id": "6c1a3e00-2222-4a2b-9c3d-abcdef012346"
}
```
