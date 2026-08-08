# Contract — Strategy Instance

- **But** : exécution paramétrée d'une Strategy Version, avec deux axes d'état indépendants (ADR-0002). C'est le contrat le plus sensible du dossier au regard de la sûreté d'exécution.
- **Producteur** : Live Strategy Runtime (`10`).
- **Consommateurs** : Portfolio Arbitration Engine (`11`), Reconciliation Engine (`13`).
- **Statut** : `CIBLE REQUISE`, forme proposée — à formaliser au Ticket 1.3.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `strategy_version_id` | uuid (FK) | oui | Référence la Strategy Version |
| `runtime_state` | enum | oui | Axe A — `CREATED`\|`STARTING`\|`RUNNING`\|`PAUSED`\|`STOPPING`\|`STOPPED`\|`FAILED_TO_START`\|`ERRORED` |
| `execution_mode` | enum | oui | Axe B — `SHADOW`\|`PAPER`\|`LIVE`, jamais fusionné avec `runtime_state` |
| `account_scope` | string | oui | Compte broker concerné (PAPER/LIVE uniquement) |
| `risk_budget_ref` | uuid (FK, nullable) | non | Référence Risk Budget |
| `triple_lock_validated` | boolean | oui | Garde technique — doit être `true` avant toute transition vers `LIVE` si une autre instance est déjà `LIVE` sur le même compte (ADR-0007) |
| `last_heartbeat_at` | timestamp | oui | Dernière preuve de vie |

## Exemple JSON

```json
{
  "id": "d4e5f6a7-8b9c-4d1e-9f2a-3b4c5d6e7f80",
  "strategy_version_id": "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11",
  "runtime_state": "RUNNING",
  "execution_mode": "PAPER",
  "account_scope": "paper-sim-001",
  "risk_budget_ref": null,
  "triple_lock_validated": false,
  "last_heartbeat_at": "2026-08-07T14:32:11Z"
}
```
