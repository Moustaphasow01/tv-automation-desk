# Evidence review — 49 legacy theoretical reservations

Date of review: 2026-09-07
Scope: read-only inspection of the 49 non-adjudicated reservations reported as `EXPIRED`. No database write, closure, candle acquisition, import, or new execution engine was performed.

## Conclusion

`EXPIRED` is only lifecycle state; it is not evidence that an entry never filled.

- The production database alone contains a complete, contiguous M1 entry window for **3/49** intents. The pinned theoretical engine reconstructs all three as **unfilled entry expiry**.
- The database window is incomplete for **46/49**: 44 June MES/MNQ windows have no M1 candle at all, one MES window is missing one minute, and one ZW window is missing one minute.
- An already sealed, native TradingView snapshot observed on 2026-09-06 supplies the missing ZW minute. In that pinned snapshot the fourth ZW window is 29/29, its maximum high is 739.75 versus a 743.50 sell limit, and the existing engine also returns `expire_entry`. Its 28 overlapping rows are exact matches with the database; only 16:18 UTC was absent from the database.
- Consequently, current evidence determines an expiry price path for **4/49**, but does not determine fill/expiry for the other **45/49**. It proves no fill-and-close path for any of the 49.
- None of the four is presently repairable end-to-end by an existing safe application command: three already have terminal `entry_expired` events whose null candle provenance is returned idempotently rather than upgraded; the fourth candle exists only in a sealed research artifact and the approved importer does not accept ZW.

The four reconstructions are evidence known now, not evidence that the application knew the bars at the original expiry. The production rows have no immutable raw-event/timing-provenance identifier, while the complete ZW research artifact is a later observation. Any future correction must therefore be append-only and effective/known at correction time; it must not backdate availability.

## Inventory and M1 coverage

Every identifier below has prefix `portfolio_order_intent_`. Times are UTC. `DB M1` is the exact contiguous entry window currently present in production. Pairs share the same entry window.

| Instrument | Requested → expiry | Count | Identifier suffixes | Required M1 | DB M1 | Present conclusion |
|---|---|---:|---|---:|---:|---|
| MES | 2026-06-11 22:25 → 22:55 | 2 | `70f02376877771a3022b9fa4`, `77a1f7a204ab3ad365141a14` | 30 | 0 | Unknown |
| MES | 2026-06-11 22:50 → 23:20 | 2 | `0c923c3a83b922f4d80a6c5e`, `3e2849c030de1691c44ed5c4` | 30 | 0 | Unknown |
| MES | 2026-06-11 23:15 → 23:45 | 2 | `8f4a0220de525bf38b3c9bc7`, `6d012323db8212ed526d3ed9` | 30 | 0 | Unknown |
| MES | 2026-06-15 23:40 → 2026-06-16 00:10 | 2 | `80f9d74905c289ee8ce8d181`, `20720434b139cb9c98894d52` | 30 | 0 | Unknown |
| MES | 2026-06-16 13:50 → 14:20 | 2 | `c02439863efe33ef8109fcf7`, `e5f67e04e9fc962b4eb41b2f` | 30 | 0 | Unknown |
| MES | 2026-06-16 15:55 → 16:25 | 2 | `1a13da27d0013946a0126684`, `e338735246434adf7465db6a` | 30 | 0 | Unknown |
| MES | 2026-08-21 00:19:29 → 00:40 | 1 | `835f441215e9bacef59067fd` | 20 | 19 | Unknown; missing 00:23 |
| MNQ | 2026-06-11 22:00 → 22:30 | 2 | `8299c0309ae626dbbb425cd0`, `73e09e0fa56becce69ab58de` | 30 | 0 | Unknown |
| MNQ | 2026-06-11 22:50 → 23:20 | 2 | `3a0568fc18058f23eee3fef8`, `a460441e7c09c0e94245de61` | 30 | 0 | Unknown |
| MNQ | 2026-06-11 23:15 → 23:45 | 2 | `f50f36f67ca1fb2d8823024b`, `88a8c9ebe05032ece3946d5c` | 30 | 0 | Unknown |
| MNQ | 2026-06-12 13:00 → 13:30 | 2 | `259a30ea752e1aad8bbc4ee8`, `5d797ef421aa634eb08d93f0` | 30 | 0 | Unknown |
| MNQ | 2026-06-12 14:40 → 15:10 | 2 | `633759196b9e1761e17fb0d3`, `94d5eb09bd07afa19bbba6d9` | 30 | 0 | Unknown |
| MNQ | 2026-06-12 15:55 → 16:25 | 2 | `9509803ab978a068c5a6c8b6`, `be3d8824dc628960194baf29` | 30 | 0 | Unknown |
| MNQ | 2026-06-12 20:30 → 21:00 | 2 | `ee8af7235a81fc6a03498c23`, `fcfbed13daeef505f82b43c9` | 30 | 0 | Unknown |
| MNQ | 2026-06-15 15:05 → 15:35 | 2 | `0ea9dd4fad4cf56450fb8776`, `f146a789e3404c3104499f60` | 30 | 0 | Unknown |
| MNQ | 2026-06-15 22:50 → 23:20 | 2 | `dd1713137831cf4c46c2f2d1`, `7d60745761fa6c5501e67960` | 30 | 0 | Unknown |
| MNQ | 2026-06-15 23:40 → 2026-06-16 00:10 | 2 | `368a96a957dda3a1451cfa57`, `9344259da28a03e41244f415` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 00:05 → 00:35 | 2 | `e13bea2566cd4675e1be00b3`, `c30d47630b027e93994f6941` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 14:15 → 14:45 | 2 | `83855d7e4db36d623fa66c0f`, `25774467a2f15da5a9bef9eb` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 15:30 → 16:00 | 2 | `2e994bd5cf834a6cb6b34b66`, `9f13cfa0755cce9bdb0566fe` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 15:55 → 16:25 | 2 | `61139eeca5367869285dcf4a`, `9962495f070df65e971f77d4` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 17:35 → 18:05 | 2 | `f3557fd0d980b5dbd19828ab`, `df969e35caef93d77bffd266` | 30 | 0 | Unknown |
| MNQ | 2026-06-16 20:30 → 21:00 | 2 | `64a55fcf5f233f48d3e6c01e`, `2222b2a40409326cc6c62d22` | 30 | 0 | Unknown |
| ZW | 2026-09-04 15:06:46 → 15:20 | 1 | `e6e70aa24ebca40ef5da3f60` | 13 | 13 | Current engine: expiry |
| ZW | 2026-09-04 15:50:45 → 16:20 | 1 | `b0d533eb2ecf6e635a03cb4f` | 29 | 28 | DB unknown; sealed snapshot 29/29: expiry |
| ZW | 2026-09-04 16:51:11 → 17:20 | 1 | `3746a9c932c0f810092cde98` | 28 | 28 | Current engine: expiry |
| ZW | 2026-09-04 17:50:11 → 18:20 | 1 | `d32c58021a7a01da90d135a0` | 29 | 29 | Current engine: expiry |

Production feed bounds explain the large gap. MES and MNQ each have roughly 51,900 M1 rows from 2026-06-10 22:00 through 2026-09-04 18:19, but the first sealed segment stops at 2026-06-11 19:59 and the next begins only at 2026-06-30 22:00. ZW begins on 2026-06-29. Feed existence and broad min/max bounds therefore do not imply window coverage.

Independent state checks found zero provider command, provider event, trade, or fill for all 49. That is consistent with an unfilled population, but it is not used as proof of no fill. Five intents already have a terminal theoretical event; 44 are eligible candidates for the current theoretical service. Every one of those 44 candidates currently lacks a complete production M1 entry window.

## Existing reusable capabilities and their limits

1. `processTheoreticalExecution({ portfolioOrderIntentIds })` can scope the current service to an exact allowlist. Its repository accepts legacy `EXPIRED` gates only when they were expired by `theoretical_execution_sweeper`, and excludes an intent once any terminal theoretical event exists.
2. `latestClosedCandleForIntent` plus `evaluateTheoreticalEntryIntent` already provide the canonical fill/expiry semantics. No-fill expiry requires a complete contiguous M1 entry window. However, the candle adapter searches for a touched candle before checking full-window completeness. It must therefore **not** be used as a generic historical repair runner on incomplete windows: an earlier missing minute could have touched first.
3. `us-grains-theoretical-replay.js` is a useful read-only causal validator for ZC/ZW because it fails closed on gaps in both entry and exit windows. It does not materialize these intents and does not cover MES/MNQ.
4. `export_tradingview_replay_m1_backfill.py` and `import_tradingview_m1_backfill.mjs` form an existing sealed acquisition/import path for MES/MNQ. The exporter reads TradingView Desktop Bar Replay without replay trades; the importer supports dry-run, hashes/signatures, exact conflict rejection, and a serializable transaction. No acquisition was run for this review.
5. The current MES/MNQ exporter covers one Paris date from 00:00 to 22:00. Potential acquisitions for Paris dates 2026-06-12, 2026-06-15, 2026-06-16 and 2026-08-21 could cover 41 of the 45 unresolved intents (40 June intents plus the one-minute MES gap), subject to actual TradingView availability. Four MNQ intents ending at 21:00 UTC fall outside that exporter contract: `ee8af7235a81fc6a03498c23`, `fcfbed13daeef505f82b43c9`, `64a55fcf5f233f48d3e6c01e`, and `2222b2a40409326cc6c62d22`.
6. There is no existing purpose-built, append-only historical repair command for these 49. Existing idempotency preserves terminal rows but cannot enrich their missing candle evidence. The approved sealed importer is MES/MNQ-only, so it cannot ingest the missing ZW minute.

## Safe next decision

Do not release any of the 49 reservations merely from `EXPIRED`, missing provider rows, or a later candle snapshot.

A bounded future recovery can reuse the existing components without inventing outcomes:

1. Freeze the exact intent IDs, current revisions/hashes, engine/policy version, and source feed.
2. Acquire only missing MES/MNQ dates through the sealed exporter; validate hashes and use importer dry-run/conflict checks. Treat capture time as `knownAt` and do not backdate it.
3. Before invoking any mutating service, require one feed with a complete, contiguous M1 entry window and run the existing engine as a read-only preflight. Missing or conflicting minutes remain `UNKNOWN`.
4. If the complete entry path shows no touch, an append-only, versioned correction mechanism is still required for existing terminal events. If it shows a touch, retain the reservation until a complete, contiguous exit path is also proven; the existing production exit scanner alone does not enforce that continuity.
5. The four late MNQ intents (two shared windows) and the ZW import/provenance case require an approved data-adapter or correction contract. They cannot be completed by the currently allowlisted importer.

## Evidence references

- Read-only production entry-window snapshot: `output/research/grains-closure-20260907/49-reservations-entry-evidence.json`
- Read-only lifecycle/service-eligibility snapshot: `output/research/grains-closure-20260907/49-reservations-lineage-evidence.json`
- Read-only evaluation of the sealed fourth ZW window: `output/research/grains-closure-20260907/49-reservations-zw-private-window-evaluation.json`
- Native ZW/M1 snapshot SHA-256: `67f291d9903273a67a6e25445df09b55597e840775d9d87c480e9bffcd148ac5`
- Native/frozen comparison SHA-256: `20d61cd59e5229ecb798cadd6c748703f1e1c7a0dc24bf98798e354951c8df79`
- The pre-existing sealed 2026-06-11 Paris artifact ends at 22:00 Paris (20:00 UTC) and overlaps none of the June intent windows; it cannot close this gap.
