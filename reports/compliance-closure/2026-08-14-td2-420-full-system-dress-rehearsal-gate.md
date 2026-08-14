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

