# Contract — Event Envelope

- **But** : structure d'événement uniforme transverse (ADR-0012), rend possible la traçabilité de bout en bout (SC-7).
- **Producteur** : tout composant nouveau de ce dossier.
- **Consommateurs** : `14-EVENTS-APIS-AND-MCP-SURFACE.md`, tableau de bord opérateur.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant unique de l'événement |
| `type` | string | oui | Type d'événement (ex. `signal.emitted`) |
| `correlation_id` | string | oui | Racine de la chaîne causale |
| `causation_id` | string (nullable) | non | Événement cause directe (nullable pour un événement racine) |
| `payload` | object | oui | Contenu métier de l'événement |
| `emitted_at` | timestamp | oui | Horodatage d'émission |
| `emitted_by` | string | oui | Composant émetteur |

## Exemple JSON

```json
{
  "id": "f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f809142",
  "type": "signal.emitted",
  "correlation_id": "corr-20260807-1432-es",
  "causation_id": null,
  "payload": { "strategy_instance_id": "d4e5f6a7-8b9c-4d1e-9f2a-3b4c5d6e7f80", "instrument": "ES" },
  "emitted_at": "2026-08-07T14:32:15Z",
  "emitted_by": "live-strategy-runtime"
}
```
