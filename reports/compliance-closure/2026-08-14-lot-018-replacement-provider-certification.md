# LOT 018 — Replacement Provider Certification

Date: 2026-08-14
Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
Baseline HEAD: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## Verdict

LOT 018: COMPLETE côté repository/domain.
Real provider PAPER proof: BLOQUÉ EXTERNE.

Le code certifie un port provider-neutral et deux adapters transitoires, mais aucune certification réelle Tradovate/Rithmic/PickMyTrade/Sim101 n’a été exécutée depuis cet environnement.

## Décisions provider conservées

- NinjaTrader AddOn: `KEEP_TRANSITION`.
- Tradovate direct API: `GO_FOR_PAPER_PROTOTYPE`, non certifié ici faute credentials/runtime.
- Rithmic: `WATCH_FOR_LATER`.
- PickMyTrade: `PAPER BRIDGE LIMITÉ`, `NO_GO_AS_PRIMARY_EXECUTION`.
- Apex Group Copier: `NO_GO_AS_EXECUTION_PROVIDER`.

Preuve ADR PickMyTrade:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/trading-desk-target-blueprint/adr/0017-pickmytrade-due-diligence-not-committed.md:14`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/trading-desk-target-blueprint/adr/0017-pickmytrade-due-diligence-not-committed.md:16`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/trading-desk-target-blueprint/adr/0017-pickmytrade-due-diligence-not-committed.md:21`

## Provider-neutral contract

Preuve code:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:3`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:6`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:8`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:11`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:37`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-port-v1.js:71`

Garanties:

- provider command déterministe;
- idempotency key;
- command hash;
- normalized broker/provider events;
- `ORDER_ACCEPTED` séparé de `ORDER_FILLED`;
- `ORDER_PARTIALLY_FILLED` séparé de full fill;
- fail-closed si provider disabled, contract/account absent, quantity absente ou unsupported command.

## Circuit breaker / fallback

Preuve code:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-circuit-breaker-v1.js:3`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-circuit-breaker-v1.js:16`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-circuit-breaker-v1.js:19`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-circuit-breaker-v1.js:45`

Tests passés couvrant:

- route primaire circuit fermé;
- fallback seulement si policy l’autorise;
- blocage double-send si une commande est en vol;
- reconciliation required si état provider incertain;
- fallback après rejet terminal uniquement si operator approval.

## NinjaTrader adapter

Preuve code:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/ninjatrader-provider-adapter-v1.js:4`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/ninjatrader-provider-adapter-v1.js:7`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/ninjatrader-provider-adapter-v1.js:23`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/ninjatrader-provider-adapter-v1.js:64`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/ninjatrader-provider-adapter-v1.js:130`

Garanties:

- adapter derrière le port provider-neutral;
- restreint à comptes `Sim*` dans ce slice;
- ATM template/id requis;
- stop/target requis;
- événements AddOn normalisés vers `broker_provider_event_v1`.

## PickMyTrade adapter

Preuve code:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/pickmytrade-provider-adapter-v1.js`

Garanties testées:

- bridge `PAPER_ONLY`;
- aucun secret dans input domaine;
- webhook URL sans userinfo/query/fragment;
- status events normalisés;
- pas de provider primaire.

## PostgreSQL / lifecycle

Preuves migrations:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/045_execution_provider_port.sql`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/049_execution_provider_portfolio_lineage.sql`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql`

Preuve service:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/portfolio-order-intent-execution-service.js`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/portfolio-order-intent-provider-lifecycle-repository.js`

Garanties testées:

- provider command seulement depuis lineage Portfolio/Risk persistée;
- aucun write vers `broker_execution_outbox`;
- Human Gate requis avant commande provider;
- ACK ≠ FILL;
- partial fill ≠ full fill;
- duplicate fill ne double-count pas;
- reject/timeout ne provoque pas de blind resend.

## Tests exécutés

```text
node --test packages/desk-domain/test/execution-provider-port-v1.test.js \
  packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js \
  packages/desk-domain/test/execution-provider-circuit-breaker-v1.test.js \
  packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js \
  packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js \
  packages/desk-domain/test/pickmytrade-provider-adapter-v1.test.js

27 pass / 0 fail
```

```text
node --test mcp_gpt_desk/test/execution_provider_port_sql_schema.test.js \
  mcp_gpt_desk/test/portfolio_order_intent_execution_service.test.js \
  mcp_gpt_desk/test/portfolio_order_intent_human_gate_lifecycle.test.js \
  mcp_gpt_desk/test/human_execution_gate_provider_lifecycle_sql_schema.test.js

24 pass / 0 fail
```

## Statuts compliance du lot

FAIT gagnés:

- Provider-neutral port.
- Provider command lifecycle.
- Normalized provider events.
- ACK/FILL distinction.
- Partial fill distinction.
- Circuit breaker/fallback no double-send.
- NinjaTrader encapsulé.
- PickMyTrade paper-only adapter borné.
- SQL schema provider/Human Gate/lifecycle.

PARTIEL:

- Tradovate direct API prototype non implémenté/certifié réellement dans ce lot.
- Rithmic reste watch later.
- PickMyTrade ne peut pas être provider primaire.

NON FAIT:

- Certification provider réel hors simulation locale.

NON PROUVÉ:

- Preuve PAPER réelle avec credentials/provider externe.
- Preuve restart/reconnect provider réel sur VPS.

BLOQUÉ EXTERNE:

- Credentials/provider PAPER.
- VPS/provider runtime.
- Sim101/AddOn réel si NinjaTrader reste le provider transitoire.

ACCEPTED DEVIATION:

- PickMyTrade conservé uniquement comme bridge paper limité, pas comme provider primaire.

FRONT_AGENT_ACTION_REQUIRED:

- Aucun.

## NEXT

LOT 019 — NinjaTrader Retirement.

Ce retrait ne peut pas être complet tant qu’un provider alternatif n’est pas réellement certifié avec rollback. Le lot doit donc auditer et bloquer explicitement tout retrait prématuré.
