# AUDIT TECHNIQUE, FONCTIONNEL ET ARCHITECTURAL — TRADING DESK — 2026-08-07

## DOCUMENT 1/4 — INDEX ET MÉTHODE

# Audit technique, fonctionnel et architectural du Trading Desk — index

Date : 2026-08-07. Mode : lecture seule, aucune modification de code fonctionnel, aucune connexion broker réelle, aucun ordre déclenché.

## Pourquoi ce dossier existe

La mission confiée était : auditer l'existant en profondeur pour préparer le terrain à une future intervention de Codex, sans rien implémenter des évolutions décrites dans un document directeur (« plan directeur » ci-après — la vision « architecture data-driven, multi-agent, scalable et event-driven » fournie en fin de mission). Le plan directeur devait servir de boussole stratégique, pas de description fiable de l'état actuel du code.

## Découverte préalable — un audit de convergence existe déjà, daté d'aujourd'hui

Avant d'écrire quoi que ce soit, l'exploration a trouvé `docs/TARGET_ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-07.md` (418 lignes, écrit le jour même à 07:51, avant le début de cette session d'audit). Ce document audite déjà le dépôt au regard du même plan directeur, avec citations `fichier:ligne`, interrogation directe de la base de production sur le VPS, et une conclusion centrale : **le desk a déjà franchi la séparation « LLM propose un plan typé » / « moteur déterministe évalue et exécute »** — le plan directeur sous-estime la maturité déterministe déjà présente.

Conformément à la consigne « ne pas se fier aux anciens documents, comparer systématiquement la documentation au comportement réel du code », ce document existant a été traité comme une hypothèse à vérifier, pas comme une vérité acquise. Cinq agents d'exploration indépendants ont été dispatchés en parallèle sur des périmètres disjoints (inventaire backend, moteur déterministe/contrats, service Windows/réveil des workers, chemin d'exécution NinjaTrader, moteur de replay/backtest + couche de données), plus une lecture directe de plusieurs fichiers pivots par l'auditeur lui-même (`codex-exec-adapter.js`, `run_desk_ai_worker.mjs`).

**Résultat de la vérification : aucune divergence significative trouvée.** Chaque affirmation testable de l'audit du 07:51 (mécanisme Codex CLI en sous-processus, LISTEN/NOTIFY Postgres, contrat `DeskDeterministicExecutionPolicy`, absence de `PickMyTrade`/`ExecutionGateway`, protection après fill non vérifiée, réconciliation jamais déclenchée, verrou de version de stratégie unique) a été retrouvée indépendamment, avec les mêmes fichiers et parfois les mêmes numéros de ligne. Ce dossier **s'appuie donc sur cet audit existant au lieu de le dupliquer**, l'étend là où il est moins détaillé (inventaire complet des services/outils MCP, schéma Postgres table par table, distinction précise entre les deux mécanismes de « replay »), et fournit le livrable qui manquait explicitement à la mission : un **plan d'évolution séquencé, jusqu'au niveau ticket**, avec dépendances et critères d'acceptation.

## Divergences documentation ↔ code trouvées

1. **Le plan directeur lui-même (prémisse §1.1)** décrit une architecture antérieure au cutover « Deterministic Strategy V5.1 » du 2026-08-01 : il suppose que tout le déterminisme reste à construire. Le code montre un moteur déterministe substantiel déjà en place (catalogue de 11 prédicats / 12 hard gates / 10 soft gates, compilateurs de plan, moteur M1, garde anti-look-ahead). **CONFIRMÉ** — voir document 2 §2.
2. **`docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md`** (un audit antérieur, conservé en archive) décrit une architecture GCP/Firebase avec un moteur Python legacy (`committee_v2`, `scanner/`) tournant encore en shadow. **Cet état n'existe plus** : Firebase/Firestore a été entièrement retiré du runtime applicatif (test de régression dédié, `mcp_gpt_desk/test/document_collections.test.js:25-32`, qui fait échouer le build si du code Firebase est réintroduit), confirmé par `docs/MIGRATION_OVH_2026-07-15.md`. Le document d'archive est correctement étiqueté comme obsolète dans son propre en-tête ; aucune action requise, simple confirmation que la bascule a eu lieu.
3. **La documentation runtime la plus fraîche** (`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md`, `docs/DETERMINISTIC_STRATEGY_V5_1_CUTOVER_2026-08-01.md`) décrit un système sous gel volontaire (`ENGINE_V5_VALIDATION_HOLD`) depuis le 2026-08-01, avec les workers IA et les lanes LIVE/Replay arrêtés par défaut. **Ceci n'est pas une divergence** mais un état opérationnel daté à vérifier avant toute décision — le statut exact du hold (levé ou non, quelles lanes actives) doit être confirmé auprès de l'opérateur avant de planifier quoi que ce soit qui suppose un service actif.

## Méthode appliquée

- Code et schéma comme source de vérité ; documentation comme hypothèse à vérifier, jamais comme preuve suffisante seule.
- Statuts utilisés pour chaque constat : **CONFIRMÉ** (démontré par le code), **INFÉRÉ** (déduction logique non garantie), **INCERTAIN** (information incomplète ou contradictoire), **ABSENT** (recherché, non trouvé).
- Citations `fichier:ligne` systématiques. Aucun comportement n'a été inventé pour combler une zone inconnue — les zones inconnues sont marquées comme telles.
- Cinq agents d'exploration indépendants ont couvert : inventaire complet du backend `mcp_gpt_desk/` ; moteur déterministe et système de contrats ; mécanisme de service Windows et réveil des workers ; chemin d'exécution NinjaTrader ; moteur de replay/backtest et couche de données. Chaque agent a travaillé sans connaissance des résultats des autres, ce qui permet une triangulation : les points où plusieurs agents convergent indépendamment sur le même fichier/ligne sont rapportés avec un niveau de confiance particulièrement élevé.
- Aucune commande nécessitant des identifiants réels, une connexion broker ou un environnement de production n'a été exécutée. Là où une vérification aurait nécessité cela (ex. interroger directement le VPS), la limitation est documentée plutôt que contournée — sauf pour les faits déjà vérifiés sur le VPS par l'audit du 07:51 lui-même (ex. dernière bougie capturée, dimensionnement machine), repris ici par citation avec attribution.

---

## DOCUMENT 2/4 — CARTOGRAPHIE ET FLUX

# Cartographie des composants et des flux

Statuts : **CONFIRMÉ** / **INFÉRÉ** / **INCERTAIN** / **ABSENT**. Citations `fichier:ligne` relatives à la racine du dépôt.

## 1. Vue d'ensemble des composants

| Composant | Rôle | Techno | Statut |
|---|---|---|---|
| `src/` (racine) | Frontend React opérateur unique | Vite + React + TS | **CONFIRMÉ** actif — `src/main.tsx` → `src/App.tsx`, seul frontend (le second frontend signalé dans l'audit de nettoyage 2026-07-15 a été retiré depuis) |
| `mcp_gpt_desk/src/server.js` | Serveur HTTP unique multiplexant API MCP + REST front, `node:http` brut (pas Express/Fastify) | Node ESM | **CONFIRMÉ** — `server.js:2` (`createServer`), `:186`, `:748` (listen) |
| `mcp_gpt_desk/scripts/run_desk_ai_worker.mjs` | Worker d'analyse IA (Master/Monitor), une instance par lane (live×2, replay×1) | Node ESM, spawns `codex` CLI | **CONFIRMÉ** — voir §3 |
| `mcp_gpt_desk/scripts/run_live_runtime_scheduler.mjs` | Boucle moteur M1 déterministe + construction des packs M5/M15 + cycle de vie du curseur live | Node ESM | **CONFIRMÉ** — service `DeskFuturesLiveRuntime` |
| `mcp_gpt_desk/scripts/run_replay_preparation_worker.mjs` | Préparation asynchrone des packs replay immuables | Node ESM | **CONFIRMÉ** — service `DeskFuturesReplayPreparation` |
| `mcp_gpt_desk/scripts/run_broker_management_worker.mjs` | Matérialisation déterministe des intentions de gestion de position (**ne parle jamais à NinjaTrader**) | Node ESM | **CONFIRMÉ** — service `DeskFuturesBrokerManagement`, `run_broker_management_worker.mjs:22-25` |
| `mcp_gpt_desk/scripts/run_telegram_alert_worker.mjs` | Livraison d'alertes Telegram + commandes admin en lecture seule | Node ESM | **CONFIRMÉ** — service `DeskFuturesTelegram` |
| `integrations/ninjatrader/DeskExecutionAddOn/DeskExecutionAddOn.cs` | AddOn NinjaScript compilé, tourne **dans** le process NinjaTrader Desktop, client HTTP+HMAC vers le backend | C# / NinjaScript | **CONFIRMÉ** — pas un service Windows, pas une tâche planifiée : code compilé dans NinjaTrader lui-même |
| `integrations/ninjatrader/windows/DeskNinjaTraderSupervisor.ps1` | Maintient `NinjaTrader.exe` démarré (tâche planifiée `AtLogOn`, pas un service SCM) | PowerShell | **CONFIRMÉ** — `Install-DeskNinjaTraderSupervisor.ps1:60-86` (`Register-ScheduledTask`) |
| `mcp_gpt_desk/scripts/run_ninja_bridge.mjs` | Pont fichier OIF/ATI alternatif (dépose des commandes texte dans `NinjaTrader 8/incoming`) | Node ESM | **ABSENT du câblage de déploiement** — code fonctionnel, mais aucune référence dans `deploy/`/`config/` ; à ne pas supposer actif en production |
| `packages/desk-domain` | Cœur de règles pures : gates, audit, risque, machines à états setup/thèse | Node ESM, zéro dépendance externe | **CONFIRMÉ** — `package.json` description : *"Pure deterministic Desk V2 core rules"* |
| `packages/desk-contracts` | Contrats scellés par hash (Markdown normatif + schémas JSON + catalogue de conditions) | Node ESM | **CONFIRMÉ** — 7 contrats actifs, historique complet conservé |
| `packages/desk-replay-engine` | Moteur d'issue déterministe (stop/target sur un setup déjà décidé) | Node ESM pur, zéro dépendance | **CONFIRMÉ** — `outcome-engine.js`, ~550 lignes, testé |
| `packages/desk-audit` | Garde anti-look-ahead | Node ESM | **CONFIRMÉ** — `anti-lookahead-guard.js`, 206 lignes |
| `packages/desk-time` | Horloge injectable (Paris/UTC) | Node ESM | **CONFIRMÉ** — `ClockPort`/`FixedClock` |
| PostgreSQL 16 (VPS) | Source de vérité unique, sans TimescaleDB | — | **CONFIRMÉ** — 21 migrations, un seul moteur, pas de réplique séparée pour les séries temporelles |
| Firebase/Firestore | — | — | **ABSENT du runtime** — retiré, migration terminée juillet 2026, test de régression dédié l'interdit (`mcp_gpt_desk/test/document_collections.test.js:25-32`) |
| Stockage objet | Système de fichiers local, catalogué en Postgres | — | **CONFIRMÉ** local (`DESK_OBJECT_ROOT`) ; `GCS_MIRROR` existe comme catégorie de provenance dans le schéma mais **aucun code actif** ne l'utilise (**INCERTAIN** si totalement mort ou juste dormant) |
| Bus de messages dédié (Kafka/RabbitMQ/Redis) | — | — | **ABSENT** — un seul canal `pg_notify`, voir §3 |

## 2. Flux 1 — Analyse de marché : de la donnée à la décision persistée

```text
Données de marché (Postgres, market_candles)
  → bundle cutoff-gated (pack + snapshots + contrat épinglé)
  → prompt construit (buildDeskAiAnalysisPrompt)
  → appel LLM (Codex CLI en sous-processus)          ← SEUL point non déterministe
  → validation de schéma (AJV, contrat épinglé)
  → compilation déterministe (geometry/RR/gates)
  → artefact canonique persisté (deterministic_execution_plan / deterministic_monitor_command)
  → moteur M1 (à chaque bougie fermée, sans LLM) → déclenchement, fill, résultat en R
```

Chaîne précise, avec citations (triangulée par deux agents indépendants + lecture directe) :

1. **Déclenchement** : `run_desk_ai_worker.mjs` interroge en boucle (voir §3) ; `DeskAiWorkerService.runOnce()` (`mcp_gpt_desk/src/desk-ai-worker-service.js:1750`) revendique le travail dû.
2. **Lecture de données (pur, déterministe)** : `facade.readClaimContext(...)` (`desk-ai-worker-service.js:1796`) lit un bundle cutoff-gated — aucun appel LLM à cette étape.
3. **Appel LLM (seul point non déterministe du cycle)** : `this.adapter.analyze({...})` (`desk-ai-worker-service.js:1874`) → `CodexExecAdapter.analyze()` (`mcp_gpt_desk/src/codex-exec-adapter.js:135`) spawn le binaire **Codex CLI d'OpenAI** (`codex-exec-adapter.js:55`, `this.codexBin = ... "codex"`) en sous-processus, sandbox lecture seule, `approval_policy="never"`, toutes les fonctionnalités agentiques risquées désactivées (`shell_tool`, `multi_agent`, `apps`, `browser_use`, `computer_use`, `image_generation`, etc. — `codex-exec-adapter.js:192-209`). Le prompt est transmis sur **stdin** ; la sortie doit être un JSON validé contre un schéma (`--output-schema`). Provider confirmé `"openai"` (`codex-exec-adapter.js:483,1053`).
4. **Validation de schéma** : `validateMaterializedWrites` (`desk-ai-worker-service.js:1892-1893`) — AJV contre le contrat épinglé (`strategy-contract-validator.js`) ; en cas d'échec, **un** re-prompt de réparation borné est tenté (`desk-ai-worker-service.js:1910-1946`), puis abandon fail-closed.
5. **Compilation déterministe (pure, zéro appel LLM)** : `compileMasterPlanV1`/`compileMonitorCommandV1` (`packages/desk-domain/src/deterministic-compiler-entry-v1.js`) — calcul de géométrie/RR (`evaluateCanonicalGeometry`, `packages/desk-domain/src/opportunity-policy-v1.js:291`), classification des 12 hard gates / 10 soft gates du catalogue (`packages/desk-contracts/catalogs/condition-catalog-v1-2.json`), validation des transitions de machine à états (thèse/setup/replan). La proposition brute du LLM est conservée pour audit (`gpt_execution_plan_proposal`), l'artefact canonique persisté est celui compilé.
6. **Moteur M1 (déterministe, LLM jamais appelé, à chaque bougie fermée)** : `reconcileLivePaperExecution` (`mcp_gpt_desk/src/live-paper-execution.js:54`) → `evaluateReplaySetupOnRows`/`evaluatePositionOnRows` → `evaluateDeterministicConditionSetV1` (évaluation des 11 prédicats sur des lignes OHLC réelles) puis `evaluateOpportunitySeekingControlledV1` en phase `ENTRY_TRIGGER`. C'est ici, et uniquement ici, que le déclenchement réel (fill) est décidé.

**Ce que GPT peut et ne peut pas faire.** GPT ne peut demander que `SETUP_CANDIDATE`, `PRE_ARMED` ou `ARMED_CONDITIONAL` (`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:113-115`) ; seul le moteur produit un trigger, un fill, une position et un résultat en R. Le contrat `DeskDeterministicExecutionPolicy` liste explicitement les faits que GPT ne peut jamais déclarer (setups déclenchés, prix de fill, ouverture/fermeture de position, résultat en R).

**Conclusion (CONFIRMÉ, triangulé par deux agents indépendants) :** le moteur déterministe est un **validateur/exécuteur fail-closed** des propositions de GPT, pas un générateur indépendant de signaux. La substance (quelle thèse, quels setups candidats, quelles conditions, quelles transitions de monitor) vient de GPT ; la légalité, la géométrie, les gates et le déclenchement final sont 100 % déterministes. Aucun chemin de code dans `packages/desk-domain` ou `mcp_gpt_desk/src` ne synthétise un nouveau candidat de trade depuis les données de marché seules, sans proposition GPT préalable.

## 3. Flux 2 — Réveil des workers (le mécanisme réel derrière « service permanent + worker »)

**Verdict de synthèse (triangulé, deux agents + lecture directe convergent) :** la description opérateur (« un service permanent réveille un worker ciblé, qui sauvegarde son état et s'arrête, puis est réveillé plus tard ») est **exacte au niveau de la conversation LLM, mais imprécise au niveau du processus**. Il n'y a pas deux processus séparés où l'un réveille l'autre : **le service Windows et le worker sont le même processus**, une boucle `do…while` qui somnole entre deux itérations.

### 3.1 Mécanisme de service — WinSW

**CONFIRMÉ.** `deploy/windows/Install-DeskServices.ps1` installe chaque service via **WinSW** (Windows Service Wrapper), pas `sc.exe`, pas NSSM, pas `node-windows` (`Install-DeskServices.ps1:6,20,68-93`). Neuf services :

| Service Windows | Script exécuté | Rôle réel |
|---|---|---|
| `DeskFuturesApi` | `node src/server.js` | API HTTP + serveur MCP public |
| `DeskFuturesCaddy` | `caddy.exe run` | Reverse-proxy TLS |
| `DeskFuturesTelegram` | `run_telegram_alert_worker.mjs` | Alertes Telegram |
| `DeskFuturesLiveRuntime` | `run_live_runtime_scheduler.mjs` | Moteur M1 + packs M5/M15 + curseur live |
| `DeskFuturesReplayPreparation` | `run_replay_preparation_worker.mjs` | Préparation des packs replay |
| `DeskFuturesBrokerManagement` | `run_broker_management_worker.mjs` | Matérialisation gestion position (pas de contact NinjaTrader) |
| `DeskFuturesCodexLive01` | `run_desk_ai_worker.mjs`, `DESK_AI_WORKER_SCOPE=live` | Worker IA LIVE principal |
| `DeskFuturesCodexLive02` | idem, redondance | Worker IA LIVE secondaire |
| `DeskFuturesCodexReplay01` | idem, `DESK_AI_WORKER_SCOPE=replay`, priorité `BelowNormal` | Worker IA REPLAY |

### 3.2 Mécanisme de claim — deux systèmes distincts coexistent

**A. Store JSONB générique + verrous advisory (workers IA/live/replay).** `infra/postgres/init/001_schema.sql:1-26` définit `desk_documents` (collection/document_id/JSONB), qui porte la quasi-totalité des « collections » applicatives (`desk_live_run_cursor`, `desk_agent_work_items`, `desk_ai_conversation_sessions`, etc.). Écriture d'un document déclenchant → `aiWorkNotification()` (`postgres-desk-persistence.js:1235-1243`) → `SELECT pg_notify('desk_ai_work_ready', $1)` si `cursor_status` passe à `DUE`/`RETRY` ou `status` à `READY`. C'est un **vrai** LISTEN/NOTIFY Postgres, pas un produit de message-queue.

**B. File relationnelle dédiée à bail (exécution broker uniquement).** `infra/postgres/init/008_ninjatrader_execution_gateway.sql:23,122-142` et `010_broker_position_management.sql:15,80-100` définissent `broker_execution_outbox`/`broker_management_outbox` avec un enum réel (`pending/leased/rendered/delivered/acknowledged/failed/cancelled/expired`) et des colonnes `lease_token`/`lease_expires_at` — structurellement distinct du store JSONB générique.

### 3.3 Le réveil, précisément

`run_desk_ai_worker.mjs:45-58` ouvre un client Postgres dédié, exécute `LISTEN desk_ai_work_ready`, enregistre un handler qui résout toute promesse `waitForWake()` en attente. La boucle principale (`:71-93`, `do…while(!stopped)`) appelle `worker.runOnce()`, puis soit dort 250 ms (si une tâche vient de finir), soit attend le réveil (`waitForWake(pollMs)`, défaut 15 000 ms) — **un `Promise.race` entre une notification NOTIFY et un timeout**, donc du polling avec réveil anticipé par événement, pas un dispatch purement événementiel. Chaque instance détient un verrou advisory Postgres sur sa propre identité (`pg_try_advisory_lock`, `run_desk_ai_worker.mjs:46-50`) pour empêcher deux instances concurrentes du même worker.

**Le service Windows n'invoque jamais un « second processus worker ».** `DeskFuturesCodexLive01` **est** `run_desk_ai_worker.mjs`, un seul processus `node.exe` géré directement par WinSW/SCM.

### 3.4 Le réveil du LLM lui-même — un nouveau processus OS par appel

**Ici, un nouveau processus est réellement créé à chaque unité d'analyse.** `spawnCodex()` (`codex-exec-adapter.js:493-626`) lance le binaire **Codex CLI** en sous-processus (`child_process.spawn`), attend son événement `close` de façon synchrone et bloquante (borné par `timeoutMs`, jusqu'à 780 000 ms / 13 min). C'est cet appel — pas le processus worker Node — qui correspond à « invoquer un agent externe ».

### 3.5 Persistance d'état — ce qui est réellement du Submit-Suspend-Resume, et ce qui ne l'est pas

**Réel et confirmé :**
- Les curseurs (`desk_live_run_cursor`) et work items (`desk_agent_work_items`) portent un bail (`lease_expires_at`) qui les rend réclamables par un autre worker si le processus original crashe.
- **La conversation LLM est bien persistée et reprise** — mais via le mécanisme natif du **Codex CLI lui-même** (`codex exec resume <thread_id>`, `codex-exec-adapter.js:211-213`), pas par une base de messages construite par ce dépôt. `desk_ai_conversation_sessions` (v2) ne stocke que les **métadonnées** de continuité (`thread_id`, `runtime_hash`, `turn_count` plafonné à 12, cutoff strictement monotone) — jamais le contenu des messages. Un garde explicite (`CODEX_SESSION_SCOPE_MISMATCH`, `codex-exec-adapter.js:293-306`) rejette toute reprise d'un fil différent de celui attendu.

**Non trouvé — à ne pas supposer :** aucune preuve qu'un work item revendiqué soit **partiellement traité, checkpointé en cours d'analyse, puis repris depuis ce checkpoint** lors d'un `runOnce()` ultérieur. Chaque `runOnce()` est entièrement synchrone : claim → un (ou deux, si réparation) appel Codex bloquant → validation → complete/fail. Si le processus meurt pendant `analyze()`, le bail expire simplement et un autre worker **relance** la même tâche depuis son état de claim (nouvel appel LLM), il ne « reprend » pas un calcul interrompu.

**Conclusion pour l'évolution vers un Agent Runtime Supervisor générique (§14 du plan directeur) :** le pattern Submit-Suspend-Resume existe déjà et fonctionne bien, mais à un seul niveau (le fil de conversation Codex), pour un seul type d'agent (le worker d'analyse Master/Monitor). Le généraliser suppose de faire de l'agent une entité de première classe (aujourd'hui `DESK_AI_WORKER_ID` est une simple variable d'environnement servant de jeton de bail, sans budget/permission/priorité — **ABSENT**), et d'introduire une enveloppe d'événement avec corrélation causale (`correlation_id`/`causation_id` : **zéro occurrence dans tout le dépôt**, **ABSENT** confirmé par grep exhaustif).

## 4. Flux 3 — Exécution broker (NinjaTrader)

```text
Positions paper éligibles (desk_positions)
  → materializeEligiblePositions()          — broker-execution-service.js:118-143
  → materializeTradeDecision()               — packages/desk-domain/src/broker-execution.js:142-254
  → evaluateBrokerPolicy()                   — broker-execution.js:256-470 (fonction pure, ~40 règles nommées)
  → createOrderIntent()                      — broker-execution.js:472-531 (si conforme)
  → approbation (auto ou opérateur SEMI_AUTO)
  → outbox → AddOn NinjaTrader (HTTP+HMAC) ou pont fichier OIF (non câblé en déploiement)
  → ordre réel côté NinjaTrader (comptes Sim* uniquement)
```

**Deux transports coexistent dans le code, un seul confirmé câblé en déploiement :**

- **AddOn NinjaScript (`integrations/ninjatrader/DeskExecutionAddOn/DeskExecutionAddOn.cs`)** — **CONFIRMÉ actif.** Tourne *dans* le processus NinjaTrader Desktop (code compilé, pas un service séparé), client HTTP signé HMAC-SHA256 vers `http://127.0.0.1:8787/api/v1` en boucle (heartbeat 5 s, snapshot 15 s), exécute au plus une commande à la fois contre les objets natifs `Account`/`Order` de NinjaTrader. Un superviseur séparé (`DeskNinjaTraderSupervisor.ps1`, **tâche planifiée**, pas un service SCM — NinjaTrader étant une appli graphique interactive) garde `NinjaTrader.exe` démarré.
- **Pont fichier OIF/ATI (`mcp_gpt_desk/scripts/run_ninja_bridge.mjs`)** — code fonctionnel (dépose des commandes texte dans `NinjaTrader 8/incoming`), mais **ABSENT de tout script d'installation** (`deploy/`, `config/`) — à ne pas supposer actif en production.

**`OrderIntent` est un contrat explicite et bien typé** (`createOrderIntent`, `broker-execution.js:472-531`) : id, compte, quantité, type, bracket stop/TP, TIF, expiration, **clé d'idempotence**. Champs manquants par rapport à la cible : `signal_id`, `strategy_id`, groupe de comptes, fournisseur préféré/de secours (**ABSENT**).

**Trois faiblesses opérationnelles réelles, confirmées indépendamment par deux agents :**

1. **Protection après fill jamais vérifiée** — `persistEntryFillAndTrade()` (`mcp_gpt_desk/src/broker-execution-repository.js:1010-1055`) écrit `status='open'` inconditionnellement et stocke les prix de stop **voulus**, jamais confirmés côté broker. Aucun événement `PROTECTION_CONFIRMED` n'est jamais émis sur ce chemin, bien que l'état existe dans la machine à états canonique (`packages/desk-domain/src/position-state-machine-v1.js`) — **elle n'est simplement pas branchée**.
2. **Réconciliation qui ne tourne jamais automatiquement** — les comparateurs existent et sont fail-closed (`compareSnapshots`, `broker-execution-service.js:882-901`), mais ne sont déclenchés que par un appel manuel ou un flag `reconcile: true` que l'AddOn code en dur à `false` (`DeskExecutionAddOn.cs:176-177`). Aucun worker planifié ne les appelle.
3. **Aucune interface fournisseur** — `'ninjatrader'` est un littéral SQL dans plusieurs fichiers (`broker-execution-repository.js:218,221,317,476,921,926`). Zéro occurrence de `PickMyTrade`/`Tradovate`/`Rithmic`/`ExecutionProvider` dans le code (uniquement dans deux documents de conception, comme aspiration future, pas comme code).

## 5. Les deux mécanismes de « replay » — à ne pas confondre

Le plan directeur et le vocabulaire courant du projet utilisent « replay » et « backtest » pour deux mécanismes réellement différents, et **l'application elle-même les fusionne dans une seule liste** (`mcp_gpt_desk/src/store.js:1588-1595`, `listBacktestRuns` concatène `desk_backtests` et `desk_replay_runs`).

| | Backtest déterministe | Replay orchestré GPT-in-the-loop |
|---|---|---|
| Entrée | Un setup **déjà décidé** (`desk_setups` matérialisés) | Rien — la décision est **régénérée** à chaque step |
| Appel LLM | **Aucun** | **Oui**, à chaque Master/Monitor, via le même worker Codex CLI que le live |
| Code | `packages/desk-replay-engine` (pur, ~550 lignes, testé) + `desk-backtest-algorithms.js` | `desk-replay-orchestration-algorithms.js` (3 025 lignes) + `desk-replay-service.js` (2 084 lignes) |
| Coût token | Zéro | **Identique au live** — c'est littéralement le même pipeline d'analyse rejoué |
| Reproductibilité | Oui (hash de contenu stable, `content_hash` sha256) | Non garantie — la sortie LLM n'est pas seedée |
| Marqueur dans le code | `create_backtest_run` : *"It does not auto-run GPT"* (`tools.js:1834-1836`) | `replay_mode: "orchestrated_gpt_in_the_loop"`, `gpt_in_the_loop: true` (`desk-replay-orchestration-algorithms.js:218-222`) |

**Conséquence directe pour le plan d'évolution** : le « Replay » actuel n'est **pas** un moteur de simulation historique au sens du plan directeur (§6) — il rejoue le pipeline GPT, pas une stratégie déterministe. Construire le vrai moteur de simulation (Python ou non) est un chantier greenfield, mais la sémantique anti-look-ahead, le rééchantillonnage cutoff-correct et le calcul en R existent déjà en JavaScript et servent de spécification exécutable. Anti-look-ahead confirmé implémenté dans les deux mécanismes séparément (`rowVisibleAtReplayCutoff`/`replayBarClosedAtCutoff`, `desk-replay-orchestration-algorithms.js:2536-2545`, et `replayLookaheadCandles`, `packages/desk-replay-engine/src/outcome-engine.js:277-286`).

## 6. Inventaire — outils MCP

Deux serveurs MCP distincts, **CONFIRMÉ** via `@modelcontextprotocol/sdk`.

**A) Serveur public réseau** (`mcp_gpt_desk/src/server.js`) — nom `"tv-automation-desk-mcp"`, transport HTTP Streamable + SSE (`/mcp`, `/sse`), protégé OAuth. Registre dans `src/tools.js` (~105 outils, lignes 713 à 2291), groupes fonctionnels : contrats (`get_active_contracts`, `get_contract`), packs/datasets (`get_desk_pack`, `get_dataset`), bundles d'analyse (`get_master_cutoff_bundle`, `get_monitor_context_bundle`), claim/heartbeat live et replay (`claim_next_live_work`, `heartbeat_live`, `complete_live`, équivalents replay), autopilote replay (`start_or_resume_replay_autopilot`, `drive_replay_automation`), backtests (`create_backtest_run` → `get_backtest_results`), écriture de décisions (`save_master_analysis`, `save_hourly_monitor`, `save_replay_master_analysis`, `save_replay_monitor`).

**B) Serveur privé stdio** (`mcp_gpt_desk/scripts/run_desk_context_mcp.mjs`) — nom `"desk-claim-scoped-context"`, **non lancé par aucun service ni script `package.json`** : il est spawné à la demande **par le CLI Codex lui-même** (configuration `-c mcp_servers.*` construite dans `codex-exec-adapter.js:374-410`) pour donner à l'analyse GPT en cours un accès MCP scopé, lecture seule, borné par bail, avec système de reçu cryptographique de preuve d'usage (`context_evidence_receipts`). 8 outils, tous en lecture seule. Actif seulement si `DESK_AI_AGENTIC_CONTEXT_ENABLED=true` (`false` par défaut dans `.env.example`).

**Un troisième mode existe, hors du dépôt** : `docs/GPT_REPLAY_AUTOPILOT_PROMPT.md` et `config/chatgpt-workers/*.json` décrivent un agent ChatGPT **externe** (scheduled task / GPT personnalisé) agissant comme **client** MCP contre le serveur public — voie de secours legacy documentée dans `docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:11-13` (« jamais actifs en même temps que les services Codex propriétaires »). Ce chemin n'est pas du code de ce dépôt et son état d'exécution réel est **INCERTAIN**.

## 7. Inventaire — schéma PostgreSQL (21 migrations)

| Fichier | Contenu |
|---|---|
| `001_schema.sql` | `desk_documents` — store JSONB générique type Firestore, backbone de la quasi-totalité des collections applicatives |
| `002_market_import_schema.sql` | `market_instruments/symbols/timeframes/feeds/candles/feed_status`, `tradingview_events`, imports/checkpoints |
| `003_trade_automation_schema.sql` | `broker_providers/accounts/contracts`, `trade_decisions/risk_checks/order_intents/approvals`, `broker_orders/order_events`, `trades/fills/events/position_snapshots` |
| `004_reference_seed.sql` | Données de référence (pas de nouvelle table) |
| `005_pack_object_catalog.sql` | `desk_pack_objects` (catalogue d'artefacts content-addressed), `desk_runtime_migrations` |
| `006_runtime_origin.sql` | Isolation des lignes issues de l'import Firestore historique (lecture seule, hors runtime actif) |
| `007_remove_legacy_v4.sql` | Nettoyage de documents V4 obsolètes |
| `008_ninjatrader_execution_gateway.sql` | `broker_bridge_mode`, `trade_policy_profiles`, `broker_bridge_heartbeats`, `broker_execution_locks`, `broker_account_snapshots`, `broker_reconciliation_runs`, `broker_execution_outbox` |
| `009_broker_sizing_policy.sql` | Colonnes de sizing sur `trade_policy_profiles`, `broker_policy_audit_events` |
| `010_broker_position_management.sql` | `trade_management_intents/approvals`, `broker_management_outbox` |
| `011_ninjatrader_addon_gateway.sql` | `broker_addon_snapshots/events`, `broker_adapter_parity_runs` |
| `012_deployment_readiness.sql` | `desk_schema_migrations`, `desk_service_heartbeats`, `desk_backup_catalog` |
| `013_news_ingestion.sql` | `news_sources/articles/ingestion_runs` |
| `014_news_runtime_grants.sql` | Droits DB (pas de table) |
| `015_broker_execution_authority.sql` | `execution_authority_mode` (semi_auto/auto) |
| `016_telegram_alerting.sql` | `telegram_runtime_config/source_state/delivery_outbox/delivery_attempts/runtime_state/command_requests` |
| `017_trade_outcomes_resilience.sql` | `trade_outcome_status`, table `trade_outcomes` |
| `018_runtime_resilience.sql` | `desk_maintenance_runs`, `desk_deployment_runs` |
| `019_strategy_v5_risk_guard.sql` | Plafond risque/trade à 0,25 % |
| `020_broker_rounding_risk_policy.sql` | `max_rounding_excess_pct` |
| `021_broker_decision_freshness_policy.sql` | `max_decision_age_seconds` |

**Absent** : `dataset_id`, colonnes `version`/`rollover_method`/`adjustments` (pas de Dataset Builder au sens du plan directeur) ; ticks, bid/ask, open interest ; TimescaleDB.

## 8. Inventaire — contrats actifs (au 2026-08-07)

D'après `docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:21-30` et confirmation indépendante des agents d'exploration :

| Contrat | Version active | Rôle |
|---|---|---|
| `DeskMasterAnalysisContract` | 5.4.0 (release courante) / 5.1.0 (pin runbook) — **voir note de version ci-dessous** | Sortie GPT « analyse initiale » |
| `DeskExecutionPlanContract` | 1.4.0 / 1.1.0 | Plan d'exécution proposé par GPT, imbriqué dans Master |
| `DeskHourlyThesisMonitorContract` | 2.4.0 / 2.1.0 | Sortie GPT « monitor » horaire |
| `DeskMonitorCommandContract` | 1.4.0 / 1.1.0 | Commande de transition proposée par le monitor |
| `DeskConditionCatalogContract` | 1.2.0 / 1.1.0 | Catalogue machine des prédicats/gates (source de vérité JSON) |
| `DeskDeterministicExecutionPolicy` | 4.3.0 / 4.1.0 | Frontière analyse GPT / décision déterministe |
| `DeskFrontProjectionContract` | 1.0.0 | Projection stable consommée par le frontend |

**Note de version — INCERTAIN, à clarifier avec l'opérateur avant tout chantier :** deux jeux de versions actives apparaissent dans les sources consultées (5.4.0/1.4.0/2.4.0/1.4.0/1.2.0/4.3.0 selon le déploiement `2026.08.06-*` observé plus tôt, contre 5.1.0/1.1.0/2.1.0/1.1.0/1.1.0/4.1.0 selon `docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md` et le cutover du 2026-08-01). Ceci reflète très probablement une progression dans le temps (V5.1 au cutover du 1er août, V5.4 plus tard), mais la version **réellement active sur le VPS à l'instant présent** doit être vérifiée avant toute planification — ne pas supposer laquelle des deux est active sans requêter `get_active_contracts` ou l'équivalent.

Chaque contrat conserve son historique complet (jusqu'à 6 versions antérieures pour Master), toutes hash-lockées, en lecture seule, jamais réécrites.

## 9. Le verrou central — une seule version de stratégie active à la fois

**CONFIRMÉ, triangulé.** `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`) fige un tuple unique de versions (strategy_version, autopilot_version, master_contract, etc.). `assertActiveStrategyRuntimePins` rejette tout payload non épinglé sur ce tuple exact (`repin_forbidden: true`). C'est ce même mécanisme qui garantit la sûreté aujourd'hui, et qui interdit structurellement le A/B, les backtests comparatifs multi-stratégies et le Research Lab. Toute la plateforme de contrats/registres/`strategy_catalog` existe déjà en base (`front-operations-service.js:1288-1341` la lit) mais **n'est jamais écrite** par le backend — une coquille inerte, pas un chantier vide. C'est le point d'accroche naturel pour le déverrouillage.

---

## DOCUMENT 3/4 — RÉPONSES SECTION 31 (les 27 questions préalables du plan directeur)

Chaque réponse est vérifiée indépendamment. Statut entre gras.

**Quelles données historiques sont disponibles ?**
OHLCV uniquement, aucun tick, aucun bid/ask, aucun open interest. Instruments avec données réelles : MNQ, MES, NQ, ES, DXY, VIX, US10Y, US02Y, GC, CL. Mégacaps et indices Asie/Europe sont **déclarés dans le schéma mais vides** (20 feeds, zéro bougie). **CONFIRMÉ**.

**Quelle profondeur d'historique existe ?**
207 281 bougies, du 2026-05-31 au 2026-07-31. 24 jours M1 distincts sur MNQ/MES (62 064 lignes). **CONFIRMÉ** — c'est le facteur limitant réel pour toute robustesse statistique, pas la mécanique du moteur.

**Quelle granularité existe ?**
M1, M5, M15, H1, H4 peuplés. `30` et `1D` déclarés mais jamais peuplés. **CONFIRMÉ**.

**Les ticks sont-ils disponibles ?**
Non. 100 % barres OHLCV. Sans ticks, ni POC/VAH/VAL ni la résolution fine de l'ambiguïté intrabar ne sont possibles. **CONFIRMÉ** — `poc_vah_val: {}` est explicitement codé en dur à vide (`mcp_gpt_desk/src/desk-market-feature-algorithms.js:394`).

**Comment les rollovers sont-ils gérés ?**
Entièrement délégués aux séries continues `1!` de TradingView. Aucune date de roll enregistrée côté desk — **irrécupérable** pour les lignes déjà importées. **CONFIRMÉ**.

**Quelles features existent déjà ?**
Réutilisables : VWAP (session, sans bandes), niveaux overnight/previous-NY/session, carte de niveaux par clustering de pivots, classification d'événements techniques, deltas cross-asset. Absents : POC/VAH/VAL réel, ATR réel (`atr_14` calcule en fait `moyenne(high−low)`, sans true range ni lissage de Wilder — `desk-market-feature-algorithms.js:780-783` — un nom trompeur, pas juste un manque), RSI côté backend, Initial Balance, bandes VWAP. **CONFIRMÉ**.

**Quelle base est actuellement utilisée ?**
PostgreSQL 16 simple, sans TimescaleDB, 21 migrations. Un store JSONB générique (`desk_documents`) porte la majorité des collections applicatives. **CONFIRMÉ**.

**Firebase doit-il être conservé ?**
Non — déjà retiré du runtime applicatif. Un test de régression dédié (`mcp_gpt_desk/test/document_collections.test.js:25-32`) échoue explicitement le build si du code Firebase/Firestore est réintroduit. **CONFIRMÉ**.

**Quels services sont réutilisables ?**
API/MCP (`mcp_gpt_desk/src/server.js`), le moteur déterministe complet (`packages/desk-domain`), le système de contrats (`packages/desk-contracts`), le moteur d'issue de replay (`packages/desk-replay-engine`), l'horloge injectable (`packages/desk-time`), la garde anti-look-ahead (`packages/desk-audit`), le kit de déploiement Windows, 6 services conteneurisés en local. **CONFIRMÉ**.

**Comment fonctionne exactement le service Windows actuel ?**
Neuf services WinSW distincts, dont trois workers IA qui exécutent chacun `run_desk_ai_worker.mjs` en boucle. Détail complet dans le document 2 §3. **CONFIRMÉ**, triangulé.

**Comment les conversations sont-elles persistées ?**
Les métadonnées de continuité sont persistées dans `desk_ai_conversation_sessions` (v2) côté Postgres. Le **contenu** reste géré par le CLI Codex lui-même — ce dépôt ne stocke jamais les messages. **CONFIRMÉ**.

**Comment les workers sont-ils réveillés ?**
`pg_notify('desk_ai_work_ready')` sur deux collections, avec repli par polling (défaut 15 s) en cas de notification manquée. **CONFIRMÉ**.

**Comment les claims sont-ils générés ?**
Deux mécanismes distincts et non unifiés : store JSONB générique avec verrous advisory pour les workers IA/live/replay ; file relationnelle dédiée avec bail pour l'exécution broker uniquement. **CONFIRMÉ**.

**Quel message bus existe déjà ?**
Aucun produit de message-queue dédié. Un seul canal `pg_notify`, utilisé comme signal de réveil, pas comme bus typé/ordonné/persistant. **CONFIRMÉ**.

**Quelle infrastructure VPS est disponible ?**
OVH, Windows Server 2025, 8 vCPU AMD EPYC-Milan, 23,4 Go RAM, ~200 Go disque (80 Go utilisés). Charge observée : 4,9 % CPU, 14,7 Go RAM libre. **CONFIRMÉ**.

**Combien de workers doivent tourner initialement ?**
**Décision opérateur — non déductible du code.** Contrainte matérielle : 8 vCPU. Recommandation de départ : 1 live + 1 replay + 2 à 4 backtest.

**Quelle charge cible à moyen terme ?**
**Décision opérateur.**

**Quel instrument pour le MVP ?**
MNQ ou MES — les deux seuls instruments avec du M1 réellement exploitable. Décision finale : **opérateur**.

**Quelle stratégie de référence ?**
**Décision opérateur.** Le catalogue de conditions fournit déjà 8 `setup_patterns` prédéfinis dont `BREAKOUT_RETEST` et `CONTINUATION`.

**Quel broker ou prop provider ?**
NinjaTrader, comptes `Sim*` exclusivement — refus câblé en dur des comptes non-simulés (`broker-execution.js:534,561`). **CONFIRMÉ**.

**Quelle compatibilité exacte avec PickMyTrade ?**
**Aucune information dans le dépôt.** Zéro occurrence de code, zéro configuration, zéro test. **ABSENT**, confirmé par grep exhaustif.

**Le backend-to-backend PickMyTrade est-il officiellement supporté ?**
**Hors périmètre du dépôt** — question à poser directement au fournisseur.

**Comment obtenir un statut broker fiable ?**
Aujourd'hui, seulement en mode push (l'AddOn envoie ses propres snapshots) ; **aucun mécanisme de pull** où le desk interroge activement l'état du broker.

**Comment gérer les sessions Rithmic ?**
**Hors périmètre du dépôt actuel** — ne se pose que si PickMyTrade est adopté.

**Comment garantir l'idempotence de bout en bout ?**
**Déjà largement acquis.** Cinq couches indépendantes : clé de matérialisation de décision, intent d'ordre content-addressed, approbations idempotentes, intents de gestion idempotents, déduplication des événements broker, plus concurrence optimiste. **CONFIRMÉ**.

**Comment éviter le double envoi lors d'un fallback ?**
La mécanique de base existe pour un fournisseur unique. Manque toute la logique de bascule entre fournisseurs, puisqu'il n'en existe qu'un.

**Comment réconcilier les positions ?**
Les comparateurs existent et sont fail-closed. **Mais ils ne sont jamais déclenchés automatiquement.** Risque opérationnel réel, indépendant de toute évolution future. **CONFIRMÉ**.

**Quelles limites de risque doivent être codées dès le MVP ?**
Déjà codées : sizing borné (0,01–0,25 %), plafonds de quantité, RR minimum 2, fraîcheur de décision, kill switch, verrous, perte journalière. Manquantes : max drawdown, trailing drawdown, max trades/jour, exposition agrégée, budget de risque portefeuille. **CONFIRMÉ**.

**Question supplémentaire posée par cette session : quel est le mécanisme réel d'authentification du CLI Codex ?**
**INCERTAIN.** Le code supporte les deux mécanismes (clé API explicite **ou** session de connexion CLI persistée) sans qu'on puisse déterminer depuis le dépôt seul lequel est effectivement configuré sur le VPS. Conditionne directement le dimensionnement réel du chantier « réduction de tokens ». À clarifier avec l'opérateur.

---

## DOCUMENT 4/4 — PLAN D'ÉVOLUTION (livrable principal)

## Principe de séquencement

Le point de départ réel est **plus avancé** que ce que suppose le plan directeur sur l'axe « rigueur déterministe », mais **bloqué** sur l'axe « pluralité » (une seule stratégie, une seule position, un seul fournisseur à la fois). Trois principes non négociables :

1. **Ce qui ne consomme aucun token LLM passe en premier**, indépendamment de la disponibilité de crédits Codex.
2. **Le verrou de version de stratégie unique est le pivot** : rien dans les phases 3/4/5 n'est atteignable tant qu'il tient.
3. **Aucun ticket de sûreté d'exécution ne passe après un chantier d'ambition** : les trois défauts de sûreté broker doivent être corrigés avant qu'une deuxième stratégie ne puisse jamais tourner en parallèle.

## Phase 0 — Immédiat, sans LLM, sans dépendance

### Épic 0.A — Sécuriser l'acquisition de données (priorité critique)

- **Ticket 0.A.1 — Relancer la capture de données de marché.** Dépendance : aucune. Dernière bougie capturée 2026-07-31 20:59 UTC ; l'ingestion s'est arrêtée au gel. Chaque jour non capturé peut devenir irrécupérable. Critère d'acceptation : job d'ingestion actif, délai de retard mesuré et alerté, idempotence d'import préservée.
- **Ticket 0.A.2 — Importer les 33 103 lignes déjà capturées (18-24 juillet) qui dorment sur disque.** Dépendance : aucune. Gain immédiat de profondeur sans attendre une seule nouvelle bougie.

### Épic 0.B — Corriger les trois défauts de sûreté d'exécution broker (priorité critique)

- **Ticket 0.B.1 — Brancher `PROTECTION_CONFIRMED` sur le chemin broker réel.** La machine à états canonique existe déjà (`position-state-machine-v1.js:12-91`) — elle n'est simplement jamais invoquée. Travail : après un fill, interroger l'état réel du stop côté broker plutôt que de faire confiance à `intent.bracket` ; définir l'action de repli si non confirmée.
- **Ticket 0.B.2 — Déclencher la réconciliation périodiquement.** `compareSnapshots`/`reconcile()` sont corrects et fail-closed, mais jamais appelés automatiquement. Point d'accroche naturel : `run_broker_management_worker.mjs`, qui tourne déjà en continu.
- **Ticket 0.B.3 — Corriger le bug `Map` d'auto-verrouillage multi-positions.** `broker-execution-service.js:888-893` construit `deskPositions` comme une `Map` clé = instrument ; deux positions sur le même instrument s'écrasent silencieusement → faux mismatch → verrouillage du compte. **Bloquant absolu avant Phase 1.** Correction : clé composite instrument + strategy_id.

### Épic 0.C — Corrections ponctuelles à faible risque

- **Ticket 0.C.1 — Corriger ou renommer `atr_14`** (calcule en fait une moyenne de range, pas un vrai ATR).
- **Ticket 0.C.2 — Étendre le hachage d'intégrité des packs à macro/news** (actuellement exclus de la garantie de reproductibilité).

### Épic 0.D — Clarifications opérationnelles préalables (décision opérateur)

- **Ticket 0.D.1 — Confirmer l'état exact du hold et la version de contrat réellement active** (deux jeux de versions observés : 5.4.0 vs 5.1.0 selon la source).
- **Ticket 0.D.2 — Clarifier le mode d'authentification Codex CLI** (clé API vs abonnement plafonné) — conditionne le dimensionnement du chantier « réduction de tokens ».

## Phase 1 — Lever le verrou de version de stratégie unique (le pivot)

Dépendance : Épic 0.B complété avant activation réelle multi-stratégies ; développement possible en parallèle de la Phase 0.

- **Ticket 1.1 — Extraire une Strategy Specification persistée du plan d'instance actuel.** Définir le sous-ensemble stable (famille de setup, filtres, session, règles de sortie) par opposition à ce qui varie à chaque checkpoint.
- **Ticket 1.2 — Peupler `strategy_catalog`/`desk_strategy_versions`.** Déjà lues par le backend, jamais écrites — coquille inerte à activer.
- **Ticket 1.3 — Remplacer `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (tuple figé) par un ensemble de versions actives.** Le déverrouillage littéral. Doit préserver toute la garantie de sûreté existante.
- **Ticket 1.4 — Cycle de vie minimal de la stratégie** (`DRAFT → PAPER → ACTIVE → RETIRED`, sous-ensemble réduit suffisant pour débloquer la Phase 3).

Débloque : Strategy Registry → Experiment Registry → backtests réels indépendants du LLM → signaux multiples → arbitrage de portefeuille → réduction de la consommation de tokens.

## Phase 2 — Moteur de simulation historique

Pas de dépendance dure sur la Phase 1 (démarrage en parallèle possible). **Recommandation : ne pas réécrire le backend Node en Spring Boot** — ~63 500 lignes de backend Node couvertes par 101 fichiers de tests seraient jetées pour un gain nul. Introduire Python uniquement pour le moteur de simulation et les statistiques.

- **Ticket 2.1 — Dataset Builder** (absent aujourd'hui : `dataset_id`, `version`, `rollover_method` inexistants).
- **Ticket 2.2 — Feature Engine, port + extension** (POC/VAH/VAL impossible sans ticks ; ATR réel, RSI backend, Initial Balance, bandes VWAP à ajouter).
- **Ticket 2.3 — Simulateur événementiel core** (réutiliser la sémantique anti-look-ahead JS existante comme spécification).
- **Ticket 2.4 — Order Simulator** (types d'ordres, slippage, commissions, fills partiels ; règle pessimiste par défaut pour l'ambiguïté intrabar faute de ticks).
- **Ticket 2.5 — Portfolio + Risk Engine en mode backtest** (réutiliser `evaluateBrokerPolicy`, fonction pure, directement réutilisable offline).
- **Ticket 2.6 — Metrics Engine** (expectancy en R, profit factor, Sharpe/Sortino/Calmar, analyse segmentée).

## Phase 3 — Experiment Registry et Research Lab

Dépendance dure : Phase 1 + Phase 2 livrées.

- **Ticket 3.1 — Généraliser `desk_replay_autopilot_configs` en Experiment Registry multi-bras** (le patron existe déjà : épinglage immuable, priorité, cycle READY/PAUSED/ARCHIVED — mais mono-bras, sans hypothèse ni métriques).
- **Ticket 3.2 — Mémoire des échecs et détection de doublons.**
- **Ticket 3.3 — Agents de recherche minimaux** (commencer par Experiment Agent + Backtest Validator seuls, pas les 9 rôles d'un coup).

Note : 24 jours de M1 suffisent pour la mécanique, pas pour la robustesse (walk-forward, out-of-sample) — traiter l'acquisition d'historique profond comme un chantier à part entière de cette phase.

## Phase 4 — Runtime multi-agent généralisé

Utile une fois la Phase 3 en place. Généralise un pattern qui fonctionne déjà pour un seul type d'agent.

- **Ticket 4.1 — Agent comme entité de première classe** (aujourd'hui `DESK_AI_WORKER_ID` est juste une variable d'environnement).
- **Ticket 4.2 — Event Envelope avec `correlation_id`/`causation_id`** (zéro occurrence actuellement — ajout additif).
- **Ticket 4.3 — Orchestrateur central minimal** (routage actuel : deux lanes fixes codées en dur).
- **Ticket 4.4 — Généraliser Submit-Suspend-Resume au-delà du worker d'analyse unique.**

Sur le bus de messages : rester sur PostgreSQL (LISTEN/NOTIFY + table de file) tant qu'il n'a pas prouvé son insuffisance — Kafka/RabbitMQ ajouterait de la charge d'exploitation sans capacité réelle sur 8 vCPU.

## Phase 5 — Portfolio Arbitration, puis Execution Gateway et PickMyTrade

- **Ticket 5.1 — Extraire une interface `ExecutionProvider`** (aujourd'hui `'ninjatrader'` est un littéral SQL dans plusieurs fichiers). Compléter au passage : `cancelOrder` (code mort), `replaceOrder` (move_stop seulement), `modifyProtection` (jamais le take-profit), `getOrderStatus`/`getPositionStatus` (push seul, jamais pull).
- **Ticket 5.2 — Portfolio Arbitration Engine.** Dépendance : Phase 1 (plusieurs stratégies actives).
- **Ticket 5.3 — Évaluation externe PickMyTrade (avant tout code).** Répondre aux 20 questions du §21.4 directement auprès du fournisseur — rien dans ce dépôt ne peut y répondre.
- **Ticket 5.4 — Adaptateur PickMyTrade (si 5.3 concluant).** Suivre la migration en 5 phases du plan directeur (démo → adaptateur+simulation → shadow → live réduit → principal).

## Ce qui n'est délibérément pas planifié ici

Aucun ticket ci-dessus ne doit être exécuté par la session d'audit elle-même. Les décisions marquées « opérateur » (nombre de workers, instrument MVP, stratégie de référence, charge cible) doivent être tranchées avant que la Phase 1 ne soit chiffrée en détail — elles ne bloquent pas la Phase 0.

---

*Fin du rapport.*
