# ADR-0049 — External-plan OOS batch transport

Status: implemented incrementally on feature/oos-batch-mcp-v1; deployment not enabled.
Owner: simulation technical orchestration. Consumers: operator UI and CLI.

The user-provided OOS_BATCH_MCP_V1 specification supersedes legacy analytical conventions
for this workflow. A dedicated desk-oos-batch package owns technical day states and
provenance only. It imports no legacy strategy, analysis, risk or fill engine. TradingView
V3.9.8 computes the simulation in PORTEFEUILLE_REALISTE. Scenario Builder is external.

PostgreSQL owns day checkpoints and technical events. An exclusive filesystem archive
stores immutable PNG/text/JSON integration artifacts under batch/month/day. Each batch
has its own archive namespace so that plans and results cannot overwrite a previous run.
No desk_documents table, live signal bus or broker capability is used.

Syntax validation is an explicit external parser port: the supplied specification contains
no complete SMC3 grammar. Its receipt must identify SYNTAX_ONLY and bind date, symbol,
schema, engine version and exact plan SHA-256. No guessed scenario grammar or trading
validation is introduced. Missing ports fail visibly; no model fallback or mock production data.

The caller supplies the premarket cutoff; the specification does not define its hour.
V1 is July/August 2026 in Europe/Paris, both UTC+02:00. Enumerate calendar dates without
guessing an exchange calendar; unavailable sessions are technical provider results.

Rejected: Master/AV4 adapters, canonical desk simulation, prompts and heuristics; all would
change the user's external plan workflow. No new infrastructure technology is required.
Tests enforce immutable bytes, anti-hindsight allowlists, freeze barriers, resumption,
exclusive chart access, no legacy imports and no invented audit metrics.

Operator-authorized session exhaustion uses existing COMPLETED with an explicit
UNSCORABLE_MARKET_GAP classification, not a fabricated ENGINE result. Native scoped
bar timestamps prove missing session coverage; a separately hashed technical receipt
retains it without seven performance artifacts. Such days remain in coverage but are
excluded from every performance aggregate. See oos-market-session-gap-runbook.md.
New bundles may carry explicitly supplied pre-cutoff calendar evidence. Existing
bundles and frozen plans are never retrofitted or repaired by this mechanism.
