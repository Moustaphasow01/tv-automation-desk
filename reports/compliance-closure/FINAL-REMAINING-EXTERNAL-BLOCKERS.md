# Final Remaining External Blockers

Date: 2026-08-14
Programme: Trading Desk Transformation V2 — Lots 013 → 024

This file lists blockers that cannot be honestly closed from local repository evidence alone.

## Blocker B-001 — Durable TradingView live data

BLOCKER ID: `B-001`
LOT: 011 / 022 / 024
SYSTEM: TradingView → webhook → PostgreSQL data engine
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: The local demo-paper readiness gate observed stale/non-durable live market data and rescue-source usage. Repository code cannot prove that the currently deployed TradingView alerts are fresh, durable and correctly routed.
EXACT HUMAN ACTION: Verify that batch/realtime TradingView alerts are active, non-delayed where required, routed to the current VPS/backend webhook, and cover MNQ/MES plus required context symbols.
EXPECTED PROOF: Fresh MNQ/MES M1/M5 rows and durable source markers in `/status` or DB health output; successful `doctor:tradingview`; successful demo-paper data freshness gate.
WHAT IT UNBLOCKS: Live Strategy runtime, Demo/Paper readiness, front freshness indicators, Shadow/Paper comparisons.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-002 — Telegram trading/manual execution channel

BLOCKER ID: `B-002`
LOT: 012 / 016 / 022 / 024
SYSTEM: Telegram bot/channel
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Telegram service and message contracts exist, but real bot token/channel wiring cannot be proven without credentials and a delivered message on the operator channel.
EXACT HUMAN ACTION: Configure the Telegram bot token/chat/channel on the VPS environment, start the alert worker, and trigger a test OrderIntent notification.
EXPECTED PROOF: Delivered Telegram message containing side, instrument, entry, stop, targets, risk, mode and explicit manual-action wording; runtime log with correlation ID; no broker command sent by the alert.
WHAT IT UNBLOCKS: Semi-manual operator workflow and Demo/Paper readiness.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-003 — Operator PIN / step-up configuration

BLOCKER ID: `B-003`
LOT: 013 / 014 / 022 / 024
SYSTEM: VNext / BFF / operator auth
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: The release gate requires an operator step-up/PIN configuration. The local strict gate reports this as missing.
EXACT HUMAN ACTION: Configure the operator PIN/step-up secret in the target environment and verify backend session/capability refresh.
EXPECTED PROOF: `gate:demo-paper-release` no longer blocks on `vnext-operator.operator.pin_configured`; authenticated VNext command preflight shows step-up requirements from backend.
WHAT IT UNBLOCKS: VNext critical command UAT and controlled Paper/Semi-manual release.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-004 — VPS release and runtime validation

BLOCKER ID: `B-004`
LOT: 014 / 022 / 024
SYSTEM: Windows VPS / services / Caddy / PostgreSQL / workers
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Local repository tests are not equivalent to a deployed VPS runtime proof.
EXACT HUMAN ACTION: Build a release artifact, deploy to VPS, run DB migrations, restart services, validate front, BFF, SSE, scheduler, Telegram worker, data ingestion and health endpoints.
EXPECTED PROOF: Release logs, service status, `/status`, `/front-api/v1` checks, SSE reconnect test, VNext route proof, and no Demo/Paper strict blockers except explicitly accepted policy gates.
WHAT IT UNBLOCKS: Production-like Shadow/Paper run.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-005 — Paper provider / Sim101 proof

BLOCKER ID: `B-005`
LOT: 005 / 012 / 018 / 022 / 024
SYSTEM: NinjaTrader Sim101 or replacement provider paper environment
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Provider-domain tests are green, but no real provider ACK/PARTIAL_FILL/FILL/REJECT/reconciliation sequence can be faked.
EXACT HUMAN ACTION: Connect the provider in a paper/simulation account only, then execute a controlled test matrix with small paper quantities.
EXPECTED PROOF: Provider events for ACK, reject, optional partial fill, fill and reconciliation; proof that ACK does not mutate physical position; no duplicate send on retry/restart.
WHAT IT UNBLOCKS: Provider certification and future Paper mode.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-006 — Strategy P0 profitable vertical slice

BLOCKER ID: `B-006`
LOT: 007 / 008 / 009 / 022 / 024
SYSTEM: Research Lab / Simulation / Shadow / Paper
STATUS: **BLOQUÉ EXTERNE + PARTIEL LOCAL**
WHY BLOCKED: Repository-side Research objects and gates exist, but a candidate cannot be considered deployable until it passes a full data-backed vertical slice with real artifacts.
EXACT HUMAN ACTION: Select one P0 Strategy_ID, run Hypothesis → Research Mission → Strategy Spec → Strategy Version → Dataset → Baseline → Screening → Simulation → Train/Validation/OOS → Robustness → Portfolio Fit → Shadow → Paper decision.
EXPECTED PROOF: Run Registry artifacts with dataset version, engine version, trades, costs, slippage, PF, expectancy, max DD, OOS, stress tests, promotion decision and approval.
WHAT IT UNBLOCKS: First strategy promotion.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-007 — Alternative provider credentials/certification

BLOCKER ID: `B-007`
LOT: 018 / 019 / 024
SYSTEM: Tradovate / Rithmic / PickMyTrade or future provider
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Provider-neutral code exists, but real provider API credentials, paper environment and certification proof are external.
EXACT HUMAN ACTION: Provide credentials for the selected paper provider and authorize a paper-only certification matrix.
EXPECTED PROOF: Provider command lifecycle, idempotence, reconnect/restart, fill/reject/cancel/position/reconciliation and rollback proof.
WHAT IT UNBLOCKS: Replacement provider certification and future NinjaTrader retirement.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-008 — NinjaTrader retirement decision

BLOCKER ID: `B-008`
LOT: 019 / 024
SYSTEM: Execution provider strategy
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: NinjaTrader must remain until a replacement provider is certified and rollback is proven.
EXACT HUMAN ACTION: Approve retirement only after B-007 is complete and an observation window validates the alternative route.
EXPECTED PROOF: Signed retirement decision, dependency scan with no critical direct NinjaTrader paths, rollback drill and provider certification artifacts.
WHAT IT UNBLOCKS: Removal of NinjaTrader transition dependency.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-009 — Real DB cleanup / retention approval

BLOCKER ID: `B-009`
LOT: 021 / 024
SYSTEM: PostgreSQL production/preprod data
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Dead-path cleanup must not delete audit, replay, research or reconciliation history without a real snapshot and retention decision.
EXACT HUMAN ACTION: Take a DB snapshot/export, approve retention rules, run cleanup in dry-run, inspect rows, then apply under maintenance.
EXPECTED PROOF: Snapshot ID/path, dry-run report, approved deletion list, apply log and post-cleanup counts.
WHAT IT UNBLOCKS: Legacy data/table cleanup.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-010 — Front VNext human UAT

BLOCKER ID: `B-010`
LOT: 013 / 014 / 024
SYSTEM: Front VNext
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: Automated build/guards do not prove operator usability on the target machine.
EXACT HUMAN ACTION: Operator UAT on VPS for Command Center, Live Trading, Research, Strategy, Execution, Settings, stale/degraded state, Human Gate and rollback.
EXPECTED PROOF: UAT checklist screenshots/logs and no critical workflow blockers.
WHAT IT UNBLOCKS: VNext cutover.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Resolved note B-011 — Jira direct-key verification

BLOCKER ID: `B-011`
LOT: 013 / 024
SYSTEM: Atlassian Jira TD2
STATUS: **RÉSOLU POUR ACCÈS DIRECT / SEARCH GÉNÉRIQUE ENCORE DÉGRADÉ**
WHY BLOCKED: Historical note only. Generic Rovo search still returns `INVALID_ARGUMENT`, but direct ARI/key access works for `TD2-416`, `TD2-417` and related TD2 tickets.
EXACT HUMAN ACTION: None for direct issue updates; continue using direct ARI/key access until generic search is repaired.
EXPECTED PROOF: `reports/compliance-closure/2026-08-14-jira-sync-after-lot-024.md`.
WHAT IT UNBLOCKS: Safe Jira comments/status updates tied to technical proof.
CRITICAL / NON-CRITICAL: **NON-CRITICAL**

## Blocker B-012 — Spring Boot deviation approval

BLOCKER ID: `B-012`
LOT: 023 / 024
SYSTEM: Architecture governance
STATUS: **BLOQUÉ EXTERNE**
WHY BLOCKED: The repository uses Node.js, while the original requirement named Spring Boot. A proposed ADR exists but requires operator decision.
EXACT HUMAN ACTION: Approve or reject ADR `0028-node-backend-control-plane-over-spring-boot-proposed.md`.
EXPECTED PROOF: ADR status changed from proposed to accepted/rejected with decision rationale.
WHAT IT UNBLOCKS: Classification of the Spring Boot requirement as `ACCEPTED DEVIATION` or explicit future migration item.
CRITICAL / NON-CRITICAL: **NON-CRITICAL for current safe operation, CRITICAL for architectural closure**

## Blocker B-013 — AUTO execution authorization

BLOCKER ID: `B-013`
LOT: 022 / 024
SYSTEM: Operating policy
STATUS: **BLOQUÉ EXTERNE / POLICY**
WHY BLOCKED: AUTO execution is explicitly disabled by policy. Repository readiness alone cannot authorize it.
EXACT HUMAN ACTION: Complete every checklist item in `AUTOMATIC-EXECUTION-REACTIVATION-GATE.md`, observe PAPER mode, then provide explicit written authorization.
EXPECTED PROOF: Completed checklist, observation report, operator authorization, rollback plan and kill-switch proof.
WHAT IT UNBLOCKS: Future auto-execution consideration only.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Blocker B-014 — LIVE authorization

BLOCKER ID: `B-014`
LOT: 022 / 024
SYSTEM: Operating policy / broker environment
STATUS: **BLOQUÉ EXTERNE / POLICY**
WHY BLOCKED: LIVE is explicitly not authorized.
EXACT HUMAN ACTION: Separate live authorization after Paper observation, strategy validation, risk approval, provider certification and rollback proof.
EXPECTED PROOF: Signed live authorization, environment isolation, account allowlist, kill-switch proof and deployment checklist.
WHAT IT UNBLOCKS: Live trading consideration only.
CRITICAL / NON-CRITICAL: **CRITICAL**

## Immediate unblock order

1. Restore durable TradingView freshness.
2. Configure Telegram trading/manual channel and send a test alert.
3. Configure operator PIN/step-up.
4. Deploy the release to VPS and run runtime gates.
5. Run one Strategy_ID P0 vertical slice through Research → SHADOW.
6. Only then consider Paper provider certification.
