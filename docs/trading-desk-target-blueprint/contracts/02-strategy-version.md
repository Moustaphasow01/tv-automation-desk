# Contract — Strategy Version

- **But** : révision figée et testable d'une Strategy Definition. Immuable une fois `PUBLISHED` (voir ADR-0001, §2.2 du modèle de domaine).
- **Producteur** : compilation DSL (`07`) ou génération assistée (Research Lab, `09`).
- **Consommateurs** : Strategy Instance, Run (Simulation Engine, `08`).
- **Statut** : `CIBLE REQUISE`, forme proposée — à formaliser au Ticket 1.2.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `strategy_definition_id` | uuid (FK) | oui | Référence la Strategy Definition |
| `version_label` | string | oui | ex. semver |
| `status` | enum | oui | `DRAFT`\|`IN_SIMULATION`\|`VALIDATED`\|`PUBLISHED`\|`DEPRECATED` — statut propre, distinct de tout état d'exécution |
| `dsl_source_hash` | string | oui | Hash du code source DSL compilé |
| `compiled_artifact_ref` | string | oui | Référence à la représentation intermédiaire compilée |
| `validated_metrics_ref` | uuid (FK, nullable) | non | Référence vers le Run de validation |
| `runtime_contract_bundle_version` | string | oui | Version du Runtime Contract Bundle utilisée à la compilation (lecture seule, ADR-0001) |

## Exemple JSON

```json
{
  "id": "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11",
  "strategy_definition_id": "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b",
  "version_label": "1.2.0",
  "status": "VALIDATED",
  "dsl_source_hash": "sha256:9f8a...",
  "compiled_artifact_ref": "artifacts/strategy-versions/3b2f1a90.plan.json",
  "validated_metrics_ref": "6c1a3e00-1111-4a2b-9c3d-abcdef012345",
  "runtime_contract_bundle_version": "engine=5.4.0,catalog=v1-2"
}
```
