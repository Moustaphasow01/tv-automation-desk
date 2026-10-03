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
