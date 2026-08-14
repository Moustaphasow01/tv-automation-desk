# Contract — Batch

- **But** : regrouper plusieurs Task avec une politique d'agrégation explicite (ADR-0014).
- **Producteur** : Mission.
- **Consommateurs** : consommateur final du résultat agrégé (ex. moniteur de thèse).
- **Statut** : `CIBLE REQUISE`, sémantique de jointure V1 implémentée côté domaine par `TD2-409`.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `task_ids` | array[uuid] | oui | Tasks regroupées |
| `policy` | enum | oui | `ALL`\|`ANY`\|`FIRST_SOCK`\|`QUORUM`\|`TIMEOUT_WITH_PARTIAL_RESULTS` |
| `status` | enum | oui | `WAITING`\|`COMPLETED`\|`COMPLETED_PARTIAL`\|`FAILED`\|`TIMED_OUT` |
| `deadline_at` | timestamp | non | Échéance (pertinent pour `TIMEOUT_WITH_PARTIAL_RESULTS`) |
| `quorum_size` | integer | non | Seuil explicite pour `QUORUM`, majorité par défaut |
| `open_task_ids` | array[uuid] | oui | Tâches non terminées au moment de la décision |
| `failed_task_ids` | array[uuid] | oui | Tâches terminalement échouées |
| `join_hash` | string | oui | Hash canonique de la décision de jointure |

## Sémantique V1

- `ALL` : attend tout ; échoue si une tâche échoue.
- `ANY` : accepte le premier succès disponible.
- `FIRST_SOCK` : accepte le premier succès chronologique et marque les tâches ouvertes comme superseded côté plan.
- `QUORUM` : accepte quand le seuil est atteint.
- `TIMEOUT_WITH_PARTIAL_RESULTS` : retourne les résultats disponibles après deadline et liste explicitement les tâches ouvertes.

## Exemple JSON

```json
{
  "id": "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091",
  "task_ids": ["d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80"],
  "policy": "TIMEOUT_WITH_PARTIAL_RESULTS",
  "status": "COMPLETED_PARTIAL",
  "deadline_at": "2026-08-07T14:35:00Z",
  "open_task_ids": [],
  "failed_task_ids": [],
  "join_hash": "sha256:..."
}
```
