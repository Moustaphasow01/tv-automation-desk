# Front Agent Actions Required

Date: 2026-08-14
Scope: UI/UX-only gaps that should not be solved by changing backend truth.

The backend/compliance programme owns contracts, source of truth, permissions, allowedActions, risk, order intent, execution lifecycle and audit. The front agent owns visual presentation, interaction design, accessibility and operator usability.

## FRONT-001 — Demo/Paper readiness cockpit

Priority: P0
Screen: Command Center / Settings / Execution
Backend contract ready?: **PARTIAL**
Current behavior: Readiness blockers exist in backend gates, but the operator needs a compact visual cockpit to understand why Demo/Paper is blocked.
Required behavior: Display gate result, blockers, warnings and exact operator actions. Do not allow the UI to clear backend blockers.
Acceptance criteria:

- Shows data freshness, Telegram, operator PIN, provider, kill switch, execution mode and live authorization state.
- Uses backend capabilities/allowedActions.
- Unknown values render as `UNKNOWN`, `UNAVAILABLE`, `STALE` or `NOT_IMPLEMENTED`; never as green/false-safe.
- Provides links/actions only when backend says they are allowed.

Blocking lot: 022 / 024

## FRONT-002 — Semi-manual OrderIntent detail

Priority: P0
Screen: Execution / Live Trading
Backend contract ready?: **PARTIAL**
Current behavior: The front can present execution state, but operator-specific manual workflow needs a clear OrderIntent detail screen.
Required behavior: A dedicated zoom/detail page for one OrderIntent, not a cramped side panel.
Acceptance criteria:

- Shows lineage: StrategySignal → ContextGateDecision → PortfolioDecision → RiskDecision → TargetPosition → OrderIntent.
- Shows immutable post-risk fields and their revision.
- Shows Human Gate status, expiry and allowed actions.
- Shows theoretical vs manual/broker state separately.
- Shows ACK/FILL distinction explicitly.
- Wrong revision, expired, stale and missing permission states are visually fail-closed.

Blocking lot: 012 / 013 / 024

## FRONT-003 — Telegram/manual action mirror

Priority: P1
Screen: Execution / Notifications
Backend contract ready?: **PARTIAL**
Current behavior: Telegram alerts are backend-side notifications. The UI needs to mirror the same information and expose manual status when supported.
Required behavior: Show the exact alert content, delivery state and operator follow-up commands/status.
Acceptance criteria:

- Alert copy is readable and action-oriented.
- Manual `PLACED`, `FILLED`, `SKIPPED`, `CLOSED` states are shown only when backend supports them.
- UI never treats Telegram delivery as broker fill.
- Correlation ID is visible for audit.

Blocking lot: 012 / 016 / 022

## FRONT-004 — Reconciliation mismatch visibility

Priority: P0
Screen: Execution / Reconciliation / OrderIntent detail
Backend contract ready?: **YES**
Current behavior: Backend can represent expected vs actual mismatch, but it must be impossible to miss in the operator UI.
Required behavior: Mismatch stays visible until explicitly resolved through backend workflow.
Acceptance criteria:

- Expected +2 / actual +3 renders as mismatch, not normalized.
- Provider ACK without FILL renders as open/not filled.
- Partial fill renders distinct from full fill.
- Unknown provider state renders degraded and read-only where necessary.

Blocking lot: 012 / 013 / 018

## FRONT-005 — VNext VPS UAT checklist

Priority: P0
Screen: All VNext top-level areas
Backend contract ready?: **PARTIAL**
Current behavior: Local build and tests are green, but VPS human UAT remains external.
Required behavior: A visible checklist or runbook-driven UAT pass for Command Center, Research Lab, Strategy Center, Live Trading, Jarvis, Execution and Settings.
Acceptance criteria:

- Each top-level area loads from BFF.
- Each area has stale/degraded/read-only state.
- Critical actions are gated by backend permissions and step-up.
- Rollback to legacy route is documented and tested.

Blocking lot: 014 / 024

## FRONT-006 — Jarvis read-only/sensitive action affordance

Priority: P1
Screen: Jarvis
Backend contract ready?: **PARTIAL**
Current behavior: Jarvis authority is guarded in backend policy, but UX must clearly separate read-only diagnostics from sensitive actions.
Required behavior: Jarvis defaults to read-only; sensitive actions require explicit backend step-up and human confirmation.
Acceptance criteria:

- Jarvis cannot visually imply that it can directly trade.
- Prepared commands are shown as proposals only.
- Sensitive actions show confirmation and backend authorization state.

Blocking lot: 015 / 024

## FRONT-007 — Real-time degraded/resync presentation

Priority: P1
Screen: Global shell / live widgets
Backend contract ready?: **YES locally**
Current behavior: SSE event metadata exists; UX must make sequence gaps and resync states understandable.
Required behavior: Display disconnected/reconnecting/resynced/degraded states without inventing business transitions.
Acceptance criteria:

- Duplicate/out-of-order/gap state has clear UI.
- Gap triggers degraded + refetch/resync message.
- UI does not patch missing events with guessed state.

Blocking lot: 013 / 016

## FRONT-008 — Static quality/refactor coordination

Priority: P2
Screen: Shared front architecture
Backend contract ready?: **N/A**
Current behavior: `guard:static-quality` is green by baseline, not by full debt burn-down.
Required behavior: Future front refactors should burn down complexity without changing business truth.
Acceptance criteria:

- Refactor is behavior-preserving.
- No business logic moves into the frontend.
- Tests remain green.

Blocking lot: 017
