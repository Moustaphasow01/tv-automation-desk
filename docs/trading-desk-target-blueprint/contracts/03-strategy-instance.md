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
| `metadata.scheduler` | object | non | Configuration additive TD2-600 : cadence, prochain tick attendu, dernier tick planifié, seuil de retard |
| `performance_drift` | object | non | Rapport optionnel TD2-605 : comparaison baseline vs observations runtime |

## Scheduler runtime V1

TD2-600 introduit un scheduler par Strategy Instance :

- `RUNNING` et `STARTING` sont les seuls états schedulables ;
- `PAUSED`, `STOPPED`, `FAILED_TO_START` et `ERRORED` ne produisent aucun tick ;
- la priorité d’exécution est `LIVE`, puis `PAPER`, puis `SHADOW` ;
- l’idempotence de redémarrage repose sur `scheduler_run_key = strategy_instance_id + scheduled_for_utc`.

## Promotion et rollback TD2-603

La transition `SHADOW → PAPER` est manuelle :

- elle exige un `operator_approval_id` explicite ;
- une métrique ou une preuve de parité ne suffit jamais à promouvoir automatiquement une instance ;
- le passage se fait via une transition auditée de `StrategyKernelService`.

Le rollback `PAPER → SHADOW` exige une raison opérateur auditée et efface l’approbation paper active.

TD2-603 n’ajoute aucun nouveau chemin vers `LIVE`.

## Dérive de performance TD2-605

Une Strategy Instance peut exposer un rapport `performance_drift` produit par le domaine `strategy_live_performance_drift_v1`.

Statuts autorisés :

- `OK`;
- `WATCH`;
- `DRIFT`;
- `BASELINE_MISSING`;
- `INSUFFICIENT_DATA`.

Sources transitoires acceptées dans `metadata` :

- baseline : `performance_baseline`, `baseline_metrics`;
- observations : `performance_observed`, `observed_metrics`, `paper_metrics`, `shadow_metrics`, `live_metrics`.

Le statut `DRIFT` peut recommander une pause opérateur, mais ne modifie pas automatiquement `runtime_state`.

Exemple de configuration :

```json
{
  "metadata": {
    "scheduler": {
      "enabled": true,
      "cadence_seconds": 60,
      "max_lag_seconds": 120,
      "next_due_at_utc": "2026-08-09T08:01:00.000Z"
    }
  }
}
```

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
