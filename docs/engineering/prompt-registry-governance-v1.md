# Prompt Registry Governance V1

TD2-PRM-008 verrouille les changements de prompts avant toute mutation opérateur.

## Placement

- Module propriétaire : `agents`.
- Couche : domaine pur transitoire dans `packages/desk-domain/src/prompt-registry-governance-v1.js`.
- Configuration revue Git : `config/prompt-registry/prompt-governance.v1.json`.
- Guard repo : `scripts/quality/check_prompt_registry.mjs`.

## Règles

- Effet par défaut : `DENY`.
- Les lectures sont autorisées aux rôles opérateur/agent.
- Les écritures exigent `prompt_registry_admin`.
- Chaque écriture exige une phrase de confirmation exacte, une raison, une idempotency key et un audit.
- `PUBLISH_PROMPT_VERSION` et `DEPLOY_PROMPT_COMPOSITION` exigent une évaluation `PASS`.
- `ROLLBACK_PROMPT_BINDING` peut se faire même après évaluation `FAIL`, mais conserve confirmation, raison, idempotence et audit.
- Les prompts ne doivent contenir aucun secret.

## Interdiction de contournement

Le fichier de gouvernance marque explicitement :

- `latest_resolution_after_claim = FORBIDDEN` ;
- `direct_prompt_file_runtime_use = FORBIDDEN_AFTER_REGISTRY_CUTOVER` ;
- `operator_ui_mutation_without_backend_action = FORBIDDEN`.

Le front PRM-007 reste donc en lecture seule tant que cette gouvernance n'est pas câblée dans un use case applicatif transactionnel.

## Validation

- `packages/desk-domain/test/prompt-registry-governance-v1.test.js`.
- `npm run guard:prompt-registry`.
- `npm run guard:prompt-registry:test`.
