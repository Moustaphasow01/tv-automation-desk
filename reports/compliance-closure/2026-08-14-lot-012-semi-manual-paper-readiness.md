# LOT 012 — SEMI_MANUAL / PAPER readiness

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Status: **PARTIEL — repository certifié, runtime externe à prouver**

## Décision opérationnelle

Le desk reste en **SEMI_MANUAL** pour l'exécution opérateur:

`Data → StrategySignal → AI Context Gate → Portfolio Arbitration → Global Risk → TargetPosition → OrderIntent → Operator notification → Human Execution Gate → Execution Gateway → Provider`

Une alerte Telegram/front peut demander à l'opérateur de poser un ordre, mais elle ne vaut jamais fill. Le backend continue de suivre l'exécution théorique séparément, selon le type d'ordre, le prix et les bougies clôturées. Les confirmations opérateur servent au journal manuel/reconciliation, pas à muter silencieusement le PnL théorique.

## Matrice de fermeture

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
| --- | --- | --- | --- | --- | --- | --- |
| Signal → Context → Portfolio → Risk → TargetPosition → OrderIntent → notification opérateur → Human Gate | Chaîne repository disponible et testée en mémoire | Branchement runtime live réel vers cette chaîne encore à auditer dans un lot ultérieur | `mcp_gpt_desk/src/portfolio-risk-runtime-service.js`, `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js`, `mcp_gpt_desk/src/telegram-trading-message.js` | `mcp_gpt_desk/test/semi_manual_paper_readiness.test.js` | Tables PostgreSQL lineage/gates/provider présentes | **FAIT côté domaine/service, PARTIEL runtime live** |
| Aucun broker dispatch avant Human Gate | Le service bloque `materializeReadyCommands` sans confirmation | Aucun sur ce périmètre | `humanGateIssues` dans `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js` | `LOT-012 SEMI_MANUAL path notifies operator and blocks broker dispatch until Human Gate` | `broker_provider_commands` existe; test prouve 0 command | **FAIT** |
| Notification opérateur claire et broker-safe | Le message Telegram indique action manuelle, risk/context, strategy, invalidation et absence d'envoi broker | Envoi réel Telegram non déclenché volontairement sans credential/chat live | `mcp_gpt_desk/src/telegram-trading-message.js` | `mcp_gpt_desk/test/telegram_trading_message.test.js`, `mcp_gpt_desk/test/semi_manual_paper_readiness.test.js` | Client Telegram testé sans fuite de token; envoi réel = dépendance externe | **PARTIEL / BLOQUÉ EXTERNE pour l'envoi réel** |
| Confirmation opérateur idempotente | Confirmation double protégée | Aucun | `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js` | `LOT-012 operator confirm is idempotent and immutable before PAPER provider command` | Tables `human_execution_gates`, `human_execution_gate_events` présentes | **FAIT** |
| Quantité/account immuables | Le Human Gate refuse changement de quantité ou de compte | Aucun | `humanGateConfirmationIssue` dans `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js` | `LOT-012 operator confirm is idempotent and immutable before PAPER provider command` | Preuve service | **FAIT** |
| Rejet opérateur | Le rejet bloque la matérialisation provider avec raison explicite | Aucun | `rejectHumanGate`, `humanGateIssues` | `LOT-012 operator reject blocks PAPER provider command with explicit reason` | Preuve service | **FAIT** |
| Expiry / stale intent | Human Gate expiré bloque; signal expiré ne produit aucun OrderIntent | Aucun | `humanGateIssues`, Signal Bus / pipeline runtime | `LOT-012 expired and stale intents fail closed before provider command`, `LOT-012 stale signal produces no OrderIntent to notify or dispatch` | Preuve service | **FAIT** |
| Market moved / ordre LIMIT | Une alerte ne remplit pas l'ordre; un LIMIT est fill seulement quand une bougie clôturée touche le prix | Aucun côté moteur théorique | `mcp_gpt_desk/src/theoretical-execution-engine.js`, `mcp_gpt_desk/src/broker-theoretical-execution-service.js` | `LOT-012 market moved does not fill a theoretical LIMIT until a closed candle touches` | Table `trade_theoretical_execution_events` présente | **FAIT** |
| Fill manuel externe +2 attendu / +2 réalisé | Event manuel classé `MATCHED_MANUAL_EXECUTION` sans muter le fill théorique | Preuve runtime broker réel non disponible dans ce lot | `recordManualExecutionEvent`, `evaluateManualExecutionReconciliation` dans `mcp_gpt_desk/src/broker-theoretical-execution-service.js` | `LOT-012 manual external fills are matched or flagged without mutating theoretical fills` | Table `trade_manual_execution_events` présente | **FAIT côté backend, BLOQUÉ EXTERNE broker réel** |
| Fill manuel externe +2 attendu / +3 réalisé | Event manuel classé `RECONCILIATION_MISMATCH` | Preuve runtime broker réel non disponible dans ce lot | `evaluateManualExecutionReconciliation` | `LOT-012 manual external fills are matched or flagged without mutating theoretical fills` | Preuve service | **FAIT côté backend, BLOQUÉ EXTERNE broker réel** |
| HTTP/provider ACK ≠ fill | Cycle provider continue à distinguer ACK, reject, partial/full fill | Aucun sur ce périmètre | `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js`, `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js` | `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js` | Tables provider présentes | **FAIT** |
| AUTO/LIVE non implicite | `LIVE` est bloqué sans autorisation explicite; `SHADOW` ne crée aucun provider command | Aucun sur ce périmètre | `normalizeExecutionPolicy`, `materializeReadyCommands` | `PAPER wrong account and implicit LIVE are rejected before provider command`, `SHADOW confirmation produces zero physical provider command` | Preuve service | **FAIT** |

## Changements techniques

- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js`
  - `humanGateIssues` remonte désormais des raisons fail-closed précises:
    - `HUMAN_CONFIRMATION_REQUIRED`
    - `HUMAN_GATE_EXPIRED`
    - `HUMAN_GATE_REJECTED`
    - autres statuts Human Gate non confirmés.
- `mcp_gpt_desk/src/broker-theoretical-execution-service.js`
  - Ajout de la classification `manual_reconciliation`.
  - Un event manuel opérateur reste observationnel et ne crée pas de fill théorique.
  - Mismatch instrument/side/quantity détecté.
- `mcp_gpt_desk/src/telegram-trading-message.js`
  - Ticket Telegram d'entrée semi-manuelle enrichi:
    - action manuelle explicite;
    - Human Gate;
    - stratégie/instance;
    - risk/context;
    - invalidation;
    - avertissement qu'aucun ordre broker n'a été envoyé.
- `mcp_gpt_desk/test/semi_manual_paper_readiness.test.js`
  - Nouvelle matrice Lot 012 couvrant notification, confirm, reject, expiry, stale, manual match/mismatch et LIMIT theoretical execution.

## Tests exécutés

```text
node --test \
  mcp_gpt_desk/test/semi_manual_paper_readiness.test.js \
  mcp_gpt_desk/test/telegram_trading_message.test.js \
  mcp_gpt_desk/test/theoretical_execution_service.test.js \
  mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js \
  mcp_gpt_desk/test/manual_theoretical_execution_sql_schema.test.js

24 pass / 0 fail
```

```text
npm --prefix mcp_gpt_desk test

1080 pass / 0 fail
```

```text
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:mcp-slices
npm run guard:sql-migrations
npm run guard:exceptions
npm run guard:problem-details
npm run guard:windows-deployment

Tous OK
```

```text
npm run guard:static-quality

KO connu, non masqué:
- front-control-plane-api.js > 600 lignes
- strategy-dsl-compiler-v1.js > 600 lignes
- canonical-simulation-engine-v1.js > 600 lignes
- oversized functions: 249 / 243
- high complexity functions: 644 / 592
- duplicate blocks: 72 / 50
- possibly dead files: 17 / 14
```

## Preuve PostgreSQL locale

Commande exécutée:

```text
docker compose ps --format json
```

Résultat utile:

```text
postgres: running, healthy
api: running, healthy
frontend/control-plane/live-runtime/broker-management/replay-preparation/telegram: running
```

Commande exécutée:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = current_schema()
  AND table_name IN (
    'trade_manual_execution_events',
    'trade_theoretical_execution_events',
    'human_execution_gates',
    'human_execution_gate_events',
    'broker_provider_commands',
    'broker_provider_events',
    'portfolio_order_intent_execution_states',
    'portfolio_order_intent_lineage'
  )
ORDER BY table_name;
```

Résultat:

```text
broker_provider_commands
broker_provider_events
human_execution_gate_events
human_execution_gates
portfolio_order_intent_execution_states
portfolio_order_intent_lineage
trade_manual_execution_events
trade_theoretical_execution_events
```

Commande exécutée:

```sql
SELECT
  obj_description('trade_manual_execution_events'::regclass) AS manual_comment,
  obj_description('trade_theoretical_execution_events'::regclass) AS theoretical_comment;
```

Résultat:

```text
manual_comment:
Operator execution acknowledgements from front or Telegram. This ledger is observational and does not mutate theoretical fills.

theoretical_comment:
Deterministic backend-only paper execution events. A Telegram/front alert never implies fill; order type and closed OHLC candles drive fills.
```

## Bloquants externes

1. **Envoi Telegram réel**
   - Non exécuté volontairement dans ce lot pour éviter une notification opérateur live non demandée.
   - Preuve nécessaire: bot token/chat configurés en préprod, message de test envoyé sur canal prévu, artifact/log de delivery.

2. **Broker/NinjaTrader/Sim101 réel**
   - Le backend sait classifier `+2 attendu / +2 manuel` et `+2 attendu / +3 manuel`.
   - Preuve nécessaire: event broker/provider réel ou snapshot Sim101 ingéré montrant match puis mismatch.

3. **Branchement runtime live complet**
   - La chaîne domaine/service est certifiée.
   - Le flux live production doit encore prouver qu'il alimente ce pipeline plutôt qu'un ancien chemin.

## Statut de conformité gagné

- FAIT gagnés:
  - Human Gate reject explicite;
  - expiry/stale fail-closed;
  - notification opérateur enrichie et broker-safe;
  - manual execution reconciliation match/mismatch;
  - séparation fill théorique vs ack opérateur;
  - LIMIT théorique non rempli tant que le prix ne touche pas.
- PARTIEL restant:
  - envoi Telegram réel;
  - preuve broker/Sim101 réelle;
  - branchement live complet de bout en bout.
- NON FAIT:
  - aucun nouveau identifié dans ce lot.
- NON PROUVÉ:
  - aucun côté repository local après tests; les preuves restantes sont externes/runtime.
- BLOQUÉ EXTERNE:
  - Telegram live;
  - broker/provider réel;
  - action humaine de validation runtime.

## Note release

Les fichiers de ce lot apparaissent dans un worktree très chargé et plusieurs fichiers restent non trackés. Ils doivent être explicitement inclus dans le prochain commit/release; aucun marquage Jira Done ne doit être fait avant que ces preuves soient rattachées au ticket correspondant.

## Prochain lot officiel

**LOT 013 — Front VNext Certification**

Objectif: prendre le HEAD Front le plus récent et certifier qu'il respecte le cahier des charges sans inventer de logique métier côté browser:

- BFF unique;
- REST et temps réel;
- ACK ≠ FILL;
- reconciliation;
- Research vertical slice et Research industrialisé visibles;
- robustness/Data Engine/SEMI_MANUAL readiness exposés;
- cutover/rollback;
- Jarvis safe;
- sécurité/observabilité;
- static-quality;
- runbooks et blockers finaux.

Le branchement runtime live complet reste un gap P0 connexe à suivre dans la fermeture finale, mais il ne doit pas remplacer le Lot 013 officiel.
