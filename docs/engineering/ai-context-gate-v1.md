# AI Context Gate V1

Tickets couverts : TD2-802, TD2-803, TD2-804.

## Objectif

`AI Context Gate V1` exécute l’avis contextuel IA autour d’un candidat déjà déterministe, avec trois garanties :

- démarrage en `SHADOW` ;
- timeout/fallback déterministe ;
- activation contraignante uniquement après validation opérateur explicite.

## Placement

- Domaine pur : `packages/desk-domain/src/ai-context-gate-v1.js`.
- Contrat advisory : `packages/desk-domain/src/ai-context-advisory-v1.js`.
- Tests : `packages/desk-domain/test/ai-context-gate-v1.test.js`.

## Modes

| Mode | Effet |
|---|---|
| `SHADOW` | avis observé et journalisable, aucune influence sur l’arbitrage |
| `ADVISORY` | avis lisible par l’opérateur et les projections, toujours non contraignant |
| `ENFORCED` | seulement si `enforcement_validated=true`; produit une contrainte pour Portfolio Risk |

## Statuts

- `SHADOW_RECORDED` : avis valide enregistré en observation.
- `ADVISORY_READY` : avis consultatif prêt.
- `ENFORCED_DECISION_READY` : contrainte portfolio prête après validation opérateur.
- `ENFORCED_BLOCKED` : tentative enforced sans validation.
- `FALLBACK_WAIT` : timeout ou sortie invalide, fallback `WAIT`.
- `DISABLED` : gate désactivé, fallback `WAIT`.

## Fallback

Le fallback est toujours :

```json
{
  "recommendation": "WAIT",
  "confidence": 0,
  "effect": "READ_ONLY_ADVISORY"
}
```

Raisons couvertes :

- `AI_CONTEXT_TIMEOUT` ;
- `AI_CONTEXT_INVALID_ADVISORY` ;
- `AI_CONTEXT_DISABLED` ;
- `AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED`.

## Décision contraignante validée

Quand `mode=ENFORCED` et `enforcement_validated=true`, la recommandation devient une contrainte d’arbitrage portefeuille, pas un ordre :

| Recommandation | `portfolio_action` |
|---|---|
| `TAKE` | `ALLOW` |
| `TAKE_REDUCED` | `REQUEST_RISK_REDUCTION` |
| `WAIT` | `DEFER` |
| `REJECT` | `BLOCK_CANDIDATE` |

Le résultat conserve :

- `order_intent_allowed=false` ;
- `order_intents_created=[]` ;
- `target_positions_created=[]` ;
- `broker_writes=[]`.

## Invariant

Même en mode contraignant validé, l’AI Context Gate ne décide pas d’exécuter. Il ne fournit qu’une contrainte à `portfolio-risk`, qui reste soumis au Global Risk Engine puis au Broker Netting Engine.
