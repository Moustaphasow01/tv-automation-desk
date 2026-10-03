# OOS native replay cutoff proof

Owner: simulation transport adapters; consumers: frozen-plan Replay Worker and technical batch projection.
No ENGINE, SMC3, analyst, plan, PREMARKET or trading-rule change. No migration or MCP/OAuth change.

The PREMARKET capture adapter retains its strict CLOSED_ONLY behavior. Replay now positions the chart
on the contractual M15 timeframe before selecting its initial boundary. Its independent bounded proof
uses the native visible bar open/close sequence, stopped replay, symbol, timezone and stable snapshots.
`currentDate()` is a selection anchor, not reliable evidence of visible candle progress. It is retained
in diagnostics but cannot certify a post-cutoff candle or reject a valid native closed-bar boundary alone.
Cached candles on a disconnected data/replay session cannot certify a cutoff. A bounded initial retry
uses TradingView's native data connection `connect()` without page reload, leaving the historical replay
and pending selection intact. It never stops replay, advances a bar or edits ENGINE inputs. Diagnostic
fields distinguish selection date, UI anchor, actual candle clock and data/replay connectivity.

For 09:00 Paris on 2026-07-01 the last fully known M15 bar is 06:45–07:00 UTC; the first simulated bar
must open at 07:00 UTC. A bar crossing this boundary or a stale timeframe fails explicitly. A persisted,
hash-bound progressed session is resumed through the existing reconciler; initial positioning is prohibited
when a progress record contains completed steps. No broker tools, plan regeneration or PREMARKET repair.

Failures include observed native bar clocks, UI anchor, expected first bar, every proof predicate, progress,
retries and browser/session state. The accepted proof is retained inside `tv_replay_state.cutoff_proof`.
The batch projection reports running/capturing/completed states before queue state, then QUEUED, and
FAILED_TECHNICAL for failures at replay/capture checkpoints. It never regresses these failures to NOT_REQUESTED.

Deploy with the existing health-gated Windows release switch and retained rollback. Verify the frozen
hash, PREMARKET bytes and 27/28/29 metadata before/after the single authorized July 1 retry. Read results
only after COMPLETED; verify all seven ENGINE-published artifact hashes and dedicated panel geometry.

Validation 2026-10-03: July 1 advanced through 44 M15 steps to CAPTURING_RESULTS then COMPLETED.
The frozen plan `bbe78c01c6cdee44264ae3ca063eee7cc6743273b750a50a95a9aeafcdaddcba`,
all PREMARKET bytes and July 27/28/29 identities/revisions stayed unchanged. Seven published artifacts
passed SHA-256 verification; both native 28x7 dedicated panes were complete with zero clipped cells.
Audit source was ENGINE_PUBLISHED_ONLY, recalculated=false. Repeated retry returned one command ID.
125 local OOS tests passed; two real PostgreSQL tests passed after the active chart lock was released.
Architecture, MCP slices and Windows deployment guards passed. The static-quality guard still fails
on pre-existing debt (271 oversized, 728 high-complexity, 97 duplicate blocks and the legacy front file);
this patch adds none of those violations. No runtime/SMC3 contract drift or new migration.
