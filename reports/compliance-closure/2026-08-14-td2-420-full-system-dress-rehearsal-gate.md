# TD2-420 — Full-System Operational Dress Rehearsal Gate

Date: 2026-08-14  
Repository: `TV_Automation_PREPROD`  
Scope: repository proof for the TD2-420 rehearsal certifier and release gate.  
Status: PARTIEL — certification gate implemented and tested locally; the real VPS dress rehearsal is still not executed.

## Objective

TD2-420 must not be closed by intent. It requires a real end-to-end operational rehearsal before allowing:

- research workers to process 10 to 20 existing Strategy_IDs;
- persistent artifacts to cover dataset, strategy, simulation, evaluation and promotion gates;
- SHADOW / SEMI_MANUAL live runtime to progress;
- signals to pass through Portfolio/Risk/Human Gate;
- frontend truth, realtime resume and observability to be proven;
- restart/chaos recovery to be proven;
- broker/provider side effects to remain exactly zero.

This lot creates the executable gate that will judge that rehearsal. It deliberately returns `NO-GO` when runtime evidence is missing.

## Implemented files

### Certifier

- `mcp_gpt_desk/src/full-system-dress-rehearsal-certifier.js`

Exports:

- `TD2_420_VERDICTS`
- `evaluateFullSystemDressRehearsalEvidence`
- `buildDressRehearsalEvidenceFromRuntimeSnapshot`

Allowed final verdicts:

- `GO — RESEARCH + LIVE SIGNALS + SEMI_MANUAL`
- `GO WITH EXTERNAL BLOCKERS — RESEARCH + LIVE SIGNALS + SEMI_MANUAL`
- `NO-GO`

Mandatory checks:

- `safety.auto_execution_off`
- `safety.live_auto_off`
- `safety.zero_broker_side_effect_delta`
- `cold_start.schema_present`
- `cold_start.critical_services_healthy`
- `workers.topology_known`
- `workers.heartbeats_fresh`
- `research.strategy_sample_size`
- `research.pipeline_artifacts`
- `research.gates_audited`
- `data.historical_lineage`
- `strategy.artifact_lineage`
- `live_runtime.scheduler_observed`
- `signal_pipeline.safe_proof`
- `front.vnext_truthful`
- `front.realtime_resume`
- `observability.no_critical_errors`
- `chaos.worker_recovery`
- `chaos.backend_restart_recovery`
- `restart.full_restart_recovered`

Optional external blockers:

- assistant runtime answer proof;
- Telegram operator notification;
- Sim101/PAPER provider smoke.

### Runtime collector CLI

- `mcp_gpt_desk/scripts/certify_td2_420_dress_rehearsal.mjs`
- `mcp_gpt_desk/package.json`

Package script:

```bash
npm --prefix mcp_gpt_desk run certify:td2-420-dress-rehearsal -- \
  --base-url=https://vps-6d6969db.vps.ovh.net \
  --database-url=postgres://... \
  --since-utc=... \
  --before-counts-json=... \
  --probe-sse
```

The CLI is read-only. It does not:

- start or stop services;
- activate AUTO_EXECUTION;
- activate LIVE;
- create a ProviderCommand;
- submit orders;
- mutate research/lifecycle state.

It reads:

- PostgreSQL schema;
- service heartbeats;
- worker heartbeats;
- research artifacts and gates;
- dataset/strategy lineage;
- live runtime state;
- signal pipeline counters;
- observability events;
- restart/chaos proof;
- Telegram/Sim101 proof when available;
- BFF `/front-api/v1/capabilities`;
- BFF `/front-api/v1/views/command-center`;
- BFF `/front-api/v1/views/jarvis-workspace`;
- optional SSE `/front-api/v1/events`.

The SSE probe reads the first event-stream chunk and cancels the reader instead of waiting for the stream to close. This avoids a false timeout on a valid persistent stream.

### Tests

- `mcp_gpt_desk/test/full_system_dress_rehearsal_certifier.test.js`

Covered cases:

- missing runtime evidence returns `NO-GO`;
- complete mandatory evidence returns `GO — RESEARCH + LIVE SIGNALS + SEMI_MANUAL`;
- optional external blockers return `GO WITH EXTERNAL BLOCKERS — RESEARCH + LIVE SIGNALS + SEMI_MANUAL`;
- runtime snapshot builder normalizes strategy IDs and service fields.

## Tests executed

### TD2-420 targeted

Command:

```bash
node --check mcp_gpt_desk/src/full-system-dress-rehearsal-certifier.js
node --check mcp_gpt_desk/scripts/certify_td2_420_dress_rehearsal.mjs
node --test mcp_gpt_desk/test/full_system_dress_rehearsal_certifier.test.js
```

Result:

```text
4 pass / 0 fail
```

### Combined targeted backend

Command:

```bash
node --test \
  mcp_gpt_desk/test/domain_assistant_runtime_service.test.js \
  mcp_gpt_desk/test/domain_assistant_runtime_sql_schema.test.js \
  mcp_gpt_desk/test/front_control_plane_api.test.js \
  mcp_gpt_desk/test/full_system_dress_rehearsal_certifier.test.js
```

Result:

```text
35 pass / 0 fail
```

### Full backend suite

Command:

```bash
npm --prefix mcp_gpt_desk test
```

Result:

```text
1118 pass / 0 fail
```

### Front VNext

Commands:

```bash
npm --prefix apps/desk-control-plane run typecheck
npm --prefix apps/desk-control-plane test -- --run
```

Results:

```text
typecheck OK
35 test files passed
161 tests passed
```

### Guards

Commands:

```bash
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:sql-migrations
npm run guard:problem-details
npm run guard:api-compatibility
npm run guard:jarvis-authority
npm run guard:jarvis-authority:test
git diff --check
```

Results:

```text
guard:architecture       OK — 396 checked files
guard:runtime-safety     OK — direct_clock_usages 130 / budget 130
guard:sql-migrations     OK — 55 migrations, 134 tables
guard:problem-details    OK
guard:api-compatibility  OK — fingerprint b939c84547cacb1b403fc30a7e2275318e4e08eca7cb6cdf0bedb611e94017a3
guard:jarvis-authority   OK — READ_ONLY_CERTIFIED, 0 violations
jarvis-authority tests   OK — 3 pass / 0 fail
git diff --check         OK
```

Note: `guard:static-quality` remains an existing known KO and is not hidden by this lot.

## Expected fail-closed behavior

Command:

```bash
node mcp_gpt_desk/scripts/certify_td2_420_dress_rehearsal.mjs --base-url=http://127.0.0.1:9
```

Result:

```text
verdict: NO-GO
```

This is expected. Without real DB/BFF/runtime evidence, the gate refuses to certify the desk.

## Requirement matrix

| Requirement | Current status | Evidence | Gap |
|---|---:|---|---|
| Full rehearsal has an executable acceptance gate | FAIT local | certifier + tests | none local |
| Gate refuses missing evidence | FAIT local | `NO-GO` test and CLI no-runtime behavior | none local |
| AUTO_EXECUTION/LIVE must stay off | FAIT local | mandatory safety checks | VPS runtime proof pending |
| Zero broker/provider side effect required | FAIT local | mandatory before/after count check | needs real VPS before/after counts |
| Research sample constrained to 10–20 Strategy_IDs | FAIT local | `research.strategy_sample_size` | needs actual campaign |
| Research artifacts and gates mandatory | FAIT local | pipeline/gate checks | needs actual artifacts |
| Data lineage/no-lookahead/synthetic policy proof mandatory | FAIT local | `data.historical_lineage` | needs actual datasets |
| Strategy version/artifact/SHADOW proof mandatory | FAIT local | `strategy.artifact_lineage` | needs actual strategy instances |
| Live scheduler/signal safe path mandatory | FAIT local | live/signal checks | needs actual live runtime sample |
| VNext/BFF/realtime proof mandatory | FAIT local | front/SSE checks | needs VPS BFF + browser/reopen proof |
| Observability critical-error proof mandatory | FAIT local | explicit critical/unexplained error counters | needs VPS event window |
| Worker/backend/restart recovery proof mandatory | FAIT local | chaos/restart checks | needs controlled VPS rehearsal |
| Telegram/Sim101 treated as external optional blockers | FAIT local | optional blocker verdict branch | needs runtime if desired |

## VPS execution still required before Done

TD2-420 cannot be moved to Done until this exact operational sequence is executed on the VPS release that contains this certifier:

1. Deploy a clean release containing TD2-418, TD2-419 and TD2-420.
2. Capture pre-run broker/provider counts:
   - `broker_provider_commands`
   - `broker_provider_events`
   - `broker_execution_outbox`
   - `broker_management_outbox`
   - `broker_orders`
   - `trade_order_intents`
   - `portfolio_order_intent_lineage`
3. Run a controlled cold start using the TD2-418 control plane.
4. Keep `AUTO_EXECUTION=OFF` and `LIVE_AUTO=OFF`.
5. Run the research campaign on 10–20 existing TD2 Strategy_IDs.
6. Prove artifacts:
   - Hypothesis/mission/task;
   - Strategy Spec/Version;
   - Dataset lineage;
   - Simulation;
   - Train/Validation/OOS;
   - Robustness;
   - Portfolio Fit;
   - SHADOW instance.
7. Observe live scheduler/signals in SHADOW or SEMI_MANUAL.
8. Prove no signal path can bypass Portfolio/Risk/Human Gate.
9. Prove VNext uses BFF truth and SSE/cursor recovery.
10. Run controlled recovery tests:
    - worker restart/requeue/idempotence;
    - backend restart/task persistence;
    - degraded state;
    - full restart recovery.
11. Capture post-run broker/provider counts.
12. Execute:

```bash
npm --prefix mcp_gpt_desk run certify:td2-420-dress-rehearsal -- \
  --base-url=https://vps-6d6969db.vps.ovh.net \
  --database-url="$DATABASE_URL" \
  --since-utc="<start-of-dress-rehearsal-utc>" \
  --before-counts-json="<captured-before-counts-json>" \
  --probe-sse
```

13. Accept Done only if verdict is:
    - `GO — RESEARCH + LIVE SIGNALS + SEMI_MANUAL`, or
    - `GO WITH EXTERNAL BLOCKERS — RESEARCH + LIVE SIGNALS + SEMI_MANUAL` with only explicitly accepted optional external blockers.

## Jira recommendation

Do not transition TD2-420 to Done yet.

Recommended Jira state:

- move TD2-420 to `En cours` if it is still `À faire`;
- add this report as evidence of the implemented certification gate;
- keep Done blocked by the actual VPS dress rehearsal artifacts.

## VPS rehearsal attempt — 2026-08-15 update

Status: **NO-GO — rehearsal not certifiable yet**.

Release built and locally verified:

- `preprod-v2-convergence-20260814.12-td2-420-output-ref-fix`
- archive: `C:\Users\CES\Desktop\TV_Automation_PREPROD\.local\releases\preprod-v2-convergence-20260814.12-td2-420-output-ref-fix.zip`
- SHA-256: `9428861be8ce9aa495e70a59ee2c86e0a4ce1217b588ba7239ed0afa4931a513`
- local release verification:

```text
Release verified: preprod-v2-convergence-20260814.12-td2-420-output-ref-fix (5017 files)
```

The `.12` release contains the runtime fix for branch-safe research iteration output references. The local backend regression suite and guards passed before this release was built:

```text
research_strategy_iteration_runner + strategy_kernel_service: 18 pass / 0 fail
mcp_gpt_desk full suite: 1124 pass / 0 fail
guard:architecture: OK
guard:runtime-safety: OK
guard:mcp-slices: OK
guard:windows-deployment: OK
guard:sql-migrations: OK
```

VPS pre-deploy observation from the previous `.11` runtime:

- active release observed before `.12` deploy attempt: `preprod-v2-convergence-20260814.11-td2-420-research-candidate-key-fix`
- real Strategy_ID inventory on VPS: **1** existing strategy definition only:
  - `demo-paper.mnq.opening-range-breakout-retest`
- this is insufficient for the strict TD2-420 requirement to rehearse **10 to 20 existing Strategy_IDs from multiple families**.

Broker/provider safety counts captured before the VPS rehearsal attempt:

```text
broker_provider_commands: 0
broker_provider_events: 0
broker_execution_outbox: 8
broker_management_outbox: 10
broker_orders: 15
trade_order_intents: 8
portfolio_order_intent_lineage: 0
```

The `.11` runtime rehearsal bootstrap completed all observed research tasks without creating broker provider commands/events:

```text
research tasks since freeze: 85 DONE / 0 active
research candidates since freeze: 85
broker_provider_commands: 0
broker_provider_events: 0
```

The imported TD2-420 certifier returned:

```text
verdict: NO-GO
total checks: 25
pass: 12
fail: 11
blocked_external: 2
mandatory_failures: 9
```

Main mandatory failures observed:

- `research.strategy_sample_size`: only 1 Strategy_ID available on the VPS.
- `research.pipeline_artifacts`: robust pipeline artifacts incomplete for TD2-420 certification.
- `research.gates_audited`: missing `G0_DATA_READY`, `G3_ROBUST`, `G4_PORTFOLIO_FIT`.
- `strategy.artifact_lineage`: no immutable published version / SHADOW instance proof.
- `live_runtime.scheduler_observed`: closed-market window; last evaluation did not progress.
- `front.realtime_resume`: browser reopen truth not proved.
- `chaos.worker_recovery`: duplicate result protection not fully proved under `.11`.
- `chaos.backend_restart_recovery`: not proved.
- `restart.full_restart_recovered`: not proved.

External blockers observed:

- Telegram runtime authorization/proof unavailable in the rehearsal window.
- Sim101/PAPER provider proof unavailable and intentionally not armed for automatic execution.

The attempt to deploy `.12` to the VPS could not be completed because the Windows host entered an operationally degraded administration state:

- SSH initially reset during key exchange until the client forced `KexAlgorithms=curve25519-sha256`.
- `cmd.exe` could still execute briefly.
- starting `powershell.exe` over SSH returned `Thread failed to start`.
- `tasklist` showed a runaway `powershell.exe` process, PID `18120`, using about `17,802,012 K` memory.
- attempts to inspect/kill that PID over SSH reset or timed out.
- ports `22`, `80` and `443` remained open; this indicates the VPS itself was reachable but remote administration was not reliable enough to continue a certified dress rehearsal.

Conclusion:

- TD2-420 remains **NO-GO**.
- Do not mark TD2-420 Done.
- Do not activate AUTO_EXECUTION or LIVE.
- Do not infer production readiness from the partial `.11` rehearsal.

Required next actions before resuming TD2-420:

1. Human/admin action on the VPS via RDP/KVM or console:
   - terminate runaway `powershell.exe` PID `18120` if still present;
   - restart `sshd` if needed;
   - verify memory pressure is cleared.
2. Deploy `.12` successfully.
3. Re-freeze `REHEARSAL_START` after `.12` is active.
4. Re-run broker/provider before-count capture.
5. Launch a bounded campaign that actually uses 10–20 existing Strategy_IDs from multiple families, or explicitly mark this requirement blocked until the Strategy_ID catalog is present on the VPS.
6. Re-run the TD2-420 certifier and accept only the allowed verdicts.

## VPS rehearsal attempt — 2026-08-15 `.12/r5`

Status: **NO-GO — real VPS rehearsal executed but mandatory TD2-420 criteria are still not satisfied**.

Administrative recovery:

- The runaway Windows administration state was cleared by a controlled forced reboot:
  - SSH/PowerShell recovered after reboot.
  - `powershell.exe` could start normally again.
- The previously failed deployment drain `deploy-20260815T001012Z-54d1fe89` was closed as `rolled_back` and restored the prior safe controls.

Deployment:

- Deployed release: `preprod-v2-convergence-20260814.12-td2-420-output-ref-fix`
- Initial `.12` deploy failed because the checksum sidecar was missing:

```text
Release archive checksum is missing:
C:\DeskFutures\incoming\preprod-v2-convergence-20260814.12-td2-420-output-ref-fix.zip.sha256
```

- The `.sha256` sidecar was then created/transferred.
- Second `.12` deploy succeeded:

```text
Release verified: preprod-v2-convergence-20260814.12-td2-420-output-ref-fix (5017 files)
Desk local health passed.
PASS front 200
PASS health 200
PASS readiness 200
PASS oauth-resource 200
PASS oauth-server 200
PASS webhook rejects missing secret
Desk public deployment smoke test passed.
Deployment deploy-20260815T001643Z-13607cce completed as verified; previous claim and execution controls restored.
Desk update preprod-v2-convergence-20260814.12-td2-420-output-ref-fix verified and reopened.
```

Activated SHADOW/SEMI_MANUAL topology for the rehearsal:

- Running:
  - `DeskFuturesApi`
  - `DeskFuturesCaddy`
  - `DeskFuturesTelegram`
  - `DeskFuturesLiveRuntime`
  - `DeskFuturesAgentRuntimeSupervisor`
  - `DeskFuturesAgentRuntimeResearch`
- Kept stopped/disabled:
  - `DeskFuturesBrokerManagement`
  - `DeskFuturesReplayPreparation`
  - `DeskFuturesCodexLive01`
  - `DeskFuturesCodexLive02`
  - `DeskFuturesCodexReplay01`

Safety state after activation:

```text
DESK_LIVE_EXECUTION_MODE=shadow
DESK_BROKER_EXECUTION_ENABLED=false
DESK_NINJA_ALLOW_LIVE_ACCOUNT=false
DESK_AI_WORKER_MODE=disabled
DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED=true
```

Claims and broker execution remained fail-closed:

```text
desk_claim_lane_controls/live   enabled=false status=PAUSED
desk_claim_lane_controls/replay enabled=false status=PAUSED
global_default_kill_switch      locked=true
```

Rehearsal window:

- `REHEARSAL_START`: `2026-08-15T00:21:41.8392963Z`
- before-counts artifact on VPS:
  - `C:\ProgramData\DeskFutures\proofs\td2-420\before_counts_12_2026-08-15T00-21-41-8392963Z.json`
- after-counts artifact on VPS:
  - `C:\ProgramData\DeskFutures\proofs\td2-420\after_counts_12_2026-08-15T00-21-41-8392963Z.json`
- certifier artifact on VPS:
  - `C:\ProgramData\DeskFutures\proofs\td2-420\td2_420_certifier_12_r5_imported.json`

Broker/provider side-effect result:

```text
before broker_provider_commands: 0
after  broker_provider_commands: 0
before broker_provider_events:   0
after  broker_provider_events:   0
broker_execution_outbox:         8 -> 8
broker_management_outbox:        10 -> 10
broker_orders:                   15 -> 15
trade_order_intents:             8 -> 8
portfolio_order_intent_lineage:  0 -> 0
```

Research bootstrap r5:

- dataset key: `td2-420-r5.demo-paper.mnq.m5.2026-06-10_2026-07-10`
- dataset id: `f1b8edd4-3c76-46d1-887c-a90c53cc551a`
- rows: `5976`
- trading days: `23`
- bootstrap simulation result:
  - `total_r=-2.0736`
  - `trade_count=2`
  - `win_rate=0`
  - `profit_factor=0`
- agent task result:
  - `106 DONE`
  - `84 research_candidates`
  - `duplicate_output_refs=0`

Important runtime proof gained:

- The `.12` output-ref fix is now proved on VPS runtime:

```text
duplicate_output_refs=0
```

This closes the `.11` regression where several branch/iteration tasks shared the same output reference.

TD2-420 certifier result:

```text
verdict: NO-GO
total: 25
pass: 13
fail: 10
blocked_external: 2
mandatory_failures: 8
```

Passing checks:

- `safety.auto_execution_off`
- `safety.live_auto_off`
- `safety.zero_broker_side_effect_delta`
- `cold_start.schema_present`
- `cold_start.critical_services_healthy`
- `workers.topology_known`
- `workers.heartbeats_fresh`
- `data.historical_lineage`
- `signal_pipeline.safe_proof`
- `front.vnext_truthful`
- `assistants.read_only_truthful`
- `observability.no_critical_errors`
- `chaos.worker_recovery`

Failing mandatory checks:

- `research.strategy_sample_size`
  - actual `strategy_count=1`
  - required `10..20`
  - strategy id available: `demo-paper.mnq.opening-range-breakout-retest`
- `research.pipeline_artifacts`
  - missions `106`
  - tasks `106`
  - datasets reported by certifier `0`
  - simulation runs `84`
  - evaluation reports `169`
  - note: the r5 dataset exists and is linked to all 84 simulations, so the certifier still under-counts datasets in the research artifact check because it uses dataset `created_at_utc` rather than simulation lineage.
- `research.gates_audited`
  - missing `G0_DATA_READY`, `G3_ROBUST`, `G4_PORTFOLIO_FIT`
  - present: `G1_SCREENED=169`, `G2_CANONICAL_VALID=84`
- `strategy.artifact_lineage`
  - validated versions `84`
  - compiled artifacts `84`
  - shadow instances reported `0`
- `live_runtime.scheduler_observed`
  - instances evaluated `5`
  - feed state `closed_market_expected`
  - last evaluation progressed `false`
- `front.realtime_resume`
  - SSE connected `true`
  - cursor resume proven `true`
  - browser reopen truth preserved `false`
- `chaos.backend_restart_recovery`
  - backend restart recovery not proved in the rehearsal window
- `restart.full_restart_recovered`
  - full restart recovery not proved through audited desk events

Optional external blockers:

- `telegram.notification_operator_safe`
  - Telegram runtime authorization/proof unavailable in this rehearsal window.
- `sim101.paper_smoke`
  - Sim101/PAPER provider unavailable or intentionally not armed.

Conclusion:

- TD2-420 remains **NO-GO**.
- `.12` is deployed and stable on the VPS.
- The desk is safe:
  - no auto execution;
  - no live auto;
  - broker execution disabled;
  - provider command/event delta zero;
  - claims paused;
  - global broker kill switch locked.
- The next blocker is no longer deployment. It is the TD2-420 evidence gap:
  1. load/provision the real 10–20 Strategy_ID catalog across multiple families;
  2. fix the certifier research dataset lineage count;
  3. add/prove G3 robustness and G4 portfolio-fit reports;
  4. prove SHADOW instances and live scheduler progression during a market/open-data window;
  5. run audited backend/full restart recovery;
  6. prove browser reopen truth and optional Telegram/Sim101 evidence when available.
