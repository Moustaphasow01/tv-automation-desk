# Desk OOS Forensic API V2

Owned by `packages/desk-oos-batch`; branch `feature/oos-batch-mcp-v1`. No new service, SQL migration, market collection, trading logic or OAuth change.

## Source boundary

The MCP exposes 31 additional `desk.read` tools alongside the existing 16. `ForensicApi` receives only an index reader, an archive reader and the existing registry's read methods. It receives no replay, capture, plan writer, engine, broker or risk provider. Every forensic tool advertises `readOnlyHint=true`, `openWorldHint=false`.

`build_oos_forensic_index.mjs` is an offline operator job, not a tool. It reads completed frozen OOS days, verifies their original plan/manifest/image/result hashes and writes only `archive_root/forensic-index-v2/`. Original OOS files and business tables are baseline-hashed before/after indexing and public acceptance. Active OOS commands block indexing. Content-addressed day files and a catalogue avoid rescanning Pine Logs on each MCP request. The catalogue pointer is atomically replaced; query cursors bind catalogue hash and filters. Rebuilding identical sources is idempotent.

## Facts and missing data

- `FACT_PLAN`: original frozen text and raw record slices, UTF-8 byte offsets; no parser mutation, defaults or plan repair.
- `FACT_ENGINE`: persisted `SMC_AUDIT`, `SMC_SHADOW`, native AUDIT/POSITIONS cells and A395 trade publications. Numeric financial values are parsed, never calculated independently.
- `FACT_MARKET_PERSISTED`: existing technical native-session-gap receipt. It does not become an ENGINE performance result.
- `ARTIFACT_VISUAL`: archived PNG pixels; exact SHA checked at retrieval.
- `DERIVED_LOCAL`: identifiers, indexing, duplicate publication aliases, event grouping, previous published stage and lossless crops. These are explicitly labelled, not new ENGINE events.

Exact duplicate JSONL publications retain every original byte offset but do not add fills or attempts. M15 publication time is separate from ENGINE `event_from/event_to` intrabar times. Shadow publication close time is explicitly derived from its outer M15 bar timestamp. First STEP completion does **not** prove first condition evaluation. Missing INV/GUARD evaluations, continuous market bars, full portfolio/risk snapshots, ticket expiry proofs and unreported excursion prices return `available=false, reason=NOT_PERSISTED`; no inference from screenshots or future data.

The deployed corpus stores native tables in `replay/audit.json`, render bounds in `replay/run_meta.json`, logs in `replay/logs.txt` and hashes in `evidence/result-integrity.json`. No pre-existing episode/event ledger files or continuous OOS M1/M5/M15 series were found. `get_forensic_capabilities` distinguishes the derived index from original persistence. Sparse OHLC in event messages remains accessible through `get_forensic_events`, never masquerades as a complete series.

`get_level_interactions` and time-coordinate crops explicitly return NOT_PERSISTED when their prerequisite series/mapping is missing. Coordinate crops decode existing PNG pixels without OCR, resampling or source writes; unsupported PNG formats fail explicitly. PNG payloads are actual MCP image blocks. JSON/TXT artefacts return exact UTF-8 text plus parsed JSON where relevant.

July 3 remains `UNSCORABLE_MARKET_GAP`; its frozen plan and technical coverage remain visible, performance artefacts absent. July 30 remains `TECHNICAL_SMOKE`. Neither receives invented metrics.

## Operator commands

Run with the existing secret environment file (never print its content):

```powershell
node --env-file=C:\ProgramData\DeskOos\config\oos.env mcp_gpt_desk/scripts/build_oos_forensic_index.mjs
node --env-file=C:\ProgramData\DeskOos\config\oos.env mcp_gpt_desk/scripts/verify_oos_forensics.mjs
```

Public acceptance invokes only forensic tools through the authenticated HTTPS MCP client, including exact PNG/text hashes, table cells, all requested exemplar days, cross-day references and T0→T4 published event links. A missing market path stays missing. Whole-corpus business and original-file fingerprints must remain unchanged.

Deployment uses `Update-OosForensics.ps1`: allowlisted/hash-checked files, isolated release/package junction, offline index preparation, only `DeskOos` restarted, public acceptance required, prior release restored on failure. No change to replay enablement, URLs, OAuth, TradingView or stable trading services. Reindexing is operator-controlled, never silently triggered by a read.

## Client path

`get_forensic_index` → `list_forensic_scenarios` → `get_scenario_forensic_packet` → targeted conditions/ticket/refusal/events → optional persisted market window → optional crop → trade publication. Pagination defaults to 50, maximum 200; cursors are opaque, immutable-generation-bound. Cross-day search returns audited references only. `verify_forensic_integrity` rehashes original sources; missing/tampered files fail rather than being repaired. `get_forensic_provenance` resolves source, event, episode and trade references back to immutable source hashes.

The API makes no trading conclusions and does not invent counterfactual policies. REAL/BE0.5/BE1/BE1.5/P1@1R values are exclusively the ones already published by V3.9.8.
