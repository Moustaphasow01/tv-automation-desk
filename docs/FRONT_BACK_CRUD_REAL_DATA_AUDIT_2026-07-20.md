# Audit CRUD front/back et zéro mock runtime — 2026-07-20

## Résultat

Le front preprod lit les données via l’API locale `/api/v1` et l’API locale lit PostgreSQL Docker (`mode=postgres`). Aucun fallback métier runtime ne doit recalculer ou simuler des métriques front.

## Corrections appliquées

- `ReplayLabPage` ne recalcule plus un résumé replay côté navigateur si `summary` manque dans la réponse backend.
- `ReplayList.summary` est obligatoire côté contrat TypeScript front.
- La création replay front envoie `timezone: "Europe/Paris"`.
- La route `POST /api/v1/replays` accepte une timezone optionnelle et applique `Europe/Paris` par défaut.
- `buildOrchestratedReplayRunDoc` passe la timezone normalisée à `createDeskExecutionScope`, ce qui évite `SCOPE_REQUIRED: timezone is required`.
- Ajout d’un test backend qui garantit qu’une création replay sans timezone explicite délègue bien `Europe/Paris`.

## Preuves API locale

- `GET /status` : `ok=true`, `mode=postgres`, database `desk`.
- `GET /api/v1/operations/summary` : contrat `DeskOperationsSummary`, données workflows/incidents/GPT réelles.
- `GET /api/v1/replays?limit=5` : contrat `DeskReplayList`, `summary` renvoyé par le backend.
- `POST /api/v1/observability/policy` : écriture réelle validée, revision policy passée à `1`, lecture suivante `persisted=true`.
- `POST /api/v1/replays` : création réelle d’un replay d’audit local avec `automation_enabled=false`, sans autopilot.
- `POST /api/v1/workflows/:id/actions` : action `cancel` appliquée sur le replay d’audit, revision passée à `1`.

## Preuves navigateur

Tests Playwright sur `localhost:8080` après rebuild Docker :

- `#/live` : h1 `Live Desk`, 9 appels `/api/v1`, 0 erreur API, 0 erreur console.
- `#/replay` : h1 `Replay Lab`, `/api/v1/replays` en 200, 0 erreur console.
- `#/operations` : h1 `Cockpit des opérations`, 13 appels `/api/v1`, 0 erreur API, 0 erreur console.
- `#/operations/observability` : h1 `Observabilité & coûts GPT`, 11 appels `/api/v1`, 0 erreur API, 0 erreur console.

## Scan zéro mock runtime

Commande :

```bash
rg -n "fallbackSummary|mock|fixture|fake|demo|dummy|sample|synthetic|simulée|simulé|inventé|inventée" src --glob '!src/test/**'
```

Constat :

- Plus de `fallbackSummary`.
- Les fixtures/mocks restants sont uniquement sous `src/test`.
- Les occurrences runtime restantes sont des états vides/UX qui disent explicitement qu’aucun prix ou performance n’est simulé.
- `chart-fallback-timeline` est un nom de classe CSS : il affiche des événements réels quand aucune bougie matérialisée n’est disponible.

## Tests passés

```bash
npm run typecheck
npm run test:react
npm run build
node --check mcp_gpt_desk/src/front-operations-api.js
node --check mcp_gpt_desk/src/desk-replay-orchestration-algorithms.js
cd mcp_gpt_desk && node --test test/front_operations_api.test.js test/front_operations_service.test.js test/replay_autopilot.test.js test/replay_bundle_transport.test.js
```

Résultats :

- React/Vitest : 16 tests passés.
- Backend ciblé : 43 tests passés.
- Build front production : OK.
- Docker : services `api`, `frontend`, `postgres` reconstruits/redémarrés et healthy.

## Limite assumée

L’API front n’expose pas de `DELETE`. Le modèle opérationnel actuel utilise des mutations commandées et auditables (`cancel`, `pause`, `resume`, `resolve`, `archive/clear` selon les objets) plutôt qu’un DELETE brut.

