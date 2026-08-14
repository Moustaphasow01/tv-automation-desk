# Desk Control Plane V2 — Remaining Capability Depth

**Date:** 2026-08-14
**Principle:** every registered product route has a real BFF projection; unfinished depth must remain visible as partial/unavailable and never become invented data or a fake action.

## Summary

The 24 route-level backend gaps originally tracked by `TD2-414` are resolved. Six P0 operating projections and eighteen explorer/detail projections now read canonical store/PostgreSQL sources, preserve availability/provenance and enforce strict identifiers with real 404 responses.

This document no longer lists missing pages. It lists the narrower capabilities still required to move from a complete read-oriented Control Plane to the final specialized SaaS experience.

## P0 — authority required before unattended demo/PAPER operation

| Capability | Current truth | Remaining backend work |
| --- | --- | --- |
| Account and capital authority | Portfolio truthfully exposes stale/unavailable snapshots | publish current net liquidation, buying power, margin and authoritative as-of/source |
| Exposure and risk analytics | current risk limits and known positions are projected | publish canonical gross/net exposure, correlation, concentration, attribution and equity curve |
| Broker reconciliation | read projection exists and stays `PENDING`/`PARTIAL` without broker authority | add evidence-backed resolve/retry workflow, revisions, actor/reason and terminal audit receipt |
| Order lifecycle | intent/order/fill relations are readable | publish complete event history and guarded cancel/replace actions with idempotency and reconciliation |
| Incident response | incident details and runbook catalog are readable | implement governed acknowledge/assign/resolve/runbook execution capabilities and audit |

## P1 — specialized product depth

| Domain | Current implementation | Remaining depth |
| --- | --- | --- |
| Research experiments/candidates | real explorer projections and strict experiment/run details | server pagination, saved filters, candidate promotion review and evidence comparison |
| Datasets | real catalog and strict detail with lineage/cutoff/provenance | coverage heatmaps, split explorer, consumer relations and downloadable governed artifacts |
| Strategies/deployments | real catalog, detail, compare and deployment projection | version promotion, shadow/PAPER lifecycle, rollback and drift command workflows |
| Replay | real overview, run ledger, strict run detail and comparison | specialized zoom timeline, pack/decision/setup/trade drill-downs, server pagination and saved comparisons |
| Performance | real overview, calendar, day detail, strategy comparison and trade tape | equity/distribution charts, reject attribution, server pagination and URL-persisted filters |
| Prompts and policies | real prompt hash parity and policy projection | governed create/review/activate/rollback workflows with approvals and effective dating |
| Operations observability | real queue/worker/process/SLO projection | historical SLO series, cost attribution, trace waterfall and governed remediation actions |
| Jarvis | real advisory context | richer citations and explainability; it must remain outside the command authority boundary |

## UX depth still to specialize

The eighteen newly unblocked routes share a reusable `ExplorerPage` for truthful list, focus, breakdown, tags and provenance. This is a deliberate bridge, not the final visual design for every domain. Each domain should replace the generic arrangement only when its authoritative chart/table/actions and full state matrix exist. The shared page must not be forked into copy-pasted hardcoded screens.

## Contract acceptance criteria

Every added capability must provide:

1. a versioned DTO/OpenAPI schema;
2. explicit `KNOWN`/`UNKNOWN`/`STALE`/`PARTIAL`/`NOT_IMPLEMENTED` semantics;
3. stable IDs and real 403/404/409 behavior;
4. source and `asOf` metadata;
5. server pagination/filtering where cardinality is unbounded;
6. backend-owned official status, PnL, R, risk and permissions;
7. bounded indexed reads with partial degradation;
8. fixtures for complete, partial, stale, forbidden and invalid data;
9. BFF and frontend contract tests;
10. success, error, permission, partial and recovery E2E for every new mutation.

## Explicit non-gaps

The following are implemented and must not be duplicated under new endpoints: session bootstrap, capability catalog, terminal command lifecycle, all 59 registered routes, Command Center, readiness, sessions, Live/plan/news/timeline/signals, research lab/experiments/candidates/agents/data/compute, strategy catalog/detail/compare/deployments, replay and performance read surfaces, operations queue/workflow/event/runbook/observability, incidents, orders, portfolio, risk, providers, reconciliation, prompt/policy governance, settings/admin and Jarvis advisory workspace.
