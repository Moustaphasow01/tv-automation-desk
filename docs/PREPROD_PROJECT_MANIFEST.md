# Manifeste préproduction — runtime, qualité, docs et archive

Statut : Autopilot V4 local + kit pré-VPS Windows prêt  
Date : 2026-07-23  
Portée : dépôt préproduction et packaging Windows, sans déploiement externe.

Ce manifeste sert de carte officielle du dépôt après nettoyage. Il distingue ce qui participe au runtime local, ce qui sert aux validations, ce qui documente le projet et ce qui reste en archive.

## 1. Runtime actif

Ces éléments sont nécessaires pour faire tourner le Desk localement.

| Zone | Chemins | Rôle |
|---|---|---|
| Orchestration locale | `docker-compose.yml` | Lance PostgreSQL, l'API/MCP Node.js, le worker broker et le frontend Nginx. |
| Infrastructure conteneurisée | `infra/docker/`, `infra/nginx/`, `infra/postgres/init/` | Images API/frontend, reverse proxy local et schéma PostgreSQL initial. |
| Frontend | `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig*.json` | Application React/Vite servie par Nginx. |
| Backend API/MCP | `mcp_gpt_desk/src/`, `mcp_gpt_desk/contracts/`, `mcp_gpt_desk/package.json` | API locale, endpoint MCP, webhook TradingView, store PostgreSQL, replay et opérations. |
| Packages métier | `packages/desk-audit/`, `packages/desk-contracts/`, `packages/desk-domain/`, `packages/desk-replay-engine/`, `packages/desk-time/` | Règles pures, contrats, temps Europe/Paris et moteur replay. |
| Scripts runtime MCP | `mcp_gpt_desk/scripts/run_live_runtime_scheduler.mjs`, `mcp_gpt_desk/scripts/run_broker_management_worker.mjs`, `mcp_gpt_desk/scripts/run_live_checkpoint_cycle.mjs`, `mcp_gpt_desk/scripts/replay_autopilot_codex_agent.mjs`, `mcp_gpt_desk/scripts/build_local_pack.mjs`, `mcp_gpt_desk/scripts/seed_contracts.mjs` | Runtime LIVE continu, gestion broker, autopilot replay, packs SQL locaux et contrats. |
| Stockage immuable | `.local/desk_objects/` + `desk_pack_objects` | Bytes locaux ignorés par Git et catalogue PostgreSQL vérifiable. |
| Connecteur TradingView | `tradingview/` | Scripts Pine maintenus pour envoyer les alertes vers le webhook local ou futur endpoint équivalent. |
| Pont NinjaTrader | `integrations/ninjatrader/` | AddOn signé, superviseur Windows et tests Sim101. |
| Déploiement Windows | `deploy/windows/`, `deploy/caddy/`, `deploy/templates/` | Build de release, PostgreSQL natif, services, tâches, sécurité, update et rollback. |

Commandes runtime principales :

```bash
docker compose --env-file .env.preprod up --build -d
docker compose --env-file .env.preprod run --rm api npm run seed:contracts
npm --prefix mcp_gpt_desk run live:checkpoint-cycle
npm --prefix mcp_gpt_desk run live:runtime
npm --prefix mcp_gpt_desk run replay:autopilot-codex
npm --prefix mcp_gpt_desk run pack:build-local -- --date YYYY-MM-DD --session asia_open --purpose replay_source --cutoff-paris ISO
```

## 2. Qualité, tests et gates

Ces éléments ne font pas partie du produit servi, mais ils protègent les contrats et le comportement.

| Zone | Chemins / commandes | Rôle |
|---|---|---|
| Tests frontend | `src/test/`, `npm run test:react` | Tests React/Vitest. |
| Tests E2E UI | `e2e/`, `playwright.config.ts`, `npm run test:e2e` | Parcours navigateur avec environnement de test dédié. |
| Stack réelle locale | `scripts/stack/test_real_stack.sh`, `playwright.real.config.ts`, `npm run test:stack` | Vérifie Nginx, API et PostgreSQL réels via fixtures temporaires. |
| Tests backend MCP | `mcp_gpt_desk/test/`, `npm --prefix mcp_gpt_desk test` | Couverture du store, outils MCP, replay, webhook, opérations et contrats backend. |
| Gates contracts | `scripts/quality/check_contracts_finalization.mjs`, `npm --prefix packages/desk-contracts run check:generated` | Vérifie contrats actifs, registry et code généré. |
| Gate domaine | `scripts/quality/check_desk_domain_coverage.mjs`, `npm --prefix packages/desk-domain run coverage:gate` | Vérifie règles métier pures et seuils de couverture. |
| Gate contrats stratégie | `scripts/quality/check_strategy_contract_lock.mjs`, `npm run guard:strategy-contracts` | Interdit toute dérive des contrats Master V4 et Monitor V1. |
| Gate kit Windows | `scripts/quality/check_windows_deployment_kit.mjs`, `npm run guard:windows-deployment` | Vérifie packaging, sécurité fail-closed, Caddy, services et locks workers. |
| Benchmark local | `scripts/quality/benchmark_local_readiness.mjs`, `npm run benchmark:local` | Mesure les principales projections contre la stack réelle. |
| Audit cleanup | `mcp_gpt_desk/scripts/audit_backend_cleanup_candidates.mjs`, `npm --prefix mcp_gpt_desk run audit:backend-cleanup` | Vérifie qu'aucun marqueur actif ou script orphelin ne revient dans le périmètre surveillé. |
| CI locale | `.github/workflows/local-ci.yml` | Enchaîne les validations principales sans déploiement. |

Séquence de validation complète recommandée après changement significatif :

```bash
npm run typecheck
npm run guard:strategy-contracts
npm run guard:windows-deployment
npm run test:react
npm run build
node scripts/quality/check_contracts_finalization.mjs
npm --prefix packages/desk-contracts run check:generated
npm --prefix packages/desk-domain run coverage:gate
npm --prefix packages/desk-replay-engine test
npm --prefix packages/desk-audit test
npm --prefix packages/desk-time test
npm --prefix mcp_gpt_desk test
npm --prefix mcp_gpt_desk run audit:backend-cleanup
npm run test:stack
```

## 3. Documentation active

Ces documents guident le développement courant.

| Document | Usage |
|---|---|
| `README.md` | Démarrage local, liens principaux et validation de base. |
| `docs/PREPROD_LOCAL_ARCHITECTURE.md` | Architecture locale et choix de persistance. |
| `docs/AUTOPILOT_V4_PREPROD_EXECUTION_PLAN.md` | Périmètre et ordre du chantier V4 local. |
| `docs/AUTOPILOT_V4_GOLDEN_2026-06-01.md` | Référence de parité de la journée golden. |
| `docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md` | Architecture fonctionnelle Operations, Replay Lab et milestones. |
| `docs/FRONT_SCREEN_STATUS_REVIEW.md` | Bilan écran par écran : livré, reste à améliorer et priorités front. |
| `docs/M17_BACKEND_CLEANUP_RUNBOOK.md` | Procédure de nettoyage contrôlé et historique des sous-passes M17. |
| `docs/NINJATRADER_EXECUTION_CHANTIER_2026-07-22.md` | Cadrage du futur pont NinjaTrader : architecture, sécurité, DB, milestones et critères de passage Sim101/live. |
| `docs/VPS_WINDOWS_READINESS_2026-07-23.md` | État exact des éléments préparés avant provisionnement. |
| `docs/VPS_WINDOWS_CUTOVER_RUNBOOK_2026-07-23.md` | Procédure d'installation, migration, shadow, update et rollback. |
| `docs/PREPROD_PROJECT_MANIFEST.md` | Présent manifeste runtime/support. |
| `docs/front-redesign/README.md` | Point d'entrée du paquet de passation front. |
| `docs/front-redesign/MANIFEST.md` | Contrat de mission Claude/Codex pour le redesign front. |
| `docs/front-redesign/PROMPT.md` | Prompt prêt à transmettre à Claude. |
| `docs/front-redesign/HANDOFF.md` | Snapshot généré du frontend actuel. |
| `docs/MIGRATION_OVH_2026-07-15.md` | État du chantier d'infrastructure séparé et architecture cible Windows. |

## 4. Archive et mémoire froide

Les documents sous `docs/archive/` sont conservés pour traçabilité. Ils ne doivent pas être utilisés comme preuve de runtime actif.

| Chemin | Statut |
|---|---|
| `docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md` | Rapport initial de cadrage nettoyage. |
| `docs/archive/2026-07-15/CLEANUP_REPORT_2026-07-15.md` | Rapport initial de copie et nettoyage préproduction. |
| `docs/archive/2026-07-19/POSTGRES_LOCAL_MIGRATION_RUNBOOK_2026-07-19.md` | Bootstrap Firestore terminé, non exécutable au runtime. |
| `scripts/db/archive/firestore_to_postgres.py` | Outil de bootstrap conservé hors des commandes actives. |

L'audit `audit:backend-cleanup` exclut volontairement `docs/archive/` et les notes de migration d'infrastructure afin de ne pas mélanger mémoire projet et runtime actif.

## 5. Règles de maintien

- Tout fichier ajouté doit entrer dans une seule catégorie principale : runtime, qualité, documentation active ou archive.
- Un script runtime vit dans `mcp_gpt_desk/scripts/`; un script support racine vit dans `scripts/handoff/`, `scripts/quality/` ou `scripts/stack/`.
- Les scripts ponctuels de migration de données vivent dans `scripts/db/` et
  ne sont jamais appelés par le runtime.
- Le profil MCP PREPROD est `autopilot_v4`; le profil `all` est réservé aux
  diagnostics de compatibilité locale.
- Un document volumineux généré doit indiquer sa commande de régénération.
- Une suppression reste interdite sans preuve de non-référence, classification explicite et tests proportionnés.
- Le chantier d'infrastructure distant reste séparé du développement produit local.
- Une release VPS doit passer `guard:strategy-contracts`,
  `guard:windows-deployment` et `Test-DeskRelease.ps1`.
