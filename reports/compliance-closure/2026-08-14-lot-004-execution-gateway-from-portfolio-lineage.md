# LOT 004 — Execution Gateway depuis Portfolio/Risk lineage

Date: 2026-08-14
Repository: `TV_Automation_PREPROD`
Scope: fermer le gap entre la lineage canonique `StrategySignal → Portfolio Arbitration → Global Risk → TargetPosition → OrderIntent` et le port `Execution Gateway`.

## Résultat court

Statut du lot: FAIT côté repository, tests, migration et smoke PostgreSQL local.

Le desk dispose maintenant d'un chemin matérialisé:

```text
portfolio_order_intent_lineage
  -> PortfolioOrderIntentExecutionService
  -> buildExecutionProviderCommandV1
  -> broker_provider_commands.portfolio_order_intent_id
  -> provider adapter claim
```

Le chemin legacy `desk_positions -> trade_decision -> trade_order_intents -> broker_execution_outbox` reste disponible uniquement derrière le rollback explicite `DESK_LEGACY_POSITION_EXECUTION_ENABLED=true`. Par défaut, il est fail-closed.

## Décision d'architecture

`portfolio-risk` reste propriétaire des décisions Portfolio/Risk/Target/OrderIntent.

`execution` reste propriétaire des commandes provider et événements broker.

Le lien entre les deux bounded contexts est relationnel et auditable:

- `broker_provider_commands.portfolio_order_intent_id`
- `broker_provider_events.portfolio_order_intent_id`

Un succès HTTP/provider ou un ACK provider ne devient pas un fill. Le lot ne modifie pas cette règle: la commande provider est seulement mise en `pending`; le cycle `ack/fill/reject/reconciliation` reste dans l'Execution Gateway.

## Implémentation

### Migration SQL

Fichier:

- `infra/postgres/init/049_execution_provider_portfolio_lineage.sql`

Ajouts:

- FK `broker_provider_commands.portfolio_order_intent_id -> portfolio_order_intent_lineage(portfolio_order_intent_id)`;
- FK `broker_provider_events.portfolio_order_intent_id -> portfolio_order_intent_lineage(portfolio_order_intent_id)`;
- index de lecture/diagnostic par portfolio intent;
- contrainte `broker_provider_commands_order_intent_source_check`;
- contrainte `broker_provider_events_order_intent_source_check`.

Invariants:

- les commandes order-related doivent avoir une source legacy ou portfolio;
- les commandes techniques `sync_positions` / `sync_orders` restent autorisées sans order intent;
- les événements order lifecycle doivent avoir une source legacy ou portfolio;
- les événements provider non order lifecycle, comme heartbeat, restent autorisés.

Preuves:

- `infra/postgres/init/049_execution_provider_portfolio_lineage.sql:1`
- `infra/postgres/init/049_execution_provider_portfolio_lineage.sql:7`
- `infra/postgres/init/049_execution_provider_portfolio_lineage.sql:15`
- `infra/postgres/init/049_execution_provider_portfolio_lineage.sql:27`

### Repository Execution depuis lineage portfolio

Fichier:

- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js`

Fonctions prouvées:

- lecture des `portfolio_order_intent_lineage` READY et `broker_submission_allowed=true`;
- jointure TargetPosition + candidate allocations + risk decisions;
- détection des commandes provider déjà actives;
- transaction PostgreSQL `BEGIN -> lock lineage FOR UPDATE -> insert broker_provider_commands -> COMMIT`;
- idempotence par `broker_provider_commands.idempotency_key`;
- enveloppe provider `execution_provider_command_envelope_v1`;
- aucun write vers `broker_execution_outbox`.

Preuves:

- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:14`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:34`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:46`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:68`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:193`

### Service applicatif

Fichier:

- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js`

Fonctions prouvées:

- construit son repository PostgreSQL depuis la persistance réelle;
- refuse un repository indisponible;
- valide la preuve complète Portfolio/Risk avant toute commande provider;
- passe par `buildExecutionProviderCommandV1`;
- refuse le double send via commandes actives/idempotence;
- fail-closed si `execution_halt=true`.

Preuves:

- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:8`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:14`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:39`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:47`
- `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:79`

### BrokerExecutionService

Fichier:

- `mcp_gpt_desk/src/broker-execution-service.js`

Ajouts Lot 004:

- instanciation de `PortfolioOrderIntentExecutionService` depuis `persistence`;
- action runtime `materialize_portfolio_order_intents`;
- skip fail-closed si execution disabled ou kill switch actif.

Preuves:

- `mcp_gpt_desk/src/broker-execution-service.js:29`
- `mcp_gpt_desk/src/broker-execution-service.js:49`
- `mcp_gpt_desk/src/broker-execution-service.js:182`
- `mcp_gpt_desk/src/broker-execution-service.js:283`

### Authority guard anti-bypass

Fichier:

- `mcp_gpt_desk/src/broker-order-intent-authority.js`

Fonctions prouvées:

- rollback legacy explicitement requis pour l'ancien chemin;
- un payload JSON qui "ressemble" à un ordre ne suffit plus;
- une commande provider portefeuille doit porter `execution_provider_command_envelope_v1`;
- le payload `portfolio_order_intent_v1` doit prouver TargetPosition, RiskDecision, CandidateAllocation et audit non-LLM.

Preuves:

- `mcp_gpt_desk/src/broker-order-intent-authority.js:1`
- `mcp_gpt_desk/src/broker-order-intent-authority.js:10`
- `mcp_gpt_desk/src/broker-order-intent-authority.js:20`
- `mcp_gpt_desk/src/broker-order-intent-authority.js:27`
- `mcp_gpt_desk/src/broker-order-intent-authority.js:34`

## Tests ajoutés ou renforcés

### Service Lot 004

Fichier:

- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js`

Cas prouvés:

- matérialisation d'une commande provider uniquement depuis lineage Portfolio/Risk persistée;
- déduplication d'une commande active pour le même portfolio intent;
- fail-closed sur lineage spoofée/incomplète;
- fail-closed sur execution halt;
- adapter PostgreSQL écrit dans `broker_provider_commands` et jamais dans `broker_execution_outbox`.

Preuves:

- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js:15`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js:35`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js:48`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js:87`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js:97`

### Schema SQL Lot 004

Fichier:

- `mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js`

Cas prouvés:

- FK command -> portfolio lineage;
- FK event -> portfolio lineage;
- contrainte source sur commandes order-related;
- contrainte source sur événements order lifecycle.

Preuves:

- `mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js:8`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js:14`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js:20`
- `mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js:26`

### BrokerExecutionService

Fichier:

- `mcp_gpt_desk/test/broker_execution_service.test.js`

Cas Lot 004 renforcés:

- action runtime matérialise les commandes depuis Portfolio OrderIntent uniquement si le desk est armé;
- kill switch bloque la matérialisation avant tout appel;
- bridge/AddOn armés bloquent un outbox legacy sans preuve Portfolio/Risk;
- bridge/AddOn acceptent uniquement une commande avec preuve persistée/enveloppe canonique.

Preuves:

- `mcp_gpt_desk/test/broker_execution_service.test.js:59`
- `mcp_gpt_desk/test/broker_execution_service.test.js:88`
- `mcp_gpt_desk/test/broker_execution_service.test.js:239`
- `mcp_gpt_desk/test/broker_execution_service.test.js:265`

## Preuve PostgreSQL locale réelle

Docker local disponible:

```text
postgres: Up healthy on 127.0.0.1:5432
api: Up healthy on 127.0.0.1:8787
frontend/control-plane: Up
```

Le volume PostgreSQL local existait avant les migrations 048/049. Les migrations ont été appliquées dans l'ordre:

```text
psql -f /docker-entrypoint-initdb.d/048_portfolio_risk_runtime_lineage.sql
psql -f /docker-entrypoint-initdb.d/049_execution_provider_portfolio_lineage.sql
```

Validation schema:

```text
broker_provider_commands.portfolio_order_intent_id
broker_provider_events.portfolio_order_intent_id
broker_provider_commands_order_intent_source_check NOT VALID
broker_provider_events_order_intent_source_check NOT VALID
```

Smoke contraintes transactionnel rollbacké:

```text
NOTICE: submit_order without legacy/portfolio lineage rejected
NOTICE: sync_positions without order lineage accepted
NOTICE: order_filled without legacy/portfolio lineage rejected
NOTICE: provider_heartbeat without order lineage accepted
ROLLBACK
```

Smoke vertical slice réel DB:

```json
{
  "pipelineStatus": "PERSISTED",
  "intentId": "portfolio_order_intent_cff8e159c5f9585883d11985",
  "materializedStatus": "PROVIDER_COMMANDS_READY",
  "persistedCommands": [
    {
      "execution_provider_command_id": "execution_provider_command_478d456d0589affb3f2ec6f5",
      "portfolio_order_intent_id": "portfolio_order_intent_cff8e159c5f9585883d11985",
      "order_intent_id": null,
      "status": "pending",
      "broker_contract_id": "ninjatrader:MNQ:2026-09"
    }
  ]
}
```

Le smoke a ensuite nettoyé ses données:

```text
remaining_smoke_runs = 0
remaining_smoke_commands = 0
```

Observation utile détectée par le smoke: la DB bloque correctement une commande provider si le `broker_contract_id` n'existe pas. Le smoke initial avec `nt_mnq` a échoué sur FK, puis le test a été relancé avec le contrat réel `ninjatrader:MNQ:2026-09`.

## Matrice de conformité du lot

| Requirement | Current status | Gap initial | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| TargetPosition/OrderIntent doit être relié à Execution Gateway | PARTIEL | Lineage persistée mais pas consommée par execution | `PortfolioOrderIntentExecutionService` + repository | service tests + full MCP | smoke DB réel | FAIT |
| OrderIntent exécutable ne peut pas sortir sans Portfolio/Risk lineage | PARTIEL | Bridge/AddOn pouvaient encore accepter certains chemins legacy/outbox | `broker-order-intent-authority.js` renforcé | broker service tests | full MCP suite | FAIT |
| Provider command doit être sourceable et auditable | PARTIEL | `broker_provider_commands` n'avait pas FK portfolio | migration 049 | SQL schema test | `\d broker_provider_commands` + smoke | FAIT |
| Provider event order lifecycle doit être sourceable | PARTIEL | `broker_provider_events` n'avait pas FK portfolio | migration 049 | SQL schema test | constraint smoke | FAIT |
| Double send doit être empêché | PARTIEL | Idempotence provider existante, non branchée au portfolio intent | active command check + idempotency key lock | service test duplicate | full MCP | FAIT |
| Kill switch doit bloquer la matérialisation | PARTIEL | Pas prouvé pour le nouveau service | `execution_halt` + BrokerExecutionService skip | service + broker tests | full MCP | FAIT |
| Un succès provider ne doit pas être traité comme fill | PARTIEL | Risque de confusion commande/fill | lot ne crée que `pending`; événements/fills restent séparés | existing broker/domain suites | full MCP + domain | FAIT sur ce lot |
| Container API courant utilise le nouveau code | NON PROUVÉ | L'image Docker locale `api` n'a pas été rebuildée après ajout des fichiers | Non traité dans ce lot | Non | `api` actuel ne contient pas encore le nouveau fichier source | PARTIEL / prochain release |

## Commandes exécutées

### Tests ciblés Lot 004

```text
node --test mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js mcp_gpt_desk/test/broker_execution_service.test.js
```

Résultat:

```text
tests 50
suites 1
pass 50
fail 0
duration_ms 14276.592546
```

### Suite MCP complète

```text
npm --prefix mcp_gpt_desk test
```

Résultat:

```text
tests 1039
suites 13
pass 1039
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 326080.484642
```

### Suite domaine

```text
npm --prefix packages/desk-domain test
```

Résultat:

```text
tests 449
suites 60
pass 449
fail 0
duration_ms 36942.529962
```

### Guards

```text
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:mcp-slices
npm run guard:sql-migrations
npm run guard:exceptions
npm run guard:problem-details
npm run guard:windows-deployment
```

Résultats:

```text
guard:architecture        OK
guard:runtime-safety      OK
guard:mcp-slices          OK
guard:sql-migrations      OK
guard:exceptions          OK
guard:problem-details     OK
guard:windows-deployment  OK
```

Guard statique:

```text
npm run guard:static-quality
```

Résultat:

```text
FAILED
- mcp_gpt_desk/src/front-control-plane-api.js has 2075 lines; allowed 600
- packages/desk-domain/src/strategy-dsl-compiler-v1.js has 624 lines; allowed 600
- packages/desk-replay-engine/src/canonical-simulation-engine-v1.js has 881 lines; allowed 600
- oversized functions: 246; allowed 243
- high complexity functions: 630; allowed 592
- duplicate blocks: 73; allowed 50
- possibly dead files: 17; allowed 14
```

Ce KO n'est pas masqué. Les ajouts Lot 004 ont été raccordés pour ne pas rester en fichier mort, et `broker-execution-service.js` reste sous son budget legacy de 1200 lignes. La dette statique restante appartient au chantier dette/quality gate global.

## État de fermeture

FAIT gagnés:

- provider command reliée à `portfolio_order_intent_lineage`;
- provider event relié à `portfolio_order_intent_lineage`;
- commande order-related sans source bloquée côté DB;
- event order lifecycle sans source bloqué côté DB;
- service runtime matérialisant depuis lineage portfolio;
- idempotence/déduplication provider depuis portfolio intent;
- kill switch fail-closed sur la nouvelle matérialisation;
- anti-bypass renforcé pour bridge/AddOn/approval.

PARTIEL restant:

- l'image Docker API locale doit être rebuildée pour embarquer le nouveau code;
- le runner live/management doit appeler périodiquement `materialize_portfolio_order_intents` dans le workflow d'exploitation réel;
- validation en environnement VPS après release;
- reconciliation post-provider complète à certifier dans un lot dédié.

NON FAIT:

- aucun nouveau gap fonctionnel identifié dans ce lot.

NON PROUVÉ:

- appel périodique réel du service par le scheduler live déployé;
- claim provider réel depuis une commande portfolio dans l'AddOn/NinjaTrader sur VPS.

BLOQUÉ EXTERNE:

- aucun pour le repository local; la preuve VPS dépendra du prochain rebuild/release et de l'environnement broker.

## Prochain lot recommandé

`LOT 005 — Runtime live scheduler + provider claim/reconciliation depuis broker_provider_commands`

Objectifs:

1. rebuild/release local puis VPS;
2. faire appeler `materialize_portfolio_order_intents` par le scheduler/runtime approprié;
3. prouver que l'AddOn/bridge claim une commande `portfolio_order_intent_id`;
4. prouver `ACK != FILL`;
5. prouver fill/reject/reconciliation/circuit breaker sur événements provider normalisés;
6. ajouter un smoke end-to-end API/front opérateur pour suivre la commande de `StrategySignal` jusqu'à `provider_event`.
