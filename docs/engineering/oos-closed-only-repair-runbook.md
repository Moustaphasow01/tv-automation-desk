# OOS CLOSED_ONLY capture integrity

Owner: simulation / desk-oos-batch. No analytical, Pine, parser, portfolio or execution changes.

## Incident and correction

2026-08-20 H4 global was pinned to 06:00Z; zoom reset replay selection to the 07:00Z
premarket bound. `setTimeframe` only checked `last_bar_close <= cutoff`: a snapshot already
ending at 06:00Z passed without snapping its effective cutoff to that close. The old validator
also accepted this exact discrepancy. A synthetic, read-only reproduction confirms both paths.

The capture adapter derives the complete close from TradingView's native last-bar clock and
pins it per timeframe until the premarket identity changes. Global and zoom share that bound.
Both sides of the screenshot require stable, scoped native observations with last-bar close
exactly equal to the effective bound. Provisional bars and inclusive timestamps are refused.
TradingView's observed exclusive cursor has whole-second precision (05:59:59Z for 06:00Z);
it is retained as observed, not invented as 05:59:59.999Z. All timestamps remain explicit UTC.

## Targeted recovery

`repair_oos_aug20_h4_zoom.mjs` is an operator-only, fixed-date operation. It assembles only
the capture bridge, with denied builder/validator callbacks and no replay bridge. The day lock
excludes plan submission; the chart lock excludes concurrent UI capture. Both registry and
plan metadata must prove no frozen plan. Any frozen evidence raises
`FROZEN_BUNDLE_INTEGRITY_VIOLATION`; do not replace or replan it.

Only `premarket/4h_zoom.png`, its evidence receipt and `premarket/manifest.json` can change
for this command. The other seven records and files are verified and remain unchanged.
Each old file is kept under a hash-bound `evidence/premarket-repair-<old manifest hash>/`
directory. A durable replacement journal allows recovery after any interrupted file publication.
PostgreSQL revision/hash guards commit only the unfrozen manifest identity, without reading
or writing result columns. A repeat consumes the journal and makes no new capture.

Migration 074 adds immutable technical repair receipts and a transaction-local authorization
for a revision-checked, unfrozen PREMARKET_READY manifest replacement. The real PostgreSQL
test showed that the original trigger also protected non-null unfrozen hashes. Its protection
remains unconditional for frozen plans, definitions and every non-authorized update. Only the
manifest hash, revision and update timestamp may change in an approved capture repair.
Do not delete quarantined evidence or reset a day. No new MCP tool is needed.
Rollback code using the deployment receipt; data rollback must use the retained original bytes
and a separately authorized operation, never a frozen plan rewrite.

## Verification

- Audit all July/August premarket manifests, eight image hashes, saved capture proofs,
  CLOSED_ONLY bounds, pair equality and manifest/registry hashes; never read replay artifacts.
- Inspect the rebuilt H4 zoom pixels and native bar time at the verified exclusive cutoff.
- Refuse Phase A if a frozen defect is found or a pixel/provenance check remains unproven.
- Tests cover the exact stale/partial H4 observations, paired bounds, summer/winter offsets,
  provisional rejection, idempotent single capture, preservation, frozen refusal and interrupted repair.
- The adapter's waits are injectable; unit tests use no real sleeps or network.
- Touch-and-improve: stricter provenance replaces the permissive inequality; manifest construction
  and capture-record mapping are extracted once and shared by normal capture and repair.
