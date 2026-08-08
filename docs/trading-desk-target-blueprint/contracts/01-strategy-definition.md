# Contract — Strategy Definition

- **But** : identifier une idée de stratégie, indépendamment de toute implémentation figée.
- **Producteur** : opérateur ou chercheur, via l'outillage du Research Lab (`09`) ou directement.
- **Consommateurs** : Strategy Version (référence par `id`).
- **Statut** : `CIBLE REQUISE`, forme proposée — à formaliser en JSON Schema au Ticket 1.1.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `name` | string | oui | Nom lisible |
| `description` | string | non | Intention de la stratégie |
| `owner` | string | oui | Auteur/responsable |
| `created_at` | timestamp | oui | Horodatage de création |

## Exemple JSON

```json
{
  "id": "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b",
  "name": "Breakout Retest ES",
  "description": "Entrée sur retest de cassure de range asiatique, session US open",
  "owner": "operator@desk",
  "created_at": "2026-08-07T09:00:00Z"
}
```
