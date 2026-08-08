# 02 — Verified AS-IS Summary

- **Titre** : Résumé consolidé et vérifié de l'état actuel du système
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `docs/audit-2026-08-07/01-CARTOGRAPHIE-ET-FLUX.md`, `docs/audit-2026-08-07/02-REPONSES-SECTION-31.md`, `docs/audit-2026-08-07/04-ADDENDUM-PASSATION.md` (v2), `docs/TARGET_ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-07.md` (vérifié indépendamment), lectures ciblées directes listées en §9
- **Documents supersédés** : aucun — ce document consolide sans contredire les sources ci-dessus
- **Dernière vérification code** : 2026-08-07, lectures directes citées en §9 ; le reste provient de l'audit du même jour, lui-même vérifié par triangulation à cinq agents indépendants
- **Portée** : ce document est la référence AS-IS unique du dossier. `03-AS-IS-TO-TARGET-GAP-MAP.md` s'appuie exclusivement sur ce document pour la partie « ce qui existe ».

---

## 1. Vue d'ensemble du système actuel

Le Trading Desk actuel est un système **GPT-first orchestré**, dans lequel un backend Node.js/ESM (`mcp_gpt_desk/`) pilote un cycle d'analyse périodique en invoquant OpenAI Codex CLI en sous-processus, dont les sorties typées sont ensuite évaluées par un **moteur déterministe substantiel** (`packages/desk-domain`) avant toute action réelle. **CONFIRMÉ**.

Contrairement à l'hypothèse implicite du plan directeur initial (qui suppose que « tout le déterminisme reste à construire »), le système a déjà franchi la séparation structurelle entre « le LLM propose un plan typé » et « le moteur déterministe évalue et exécute » — cette séparation est le socle sur lequel ce dossier construit, elle n'est pas à inventer. **CONFIRMÉ**, triangulé indépendamment par cinq agents d'exploration et par l'audit externe du 2026-08-07 07:51.

## 2. Composants principaux

| Composant | Rôle | Statut |
|---|---|---|
| `mcp_gpt_desk/` (Node.js/ESM) | Backend applicatif : orchestration, API front, services MCP, worker IA | CONFIRMÉ |
| `packages/desk-domain` | Moteur déterministe pur, zéro dépendance externe : prédicats, gates, compilateurs de plan, state machines | CONFIRMÉ |
| `packages/desk-contracts` | Contrats Markdown+JSON-Schema scellés par hash, versionnés | CONFIRMÉ |
| `packages/desk-replay-engine` | Moteur de replay déterministe, zéro LLM (à distinguer du replay orchestré GPT — voir §5) | CONFIRMÉ |
| `src/` (React/Vite/TS) | Frontend opérateur | CONFIRMÉ |
| PostgreSQL 16 | Store générique JSONB (`desk_documents`) + tables relationnelles (21 migrations recensées) | CONFIRMÉ |
| Windows Server VPS (OVH) | Hébergement, services Windows wrappés WinSW | CONFIRMÉ |
| NinjaTrader 8 Desktop + AddOn C# compilé | Exécution broker réelle, via HTTP+HMAC | CONFIRMÉ |
| OpenAI Codex CLI | Sous-processus sandboxé invoqué pour l'analyse/génération de plans | CONFIRMÉ |

## 3. Le moteur déterministe (`packages/desk-domain`, `packages/desk-contracts`)

- Catalogue de conditions : **11 prédicats, 12 hard gates, 10 soft gates**, défini dans `packages/desk-contracts/catalogs/condition-catalog-v1-2.json`. **CONFIRMÉ**.
- Compilateurs déterministes traduisant un plan typé (issu du LLM) en évaluation exécutable, moteur d'évaluation M1, garde anti-look-ahead. **CONFIRMÉ**.
- State machines pour position/thèse/setup, incluant `position-state-machine-v1.js`, avec un état `PROTECTION_CONFIRMED` et un garde `ENGINE_ONLY_EVENTS` empêchant certaines transitions d'être déclenchées autrement que par le moteur lui-même. **CONFIRMÉ**.
- `NO_DUPLICATE_POSITION` (`packages/desk-domain/src/broker-execution.js:439-442`) est évalué en phase `BROKER_SUBMIT`, aux côtés de `BRIDGE_HEALTHY`/`BRIDGE_CONNECTED` — c'est-à-dire sur le chemin réel de soumission au broker, pas un chemin de simulation. **CONFIRMÉ** par lecture directe.
- Contrats scellés par hash et versionnés : `DeskMasterAnalysisContract`, `DeskExecutionPlanContract`, `DeskHourlyThesisMonitorContract`, `DeskMonitorCommandContract`, `DeskConditionCatalogContract`, `DeskDeterministicExecutionPolicy`, `DeskFrontProjectionContract`. **CONFIRMÉ**.
- **Ambiguïté de version non résolue** : les contrats apparaissent référencés tantôt en 5.4.0, tantôt en 5.1.0 selon la source consultée. **INCERTAIN** — consigné comme décision/vérification opérateur `OP-2` (voir `19-ARCHITECTURE-DECISION-RECORDS.md` et `operator-decisions.yaml`), non deviné ici.

## 4. Le mécanisme d'orchestration Codex/LLM

- `mcp_gpt_desk/src/codex-exec-adapter.js` — classe `CodexExecAdapter`. `codexBin` par défaut `"codex"` (`:55`). Méthode `analyze()` (`:135-346`) spawn le CLI Codex via `spawnCodex()` (`:493-626`), avec `codex exec resume <thread_id>` quand une session existe déjà (`:211-213`), sandbox et flags de sécurité (`:192-209`), allowlist d'environnement `sanitizedCodexEnv` incluant `CODEX_API_KEY` (`:462`). Garde `CODEX_SESSION_SCOPE_MISMATCH` (`:293-306`). Télémétrie avec `provider: "openai"` codé en dur (`:483,1053`). **CONFIRMÉ** par lecture directe intégrale du fichier.
- `mcp_gpt_desk/scripts/run_desk_ai_worker.mjs` — point d'entrée réel du worker. Boucle `do...while(!stopped)` (`:71-93`). `LISTEN desk_ai_work_ready` (`:45-58`). `pg_try_advisory_lock` (`:46-50`). `waitForWake(pollMs)`, défaut 15000ms, motif `Promise.race`. **CONFIRMÉ** par lecture directe intégrale du fichier.
- Ce mécanisme sert de **mécanisme d'accélération** (réveil quasi immédiat) au-dessus d'une source de vérité durable par table de tâches (`desk_live_run_cursor`, `desk_agent_work_items`) — si `LISTEN/NOTIFY` échoue, le polling périodique (15s) reste le filet de sécurité. **CONFIRMÉ/INFÉRÉ** (le comportement de fallback est démontré par le code ; sa fiabilité en production sur incident réel n'a pas été testée dans cet audit).
- Trois pipelines distincts invoquant le LLM ont été identifiés (analyse de marché horaire, moniteur de thèse, orchestration de replay) — leur rôle exact et leur migration cible sont traités en détail dans `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md` §« Migration des 3 pipelines ». **CONFIRMÉ** pour l'existence des 3 pipelines ; le détail de chacun est développé dans le document 09 pour éviter la duplication ici.

## 5. Les deux mécanismes de « replay » — distinction critique

Le mot « replay » désigne dans ce dépôt **deux mécanismes différents**, conflués par l'application elle-même dans `store.js:1588-1595`. **CONFIRMÉ**.

| | Moteur de résultats déterministe | Replay orchestré GPT-in-the-loop |
|---|---|---|
| Package | `packages/desk-replay-engine` | `desk-replay-orchestration-algorithms.js` / `desk-replay-service.js` |
| Appel LLM | Zéro | Un appel LLM complet par étape rejouée |
| Coût | Fixe, nul en tokens | Proportionnel au nombre d'étapes rejouées |
| Rôle cible | Base du futur Simulation Engine (Phase 3) | Cas d'usage du futur Research Lab (Phase 4-5), pas du Simulation Engine |

Cette distinction est structurante pour `08-SIMULATION-AND-EXPERIMENT-PLATFORM.md` : le Simulation Engine cible **étend** le moteur déterministe existant, il **ne s'appuie pas** sur le replay orchestré GPT, dont le coût par étape est incompatible avec un usage de simulation à grande échelle (des milliers de runs).

## 6. Chemin d'exécution broker réel

Chaîne confirmée : `materializeEligiblePositions` → `materializeTradeDecision` → `evaluateBrokerPolicy` (fonction pure, ~40 règles, phase `BROKER_SUBMIT`) → `createOrderIntent` → approbation → outbox → NinjaTrader AddOn (HTTP+HMAC) ou pont fichier non câblé. **CONFIRMÉ**.

- Réconciliation : `broker-execution-service.js`, fonction `compareSnapshots` et méthode `reconcile()` (approx. `:647-682`, `:882-925`). `reconciliationSnapshot(accountId)` (`:663`) scope correctement le compte en amont. **CONFIRMÉ** par lecture directe. La réconciliation périodique automatique n'est **jamais déclenchée** en production actuellement (confirmé par l'audit du 07:51, corroboré). **CONFIRMÉ/ABSENT** (le code existe, le déclenchement automatique n'existe pas).
- Bug de collision confirmé : les Maps `deskPositions`/`brokerPositions` sont construites avec pour clé `positionKey(instrument)` **seul** — sans discriminant de stratégie ou d'instance. Sous multi-stratégie réelle sur le même instrument, deux positions distinctes s'écraseraient dans l'agrégation. **CONFIRMÉ**. Le ticket de correction ne présume **pas** que `instrument + strategy_id` soit la bonne clé cible — voir §7 ci-dessous et `17-EXECUTABLE-BACKLOG.md` Ticket 0.4.
- Table `trades` (`infra/postgres/init/003_trade_automation_schema.sql:317-346`) possède déjà une colonne `strategy_id text` (`:336`), indexée via `trades_scope_idx` (`:346`). **CONFIRMÉ**. Mais `strategy_id` est une **clé de session/lane legacy**, pas un identifiant canonique de stratégie métier au sens de la cible (voir §7). **CONFIRMÉ/INFÉRÉ** — sa sémantique exacte historique reste partiellement **INCERTAIN** et doit être revérifiée à l'entrée de Phase 1 (voir `17`, Ticket 1.4).

## 7. `ACTIVE_STRATEGY_RUNTIME_VERSIONS` — nature exacte, verrouillée

`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14` définit un objet `ACTIVE_STRATEGY_RUNTIME_VERSIONS`. Lecture directe intégrale du fichier confirme qu'il s'agit d'un **verrou de compatibilité schéma/moteur** (« Runtime Contract Bundle ») — une paire de versions figeant quelle version du catalogue de conditions et du moteur d'évaluation le système accepte d'exécuter — **et non** un identifiant de stratégie métier, et **encore moins** un mécanisme conçu pour supporter plusieurs stratégies actives simultanément. **CONFIRMÉ** par lecture directe.

Conséquence actée dans ce dossier (voir `19-ARCHITECTURE-DECISION-RECORDS.md`, ADR-01) : ce verrou **reste singulier et strict**. La pluralité de stratégies métier (Strategy Definition / Strategy Version / Strategy Instance, §5 de `01-NORTH-STAR-AND-SUCCESS-CRITERIA.md`) est un axe **orthogonal**, introduit à côté de ce verrou, jamais en remplacement de celui-ci.

## 8. État opérationnel daté (à revalider avant toute planification)

- Le système est actuellement sous gel volontaire `ENGINE_V5_VALIDATION_HOLD` depuis 2026-08-01 (`docs/DETERMINISTIC_STRATEGY_V5_1_CUTOVER_2026-08-01.md`), les workers IA et les lanes LIVE/Replay étant arrêtés par défaut. **CONFIRMÉ** (documentation runtime récente), statut exact (levé ou non, quelles lanes actives) à reconfirmer auprès de l'opérateur avant toute planification d'activation — voir `operator-decisions.yaml`, `OP-1`.
- L'ancienne architecture GCP/Firebase/Python (`committee_v2`, `scanner/`) décrite dans un audit archivé (`docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md`) **n'existe plus** dans le runtime applicatif — retrait confirmé par un test de régression dédié (`mcp_gpt_desk/test/document_collections.test.js:25-32`, qui fait échouer le build si du code Firebase est réintroduit) et par `docs/MIGRATION_OVH_2026-07-15.md`. **CONFIRMÉ, ABSENT** (l'ancien système est absent, sa disparition est positivement vérifiée).

## 9. Lectures directes effectuées pour ce dossier (au-delà de l'audit du 07-07)

| Fichier | Portée lue | Raison |
|---|---|---|
| `mcp_gpt_desk/src/codex-exec-adapter.js` | Intégral | Vérifier le mécanisme exact d'invocation Codex CLI |
| `mcp_gpt_desk/scripts/run_desk_ai_worker.mjs` | Intégral | Vérifier le mécanisme exact de réveil du worker |
| `mcp_gpt_desk/src/strategy-runtime-versioning.js` | Intégral | Trancher la nature d'`ACTIVE_STRATEGY_RUNTIME_VERSIONS` (point de correction addendum §1) |
| `mcp_gpt_desk/src/broker-execution-service.js` | `compareSnapshots`, `reconcile()` | Vérifier le scope compte de la réconciliation |
| `packages/desk-domain/src/broker-execution.js` | `:420-450` | Vérifier que `NO_DUPLICATE_POSITION` est bien sur le chemin réel `BROKER_SUBMIT` (point de correction errata §3) |
| `infra/postgres/init/003_trade_automation_schema.sql` | `:317-346` | Vérifier l'existence et l'indexation de `strategy_id` sur `trades` |
| `.github/workflows/local-ci.yml` | Intégral (lu en amont de l'audit, réutilisé) | Établir la liste exacte des commandes CI, reprise verbatim dans les tickets de Phase -1 |

## 10. Ce qui reste explicitement non vérifié (zones à ne pas deviner)

- Le comportement exact du système sous charge concurrente réelle multi-stratégie (aucun test de charge trouvé). **ABSENT**.
- L'état réel du hold `ENGINE_V5_VALIDATION_HOLD` au moment où un agent d'implémentation commencera à travailler — dépend de la date d'exécution, doit être revérifié, pas supposé constant depuis 2026-08-01. **À REVALIDER**.
- La version exacte des contrats en production (5.4.0 vs 5.1.0, §3). **INCERTAIN**, `OP-2`.
- La sémantique historique complète de la colonne `strategy_id` sur `trades` au-delà de son usage courant en clé de session/lane (§6). **INCERTAIN**, à revérifier au Ticket 1.4.
- Le comportement du pont fichier NinjaTrader mentionné comme alternative non câblée au chemin HTTP+HMAC — son état d'implémentation réel n'a pas été vérifié en détail dans cet audit. **INCERTAIN**.

Ce document ne comble aucune de ces zones par une supposition ; elles sont reprises explicitement dans `03-AS-IS-TO-TARGET-GAP-MAP.md` et, le cas échéant, dans `20-RISK-REGISTER.md`.
