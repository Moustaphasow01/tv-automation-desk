# Lot 010 — Multi-Strategy Portfolio

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD at audit time: `e18b48a`

## Objective

Close the Portfolio Arbitration gaps required by the Trading Desk Transformation V2 programme:

```text
StrategySignal
→ Portfolio Arbitration
→ Global Risk
→ TargetPosition
→ OrderIntent
```

The objective is not only to create Candidate Allocations, but to prove that several strategies can produce simultaneous intentions, that those intentions are arbitrated globally, that account/sub-book scope is preserved, and that OrderIntent generation cannot collapse several accounts into a single broker account.

No AUTO/LIVE activation was performed. The execution policy remains SEMI_MANUAL.

## Initial audit

Existing implementation already included:

- Candidate Allocation domain model.
- Virtual strategy portfolio attribution.
- Global Risk budget evaluation.
- TargetPosition netting.
- OrderIntent materialization.
- PostgreSQL persistence introduced in Lot 003.
- Human Execution Gate introduced in Lot 005.

Critical gap found during Lot 010:

- `buildCandidateAllocationPortfolioV1` grouped allocations by `instrument` only.
- Two simultaneous MNQ signals targeting different accounts could therefore be merged before risk/arbitration.
- `buildOrderIntentPlanV1` accepted a global `broker_account_id`, which could override the target account for a different account-scoped TargetPosition.

This was a real production-risk class bug: multi-account support could appear present while silently routing the second account to the first broker account.

## Implementation

### Domain

- `packages/desk-domain/src/portfolio-candidate-allocation-v1.js`
  - Added explicit runtime states: `ACTIVE`, `SUSPENDED`, `DISABLED`.
  - Added account scope on normalized signals and candidate allocations.
  - Candidate Allocation grouping is now `account_id + instrument`, not only `instrument`.
  - Added `allowed_account_ids`.
  - Added fail-closed rejections for:
    - missing account id;
    - out-of-scope account;
    - disabled strategy instance;
    - suspended strategy instance.
  - Added arbitration metadata:
    - `conflict_status`;
    - simultaneous signal count;
    - long/short strategy instance ids;
    - account ids in portfolio summary.

- `packages/desk-domain/src/portfolio-risk-budget-v1.js`
  - Risk evaluation now uses each allocation account, not only the run default account.
  - RiskDecision now carries `account_id`.
  - Current exposure snapshot is computed by account.

- `packages/desk-domain/src/portfolio-order-intent-v1.js`
  - Added safe broker account resolution.
  - `broker_account_id` can no longer globally override another target account.
  - Explicit per-account mapping is supported through `broker_account_ids`.
  - When no safe mapping exists, the target account is used fail-safe.

- `packages/desk-domain/index.js`
  - Exports `PORTFOLIO_STRATEGY_RUNTIME_STATES_V1`.

- `packages/desk-domain/index.d.ts`
  - Type surface updated for the new runtime state enum.

### PostgreSQL / runtime persistence

- `infra/postgres/init/053_portfolio_candidate_allocation_account_scope.sql`
  - Adds `portfolio_candidate_allocations.account_id`.
  - Backfills from payload/run/default.
  - Makes the column `NOT NULL`.
  - Adds account/instrument/time index.

- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js`
  - Persists allocation `account_id`.
  - Persists risk decision `account_id`.

## Tests added or extended

- `packages/desk-domain/test/portfolio-candidate-allocation-v1.test.js`
  - proves simultaneous MNQ signals across different accounts are not merged;
  - proves strategy instance runtime states;
  - proves suspended/disabled strategies are rejected.

- `packages/desk-domain/test/portfolio-risk-budget-v1.test.js`
  - proves account-specific risk limits and exposures.

- `packages/desk-domain/test/portfolio-order-intent-v1.test.js`
  - proves global broker account override is blocked;
  - proves fallback to target account when no safe broker mapping exists.

- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js`
  - proves account-scoped multi-strategy allocations persist through the runtime service.

- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js`
  - proves migration 053 creates the account-scope column, non-null constraint and index.

## Runtime proof on local PostgreSQL

Migration applied:

```text
docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/053_portfolio_candidate_allocation_account_scope.sql'

ALTER TABLE
UPDATE 0
UPDATE 0
ALTER TABLE
CREATE INDEX
```

First DB proof detected a defect:

```text
account_id=paper-sim102
broker_account_id=paper-sim101
```

The defect was fixed in `portfolio-order-intent-v1.js`.

Second DB proof after fix:

```text
portfolio_arbitration_run_id: portfolio_run_256b1e26d6653bdf359230c0
status: ORDER_INTENTS_READY
counts:
  allocations: 2
  risk_decisions: 2
  target_positions: 2
  order_intents: 2
```

Persisted allocations:

```text
account_id   | instrument | net_direction | proposed_size | status
paper-sim101 | MNQ        | LONG          | 1             | PROPOSED
paper-sim102 | MNQ        | LONG          | 1             | PROPOSED
```

Persisted OrderIntent scope:

```text
account_id   | broker_account_id | instrument | quantity
paper-sim101 | paper-sim101      | MNQ        | 1
paper-sim102 | paper-sim102      | MNQ        | 1
```

Idempotence proof on the same command key:

```text
status: IDEMPOTENT
run_id: portfolio_run_256b1e26d6653bdf359230c0
new allocations/risk_decisions/target_positions/order_intents: 0
```

## Commands executed

Targeted Lot 010 suite:

```text
node --test \
  packages/desk-domain/test/portfolio-candidate-allocation-v1.test.js \
  packages/desk-domain/test/portfolio-risk-budget-v1.test.js \
  packages/desk-domain/test/portfolio-target-position-v1.test.js \
  packages/desk-domain/test/portfolio-order-intent-v1.test.js \
  packages/desk-domain/test/portfolio-virtual-pnl-attribution-v1.test.js \
  mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js \
  mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js
```

Result:

```text
44 pass / 0 fail
```

Domain suite:

```text
npm --prefix packages/desk-domain test
```

Result:

```text
460 pass / 0 fail
```

MCP/backend suite:

```text
npm --prefix mcp_gpt_desk test
```

Result:

```text
1065 pass / 0 fail
```

Syntax check after export compaction:

```text
node --check packages/desk-domain/index.js
```

Result:

```text
OK
```

## Guards

```text
npm run guard:architecture
OK

npm run guard:runtime-safety
OK

npm run guard:mcp-slices
OK

npm run guard:sql-migrations
OK — migration_files: 53

npm run guard:exceptions
OK

npm run guard:problem-details
OK

npm run guard:windows-deployment
OK

npm run guard:static-quality
KO known / not masked
```

Known static-quality debt after correcting the accidental `index.js` 601-line regression:

```text
mcp_gpt_desk/src/front-control-plane-api.js has 2075 lines; allowed 600
packages/desk-domain/src/strategy-dsl-compiler-v1.js has 624 lines; allowed 600
packages/desk-replay-engine/src/canonical-simulation-engine-v1.js has 881 lines; allowed 600
oversized functions: 249; allowed 243
high complexity functions: 644; allowed 592
duplicate blocks: 72; allowed 50
possibly dead files: 17; allowed 14
```

This is still scheduled for Lot 017 and was not hidden by changing the baseline.

## Requirement closure matrix

| Requirement | Previous status | Final status | Evidence |
|---|---:|---:|---|
| Strategies produce Candidate Allocations, not broker orders | PARTIEL | FAIT | `portfolio-candidate-allocation-v1.js`, domain tests |
| Strategy sub-book / virtual portfolio can be preserved | PARTIEL | FAIT | virtual portfolio builder + account ids preserved |
| Simultaneous strategy intentions are arbitrated globally | PARTIEL | FAIT | allocation grouping by account+instrument, conflict metadata, tests |
| TargetPosition is netted after Portfolio Arbitration | PARTIEL | FAIT | `portfolio-target-position-v1.js` existing tests + runtime DB proof |
| Global Risk uses account/instrument/portfolio context | PARTIEL | FAIT | `portfolio-risk-budget-v1.js` account exposure test |
| OrderIntent uses TargetPosition lineage | PARTIEL | FAIT | Lot003/004 lineage + Lot010 account-safe broker mapping |
| Multi-account broker routing cannot silently collapse | PARTIEL | FAIT | DB proof: paper-sim101 and paper-sim102 produce separate broker accounts |
| Disabled/suspended strategies cannot allocate | PARTIEL | FAIT | runtime state enum + tests |
| MNQ account-scoped netting | PARTIEL | FAIT | DB proof on MNQ |
| MES account-scoped netting | PARTIEL | PARTIEL | code path is instrument-generic, but Lot010 DB proof only used MNQ |
| Formal marginal contribution analytics | PARTIEL | PARTIEL | attribution exists, but full marginal contribution model is not yet closed |
| Runtime live/research use the new pipeline end-to-end | PARTIEL | PARTIEL | runtime service proven locally; live/research full cutover remains later lot |

## Production blockers remaining from this lot

1. MES-specific runtime proof should be added before claiming full instrument-pair certification.
2. Marginal contribution analytics remains partial.
3. Live/research full routing into the Portfolio/Risk runtime is still not fully proven in production-like execution.
4. Static quality remains intentionally red until Lot 017.

## Conclusion

Lot 010 is closed for the core multi-strategy portfolio requirement:

- multiple strategies can produce separate candidate allocations;
- allocations are account-scoped;
- risk is account-aware;
- target positions remain account-scoped;
- order intents cannot use a broker account that does not safely match the target account;
- persistence proves the lineage on local PostgreSQL;
- tests and guards pass except for the known static-quality programme debt.

No live trading mode was activated.
