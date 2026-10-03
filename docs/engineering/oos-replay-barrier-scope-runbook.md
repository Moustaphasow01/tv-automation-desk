# OOS native M15 barriers and immutable replay scope

Owner: simulation / desk-oos-batch. Incident: 2026-07-03 overshoot and resume mismatch.
Consumers: frozen replay worker and its PostgreSQL technical checkpoints.

## Boundary and placement

`oos-replay-barrier.js` proves native M15 sequences; `oos-replay-scope.js` hashes
immutable technical identity; `oos-replay-recovery.js` owns bounded TradingView
reattachment/seek. They live beside the existing host provider adapter, not in the
trading kernel. `OosReplayProgress` persists proved cursor/diagnostics; the package
PostgreSQL adapter packs extensible fields into existing `tv_replay_state` JSONB.
No migration, MCP/OAuth change, parser, ENGINE, plan, risk or PREMARKET mutation.

Rejected alternatives: accept currentDate as progress; count every newer candle as
one step; compare ephemeral browser IDs as immutable identity; fabricate missing
bars; shorten the plan session window; publish a provisional ENGINE dashboard.

## Proof and recovery

The next open equals the last confirmed M15 close. A multi-bar response is accepted
only when every native timestamp from that barrier to the observed candle is present,
ordered and 900 seconds apart, within the session barrier. Counters count proved bars.
Scope contains date, symbol, exact frozen plan and manifest hashes, engine/book,
execution timeframe, cutoff and session end. Canonical sorted keys survive JSONB
reordering. Browser and native replay session IDs are attachment metadata only.

Legacy checkpoints can be adopted after their server-owned date/plan, cutoff proof,
target and installed ENGINE configuration are verified. A different immutable scope
fails before UI mutation. A replaced/lost attachment or unproved overshoot can seek
the last confirmed close only for an unpublished run, retaining exactly the plan.
Restore proves stable paused M15 bars, original cutoff/first simulation-bar history
and unchanged ENGINE inputs. A completed replay receipt forbids such a seek.

Diagnostics include expected/observed open and close, target, native sequence,
previous confirmed candle, requested and actual advance counts, cursors, browser/TV
attachment, counts and reason. No raw plan, secret or price/result calculation.
Recovery/step retries are bounded by existing timeout settings. A known missing
native session bar fails before another mutation: `TV_REPLAY_SESSION_BAR_UNAVAILABLE`.
It is not mislabeled as an immutable mismatch or as a successful final session.

## July 3 evidence and honest completion gate

Persisted baseline: 40 confirmed steps, last open 2026-07-03T16:45Z, close17:00Z;
target18:00Z (20:00 Paris). Native consecutive indices show the next candle at
2026-07-05T22:00Z. The previous failure was a single native jump over absent candles,
not necessarily duplicate commands. Its out-of-window cursor then hit the old
generic resume-scope predicate with empty diagnostics, despite identical plan.

ENGINE source (unchanged pinned source) sets `finalAudit` only when `time_close >=
sessionPlan.entryEnd` (line2058). If the restored session has no candle reaching that
end, capture/publication must remain blocked. Neither a fabricated candle nor a new
session/plan date is an infrastructure fix. Resolving that calendar/end contract
requires explicit approval; this worker must not decide a trading-session exception.

## Validation, deployment and rollback

Run `node --test mcp_gpt_desk/test/oos_*.test.js packages/desk-oos-batch/test/*.test.js`,
plus real PostgreSQL tests with an isolated generated schema. Verify canonical scope
roundtrip, exact barriers, gaps, ephemeral replacement, seek, idempotence, original
bytes, no pre-COMPLETED result reads and unchanged other-day revisions. Run architecture,
MCP slice, deployment and static-quality guards; disclose legacy guard debt.

Deploy the branch with the explicit replay allowlist in `Update-OosReplay.ps1`.
Health-gated release/config rollback retains all frozen archives/checkpoints. The
new metadata uses existing JSONB; no broad delete/reset or data migration is needed.
Tests increase coverage of technical proof and split scope/barrier/recovery ownership,
instead of adding a second simulation/trading engine. No ADR boundary change.

Validation snapshot before real retry: 44 focused tests passed, then the full OOS
suite passed with 140 tests and two PostgreSQL tests skipped locally (no local DB).
Two additional canonical-order/gap-idempotence cases and real PostgreSQL roundtrip
checks were added before final deployment. Architecture, MCP slices and Windows
deployment guards pass. Static-quality remains blocked by pre-existing repository
debt (front projection1726 lines, oversized functions271, duplicate blocks97);
the touched replay initialization/scope/recovery functions are kept within the new
code budgets, with no waiver or relaxed guard. See actual command results for the
final test counts and deployed incident checkpoint. Final local suite: 144 tests,
142 PASS / 2 PostgreSQL SKIP / 0 FAIL. High-complexity function count falls from728
to727; other legacy debt budgets are unchanged. No quality baseline was relaxed.
