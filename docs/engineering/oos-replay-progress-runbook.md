# OOS replay progress recovery

Owner: simulation / desk-oos-batch; incident TV_REPLAY_STEP_TIMEOUT.

TradingView `currentDate()` stays on the selected historical anchor while `doStep()`
publishes subsequent closed historical bars. OOS now proves progression from the
last bar open plus the current timeframe, not from that anchor. PREMARKET is unchanged.

`oos_replay_progress` is additive technical storage, keyed by day and pinned plan
identity. A retry reconciles the installed plan hash, book, replay anchor, chart,
timeframe and persisted cursor before any step. A progressed replay is never reset
or reloaded; lost or regressed state fails closed. Existing chart/day advisory locks
still serialize all UI mutations. `request_replay(date)` already maps technical
failures to the durable `retry` command with a revision-scoped idempotency key.

Optional `replay_timeouts` in OOS configuration: `command_ms=120000`,
`ui_transition_ms=30000`, `progress_ms=90000`, `final_render_ms=60000`,
`capture_ms=60000`, `poll_ms=500`, `retry_backoff_ms=1000`, `max_retries=2`.
Timeouts are transport/watchdog limits, not trading expiry rules. After a timeout,
read actual bars before issuing another step. Stop after bounded attempts.

Deploy through `deploy/windows/Update-OosReplay.ps1`; it applies migration 073,
checks patched JS and creates a recoverable release. No Pine/parser, OAuth or stable
service changes. Rollback restores the previous service/config; leave the additive
progress table in place. Never edit a frozen plan or reset a progressed chart to retry.

Diagnostics include stage, actual/target time, selection anchor, confirmed bar,
step count, last success, timeout budgets, UI/loading/modal, session, MCP error codes
and retry count. Secrets and raw plans never enter diagnostics. Results are still
ENGINE-only and must pass the existing dedicated-panel and artifact hash gates.

Debt reduction: removed the fixed 80-poll anchor-based awaitStep loop; new deterministic
tests cover late success, uncertain commands, bounded stalls and crash reconciliation.
