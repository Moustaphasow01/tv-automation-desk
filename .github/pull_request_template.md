# Trading Desk PR — architectural report

## Jira

- Ticket principal :
- Tickets liés créés pendant le chantier :
- Epic / phase :

## Résumé opérateur

Décrire le résultat en langage métier : ce qui change pour le desk, les workers,
le moteur, le front, le replay, le live ou l'exploitation.

## Placement architectural obligatoire

- Bounded context propriétaire :
- Couche touchée : domain / application / api / adapter / reporting / legacy host / infra / docs
- Responsabilité ajoutée ou modifiée :
- Consommateurs :
- Alternatives écartées :
- Pourquoi l'existant ne suffisait pas :

## Frontières et contrats

- Imports cross-module ajoutés :
- API publique / événement / projection utilisée :
- Contrats, schemas, prompts ou migrations modifiés :
- Compatibilité live / replay / shadow / paper :
- Rollback possible :

## Touch-and-improve

Si une zone legacy est touchée, indiquer une réduction mesurable.

- Zone legacy touchée :
- Dette avant :
- Dette après :
- Mesure réduite : taille / complexité / duplication / nommage / frontière / typage / couverture
- Exception utilisée : oui/non, ID si oui

## Tests et preuves

Cocher uniquement les validations réellement exécutées.

- [ ] `npm run typecheck`
- [ ] `npm run test:react`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `npm run test:stack`
- [ ] `npm run guard:architecture`
- [ ] `npm run guard:static-quality`
- [ ] `npm run guard:exceptions`
- [ ] `npm run guard:architecture-scorecard`
- [ ] `npm run guard:pr-governance`
- [ ] `npm run guard:security-supply-chain`
- [ ] `npm run guard:sql-migrations`
- [ ] `npm run guard:problem-details`
- [ ] `npm run guard:runtime-safety`
- [ ] `npm run guard:mcp-slices`
- [ ] `npm run guard:front-architecture`
- [ ] `npm run certify:resilience`
- [ ] `npm --prefix packages/desk-domain run coverage:gate`
- [ ] `npm --prefix mcp_gpt_desk test`
- [ ] `docker compose config --quiet`

Notes de validation :

## Observabilité, sécurité et exploitation

- Audit / logs / métriques ajoutés :
- Secrets ou permissions touchés :
- Risque broker ou ordre réel :
- Mode de déploiement :
- Plan de rollback / désactivation :

## Limites assumées

- Dette restante :
- Ticket de suite :
- Décision ADR nécessaire :
