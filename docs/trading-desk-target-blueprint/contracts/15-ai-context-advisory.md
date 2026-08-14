# Contract — AI Context Advisory

- **But** : avis LLM encadré SHADOW/ADVISORY, jamais décisionnel (ADR-0009, INV-1).
- **Producteur** : AI Context Gate (`12`).
- **Consommateurs** : Portfolio Arbitration Engine (lecture seule), opérateur.
- **Statut** : `CIBLE REQUISE`, forme proposée.
- **Implémentation TD2-800** : `packages/desk-domain/src/ai-context-advisory-v1.js` formalise `ai_context_advisory_v1` et sa preuve `ai_context_advisory_isolation_proof_v1`.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `schema_version` | string | oui | `ai_context_advisory_v1` |
| `advisory_id` | string | oui | Identifiant stable |
| `subject.subject_type` | enum | oui | `SIGNAL`, `POSITION` ou `CANDIDATE_ALLOCATION` déjà existant |
| `subject.subject_id` | string | oui | Identifiant du sujet lu |
| `signal_id` | string (nullable) | non | Signal concerné, si applicable |
| `position_id` | string (nullable) | non | Position existante concernée, si applicable |
| `candidate_allocation_id` | string (nullable) | non | Allocation déjà produite par le moteur, référence lecture seule |
| `recommendation` | enum | oui | `TAKE`\|`TAKE_REDUCED`\|`WAIT`\|`REJECT` — jamais autre chose |
| `confidence` | number (0-1, nullable) | non | Niveau de confiance explicatif, non exécutable |
| `rationale` | string | oui | Justification textuelle |
| `model_ref` | string | oui | Référence au modèle utilisé |
| `evidence_refs[]` | array | non | Références à datasets/news/événements consultés |
| `effect` | enum | oui | Toujours `READ_ONLY_ADVISORY` |
| `issued_at_utc` | timestamp | oui | Horodatage d'émission |
| `expires_at_utc` | timestamp (nullable) | non | Date limite de pertinence |
| `advisory_hash` | sha256 | oui | Empreinte canonique du contrat |

## Exemple JSON

```json
{
  "schema_version": "ai_context_advisory_v1",
  "advisory_id": "aictx_6d2c889ad0a8a77a9997edb1",
  "subject": {
    "subject_type": "CANDIDATE_ALLOCATION",
    "subject_id": "candalloc:mnq:2026-08-07T14:30Z",
    "signal_id": null,
    "position_id": null,
    "candidate_allocation_id": "candalloc:mnq:2026-08-07T14:30Z"
  },
  "recommendation": "TAKE_REDUCED",
  "confidence": 0.71,
  "rationale": "Contexte macro haussier mais volatilité implicite élevée — taille réduite recommandée",
  "model_ref": "codex/context-decision/xhigh",
  "evidence_refs": [{ "ref": "dataset:news_digest:2026-08-07T14:30Z" }],
  "effect": "READ_ONLY_ADVISORY",
  "issued_at_utc": "2026-08-07T14:32:20Z",
  "expires_at_utc": "2026-08-07T14:47:20Z",
  "advisory_hash": "sha256:..."
}
```

**Rappel structurel** : ce contrat ne porte **aucun** champ permettant de référencer ou produire directement un `Order Intent` — c'est une garde intentionnelle de la forme du contrat, pas seulement une convention (voir `12` §3).

## Preuve TD2-800

La preuve `ai_context_advisory_isolation_proof_v1` est calculée par `proveAiContextAdvisoryIsolationV1`.

Elle échoue si une entrée ou sortie contient un champ broker, ordre, quantité, outbox d’exécution, provider contract ou une sémantique de création de `OrderIntent`, `TargetPosition` ou `CandidateAllocation`.

Elle doit rester verte avant toute promotion du gate hors SHADOW.
