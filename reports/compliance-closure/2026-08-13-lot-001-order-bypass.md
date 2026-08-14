# Trading Desk Transformation V2 — Compliance closure lot 001

Date: 2026-08-13
Repository: `TV_Automation_PREPROD`
Scope: P0 order-bypass closure, fail-closed broker submission authority.

## Baseline recalled

Operator-provided previous audit baseline:

- Total requirements: 139
- FAIT: 63
- PARTIEL: 71
- NON FAIT: 2
- NON PROUVÉ: 3
- Strict compliance: 45.3%

This document is not a Jira status. Evidence is limited to code, configuration, tests, guards and runtime artifacts produced in this repository.

## Top 20 critical gaps to close

| Rank | Priority | Requirement area | Current status | Gap / risk | Dependency |
|---:|---|---|---|---|---|
| 1 | P0 | Unique order path | PARTIEL → improved in this lot | Legacy `desk_positions -> trade_decision -> order_intent` could still materialize/evaluate outside the target chain. | None |
| 2 | P0 | Execution outbox claim authority | PARTIEL → improved in this lot | Approved legacy outbox rows could be leased by bridge/AddOn without proving Portfolio/Risk/TargetPosition lineage. | None |
| 3 | P0 | Global Risk mandatory | PARTIEL | Some paths still rely on broker policy/risk checks after a trade decision instead of a single Portfolio Arbitration → Global Risk gate. | Requires P0 risk vertical audit |
| 4 | P0 | AI Context Gate | PARTIEL | AI advisory path exists but is not yet fully certified as unable to create trades or bypass Portfolio/Risk. | Requires targeted AI Context Gate tests |
| 5 | P0 | Provider-neutral Execution Gateway | PARTIEL | Existing broker outbox remains historically Ninja-oriented even if provider-port modules exist. | Requires gateway certification |
| 6 | P0 | Direct provider scripts | PARTIEL | Certification/diagnostic scripts can write provider-facing commands if manually run; must be explicitly test-only/fail-closed in production contexts. | Human/provider runtime for final proof |
| 7 | P0 | Front execution commands | PARTIEL | Legacy UI still exposes execution actions; backend is safer, but VNext capabilities/allowedActions must hide or gate unsafe operations. | Front/BFF lot |
| 8 | P0 | Existing queued legacy intents | PARTIEL → improved in this lot | Previously queued intents may be stale or legacy; claim now blocks without lineage proof, but cleanup/reconciliation of old rows remains needed. | DB runtime inspection |
| 9 | P1 | Research vertical slice | PARTIEL | Need one Strategy_ID P0 from Hypothesis → SHADOW → PAPER with complete artifacts and Run Registry proof. | Dataset availability |
| 10 | P1 | Robustness/OOS promotion | PARTIEL | OOS/walk-forward/Monte Carlo/stress tests exist in pieces; promotion must require proof. | Research vertical slice |
| 11 | P1 | Simulation ↔ SHADOW parity | PARTIEL | Domain tests exist; needs runtime proof for first promoted Strategy Instance. | Vertical slice |
| 12 | P1 | Signal Bus outbox/resume | PARTIEL | Signal Bus exists, but production-grade duplicate/out-of-order/gap proof must be attached to E2E. | Runtime event tests |
| 13 | P1 | Execution reconciliation | PARTIEL | Ack/fill separation has tests, but restart/double-send/circuit-breaker certification must be completed end-to-end. | Provider/sim runtime |
| 14 | P1 | Secrets/log hygiene | NON PROUVÉ | Need automated scan and runtime log proof that no broker/API secret leaks into front/logs/reports. | Environment snapshot |
| 15 | P1 | Observability | PARTIEL | Provider health, latency, stale data, failed commands and correlation IDs exist in places but lack consolidated proof. | Runtime stack |
| 16 | P1 | Front VNext autonomy | PARTIEL | VNext is separate in progress; must prove no legacy runtime dependency, BFF-only data, read-only degraded mode and rollback. | Front E2E |
| 17 | P1 | Jarvis supervisor safety | PARTIEL | Must prove Jarvis remains read-only/permissioned and cannot bypass gates. | Jarvis integration scope |
| 18 | P1 | Spring Boot deviation | NON PROUVÉ | Node.js may satisfy the architecture properties, but the Spring Boot deviation requires an explicit ADR decision. | Operator architecture decision |
| 19 | P2 | Static quality debt | PARTIEL | Static guard still fails on known large files, complexity, duplicates and dead files. | Refactor lots |
| 20 | P2 | Final cutover | PARTIEL | Need old/new quantitative comparison, SHADOW/PAPER observation, rollback proof and legacy retirement gates. | All prior lots |

## Lot 001 implementation matrix

| Requirement | Current status before lot | Gap | Implementation | Tests | Runtime / guard proof | Final status |
|---|---|---|---|---|---|---|
| No legacy source may materialize executable orders outside target chain | PARTIEL | `materializeEligiblePositions()` and `evaluateDecision()` accepted legacy `desk_positions` by default. | Added default fail-closed flag `DESK_LEGACY_POSITION_EXECUTION_ENABLED=false/absent`; legacy materialization skips, evaluation throws unless explicit rollback flag is true. | `legacy position materialization is fail-closed by default`; `legacy position evaluation is fail-closed by default`; explicit rollback test retained. | 50/50 focused tests passed; 90/90 broader execution tests passed before final extraction; guards architecture/runtime/MCP/windows passed. | FAIT for default fail-closed behavior; rollback remains explicit and must stay audited. |
| Bridge/AddOn cannot lease an OrderIntent without Portfolio/Risk lineage | PARTIEL | Old approved outbox candidates could be claimed if broker policy recheck passed, even without proof of `TargetPosition` lineage. | Added `assertBrokerOrderIntentAuthority()` before approve/bridge/AddOn claim. `peekOutbox()` now returns `intent_payload` and `intent_raw` so lineage proof can be verified. | `armed ATI bridge blocks an approved legacy outbox item without Portfolio/Risk lineage`; `armed AddOn blocks an approved legacy outbox item without Portfolio/Risk lineage`; existing AddOn happy path updated with `portfolio_order_intent_v1` payload proof. | Focused execution tests passed; MCP slices guard passed. | FAIT for service-level approve/claim gate. Existing DB cleanup remains PARTIEL separately. |
| Rollback path must be explicit and secure | PARTIEL | Emergency legacy path was implicit. | Config templates set `DESK_LEGACY_POSITION_EXECUTION_ENABLED=false`; Sim101 enable script keeps it false. | Domain env test verifies default false and explicit true only when flag set. | Windows deployment guard passed. | FAIT for configuration default; operator runbook approval still recommended before ever setting true. |
| Broker service static quality | PARTIEL | Added P0 checks risked pushing broker service beyond line budget. | Extracted authority guard to `broker-order-intent-authority.js`; broker service is now exactly 1200 lines. | Broker/front execution tests passed after extraction. | `guard:static-quality` no longer reports broker service over limit. | FAIT for this file; global static quality remains PARTIEL. |
| Direct provider/certification script cannot run accidentally | PARTIEL | `test_ninja_execution_gateway.mjs` inserted direct DB fixtures and exercised bridge events without an explicit operator/test-only preflight. | Added mandatory confirmation phrase, non-production guard, localhost-only API guard and explicit legacy rollback flag requirement before any DB/API write. | Executed script without confirmation and verified guarded failure before DB requirements. | `guarded_exit=1` with required-confirmation message. | FAIT for accidental execution prevention; full provider runtime certification remains BLOQUÉ EXTERNE. |

## Evidence

### Files / classes

- `packages/desk-domain/src/broker-execution.js`
  - `brokerExecutionEnvironment()` exposes `legacyPositionExecutionEnabled` from `DESK_LEGACY_POSITION_EXECUTION_ENABLED`.
- `mcp_gpt_desk/src/broker-execution-service.js`
  - `materializeEligiblePositions()` fails closed by default.
  - `evaluateDecision()` requires explicit rollback.
  - `executeAction("approve")`, `claimBridgeWork()` and `claimAddonWork()` require Portfolio/Risk/TargetPosition lineage proof.
- `mcp_gpt_desk/src/broker-order-intent-authority.js`
  - Central authority guard for legacy rollback and broker-intent lineage.
- `mcp_gpt_desk/src/broker-execution-repository.js`
  - `peekOutbox()` returns intent payload/raw fields needed for service-level authority verification.
- `mcp_gpt_desk/scripts/test_ninja_execution_gateway.mjs`
  - Direct DB/API gateway-event fixture is opt-in, local-only, non-production and legacy-rollback explicit.
- `mcp_gpt_desk/test/broker_execution_service.test.js`
  - Regression tests for fail-closed legacy path and AddOn legacy outbox blocking.
- `packages/desk-domain/test/broker-execution.test.js`
  - Environment default/explicit flag tests.
- `.env.preprod.example`, `mcp_gpt_desk/.env.example`, `deploy/templates/desk.vps.env.example`, `deploy/windows/Enable-DeskSim101Environment.ps1`
  - Explicit fail-closed rollback flag.

### Commands executed

```bash
npm --prefix packages/desk-domain test
```

Result: `440 pass / 0 fail`.

```bash
node --test packages/desk-domain/test/broker-execution.test.js \
  mcp_gpt_desk/test/broker_execution_service.test.js \
  mcp_gpt_desk/test/broker_execution_repository.test.js \
  mcp_gpt_desk/test/front_execution_api.test.js \
  mcp_gpt_desk/test/live_paper_execution.test.js \
  mcp_gpt_desk/test/theoretical_execution_service.test.js
```

Result before extraction: `90 pass / 0 fail`.

```bash
node --test mcp_gpt_desk/test/broker_execution_service.test.js \
  mcp_gpt_desk/test/front_execution_api.test.js
```

Result after extraction: `50 pass / 0 fail`.

```bash
node --test mcp_gpt_desk/test/broker_execution_service.test.js
```

Result after adding ATI-specific regression: `39 pass / 0 fail`.

```bash
set +e
node mcp_gpt_desk/scripts/test_ninja_execution_gateway.mjs \
  >/tmp/test_ninja_gateway_guard.out \
  2>/tmp/test_ninja_gateway_guard.err
```

Result: guarded failure before DB/API write; required message matched
`DESK_NINJA_GATEWAY_TEST_CONFIRMATION=I_CONFIRM_LOCAL_GATEWAY_EVENT_TEST_ONLY is required`.

```bash
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:mcp-slices
npm run guard:windows-deployment
```

Result: all passed.

```bash
npm run guard:static-quality
```

Result: still failed on pre-existing global debt:

- `packages/desk-domain/src/strategy-dsl-compiler-v1.js` has 624 lines; allowed 600.
- `packages/desk-replay-engine/src/canonical-simulation-engine-v1.js` has 881 lines; allowed 600.
- high complexity functions: 599; allowed 592.
- duplicate blocks: 73; allowed 50.
- possibly dead files: 16; allowed 14.

Broker service line-limit regression was removed: `mcp_gpt_desk/src/broker-execution-service.js` is now 1200 lines.

## Remaining blockers after lot 001

1. Global Risk must become the single mandatory physical-exposure authority, not only a broker-policy recheck.
2. Existing DB state must be inspected for already queued legacy intents/outbox rows and remediated.
3. Remaining provider/certification scripts must be kept classified as test-only or routed through the provider-neutral gateway; `test_ninja_execution_gateway.mjs` is now guarded, but runtime provider certification is external.
4. AI Context Gate needs a certification test suite proving advisory-only behavior under timeout, invalid response, retry and SHADOW fallback.
5. Static quality guard remains red on pre-existing debt and should become a P1 quality lot.

## Recommended next lot

Lot 002: Global Risk mandatory path.

Target proof: a physical exposure can only be created from:

`StrategySignal -> PortfolioCandidateAllocation -> GlobalRiskDecision -> TargetPosition -> portfolio_order_intent_v1 -> ExecutionGateway`.

Add E2E regression tests proving:

- LLM payload cannot create OrderIntent.
- Front command cannot create OrderIntent.
- Legacy MCP/manual path cannot create OrderIntent.
- Risk blocked/reduced decisions cannot reach provider submission.
- Kill switch and missing risk budget fail closed.
