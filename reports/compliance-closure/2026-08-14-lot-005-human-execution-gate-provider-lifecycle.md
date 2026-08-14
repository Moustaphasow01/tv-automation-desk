# Lot 005 — Human Execution Gate + Provider Lifecycle

Date: 2026-08-14
Repository: `TV_Automation_PREPROD`
Scope: `PortfolioOrderIntent → Human Gate → materialization → broker_provider_commands → claim → dispatch → ACK → PARTIAL_FILL → FILL/REJECT → reconciliation`

## Résumé

Lot 005 est fermé côté repository PREPROD.

Le chemin physique provider est maintenant verrouillé par une étape humaine canonique avant matérialisation. Une `PortfolioOrderIntent` issue de `Portfolio/Risk/Target` ne peut produire une commande provider que si :

1. la lineage Portfolio/Risk est complète ;
2. l’intent est encore `READY` et `broker_submission_allowed=true` ;
3. le Human Execution Gate est confirmé sur les mêmes termes ;
4. le mode d’exécution autorise réellement une commande physique ;
5. aucune commande provider active/idempotente n’existe déjà.

Important : aucun mode AUTO/LIVE n’a été activé par ce lot. `SHADOW` reste sans dispatch physique et `LIVE` reste fail-closed sans autorisation humaine explicite.

## Changements principaux

- Migration PostgreSQL canonique :
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql`
  - ajoute `unknown` et `reconciliation_required` à `execution_provider_command_status`.
  - crée `human_execution_gates`.
  - crée `human_execution_gate_events`.
  - crée `portfolio_order_intent_execution_states`.
  - ajoute l’index `broker_provider_commands_portfolio_status_idx`.

- Runtime applicatif :
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js`
  - `mcp_gpt_desk/src/broker-portfolio-execution-actions.js`
  - `mcp_gpt_desk/src/broker-execution-service.js`

- SQL ownership :
  - `docs/engineering/sql-migration-policy.json`
  - `human_execution_*` appartient au boundary `execution`.

## Matrice de fermeture

| Requirement | Current status | Gap fermé | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Human Gate persistant avant provider command | PARTIEL | Pas de gate canonique ni audit events | `human_execution_gates`, `human_execution_gate_events` | `human_execution_gate_provider_lifecycle_sql_schema.test.js` | Smoke DB confirme `HUMAN_CONFIRMATION_REQUIRED` sans gate | FAIT |
| No confirmation = 0 provider command | PARTIEL | Une OrderIntent risk-approved pouvait être matérialisée trop tôt | `humanGateIssues`, `persistProviderCommand` revérifie le gate sous lock | `Risk APPROVED without operator confirmation creates zero provider commands` | Smoke DB `noConfirm.status=BLOCKED`, `count=0` | FAIT |
| Confirmation = exactement 1 provider command | PARTIEL | Pas d’étape opérateur idempotente sur la lineage | `confirmHumanGate`, `terms_hash`, command idempotency | `Risk APPROVED plus operator CONFIRM creates exactly one provider command` | Smoke DB `materialized.count=1`, `commandCount=1` | FAIT |
| Double confirmation / double materialization idempotentes | PARTIEL | Risque de double send/double command | idempotency key gate + active provider command dedupe | `double CONFIRM and replay materialization remain idempotent` | Smoke DB nettoyage + commande unique | FAIT |
| Risk REJECTED non forçable | PARTIEL | Confirmation pouvait être demandée sans preuve submit-table | `confirmHumanGate` refuse `PORTFOLIO_ORDER_INTENT_NOT_SUBMITTABLE` | `Risk REJECTED cannot be force-confirmed into a provider command` | Domain/MCP suites vertes | FAIT |
| Intent expiré = 0 dispatch | PARTIEL | Expiration non certifiée au gate | `HUMAN_GATE_EXPIRED` | `expired intent refuses confirmation and never dispatches` | Domain/MCP suites vertes | FAIT |
| Opérateur ne peut pas augmenter quantité ni changer compte | PARTIEL | Termes d’exécution pas immuables | `confirmationTerms`, `humanGateConfirmationIssue` | `operator cannot increase quantity or change account after Risk` | Domain/MCP suites vertes | FAIT |
| SHADOW confirmation = 0 physique | PARTIEL | Mode SHADOW devait être explicitement fail-closed | `materializeReadyCommands` retourne `SHADOW_NO_PHYSICAL_DISPATCH` | `SHADOW confirmation produces zero physical provider command` | Domain/MCP suites vertes | FAIT |
| PAPER mauvais compte refusé / LIVE implicite refusé | PARTIEL | Environnements pas prouvés au nouveau gate | `PAPER_ACCOUNT_NOT_ALLOWED`, `LIVE_IMPLICIT_DISPATCH_FORBIDDEN` | `PAPER wrong account and implicit LIVE are rejected before provider command` | Domain/MCP suites vertes | FAIT |
| Claim provider exclusif/idempotent | PARTIEL | Pas de claim provider sur commandes portfolio | `FOR UPDATE SKIP LOCKED`, lease token, bounded lease | `provider claim is concurrent/idempotent and ACK is not a fill` | Smoke DB `claim.status=CLAIMED` | FAIT |
| ACK n’est jamais un FILL | PARTIEL | Risque de confondre ACK HTTP/provider avec exécution | `ACKNOWLEDGED` garde `filled_quantity=0` | `provider claim is concurrent/idempotent and ACK is not a fill` | Smoke DB `ackState.lifecycle_status=ACKNOWLEDGED`, `filled_quantity=0` | FAIT |
| PARTIAL_FILL / FILL font évoluer l’état | PARTIEL | Pas de lifecycle state canonique par OrderIntent | `recordBrokerProviderEvent`, `portfolio_order_intent_execution_states` | `partial/full fills evolve state while duplicate fill events do not double count` | Smoke DB `fillState.lifecycle_status=FILLED`, `filled_quantity=2` | FAIT |
| Duplicate broker events sans double count | PARTIEL | Risque de double fill | `external_event_key` dedupe + `GREATEST(filled_quantity)` | même test partial/full | Domain/MCP suites vertes | FAIT |
| Timeout inconnu sans blind resend | PARTIEL | Timeout après send pouvait être retraité trop agressivement | `timeout → unknown`, commande active protégée | `provider reject and communication timeout do not blind-resend` | Domain/MCP suites vertes | FAIT |
| PostgreSQL réel aligné avec code | NON PROUVÉ | Les mocks ne prouvaient pas le schéma réel | Correction `ORDER BY l.created_at_utc ASC`; test anti-régression | test SQL schema ajouté | Smoke DB réel complet OK | FAIT |

## Preuves techniques

### Fichiers / lignes

- Migration Human Gate + lifecycle :
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql:1`
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql:4`
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql:37`
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql:65`
  - `infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql:98`

- Service applicatif :
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:20`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:50`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:86`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:96`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:106`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:120`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-service.js:133`

- Repository PostgreSQL :
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:44`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:65`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:69`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:81`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:98`
  - `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:123`

- Human Gate :
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:23`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:45`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:62`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:67`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:69`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:86`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:290`
  - `mcp_gpt_desk/src/portfolio-order-intent-human-gate-repository.js:315`

- Provider lifecycle :
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:19`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:56`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:88`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:231`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:255`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:270`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:291`
  - `mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js:317`

- Broker execution API actions :
  - `mcp_gpt_desk/src/broker-portfolio-execution-actions.js:1`
  - `mcp_gpt_desk/src/broker-execution-service.js:29`
  - `mcp_gpt_desk/src/broker-execution-service.js:281`

- SQL ownership :
  - `docs/engineering/sql-migration-policy.json:32`
  - `docs/engineering/sql-migration-policy.json:35`

### Tests

Commandes exécutées :

```text
node --test mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js
```

Résultat :

```text
24 pass / 0 fail
```

Commande :

```text
npm --prefix mcp_gpt_desk test
```

Résultat :

```text
1054 pass / 0 fail
```

Commande :

```text
npm --prefix packages/desk-domain test
```

Résultat :

```text
449 pass / 0 fail
```

Tests principaux :

- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:11`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:22`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:35`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:47`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:59`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:75`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:87`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:98`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:122`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:144`
- `mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js:165`
- `mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js:12`
- `mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js:17`
- `mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js:27`
- `mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js:36`

### Smoke PostgreSQL réel

Préparation :

```text
docker compose exec -T postgres psql -U desk -d desk -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/050_human_execution_gate_provider_lifecycle.sql
```

Résultat migration :

```text
ALTER TYPE
ALTER TYPE
CREATE TABLE
CREATE INDEX
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE TABLE
CREATE INDEX
CREATE INDEX
```

Vérification schéma :

```text
human_execution_gate_events
human_execution_gates
portfolio_order_intent_execution_states
reconciliation_required
unknown
```

Smoke runtime réel exécuté contre PostgreSQL local avec les services applicatifs.

Résultat :

```json
{
  "status": "OK",
  "pipelineStatus": "ORDER_INTENTS_READY",
  "noConfirm": {
    "status": "BLOCKED",
    "count": 0,
    "reason": "HUMAN_CONFIRMATION_REQUIRED"
  },
  "confirm": {
    "status": "CONFIRMED"
  },
  "materialized": {
    "status": "PROVIDER_COMMANDS_READY",
    "count": 1
  },
  "claim": {
    "status": "CLAIMED"
  },
  "commandCount": 1,
  "eventCount": 3,
  "ackState": {
    "lifecycle_status": "ACKNOWLEDGED",
    "filled_quantity": "0"
  },
  "fillState": {
    "lifecycle_status": "FILLED",
    "filled_quantity": "2",
    "average_fill_price": "28012.5"
  }
}
```

Nettoyage post-smoke vérifié :

```text
portfolio_arbitration_runs lot-005-smoke-% = 0
broker_provider_commands lot-005-smoke-% = 0
human_execution_gates lot-005-smoke-% = 0
```

Anomalies trouvées par le smoke et corrigées :

1. `ORDER BY l.created_at` ne correspondait pas au schéma réel `portfolio_order_intent_lineage.created_at_utc`.
   - Correction : `mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js:65`
   - Test anti-régression : `mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js:36`

2. Le premier smoke utilisait un contrat provider non seedé (`nt_mnq`).
   - Conclusion : FK PostgreSQL correcte, commande provider bloquée si le contrat n’existe pas.
   - Smoke final exécuté avec le contrat seedé `ninjatrader:MNQ:2026-09`.

3. Un smoke utilisait `available_at` postérieur à l’horloge PostgreSQL.
   - Conclusion : le claim fail-close temporel fonctionne.
   - Smoke final exécuté avec un `as_of_utc` éligible.

## Guards

```text
guard:architecture        OK
guard:runtime-safety      OK
guard:mcp-slices          OK
guard:windows-deployment  OK
guard:sql-migrations      OK
guard:exceptions          OK
guard:problem-details     OK
guard:static-quality      KO connu
```

`guard:static-quality` reste KO sur dette existante :

```text
mcp_gpt_desk/src/front-control-plane-api.js has 2075 lines; allowed 600
packages/desk-domain/src/strategy-dsl-compiler-v1.js has 624 lines; allowed 600
packages/desk-replay-engine/src/canonical-simulation-engine-v1.js has 881 lines; allowed 600
oversized functions: 248; allowed 243
high complexity functions: 640; allowed 592
duplicate blocks: 73; allowed 50
possibly dead files: 17; allowed 14
```

Le Lot 005 n’ajoute pas de nouveau fichier oversized.

## Statut de conformité gagné

FAIT gagnés :

- Human Execution Gate persistant, revisionné et audité.
- Confirmation opérateur obligatoire avant provider command.
- Rejet/refus opérateur persisté.
- Idempotence double confirmation.
- Idempotence double matérialisation.
- Risk rejected non forçable.
- Expired gate non dispatchable.
- Quantité et compte immuables après Risk.
- SHADOW sans commande physique.
- LIVE implicite fail-closed.
- PAPER mauvais compte fail-closed.
- Provider claim exclusif via lease.
- ACK distinct de FILL.
- Partial/full fill persistés dans lifecycle state.
- Duplicate broker event sans double count.
- Timeout/communication lost marqué `UNKNOWN` et protégé contre blind resend.
- Smoke PostgreSQL réel prouvé.

## Reste volontairement PARTIEL / NON PROUVÉ

- Certification provider externe réelle : non exécutée dans ce lot. Les événements provider sont normalisés et testés, mais aucun NinjaTrader/PickMyTrade externe réel n’a été appelé.
- Reconciliation worker complet après divergence broker réelle : les statuts `UNKNOWN` / `RECONCILIATION_REQUIRED` existent, mais le lot suivant doit prouver la boucle de réconciliation runtime prolongée.
- UI opérateur complète pour Human Gate : le service/action backend existe ; l’industrialisation front VNext reste à fermer dans les lots front.
- `static-quality` : dette connue, à fermer au lot qualité dédié.

## Blockers production restants

1. Certifier l’exécution provider en environnement paper réel, avec événements réels `ACK`, `PARTIAL_FILL`, `FILL`, `REJECT`.
2. Certifier la boucle de réconciliation après restart/divergence.
3. Brancher l’UI opérateur Human Gate sur les actions backend avec capabilities/permissions.
4. Garder AUTO/LIVE désactivés tant que le cutover explicite n’est pas approuvé.
5. Fermer ou accepter formellement la dette `static-quality`.

## Prochain lot recommandé

Lot 006 — Reconciliation / provider recovery / no blind resend end-to-end.

Objectif : prouver que les états `UNKNOWN` et `RECONCILIATION_REQUIRED` ne restent pas juste des états de stockage, mais déclenchent une boucle de diagnostic/réconciliation sûre, sans double-send et sans promotion implicite.
