# Desk Replay Bundle Transport Contract v2.0.0

The `v2.0.0` in this document title is the transport protocol version; it is
independent from the active analytical Monitor contract version.

This transport contract applies to Replay Master and Replay Monitor bundle
reads. New runs pin Autopilot v5.1.0, DeskMasterAnalysisContract v5.1.0,
DeskHourlyThesisMonitorContract v2.1.0, DeskExecutionPlanContract v1.1.0,
DeskMonitorCommandContract v1.1.0, DeskDeterministicExecutionPolicy v4.1.0,
DeskConditionCatalogContract v1.1.0, deterministic compiler v1.1.0 and condition
engine v1.1.0.

Historical V5.0/V2.0 and V4/V1 runs remain readable with their original
hash-locked contracts, are read-only and are never converted or repinned
implicitly.

## Required Read Flow

1. Call `get_active_contracts` with `view=summary`.
2. Read the one full analysis contract needed by the current workflow with `get_contract`.
3. Read the prepared replay bundle with `view=compact` and `include_raw_refs=false`.
4. Verify `contract_context`, the replay pin, `save_target.suggested_payload`, cutoff, and anti-lookahead state.
5. Use `section_manifest` and replay-scoped deep-read tools only when more evidence is required.
6. Save directly with the declared MCP save tool.
7. Verify the run transition with `get_replay_state`.

## Lossless Access

The compact view keeps all decision-critical fields and exposes SHA-256 hashes for canonical sections. Full pack metadata, raw references, lineage, and rolling snapshots remain available through:

- `get_replay_bundle_manifest`
- `get_replay_bundle_section`
- `get_replay_snapshot`

Every deep read requires the exact `backtest_id`, `step_id`, and `bundle_type`. A replay read must never fall back to live data. LIVE and Replay nevertheless share the same V5.1/V2.1 contracts, Policy V4.1, V1.1 machine contracts, compiler 1.1, condition engine 1.1, phase gates and state machines; only temporal acquisition differs. GPT analyzes closed M5 checkpoints while the deterministic engine evaluates every eligible closed M1 bar.

## Replay Source Coverage

A replay pins an immutable `replay_source` pack whose `source_coverage.end_utc` reaches the configured replay end. Source coverage and decision visibility are separate: every MCP read validates the complete immutable object, then returns only rows visible at the current step `as_of_utc`.

A decision-cutoff pack such as the Asia Open `00:15` pack cannot drive later M15 steps and must be rejected before ChatGPT receives a prompt.

## Market Availability

- `fresh`: observations exist inside the requested window.
- `missing_unexpected`: the source should be open but is absent; this may justify `DATA_NOT_READY`.
- `stale_market_closed`: the market is closed and `last_known` is context only, never a fresh trigger.
- `not_yet_open`: the current session has not opened; a gap or confirmation is not applicable yet, not missing.

Cash VIX and US mega caps/semis are not expected to produce fresh overnight observations outside their cash session. A technology gap becomes usable only after a current-session quote exists.

## Size Budget

The default structured response budget is 180000 bytes. If a requested response exceeds the budget, the server returns a manifest and exact follow-up calls instead of silently truncating analytical data.

`budget_exceeded` is not `MCP_REQUIRED`. `MCP_REQUIRED` is reserved for missing or unavailable MCP capabilities. `DATA_NOT_READY` is used only after the required replay-scoped sections were read and indispensable source data is still missing.

## Save Integrity

The following values always come from `save_target.suggested_payload` and must not be invented or recomputed by the model:

- `backtest_id`
- `step_id`
- `expected_revision`
- `idempotency_key`
- `pack_build_id`
- `contract_name`
- `schema_version`
- `contract_hash`

The compact, manifest, and section reads are read-only and cannot advance the replay revision. `expected_revision` is a strict compare-and-swap copied from `suggested_payload`; the model never increments, repairs or guesses it. Executable intent uses only contract enums and typed parameters. Temporary VETO conditions are `LATEST_ONLY`; only structural INVALIDATION is terminal.
