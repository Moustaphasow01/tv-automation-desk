# Contract — AI Context Advisory

- **But** : avis LLM encadré SHADOW/ADVISORY, jamais décisionnel (ADR-0009, INV-1).
- **Producteur** : AI Context Gate (`12`).
- **Consommateurs** : Portfolio Arbitration Engine (lecture seule), opérateur.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `signal_id` | uuid (FK, nullable) | non | Signal concerné, si applicable |
| `recommendation` | enum | oui | `TAKE`\|`TAKE_REDUCED`\|`WAIT`\|`REJECT` — jamais autre chose |
| `rationale` | string | oui | Justification textuelle |
| `model_ref` | string | oui | Référence au modèle utilisé |
| `issued_at` | timestamp | oui | Horodatage d'émission |

## Exemple JSON

```json
{
  "id": "b8c9d0e1-f2a3-4b4c-5d6e-7f8091426374",
  "signal_id": "a7b8c9d0-e1f2-4a3b-4c5d-6e7f80914263",
  "recommendation": "TAKE_REDUCED",
  "rationale": "Contexte macro haussier mais volatilité implicite élevée — taille réduite recommandée",
  "model_ref": "codex-cli/thesis-monitor-agent",
  "issued_at": "2026-08-07T14:32:20Z"
}
```

**Rappel structurel** : ce contrat ne porte **aucun** champ permettant de référencer ou produire directement un `Order Intent` — c'est une garde intentionnelle de la forme du contrat, pas seulement une convention (voir `12` §3).
