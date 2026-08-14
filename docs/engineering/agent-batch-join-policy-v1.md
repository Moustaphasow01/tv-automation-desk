# Agent Batch Join Policy V1

> Ticket : `TD2-409`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Agent Batch Join Policy V1` décide quand un groupe de tâches IA peut produire un résultat agrégé.

Cette policy évite deux fragilités :

- bloquer tout un cycle Live/Replay parce qu'un sous-agent est lent ;
- ignorer silencieusement des sous-tâches ouvertes ou échouées.

## Placement

- Module propriétaire : `agents`.
- Domaine pur : `packages/desk-domain/src/agent-batch-join-policy-v1.js`.
- Export public : `packages/desk-domain/index.js`.

Il n'y a pas de migration SQL dans TD2-409. La persistance Batch sera ajoutée quand le runtime créera réellement des batchs durables. Ici, on stabilise d'abord la sémantique déterministe.

## Politiques supportées

| Policy | Décision |
| --- | --- |
| `ALL` | attend tous les résultats ; échoue dès qu'une sous-tâche est terminalement échouée. |
| `ANY` | accepte le premier succès disponible ; échoue seulement si plus aucun succès n'est possible. |
| `FIRST_SOCK` | accepte le premier succès chronologique et marque les tâches ouvertes comme `MARK_SUPERSEDED` côté plan. |
| `QUORUM` | accepte lorsque le seuil `quorum_size` est atteint ; échoue si le seuil devient impossible. |
| `TIMEOUT_WITH_PARTIAL_RESULTS` | avant deadline, attend ; après deadline, retourne les résultats disponibles et liste les tâches non terminées. |

## Statuts de jointure

- `WAITING` : résultat agrégé pas encore disponible.
- `COMPLETED` : résultat complet ou succès suffisant sans reste pertinent.
- `COMPLETED_PARTIAL` : résultat exploitable mais incomplet.
- `FAILED` : aucun résultat acceptable ou politique devenue impossible.
- `TIMED_OUT` : deadline atteinte sans aucun résultat disponible.

## Invariants

- Une tâche non terminée est toujours listée dans `open_task_ids`.
- Une tâche échouée est toujours listée dans `failed_task_ids`.
- Les actions restantes sont explicites : `MARK_SUPERSEDED` pour `FIRST_SOCK`, `KEEP_UNFINISHED` pour timeout partiel.
- La décision est hashée via `join_hash`; même entrée + même horloge = même résultat.
- La policy ne modifie pas les tâches : elle produit un plan. La mutation éventuelle sera un use case séparé.

## Rollback

La policy n'est pas branchée par défaut sur les pipelines Live/Replay existants. Le rollback consiste à ne pas appeler cette policy dans les futurs use cases Batch.

ADR-0020 reste respectée : aucun comportement observable du pipeline GPT-first n'est modifié par TD2-409.

## Tests

- `packages/desk-domain/test/agent-batch-join-policy-v1.test.js`.
- `npm --prefix packages/desk-domain test`.
