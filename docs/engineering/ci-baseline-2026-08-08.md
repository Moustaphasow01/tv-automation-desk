# CI / Docker / E2E baseline — 2026-08-08

> Ticket : `TD2-002` — Exécuter CI Docker E2E et publier le rapport.

## Source de vérité

Les commandes ont été prises depuis le dépôt :

- `package.json` ;
- `.github/workflows/local-ci.yml` ;
- scripts package `packages/*/package.json` et `mcp_gpt_desk/package.json`.

Aucune commande de validation n'a été inventée hors des scripts et workflows
versionnés. Quand une commande du workflow était une commande d'installation
(`npm ci`) ou nécessitait un daemon Docker actif, elle est classée explicitement.

## Résultat synthétique

Statut baseline : `PASS_WITH_ENVIRONMENT_LIMITATION`.

La baseline applicative, front, contrats, packages internes, MCP et E2E est verte.
La limitation restante est environnementale : le daemon Docker Desktop n'est pas
joignable depuis cette session pour lancer `test:stack`, même si `docker.exe
compose config --quiet` valide correctement le fichier Compose.

## Commandes exécutées

| Commande | Résultat | Note |
| --- | --- | --- |
| `npm run typecheck` | OK | TypeScript app + node. |
| `npm run build` | OK | Build Vite production OK. |
| `npm run test:react` | OK | 9 fichiers, 52 tests. |
| `npm run test:e2e` | OK | 5/5 Playwright, webServer local 4173. |
| `npm run certify:resilience` | OK | 25 checks, rapport `.local/certification/resilience-20260808T211913277Z.json`. |
| `npm run guard:front-architecture` | OK | 6 fichiers requis, 79 fichiers runtime scannés. |
| `npm run guard:front-architecture:test` | OK | 2/2. |
| `npm run guard:architecture-scorecard` | OK | P-1 = 14/14. |
| `npm run guard:pr-governance` | OK | 14 commandes de validation attendues. |
| `npm run guard:static-quality` | OK | Baseline inchangée : 228/565/49/11. |
| `npm --prefix packages/desk-contracts run check:generated` | OK | Artifacts générés à jour + Strategy V5 OK. |
| `node scripts/quality/check_contracts_finalization.mjs` | OK | 5 contrats actifs validés, 0 violation. |
| `npm --prefix packages/desk-domain run coverage:gate` | OK | Gate domain OK. |
| `npm --prefix packages/desk-replay-engine test` | OK | 9/9. |
| `npm --prefix packages/desk-audit test` | OK | 8/8. |
| `npm --prefix packages/desk-time test` | OK | 6/6. |
| `npm --prefix mcp_gpt_desk run audit:backend-cleanup` | OK | 633 fichiers scannés, 101 findings, 24 scripts non référencés. |
| `npm --prefix mcp_gpt_desk test` | OK | 770/770. |
| `/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe compose config --quiet` | OK | Compose syntax/config validée via Docker Desktop Windows. |
| `npm run baseline:environment:test` | OK | 1/1. |
| `npm run baseline:environment -- --include-vps` | OK | Rapport `.local/baseline/environment-baseline-20260808T214412700Z.json`, VPS capturé. |

## Commandes classées environnement

| Commande | Statut | Cause |
| --- | --- | --- |
| `docker compose ps --format json` | ENV_BLOCKED | Docker daemon non joignable : pipe `dockerDesktopLinuxEngine` introuvable. |
| `npm run test:stack` | ENV_BLOCKED | Le script exige une stack Docker déjà en cours (`api`, `frontend`, `postgres`) et le binaire `docker` WSL. La validation Compose a été faite via `docker.exe`, mais le daemon n'était pas disponible pour exécuter la stack. |
| `npm ci` / `npm --prefix mcp_gpt_desk ci` | NOT_RUN_INSTALL_STEP | Étapes d'installation CI non nécessaires pour établir la baseline du workspace courant ; à rejouer en CI propre ou avant release. |

## Échecs bloquants

Aucun échec applicatif bloquant détecté.

## Dette / limites

- `test:stack` doit être rejoué dès que Docker Desktop expose le daemon Linux à
  WSL ou depuis une CI Linux propre.
- `audit:backend-cleanup` produit une liste de dette volontairement non bloquante
  : 101 findings et 24 scripts non référencés. Cette sortie alimente `TD2-003`.
- La baseline runtime PostgreSQL distante reste `not_configured` tant qu'une URL
  read-only n'est pas fournie explicitement à `baseline:environment`.

## Baseline de non-régression

Pour les tickets suivants, un changement ne doit pas dégrader :

- `npm run test:e2e` : 5/5 ;
- `npm run test:react` : 52/52 ;
- `npm --prefix mcp_gpt_desk test` : 770/770 ;
- `npm run certify:resilience` : 25 checks ;
- `docker.exe compose config --quiet` : OK.

Si `test:stack` devient exécutable, son premier passage vert remplacera la limite
`ENV_BLOCKED` par une baseline stricte.
