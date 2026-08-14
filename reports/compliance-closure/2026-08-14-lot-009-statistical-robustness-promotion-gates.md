# Lot 009 — Statistical robustness / promotion gate persistence

Date: 2026-08-14
Repository: `TV_Automation_PREPROD`
Operational policy: `SEMI_MANUAL` — physical execution remains paused and no automatic LIVE activation is authorized.

## Status

Lot status: **PARTIEL**

This lot closes a critical proof gap around research promotion evidence: portfolio fit and promotion matrix decisions are now first-class, persisted evaluation reports, and the robustness runner fails closed when promotion evidence is incomplete or negative.

It does **not** claim the full statistical robustness programme is complete. Deflated Sharpe Ratio, Probability of Backtest Overfitting, Hansen SPA / White Reality Check, true split-backed OOS execution, and a candidate promoted all the way to SHADOW/PAPER remain open.

## Requirements matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
| --- | --- | --- | --- | --- | --- | --- |
| Research evaluations must persist portfolio fit evidence before promotion | PARTIEL | No first-class `PORTFOLIO_FIT` report kind existed in the research evaluation vocabulary | Added SQL enum migration and domain enum support | `research_experiment_sql_schema.test.js`, `research-experiment-registry-v1.test.js` | Local PostgreSQL accepted migration 052 and persisted a `PORTFOLIO_FIT` report | **FAIT** |
| Promotion matrix must be persisted and auditable | PARTIEL | Promotion matrix could be computed by domain helpers but was not materialized as canonical Research Lab evidence in robustness runtime | Added `PROMOTION_MATRIX` evaluation report generation and persistence via robustness runner | `research_robustness_review_runner.test.js` | DB contains persisted `PROMOTION_MATRIX` report linked to candidate/run | **FAIT** |
| Semi-manual policy must block automatic promotion/live execution | PARTIEL | Promotion decision needed explicit persisted gates proving `automatic_execution_enabled=false` and `live_authorization=false` | Promotion report criteria now includes `semi_manual_required`, `operator_approval_required`, `automatic_execution_enabled=false`, `live_authorization=false`, and canonical gates `G0..G7` | Targeted robustness runner tests assert automatic/live flags are false in fail path | Persisted promotion matrix rejected a non-robust candidate; candidate remains `UNDER_REVIEW` and `promotion_blocked=true` | **FAIT** |
| A good baseline must not be promoted if robustness fails | PARTIEL | Robustness runner needed to bind robustness/OOS/portfolio fit to promotion decision and fail closed | Final decision now derives from robustness + promotion matrix; `promotion_allowed` is true only for `APPROVED_FOR_PROMOTION` | Fragile test asserts `ROBUSTNESS_FAILED`, `REJECT_PROMOTION`, and `G2_ROBUSTNESS.ok=false` | Existing Lot007 candidate with attractive baseline was rejected by runtime because robustness failed | **FAIT** |
| Full statistical robustness programme | PARTIEL | DSR/PBO/Hansen/White/true OOS/walk-forward industrial proof still absent | Not implemented in this lot | Not applicable | Not available | **PARTIEL** |
| Full Research → SHADOW → PAPER vertical slice | PARTIEL | No candidate reached promotion; portfolio context is conservative and can return `NEEDS_REVIEW` | This lot prevents unsafe promotion; it does not fabricate a winning strategy | Not applicable | Candidate `839edcff-05fe-4168-975a-ded9dcf35093` remains blocked | **PARTIEL** |

## Code and schema evidence

- PostgreSQL migration: `infra/postgres/init/052_research_promotion_gate_reports.sql`
  - Adds `PORTFOLIO_FIT`
  - Adds `PROMOTION_MATRIX`
- Domain vocabulary: `packages/desk-domain/src/research-experiment-registry-v1.js`
  - `RESEARCH_EVALUATION_REPORT_KINDS_V1` now includes both new report kinds.
- Type surface: `packages/desk-domain/index.d.ts`
  - Type tuple includes both report kinds.
- Promotion gate builder: `mcp_gpt_desk/src/research/research-promotion-gate-evaluations.js`
  - Builds conservative `PORTFOLIO_FIT` and `PROMOTION_MATRIX` reports.
  - Requires explicit operator approval before promotion.
  - Forces `automatic_execution_enabled=false` and `live_authorization=false` under semi-manual preprod policy.
- Robustness runtime: `mcp_gpt_desk/src/research/research-robustness-review-runner.js`
  - Persists `ROBUSTNESS`, `OUT_OF_SAMPLE`, `PORTFOLIO_FIT`, and `PROMOTION_MATRIX` reports in one runtime pass.
  - Exposes `promotion_decision`, `promotion_allowed`, `robustness_gate_passed`, and report IDs.

## Tests executed

### Targeted Lot009 tests

```text
node --test \
  mcp_gpt_desk/test/research_robustness_review_runner.test.js \
  mcp_gpt_desk/test/research_experiment_sql_schema.test.js \
  packages/desk-domain/test/research-experiment-registry-v1.test.js \
  packages/desk-domain/test/research-promotion-matrix-v1.test.js

23 pass / 0 fail
```

### Research targeted suite

```text
node --test \
  mcp_gpt_desk/test/research_robustness_review_runner.test.js \
  mcp_gpt_desk/test/research_backtest_review_runner.test.js \
  mcp_gpt_desk/test/research_strategy_iteration_runner.test.js \
  mcp_gpt_desk/test/research_experiment_service.test.js \
  mcp_gpt_desk/test/research_experiment_sql_schema.test.js \
  mcp_gpt_desk/test/strategy_kernel_service.test.js

44 pass / 0 fail
```

### Domain full suite

```text
npm --prefix packages/desk-domain test

455 pass / 0 fail
```

### MCP full suite

```text
npm --prefix mcp_gpt_desk test

1063 pass / 0 fail
```

## Runtime proof on local PostgreSQL

Migration applied:

```text
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/052_research_promotion_gate_reports.sql'

ALTER TYPE
ALTER TYPE
```

Runtime robustness task replayed using the existing Lot007 candidate:

```text
research_candidate_id: 839edcff-05fe-4168-975a-ded9dcf35093
simulation_run_id: d290d7ef-e6d4-44a2-8225-e8f95c2d8742
status: ROBUSTNESS_FAILED
robustness_report_id: 53ecdaf6-3012-4cde-abd3-331e9fc97205
oos_report_id: 301ec6c4-2e32-4d20-8ae3-459fad60e06e
portfolio_fit_report_id: 39c80fc2-e332-4044-b368-e5252497fe01
promotion_matrix_report_id: 6e6bba9d-ee4e-4dee-8071-ce20b6611cea
robustness_gate_passed: false
promotion_decision: REJECT_PROMOTION
promotion_allowed: false
reasons:
  - PARAMETER_PERTURBATION_FAILED
  - VALIDATION_REJECT_CANDIDATE
```

Persisted evaluation reports:

```text
VALIDATION            PASS          score 0.9100  total_r 9.4522
OUT_OF_SAMPLE         PASS          score 0.8263  total_r 9.4522
ROBUSTNESS            FAIL          score 0.8563  decision ROBUSTNESS_FAILED
CONTRADICTORY_REVIEW  PASS          score 0.9117  decision READY_FOR_ROBUSTNESS_REVIEW
PORTFOLIO_FIT         NEEDS_REVIEW  score 0.6900  decision PORTFOLIO_FIT_REVIEW_REQUIRED
PROMOTION_MATRIX      FAIL          score 0.4900  decision REJECT_PROMOTION
```

Candidate state after runtime proof:

```text
research_candidate_id: 839edcff-05fe-4168-975a-ded9dcf35093
status: UNDER_REVIEW
promotion_blocked: true
promotion_block_reason: EVALUATION_FAILED
last_evaluation_verdict: FAIL
evaluation_score: 0.7807
```

Interpretation: the system did the safe thing. A candidate with good baseline validation/OOS evidence was **not promoted** because robustness and portfolio-fit promotion gates were not good enough.

## Guards

```text
guard:architecture        OK
guard:runtime-safety      OK
guard:mcp-slices          OK
guard:sql-migrations      OK
guard:exceptions          OK
guard:problem-details     OK
guard:windows-deployment  OK
guard:static-quality      KO connu
```

`guard:static-quality` remains open and is not masked:

```text
front-control-plane-api.js has 2075 lines; allowed 600
strategy-dsl-compiler-v1.js has 624 lines; allowed 600
canonical-simulation-engine-v1.js has 881 lines; allowed 600
oversized functions: 249; allowed 243
high complexity functions: 644; allowed 592
duplicate blocks: 72; allowed 50
possibly dead files: 17; allowed 14
```

This is aligned with the known static-quality closure track, but the current counters must be treated as real debt.

## Remaining gaps

1. **True statistical robustness still PARTIEL**
   - Deflated Sharpe Ratio not implemented/proven.
   - Probability of Backtest Overfitting not implemented/proven.
   - Hansen SPA / White Reality Check not implemented/proven.
   - Full walk-forward/OOS split execution not yet proven end-to-end.

2. **Portfolio fit still conservative**
   - The report is first-class and persisted.
   - Real strategy correlation/sub-book/risk-budget integration must feed it systematically.
   - Missing portfolio context correctly blocks or requires review.

3. **No SHADOW/PAPER promotion yet**
   - This is intentional: the tested candidate failed robustness/promotion gates.
   - A later lot must produce or select a candidate that passes before SHADOW/PAPER proof can be claimed.

4. **Static quality remains a blocker for final closure**
   - Existing large modules and complexity counters remain above baseline.
   - This must be closed in the dedicated quality lot before final cutover.

## Lot conclusion

Lot009 adds a real promotion safety layer: the Research Lab can no longer treat robustness as a loose narrative or a transient runner result. Portfolio fit and promotion matrix decisions are persisted, auditable, linked to candidate/run evidence, and fail closed under the semi-manual policy.

Strictly gained as **FAIT**:

- First-class persisted `PORTFOLIO_FIT` reports.
- First-class persisted `PROMOTION_MATRIX` reports.
- Runtime robustness runner emits four report types.
- Promotion is blocked when robustness fails.
- Semi-manual policy prevents automatic execution/live authorization from promotion evidence.

Still **PARTIEL**:

- Complete statistical robustness suite.
- Real portfolio correlation/sub-book integration.
- End-to-end successful promotion to SHADOW then PAPER.
- Static quality.

Recommended next P0 lot:

**Lot010 — Research statistical robustness depth + split-backed OOS/walk-forward proof**, unless the programme order chooses to branch first into signal bus/live runtime certification.
