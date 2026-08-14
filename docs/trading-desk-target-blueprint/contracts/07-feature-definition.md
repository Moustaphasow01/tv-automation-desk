# Contract — Feature Definition / Feature Version

- **But** : définition et version immuable d'une feature dérivée, calculée de façon identique en simulation et en live.
- **Producteur** : Feature Engine (`06`, Phase 2).
- **Consommateurs** : Strategy DSL (`07`), Simulation Engine (`08`), Live Strategy Runtime (`10`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable de la Feature Definition |
| `feature_key` | string | oui | Clé canonique, ex. `atr_14` |
| `name` | string | oui | Nom lisible |
| `category` | string | oui | Famille (`volatility`, `session_level`, `intermarket`, etc.) |
| `output_kind` | enum | oui | `SCALAR`\|`SERIES`\|`EVENT`\|`MAP` |
| `definition_status` | enum | oui | `ACTIVE`\|`DEPRECATED` |
| `version_id` | uuid | oui | Identifiant stable de la Feature Version |
| `version` | string | oui | Version du calcul (nouvelle version = additive, jamais redéfinition silencieuse) |
| `version_status` | enum | oui | `DRAFT`\|`VALIDATED`\|`PUBLISHED`\|`DEPRECATED` |
| `formula_ref` | string | oui | Référence au code de calcul |
| `formula_hash` | string | oui si `PUBLISHED` | Hash du code/formule versionné, format `sha256:<64 hex>` |
| `input_schema` | object | oui | Contrat des données d’entrée |
| `output_schema` | object | oui | Contrat des valeurs produites |
| `parameters_schema` | object | oui | Contrat des paramètres de calcul |
| `deterministic` | boolean | oui | `true` requis pour publier |
| `point_in_time_safe` | boolean | oui | `true` requis pour publier ; interdit le lookahead |

## Tables runtime préparées

- `feature_computation_runs` journalise un calcul par `(feature_version_id, dataset_id, parameters_hash)` avec `output_hash` et `provenance_hash`.
- `feature_value_points` stocke les points immuables calculés, horodatés par `observed_at_utc` et `available_at_utc`.

## Invariants

- Une Feature Version `PUBLISHED` doit avoir `formula_hash`, `deterministic=true`, `point_in_time_safe=true` et `published_at_utc`.
- Un calcul `COMPLETED` doit avoir `output_hash` et `provenance_hash`.
- Les valeurs `OK` doivent porter une valeur numérique ou JSON ; les gaps restent représentables via `quality`.

## Exemple JSON

```json
{
  "id": "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
  "feature_key": "atr_14",
  "name": "ATR Wilder 14",
  "category": "volatility",
  "output_kind": "SERIES",
  "definition_status": "ACTIVE",
  "version_id": "8a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "version": "wilder_atr_14_v1",
  "version_status": "PUBLISHED",
  "formula_ref": "mcp_gpt_desk/src/market-volatility-indicators.js#computeWilderAtr14",
  "formula_hash": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  "input_schema": { "requires": ["high", "low", "close", "previous_close"] },
  "output_schema": { "type": "number", "unit": "points" },
  "parameters_schema": { "period": 14 },
  "deterministic": true,
  "point_in_time_safe": true
}
```
