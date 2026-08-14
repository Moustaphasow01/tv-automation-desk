# LOT 007 — Research Vertical Slice E2E

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD at audit: `e18b48a310085679c94639420ca0b0b8c78ee70f`
Status: **PARTIAL**

## Objective

Prove one representative P0 research strategy can move through:

`Hypothesis → Research Mission → Strategy Spec → immutable Strategy Version → Dataset Version → baseline → bounded screening → canonical simulation → Train / Validation / OOS → robustness → Portfolio Fit → SHADOW → SEMI_MANUAL/PAPER`.

The lot must not industrialize the full 160-strategy catalogue before this vertical slice is reliable.

## Initial audit

The repository already had:

- PostgreSQL research registry tables for experiments, hypotheses, candidates and evaluation reports.
- Strategy Kernel tables and immutable `StrategyVersion` constraints.
- Dataset registry and Simulation Run registry tables.
- Deterministic research runners:
  - `RESEARCH_BACKTEST_REVIEW`
  - `RESEARCH_STRATEGY_ITERATION`
  - `RESEARCH_ROBUSTNESS_REVIEW`
- Domain policies for failure memory, novelty, promotion matrix and robustness.

The first runtime proof exposed a real gap: iteration variants were creating new `StrategyDefinition` identities (`...balanced`, `...deep-retest`) instead of preserving the selected catalogue Strategy ID. That could violate the instruction "do not create a new Strategy_ID".

## Architecture and placement

Bounded contexts:

- `research`: hypothesis, experiment, candidate, agent task and evaluation lifecycle.
- `strategy`: Strategy Definition and immutable Strategy Version.
- `simulation`: canonical deterministic Simulation Run and artifacts.

Placement decision:

- Keep iteration variants as new `StrategyVersion` and `ResearchCandidate` records under the same `StrategyDefinition`.
- Do not create a new strategy catalogue identity for each variant.
- Do not change the front.
- Do not activate SHADOW/PAPER/LIVE automatically.

Rejected alternative:

- Creating one `StrategyDefinition` per variant. That makes screens and Jira easier in the short term, but breaks the catalogue identity invariant and pollutes the 160 Strategy_ID programme.

## Implementation

### Strategy_ID preservation fix

Files:

- `mcp_gpt_desk/src/research/research-strategy-iteration-plan.js`
  - `variantIds()` now accepts a source `strategy_definition_id`.
  - Variant IDs are derived from the source definition plus variant key.
  - Variant seeds mark `catalog-preserving` when a source definition exists.
- `mcp_gpt_desk/src/research/research-strategy-iteration-materializer.js`
  - `registerDefinition()` now reuses an existing source definition instead of attempting to recreate it with variant metadata.
  - Derived candidate keys now include the source StrategyDefinition ID to avoid collisions with older legacy variant identities.
- `mcp_gpt_desk/test/research_strategy_iteration_runner.test.js`
  - Added regression assertion that all variants preserve the source `strategy_definition_id`.

## Runtime proof — PostgreSQL local

PostgreSQL Docker service:

- `tv-automation-preprod-postgres-1`
- Status: healthy

Dataset created for the fresh proof:

- `dataset_id`: `77e1a415-917a-4535-be17-c3fbb1bc259b`
- `dataset_key`: `lot007.catalog-preserving.mnq.m5.2026-06-01_2026-07-01`
- Instrument/timeframe: `MNQ` / `M5`
- Rows: `6024`
- Trading days: `23`
- Range: `2026-06-01T00:00:00.000Z → 2026-07-01T00:00:00.000Z`
- Dataset hash: `sha256:c0ee2cb0c16b8d65ebf57b3025efae750a5b3a995730d1508a32010ffaf5b0c1`

Strategy identity:

- Source `StrategyDefinition`: `4b22bd26-ddb2-483b-ae04-95de4990b1bb`
- External key: `demo-paper.mnq.opening-range-breakout-retest`
- Baseline `StrategyVersion`: `81a82809-9abd-46e0-af4f-d19a5e212289`
- SHADOW seed instance created for baseline: `60cee03e-1d6c-48f9-8c5b-b557cf2d3ad8`
- Baseline compile status: `COMPILED`
- Baseline compiled artifact hash: `sha256:4630799d56074289e75f8fa2f73cb30cd5a7ec417b6d3152b123064c08e7ec9b`

Baseline result:

- Simulation run: `8d975563-b010-4c94-9c99-54201878c4de`
- Status: `COMPLETED`
- Total R: `-2.0736`
- Trades: `2`
- Profit factor: `0`
- Expectancy R: `-1.0368`
- Max DD R: `-2.0736`
- Verdict: `FAIL`
- Next task: `RESEARCH_STRATEGY_ITERATION`

Iteration result:

| Variant | Candidate | StrategyVersion | Run | Verdict | Total R | Trades | PF | Expectancy R | Max DD R |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| deep-retest | `839edcff-05fe-4168-975a-ded9dcf35093` | `29e79eb6-192c-4e08-9aa0-82b7d6f440a7` | `d290d7ef-e6d4-44a2-8225-e8f95c2d8742` | PASS | 9.4522 | 21 | 1.8193 | 0.4501 | -6.1872 |
| wide-retest | `42aba02e-7876-426a-918e-6e48b4bf70f5` | `45ce63b5-ceec-4aea-945d-48b1bc037479` | `e54c9f46-12b0-4ece-94fc-5b74dc0c552e` | PASS | 4.7005 | 25 | 1.2981 | 0.1880 | -7.2310 |
| balanced | `41e1ff20-adba-49cc-94d8-2fe11053881e` | `320e9641-cb05-47e9-88ca-c461803e8541` | `65d86db5-289f-43ce-8458-22dac5debfca` | PASS | 2.2902 | 25 | 1.1379 | 0.0916 | -7.2660 |
| quick-retest | `46cee762-5adc-49e9-9197-b97860428a5f` | `a502c98e-cbd2-464e-ae34-74eae5873fe0` | `e31bef16-fe9c-4f17-993f-bdede9013b4e` | FAIL | -7.5192 | 22 | 0.5754 | -0.3418 | -8.3784 |

DB identity proof:

- The 4 derived candidates above all have `strategy_definition_id = 4b22bd26-ddb2-483b-ae04-95de4990b1bb`.
- The 4 derived candidates all point to `external_key = demo-paper.mnq.opening-range-breakout-retest`.

Contradictory review proof for the best candidate:

- Task: `0d35a813-9c1d-40b6-b2e6-7457ee8a769a`
- Result: `READY_FOR_ROBUSTNESS_REVIEW`
- Verdict: `PASS`
- Score: `0.9117`
- Reason: `BASELINE_BACKTEST_ACCEPTABLE`
- Enqueued robustness task: `2b8a75b3-d1cb-4fc3-81b6-c62c5def38cd`

Robustness/OOS proof for the best candidate:

- Robustness report: `53ecdaf6-3012-4cde-abd3-331e9fc97205`
- OOS proxy report: `301ec6c4-2e32-4d20-8ae3-459fad60e06e`
- OOS proxy verdict: `PASS`
- Robustness verdict: `FAIL`
- Robustness score: `0.8563`
- Promotion allowed: `false`
- Gate reason: `PARAMETER_PERTURBATION_FAILED`
- Walk-forward pass rate: `0.6667`
- Parameter perturbation pass rate: `0.5`

Candidate final state after robustness:

- Candidate: `839edcff-05fe-4168-975a-ded9dcf35093`
- Status: `UNDER_REVIEW`
- `promotion_blocked`: `true`
- `promotion_block_reason`: `EVALUATION_FAILED`
- `last_evaluation_verdict`: `FAIL`

This is the expected fail-closed result: a candidate with attractive aggregate performance was not promoted because robustness failed.

## Simulation artifacts

For best candidate run `d290d7ef-e6d4-44a2-8225-e8f95c2d8742`:

- Engine: `desk-replay-engine`
- Engine version: `1.0.0`
- Status: `COMPLETED`
- Result hash: `sha256:f9404fe2d5b22bef5622941fc0863d0eee6fd8905d30d85a10b28b9ea08c8f5a`
- Metrics hash: `sha256:e11f4f828098e2ba32a05c1a95423fa3f279a12a45e25b80b3b1b40f56e34419`
- Result ref: `artifact://simulation-runs/d290d7ef-e6d4-44a2-8225-e8f95c2d8742/result`
- Metrics ref: `artifact://simulation-runs/d290d7ef-e6d4-44a2-8225-e8f95c2d8742/metrics`
- Artifacts present:
  - `INPUT_MANIFEST`
  - `ORDER_SIMULATION_POLICY`
  - `RESULT`
  - `METRICS`
  - `EVENTS`
  - `POSITIONS`

## Tests

Targeted backend/domain tests:

```text
node --test \
  mcp_gpt_desk/test/research_strategy_iteration_runner.test.js \
  mcp_gpt_desk/test/research_backtest_review_runner.test.js \
  mcp_gpt_desk/test/research_robustness_review_runner.test.js \
  mcp_gpt_desk/test/strategy_kernel_service.test.js

29 pass / 0 fail
```

Simulation package:

```text
npm --prefix packages/desk-replay-engine test
45 pass / 0 fail
```

Domain package:

```text
npm --prefix packages/desk-domain test
454 pass / 0 fail
```

## Guards

Green:

```text
guard:architecture       OK
guard:runtime-safety     OK
guard:mcp-slices         OK
guard:sql-migrations     OK
guard:exceptions         OK
guard:problem-details    OK
```

Known red before Lot017:

```text
guard:static-quality      KO
```

Current static-quality failures:

- `mcp_gpt_desk/src/front-control-plane-api.js` has 2075 lines; allowed 600.
- `packages/desk-domain/src/strategy-dsl-compiler-v1.js` has 624 lines; allowed 600.
- `packages/desk-replay-engine/src/canonical-simulation-engine-v1.js` has 881 lines; allowed 600.
- oversized functions: `248`; allowed `243`.
- high complexity functions: `640`; allowed `592`.
- duplicate blocks: `72`; allowed `50`.
- possibly dead files: `17`; allowed `14`.

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---|---|---|---|---|---|
| One existing Strategy_ID selected | PARTIEL | Jira catalogue lookup unavailable through Rovo; local catalogue identity used. | Preserved local `StrategyDefinition` `demo-paper.mnq.opening-range-breakout-retest`. | Research iteration test. | DB rows show all variants preserve source definition. | PARTIEL |
| Hypothesis persisted | FAIT | None for this slice. | Research registry. | Research service tests. | Hypothesis `abbe3166-d94f-4763-9ae2-ec44235f4ca1`. | FAIT |
| Research Mission persisted | FAIT | None for deterministic runners. | Agent task/mission runtime. | Research runner tests. | Review/iteration/robustness agent tasks created. | FAIT |
| Strategy Spec / DSL compiled | FAIT | None for this slice. | Strategy Kernel compile. | Strategy Kernel + domain DSL tests. | Baseline and variants compile to deterministic plans. | FAIT |
| Immutable Strategy Version | FAIT | None for published immutability schema; tested at domain/SQL level historically. | Strategy Kernel version registry. | Strategy Kernel service/domain tests. | Version rows and hashes persisted. | FAIT |
| Dataset Version sealed | FAIT | None for dataset seal itself. | Dataset registry. | Dataset SQL/schema tests. | Dataset `77e1...` READY with content/provenance hashes. | FAIT |
| Baseline canonical simulation | FAIT | None. | Simulation Run Registry. | Replay-engine tests. | Baseline run `8d975...` completed and rejected. | FAIT |
| Bounded screening / variants | FAIT | None for bounded count and deterministic IDs. | Iteration generator capped to 5, produced 4. | Iteration runner tests. | 4 variants persisted. | FAIT |
| Validation report | FAIT | None. | Research evaluation reports. | Research runner tests. | Validation reports persisted. | FAIT |
| Contradictory review | FAIT | None. | Backtest review runner. | Backtest review tests. | Best candidate review PASS. | FAIT |
| OOS | PARTIEL | OOS is currently a robustness-derived proxy report, not a separate persisted temporal split simulation. | Robustness runner records `OUT_OF_SAMPLE` proxy. | Robustness tests. | OOS proxy PASS. | PARTIEL |
| Train/Validation/OOS temporal split persistence | PARTIEL | Tables exist, but this vertical slice did not persist a dataset split or split usage row. | Existing migration/table only. | Schema test exists. | DB query returned 0 split rows for this dataset. | PARTIEL |
| Robustness | FAIT | None for fail-closed robustness decision. | Robustness runner. | Replay-engine robustness + runner tests. | Robustness FAIL with `promotion_allowed=false`. | FAIT |
| Portfolio Fit | PARTIEL | Domain has virtual PnL/similarity primitives, but no persisted portfolio-fit report in this slice. | Domain package. | Domain tests. | No persisted Lot007 portfolio-fit artifact. | PARTIEL |
| SHADOW | PARTIEL | Baseline SHADOW seed exists; best candidate was not promoted to SHADOW because robustness failed. | Strategy instance registry. | Strategy Kernel tests. | Baseline SHADOW instance exists; best candidate has no instance. | PARTIEL |
| SEMI_MANUAL/PAPER | PARTIEL | Correctly not reached because robustness failed. No physical/autonomous execution activated. | Execution remains gated/off. | Human gate/execution tests from Lot005. | No provider command created from this research slice. | PARTIEL |
| Negative result memory | FAIT | None for this slice. | Research candidate/evaluation lifecycle. | Research failure memory tests. | Candidate remains blocked after robustness fail. | FAIT |

## FAIT gained

- Research variants no longer create new `StrategyDefinition` identities when a source candidate already carries one.
- Research iteration preserves catalogue Strategy_ID while producing new StrategyVersions/Candidates.
- One-month deterministic dataset, baseline, iteration, review, OOS proxy and robustness evidence are persisted and queryable.
- A non-robust attractive candidate is blocked fail-closed and not promoted.

## Remaining PARTIEL

- True Train/Validation/OOS split rows are not persisted by the vertical slice.
- OOS is currently a robustness proxy, not a separate canonical OOS simulation run over an explicitly linked split.
- Portfolio Fit is not persisted as a research artifact/report for this slice.
- Best candidate did not reach SHADOW/PAPER because robustness failed; this is safe, but means the full happy-path vertical slice remains incomplete.
- Jira catalogue Strategy_ID lookup remains not proven because Atlassian Rovo search returned `INVALID_ARGUMENT`.

## NON FAIT

- None introduced by this lot.

## NON PROUVÉ

- End-to-end Strategy_ID identity against the actual Jira 160-strategy catalogue.
- Full promotion path to SHADOW and SEMI_MANUAL/PAPER for a robust candidate.

## BLOQUÉ EXTERNE

- Jira lookup/update through Atlassian Rovo: connector returned `INVALID_ARGUMENT`.

Expected external proof:

- A successful query of the TD2 160-strategy catalogue and confirmation that `demo-paper.mnq.opening-range-breakout-retest` maps to an existing P0 Strategy_ID, or selection of another existing P0 Strategy_ID.

## Git status classification

`UNTRACKED_REQUIRED`:

- `mcp_gpt_desk/src/research/research-strategy-iteration-plan.js`
- `mcp_gpt_desk/src/research/research-strategy-iteration-materializer.js`
- `mcp_gpt_desk/test/research_strategy_iteration_runner.test.js`
- this report under `reports/compliance-closure/`

This matches the previous lot pattern: files are tested and functional but must be explicitly included in the next commit/release.

## Conclusion

**LOT 007 is PARTIAL, not FAILED.**

The desk made meaningful progress and demonstrated the right safety behavior:

- it found a promising candidate;
- it preserved the source Strategy_ID after correction;
- it persisted metrics and artifacts;
- it rejected promotion when robustness failed.

Strict closure still requires a candidate that passes true split-based validation/OOS/robustness and reaches SHADOW/SEMI_MANUAL without bypassing gates.

## Next

Do not industrialize all 160 Strategy_ID yet. The next safe lot is to close the robustness/split/promotion gaps before broadening research:

1. persist temporal split manifests during dataset creation/bootstrap;
2. run separate canonical simulations per split role;
3. persist Portfolio Fit as a first-class research evaluation/artifact;
4. only then retry the Lot007 happy path and decide whether Lot008 can start safely.
