# Prompt Binding Policy V1

TD2-PRM-004 ajoute la politique déterministe qui résout le prompt opérationnel d'un agent sans `latest` implicite après claim.

## Placement

- Module propriétaire : `agents`.
- Couche : domaine pur transitoire dans `packages/desk-domain/src/prompt-binding-policy-v1.js`.
- Persistance : schéma PostgreSQL PRM-002 (`agent_prompt_bindings`, `prompt_deployments`, `prompt_audit_events`).
- Consommateurs prévus : workers Live/Replay/Codex, futur service applicatif `agents`, écran opérateur PRM-007.

Le domaine reste sans dépendance SQL, HTTP, MCP, React, Codex ou broker.

## Responsabilité

La policy :

- trouve un unique binding actif par `agent_role`, `mission_key`, `lane`, `environment` et fenêtre de validité ;
- refuse les bindings absents ou ambigus ;
- sélectionne une composition publiée ;
- route un canary par bucket déterministe et garde `last_known_good` comme fallback ;
- épingle `prompt_composition_id`, `prompt_version_id`, `rendered_sha256` et `resolution_hash` ;
- produit une décision de rollback auditable vers `last_known_good`.

## Invariants

- Une composition non publiée est refusée avec `PROMPT_COMPOSITION_NOT_PUBLISHED`.
- Un binding `CANARY` exige `last_known_good_composition_id`.
- Un binding `REVOKED` n'est jamais résolu.
- Le résultat de résolution contient un hash canonique stable et ne dépend pas de l'ordre des lignes en entrée.
- Le rollback ne modifie pas le texte du prompt : il bascule seulement le binding vers la composition connue saine.

## Rollback et sécurité

Le rollback opérationnel consiste à appliquer `buildPromptRollbackDecisionV1`, persister `next_binding` puis écrire `audit_event`. Le canary repasse à `0%`, la composition active devient `last_known_good` et l'événement conserve les hashes avant/après.

Aucun secret n'est rendu ou stocké par cette policy ; la redaction du rendu reste portée par `prompt-renderer-v1`.

## Alternatives écartées

- Résoudre le prompt dans `mcp_gpt_desk/src/store.js` : rejeté, car le host legacy ne doit pas devenir propriétaire de la logique `agents`.
- Laisser un worker choisir `latest` : rejeté, car un work item claimé doit épingler une version exacte.
- Canary aléatoire : rejeté, car la reproductibilité impose un bucket déterministe.

## Tests

- `packages/desk-domain/test/prompt-binding-policy-v1.test.js`.
- Suite domaine : `npm --prefix packages/desk-domain test`.
