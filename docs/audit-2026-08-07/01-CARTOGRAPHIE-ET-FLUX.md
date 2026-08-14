# Cartographie des composants et des flux

Statuts : **CONFIRMÉ** / **INFÉRÉ** / **INCERTAIN** / **ABSENT**. Citations
`fichier:ligne` relatives à la racine du dépôt.

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

Chaîne précise, avec citations (triangulée par deux agents indépendants + lecture
directe) :

1. **Déclenchement** : `run_desk_ai_worker.mjs` interroge en boucle (voir §3) ;
   `DeskAiWorkerService.runOnce()` (`mcp_gpt_desk/src/desk-ai-worker-service.js:1750`)
   revendique le travail dû.
2. **Lecture de données (pur, déterministe)** :
   `facade.readClaimContext(...)` (`desk-ai-worker-service.js:1796`) lit un
   bundle cutoff-gated — aucun appel LLM à cette étape.
3. **Appel LLM (seul point non déterministe du cycle)** :
   `this.adapter.analyze({...})` (`desk-ai-worker-service.js:1874`) →
   `CodexExecAdapter.analyze()` (`mcp_gpt_desk/src/codex-exec-adapter.js:135`)
   spawn le binaire **Codex CLI d'OpenAI** (`codex-exec-adapter.js:55`,
   `this.codexBin = ... "codex"`) en sous-processus, sandbox lecture seule,
   `approval_policy="never"`, toutes les fonctionnalités agentiques risquées
   désactivées (`shell_tool`, `multi_agent`, `apps`, `browser_use`,
   `computer_use`, `image_generation`, etc. — `codex-exec-adapter.js:192-209`).
   Le prompt est transmis sur **stdin** ; la sortie doit être un JSON validé
   contre un schéma (`--output-schema`). Provider confirmé `"openai"`
   (`codex-exec-adapter.js:483,1053`).
4. **Validation de schéma** : `validateMaterializedWrites`
   (`desk-ai-worker-service.js:1892-1893`) — AJV contre le contrat épinglé
   (`strategy-contract-validator.js`) ; en cas d'échec, **un** re-prompt de
   réparation borné est tenté (`desk-ai-worker-service.js:1910-1946`), puis
   abandon fail-closed.
5. **Compilation déterministe (pure, zéro appel LLM)** :
   `compileMasterPlanV1`/`compileMonitorCommandV1`
   (`packages/desk-domain/src/deterministic-compiler-entry-v1.js`) — calcul de
   géométrie/RR (`evaluateCanonicalGeometry`,
   `packages/desk-domain/src/opportunity-policy-v1.js:291`), classification
   des 12 hard gates / 10 soft gates du catalogue
   (`packages/desk-contracts/catalogs/condition-catalog-v1-2.json`), validation
   des transitions de machine à états (thèse/setup/replan). La proposition
   brute du LLM est conservée pour audit (`gpt_execution_plan_proposal`),
   l'artefact canonique persisté est celui compilé.
6. **Moteur M1 (déterministe, LLM jamais appelé, à chaque bougie fermée)** :
   `reconcileLivePaperExecution` (`mcp_gpt_desk/src/live-paper-execution.js:54`)
   → `evaluateReplaySetupOnRows`/`evaluatePositionOnRows` →
   `evaluateDeterministicConditionSetV1` (évaluation des 11 prédicats sur des
   lignes OHLC réelles) puis `evaluateOpportunitySeekingControlledV1` en phase
   `ENTRY_TRIGGER`. C'est ici, et uniquement ici, que le déclenchement réel
   (fill) est décidé.

**Ce que GPT peut et ne peut pas faire.** GPT ne peut demander que
`SETUP_CANDIDATE`, `PRE_ARMED` ou `ARMED_CONDITIONAL`
(`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:113-115`) ; seul le moteur produit
un trigger, un fill, une position et un résultat en R. Le contrat
`DeskDeterministicExecutionPolicy` liste explicitement les faits que GPT ne
peut jamais déclarer (setups déclenchés, prix de fill, ouverture/fermeture de
position, résultat en R).

**Conclusion (CONFIRMÉ, triangulé par deux agents indépendants) :** le moteur
déterministe est un **validateur/exécuteur fail-closed** des propositions de
GPT, pas un générateur indépendant de signaux. La substance (quelle thèse,
quels setups candidats, quelles conditions, quelles transitions de monitor)
vient de GPT ; la légalité, la géométrie, les gates et le déclenchement final
sont 100 % déterministes. Aucun chemin de code dans `packages/desk-domain` ou
`mcp_gpt_desk/src` ne synthétise un nouveau candidat de trade depuis les
données de marché seules, sans proposition GPT préalable.

## 3. Flux 2 — Réveil des workers (le mécanisme réel derrière « service permanent + worker »)

**Verdict de synthèse (triangulé, deux agents + lecture directe convergent) :**
la description opérateur (« un service permanent réveille un worker ciblé, qui
sauvegarde son état et s'arrête, puis est réveillé plus tard ») est **exacte au
niveau de la conversation LLM, mais imprécise au niveau du processus**. Il n'y
a pas deux processus séparés où l'un réveille l'autre : **le service Windows
et le worker sont le même processus**, une boucle `do…while` qui somnole entre
deux itérations.

### 3.1 Mécanisme de service — WinSW

**CONFIRMÉ.** `deploy/windows/Install-DeskServices.ps1` installe chaque
service via **WinSW** (Windows Service Wrapper), pas `sc.exe`, pas NSSM, pas
`node-windows` (`Install-DeskServices.ps1:6,20,68-93`). Neuf services :

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

**A. Store JSONB générique + verrous advisory (workers IA/live/replay).**
`infra/postgres/init/001_schema.sql:1-26` définit `desk_documents`
(collection/document_id/JSONB), qui porte la quasi-totalité des « collections »
applicatives (`desk_live_run_cursor`, `desk_agent_work_items`,
`desk_ai_conversation_sessions`, etc.). Écriture d'un document déclenchant
→ `aiWorkNotification()` (`postgres-desk-persistence.js:1235-1243`) →
`SELECT pg_notify('desk_ai_work_ready', $1)` si `cursor_status` passe à
`DUE`/`RETRY` ou `status` à `READY`. C'est un **vrai** LISTEN/NOTIFY Postgres,
pas un produit de message-queue.

**B. File relationnelle dédiée à bail (exécution broker uniquement).**
`infra/postgres/init/008_ninjatrader_execution_gateway.sql:23,122-142` et
`010_broker_position_management.sql:15,80-100` définissent
`broker_execution_outbox`/`broker_management_outbox` avec un enum réel
(`pending/leased/rendered/delivered/acknowledged/failed/cancelled/expired`) et
des colonnes `lease_token`/`lease_expires_at` — structurellement distinct du
store JSONB générique.

### 3.3 Le réveil, précisément

`run_desk_ai_worker.mjs:45-58` ouvre un client Postgres dédié, exécute
`LISTEN desk_ai_work_ready`, enregistre un handler qui résout toute promesse
`waitForWake()` en attente. La boucle principale (`:71-93`, `do…while(!stopped)`)
appelle `worker.runOnce()`, puis soit dort 250 ms (si une tâche vient de finir),
soit attend le réveil (`waitForWake(pollMs)`, défaut 15 000 ms) — **un
`Promise.race` entre une notification NOTIFY et un timeout**, donc du polling
avec réveil anticipé par événement, pas un dispatch purement événementiel.
Chaque instance détient un verrou advisory Postgres sur sa propre identité
(`pg_try_advisory_lock`, `run_desk_ai_worker.mjs:46-50`) pour empêcher deux
instances concurrentes du même worker.

**Le service Windows n'invoque jamais un « second processus worker ».**
`DeskFuturesCodexLive01` **est** `run_desk_ai_worker.mjs`, un seul processus
`node.exe` géré directement par WinSW/SCM.

### 3.4 Le réveil du LLM lui-même — un nouveau processus OS par appel

**Ici, un nouveau processus est réellement créé à chaque unité d'analyse.**
`spawnCodex()` (`codex-exec-adapter.js:493-626`) lance le binaire **Codex CLI**
en sous-processus (`child_process.spawn`), attend son événement `close` de
façon synchrone et bloquante (borné par `timeoutMs`, jusqu'à 780 000 ms /
13 min). C'est cet appel — pas le processus worker Node — qui correspond à
« invoquer un agent externe ».

### 3.5 Persistance d'état — ce qui est réellement du Submit-Suspend-Resume, et ce qui ne l'est pas

**Réel et confirmé :**
- Les curseurs (`desk_live_run_cursor`) et work items (`desk_agent_work_items`)
  portent un bail (`lease_expires_at`) qui les rend réclamables par un autre
  worker si le processus original crashe.
- **La conversation LLM est bien persistée et reprise** — mais via le
  mécanisme natif du **Codex CLI lui-même** (`codex exec resume <thread_id>`,
  `codex-exec-adapter.js:211-213`), pas par une base de messages construite par
  ce dépôt. `desk_ai_conversation_sessions` (v2) ne stocke que les
  **métadonnées** de continuité (`thread_id`, `runtime_hash`, `turn_count`
  plafonné à 12, cutoff strictement monotone) — jamais le contenu des
  messages. Un garde explicite (`CODEX_SESSION_SCOPE_MISMATCH`,
  `codex-exec-adapter.js:293-306`) rejette toute reprise d'un fil différent de
  celui attendu.

**Non trouvé — à ne pas supposer :** aucune preuve qu'un work item revendiqué
soit **partiellement traité, checkpointé en cours d'analyse, puis repris
depuis ce checkpoint** lors d'un `runOnce()` ultérieur. Chaque `runOnce()` est
entièrement synchrone : claim → un (ou deux, si réparation) appel Codex
bloquant → validation → complete/fail. Si le processus meurt pendant
`analyze()`, le bail expire simplement et un autre worker **relance** la même
tâche depuis son état de claim (nouvel appel LLM), il ne « reprend » pas un
calcul interrompu.

**Conclusion pour l'évolution vers un Agent Runtime Supervisor générique
(§14 du plan directeur) :** le pattern Submit-Suspend-Resume existe déjà et
fonctionne bien, mais à un seul niveau (le fil de conversation Codex), pour un
seul type d'agent (le worker d'analyse Master/Monitor). Le généraliser
suppose de faire de l'agent une entité de première classe (aujourd'hui
`DESK_AI_WORKER_ID` est une simple variable d'environnement servant de jeton
de bail, sans budget/permission/priorité — **ABSENT**), et d'introduire une
enveloppe d'événement avec corrélation causale
(`correlation_id`/`causation_id` : **zéro occurrence dans tout le dépôt**,
**ABSENT** confirmé par grep exhaustif).

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

**Deux transports coexistent dans le code, un seul confirmé câblé en
déploiement :**

- **AddOn NinjaScript (`integrations/ninjatrader/DeskExecutionAddOn/DeskExecutionAddOn.cs`)** —
  **CONFIRMÉ actif.** Tourne *dans* le processus NinjaTrader Desktop
  (code compilé, pas un service séparé), client HTTP signé HMAC-SHA256 vers
  `http://127.0.0.1:8787/api/v1` en boucle (heartbeat 5 s, snapshot 15 s), exécute
  au plus une commande à la fois contre les objets natifs `Account`/`Order` de
  NinjaTrader. Un superviseur séparé (`DeskNinjaTraderSupervisor.ps1`, **tâche
  planifiée**, pas un service SCM — NinjaTrader étant une appli graphique
  interactive) garde `NinjaTrader.exe` démarré.
- **Pont fichier OIF/ATI (`mcp_gpt_desk/scripts/run_ninja_bridge.mjs`)** —
  code fonctionnel (dépose des commandes texte dans
  `NinjaTrader 8/incoming`), mais **ABSENT de tout script d'installation**
  (`deploy/`, `config/`) — à ne pas supposer actif en production.

**`OrderIntent` est un contrat explicite et bien typé**
(`createOrderIntent`, `broker-execution.js:472-531`) : id, compte, quantité,
type, bracket stop/TP, TIF, expiration, **clé d'idempotence**. Champs
manquants par rapport à la cible : `signal_id`, `strategy_id`, groupe de
comptes, fournisseur préféré/de secours (**ABSENT**).

**Trois faiblesses opérationnelles réelles, confirmées indépendamment par deux
agents :**

1. **Protection après fill jamais vérifiée** — `persistEntryFillAndTrade()`
   (`mcp_gpt_desk/src/broker-execution-repository.js:1010-1055`) écrit
   `status='open'` inconditionnellement et stocke les prix de stop **voulus**,
   jamais confirmés côté broker. Aucun événement `PROTECTION_CONFIRMED`
   n'est jamais émis sur ce chemin, bien que l'état existe dans la machine à
   états canonique (`packages/desk-domain/src/position-state-machine-v1.js`) —
   **elle n'est simplement pas branchée**.
2. **Réconciliation qui ne tourne jamais automatiquement** — les comparateurs
   existent et sont fail-closed (`compareSnapshots`,
   `broker-execution-service.js:882-901`), mais ne sont déclenchés que par un
   appel manuel ou un flag `reconcile: true` que l'AddOn code en dur à `false`
   (`DeskExecutionAddOn.cs:176-177`). Aucun worker planifié ne les appelle.
3. **Aucune interface fournisseur** — `'ninjatrader'` est un littéral SQL
   dans plusieurs fichiers (`broker-execution-repository.js:218,221,317,476,921,926`).
   Zéro occurrence de `PickMyTrade`/`Tradovate`/`Rithmic`/`ExecutionProvider`
   dans le code (uniquement dans deux documents de conception, comme
   aspiration future, pas comme code).

## 5. Les deux mécanismes de « replay » — à ne pas confondre

Le plan directeur et le vocabulaire courant du projet utilisent « replay » et
« backtest » pour deux mécanismes réellement différents, et **l'application
elle-même les fusionne dans une seule liste** (`mcp_gpt_desk/src/store.js:1588-1595`,
`listBacktestRuns` concatène `desk_backtests` et `desk_replay_runs`).

| | Backtest déterministe | Replay orchestré GPT-in-the-loop |
|---|---|---|
| Entrée | Un setup **déjà décidé** (`desk_setups` matérialisés) | Rien — la décision est **régénérée** à chaque step |
| Appel LLM | **Aucun** | **Oui**, à chaque Master/Monitor, via le même worker Codex CLI que le live |
| Code | `packages/desk-replay-engine` (pur, ~550 lignes, testé) + `desk-backtest-algorithms.js` | `desk-replay-orchestration-algorithms.js` (3 025 lignes) + `desk-replay-service.js` (2 084 lignes) |
| Coût token | Zéro | **Identique au live** — c'est littéralement le même pipeline d'analyse rejoué |
| Reproductibilité | Oui (hash de contenu stable, `content_hash` sha256) | Non garantie — la sortie LLM n'est pas seedée |
| Marqueur dans le code | `create_backtest_run` : *"It does not auto-run GPT"* (`tools.js:1834-1836`) | `replay_mode: "orchestrated_gpt_in_the_loop"`, `gpt_in_the_loop: true` (`desk-replay-orchestration-algorithms.js:218-222`) |

**Conséquence directe pour le plan d'évolution** : le « Replay » actuel n'est
**pas** un moteur de simulation historique au sens du plan directeur (§6) — il
rejoue le pipeline GPT, pas une stratégie déterministe. Construire le vrai
moteur de simulation (Python ou non) est un chantier greenfield, mais la
sémantique anti-look-ahead, le rééchantillonnage cutoff-correct et le calcul
en R existent déjà en JavaScript et servent de spécification exécutable.
Anti-look-ahead confirmé implémenté dans les deux mécanismes séparément
(`rowVisibleAtReplayCutoff`/`replayBarClosedAtCutoff`,
`desk-replay-orchestration-algorithms.js:2536-2545`, et
`replayLookaheadCandles`, `packages/desk-replay-engine/src/outcome-engine.js:277-286`).

## 6. Inventaire — outils MCP

Deux serveurs MCP distincts, **CONFIRMÉ** via `@modelcontextprotocol/sdk`.

**A) Serveur public réseau** (`mcp_gpt_desk/src/server.js`) — nom
`"tv-automation-desk-mcp"`, transport HTTP Streamable + SSE (`/mcp`, `/sse`),
protégé OAuth. Registre dans `src/tools.js` (~105 outils, lignes 713 à 2291),
groupes fonctionnels : contrats (`get_active_contracts`, `get_contract`),
packs/datasets (`get_desk_pack`, `get_dataset`), bundles d'analyse
(`get_master_cutoff_bundle`, `get_monitor_context_bundle`), claim/heartbeat
live et replay (`claim_next_live_work`, `heartbeat_live`, `complete_live`,
équivalents replay), autopilote replay (`start_or_resume_replay_autopilot`,
`drive_replay_automation`), backtests (`create_backtest_run` →
`get_backtest_results`), écriture de décisions (`save_master_analysis`,
`save_hourly_monitor`, `save_replay_master_analysis`, `save_replay_monitor`).

**B) Serveur privé stdio** (`mcp_gpt_desk/scripts/run_desk_context_mcp.mjs`) —
nom `"desk-claim-scoped-context"`, **non lancé par aucun service ni script
`package.json`** : il est spawné à la demande **par le CLI Codex lui-même**
(configuration `-c mcp_servers.*` construite dans `codex-exec-adapter.js:374-410`)
pour donner à l'analyse GPT en cours un accès MCP scopé, lecture seule,
borné par bail, avec système de reçu cryptographique de preuve d'usage
(`context_evidence_receipts`). 8 outils, tous en lecture seule. Actif
seulement si `DESK_AI_AGENTIC_CONTEXT_ENABLED=true` (`false` par défaut dans
`.env.example`).

**Un troisième mode existe, hors du dépôt** : `docs/GPT_REPLAY_AUTOPILOT_PROMPT.md`
et `config/chatgpt-workers/*.json` décrivent un agent ChatGPT **externe**
(scheduled task / GPT personnalisé) agissant comme **client** MCP contre le
serveur public — voie de secours legacy documentée dans
`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:11-13` (« jamais actifs en même
temps que les services Codex propriétaires »). Ce chemin n'est pas du code de
ce dépôt et son état d'exécution réel est **INCERTAIN**.

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

**Absent** : `dataset_id`, colonnes `version`/`rollover_method`/`adjustments`
(pas de Dataset Builder au sens du plan directeur) ; ticks, bid/ask, open
interest ; TimescaleDB.

## 8. Inventaire — contrats actifs (au 2026-08-07)

D'après `docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md:21-30` et confirmation
indépendante des agents d'exploration :

| Contrat | Version active | Rôle |
|---|---|---|
| `DeskMasterAnalysisContract` | 5.4.0 (release courante) / 5.1.0 (pin runbook) — **voir note de version ci-dessous** | Sortie GPT « analyse initiale » |
| `DeskExecutionPlanContract` | 1.4.0 / 1.1.0 | Plan d'exécution proposé par GPT, imbriqué dans Master |
| `DeskHourlyThesisMonitorContract` | 2.4.0 / 2.1.0 | Sortie GPT « monitor » horaire |
| `DeskMonitorCommandContract` | 1.4.0 / 1.1.0 | Commande de transition proposée par le monitor |
| `DeskConditionCatalogContract` | 1.2.0 / 1.1.0 | Catalogue machine des prédicats/gates (source de vérité JSON) |
| `DeskDeterministicExecutionPolicy` | 4.3.0 / 4.1.0 | Frontière analyse GPT / décision déterministe |
| `DeskFrontProjectionContract` | 1.0.0 | Projection stable consommée par le frontend |

**Note de version — INCERTAIN, à clarifier avec l'opérateur avant tout
chantier :** deux jeux de versions actives apparaissent dans les sources
consultées (5.4.0/1.4.0/2.4.0/1.4.0/1.2.0/4.3.0 selon le déploiement
`2026.08.06-*` observé plus tôt, contre 5.1.0/1.1.0/2.1.0/1.1.0/1.1.0/4.1.0
selon `docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md` et le cutover du
2026-08-01). Ceci reflète très probablement une progression dans le temps
(V5.1 au cutover du 1er août, V5.4 plus tard), mais la version **réellement
active sur le VPS à l'instant présent** doit être vérifiée avant toute
planification — ne pas supposer laquelle des deux est active sans requêter
`get_active_contracts` ou l'équivalent.

Chaque contrat conserve son historique complet (jusqu'à 6 versions
antérieures pour Master), toutes hash-lockées, en lecture seule, jamais
réécrites.

## 9. Le verrou central — une seule version de stratégie active à la fois

**CONFIRMÉ, triangulé.** `ACTIVE_STRATEGY_RUNTIME_VERSIONS`
(`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`) fige un tuple unique
de versions (strategy_version, autopilot_version, master_contract, etc.).
`assertActiveStrategyRuntimePins` rejette tout payload non épinglé sur ce
tuple exact (`repin_forbidden: true`). C'est ce même mécanisme qui garantit
la sûreté aujourd'hui, et qui interdit structurellement le A/B, les
backtests comparatifs multi-stratégies et le Research Lab. Toute la
plateforme de contrats/registres/`strategy_catalog` existe déjà en base
(`front-operations-service.js:1288-1341` la lit) mais **n'est jamais écrite**
par le backend — une coquille inerte, pas un chantier vide. C'est le point
d'accroche naturel pour le déverrouillage (voir `03-PLAN-EVOLUTION.md`).
