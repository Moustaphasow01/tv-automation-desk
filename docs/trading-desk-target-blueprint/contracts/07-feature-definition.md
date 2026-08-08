# Contract — Feature Definition

- **But** : définition versionnée d'une feature dérivée, calculée de façon identique en simulation et en live.
- **Producteur** : Feature Engine (`06`, Phase 2).
- **Consommateurs** : Strategy DSL (`07`), Simulation Engine (`08`), Live Strategy Runtime (`10`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `name` | string | oui | ex. `atr_14` |
| `version` | string | oui | Version du calcul (nouvelle version = additive, jamais redéfinition silencieuse, Ticket 0.6) |
| `formula_ref` | string | oui | Référence au code de calcul |
| `status` | enum | oui | `ACTIVE`\|`DEPRECATED` |

## Exemple JSON

```json
{
  "id": "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
  "name": "atr_14",
  "version": "v2",
  "formula_ref": "packages/desk-data/src/features/atr14.js",
  "status": "ACTIVE"
}
```
