# DeskAgentWorkItem v1.0.0

## Purpose

`DeskAgentWorkItem` is the backend-owned handoff between the Desk orchestrator and a scheduled ChatGPT task. It carries one exact live or replay Master/Monitor assignment and prevents two workers from executing the same scope.

## Lifecycle

`READY -> CLAIMED -> COMPLETED`

Failure may return a work item from `CLAIMED` to `READY` while attempts remain. Terminal alternatives are `FAILED`, `PAUSED`, and `SUPERSEDED`.

## Required identity

- `work_item_id`
- `workflow`: `LIVE_MASTER`, `LIVE_M15_MONITOR`, `REPLAY_MASTER`, or `REPLAY_MONITOR`
- `automation_scope`: `live` or `replay`
- `run_id` for live, or `backtest_id` for replay
- `step_id`
- `bundle_id`
- `pack_build_id`
- `contract_context`
- `expected_revision` for replay
- `idempotency_key`
- `prompt_name`, `prompt_version`, `prompt_hash`

## Claim lease

A claim returns `worker_id`, `lease_token`, and `lease_expires_at_utc`. The GPT save must echo these three values. The backend verifies the lease and the exact live/replay scope before accepting the analysis write; replay additionally verifies its expected revision.

Only an expired lease can be reclaimed. A heartbeat may extend a valid lease. A retry keeps the same immutable scope and increments `attempt_count`.

## Prompt ownership

The backend generates `prompt_text` from the prepared bundle and active/pinned contract. `claim_next_desk_work` returns `execution_prompt`, which adds the active lease. The worker must read the compact bundle through MCP, save through MCP, and never ask the operator to transfer JSON.

## Completion

Replay saves complete their work item and automatically run deterministic transitions until the next GPT step or a terminal replay state. A live M15 save completes its work item after all nested updates succeed. A live Master stays claimed after `save_master_analysis` and only becomes complete after the linked active thesis has also been materialized. `complete_desk_work` reconciles the actual saved outputs and is idempotent.

## Late live Master catch-up

When a `LIVE_MASTER` is completed after one or more M15 checkpoints, completion prepares one `LIVE_M15_MONITOR` at the latest settled closed checkpoint. It never enqueues every missed checkpoint.

The work item, monitor bundle, save target, and work-event audit carry an optional `catchup_context` with:

- `master_cutoff_paris`
- `master_materialized_at_paris`
- `monitor_checkpoint_paris`
- `catchup_mode: true`
- `skipped_checkpoints` and `skipped_checkpoint_count`
- `data_settlement_lag_seconds`

The selected checkpoint and skipped list are derived from the first completion timestamp and remain stable on idempotent retries.

## Live Monitor latest-wins

When several closed M15 Monitor checkpoints are available and none is leased,
the LIVE cursor claims only the most recent settled checkpoint. Older,
unmaterialized Monitor checkpoints are never replayed one by one.

The selected bundle carries `catchup_context` with the last materialized
checkpoint, the selected checkpoint, the complete list of superseded
checkpoints, and an analysis window. The rolling pack must cover that complete
window. GPT must analyze the accumulated market-data delta and explicitly
acknowledge the materialization gap.

An active valid lease is never preempted by latest-wins. A pending
`REPLAN_FULL` Master also remains prioritary over later Monitor checkpoints.

## Bounded empty-claim retry

`claim_next_live_work` may perform at most three server-side claim attempts,
spaced by 60 seconds, when the state is transient (`DATA_NOT_READY`, an active
lease, or a near-term eligibility boundary). Terminal, paused, closed, and
genuinely up-to-date states return immediately. The response exposes a
`claim_retry` audit; the GPT worker must not add a fourth client-side attempt.
