# Prompt Evaluation Policy V1

TD2-PRM-006 ajoute le gate déterministe qui décide si une composition de prompt peut être promue.

## Placement

- Module propriétaire : `agents`.
- Couche : domaine pur transitoire dans `packages/desk-domain/src/prompt-evaluation-policy-v1.js`.
- Persistance : table `prompt_evaluations` créée par PRM-002.
- Consommateurs prévus : service applicatif `agents`, écran opérateur PRM-007, garde de promotion PRM-008.

## Gates

Une composition candidate est `PASS` uniquement si :

- l'identité et `rendered_sha256` sont présents ;
- un dataset d'évaluation est fourni ;
- le scan sécurité passe sans finding critique ;
- la validation de contrat passe sans violation ;
- la non-régression est passée et le delta qualité reste dans le seuil ;
- la qualité atteint le score minimal ;
- les métriques tokens, coût et latence sont disponibles.

Les dépassements de coût, latence ou tokens produisent `REVIEW`, pas `PASS`. Les absences de preuve, les violations contrat, les findings critiques et les régressions fortes produisent `FAIL`.

## Historisation

`evaluatePromptCandidateV1` retourne un record compatible avec `prompt_evaluations` :

- `evaluation_status` ;
- `security_status` ;
- `regression_status` ;
- `quality_score`, tokens, latence et coût ;
- `report_hash` ;
- `report` structuré avec checks et seuils.

## Rollback

Cette policy ne modifie aucun binding. Si un canary échoue ou passe en `REVIEW`, TD2-PRM-004 fournit le rollback vers `last_known_good`.

## Tests

- `packages/desk-domain/test/prompt-evaluation-policy-v1.test.js`.
- Suite domaine : `npm --prefix packages/desk-domain test`.
