# Front V2 — Mapping Provider Lifecycle

Le registre visuel traduit les codes publiés ; il ne crée aucune transition.

| Source backend | Présentation | Règle UX |
| --- | --- | --- |
| OrderIntent créé | Proposition autorisée | Ce n'est ni une confirmation ni une exécution |
| Human Gate confirmé | Confirmation opérateur | Ce n'est pas un ACK broker |
| Provider command créé/claimé | Transmission en cours | Afficher l'acteur et la corrélation |
| `ORDER_ACCEPTED` / état ACK publié | Accepté par le provider | Ce n'est pas un fill |
| `ORDER_PARTIALLY_FILLED` | Partiellement exécuté | Quantité restante visible si publiée |
| `ORDER_FILLED` | Exécuté | Prix/quantité seulement depuis le broker |
| `ORDER_REJECTED` | Rejet provider | Raison brute conservée dans l'inspecteur |
| Circuit `OPEN` | Exécution indisponible | Actions désactivées par `allowedActions` |
| Réconciliation divergente | Anomalie prioritaire | Persiste jusqu'à résolution backend |
| Code inconnu | Statut inconnu | Ne casse pas la vue ; code brut visible |

## Événement UI minimal

```text
eventId, eventType, rawStatus, occurredAt, receivedAt,
source, actor, entity, correlationId, causationId,
sequence, revision, details
```

Sans métadonnées d'ordre, la timeline affiche les événements reçus mais signale une couverture partielle. Elle ne fabrique ni `sequence`, ni ACK, ni état réconcilié.
