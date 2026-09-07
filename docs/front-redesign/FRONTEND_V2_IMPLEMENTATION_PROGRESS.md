# Desk Control Plane V2 — Implementation Progress

**Last verified:** 2026-08-15
**Application:** `apps/desk-control-plane`
**Local cutover URL:** `http://127.0.0.1:8090`
**Legacy comparison URL:** `http://127.0.0.1:8080`
**Authority:** backend/BFF `/front-api/v1`; no runtime mock mode

## Semi-manual execution slice — TD2-416

| Capability | Front | Backend integration | Evidence |
| --- | --- | --- | --- |
| OrderIntent execution dossier | IMPLEMENTED | PARTIAL — current real `order-detail` projection | route `execution/orders/:orderId` |
| Post-Risk immutability | IMPLEMENTED | n/a | definition-only terms; contract test |
| Execution mode | IMPLEMENTED | BLOCKED — CN-EXE-001 | renders `UNAVAILABLE`, never a local default |
| Human Execution Gate | IMPLEMENTED fail-closed | BLOCKED — CN-EXE-003 | no active action without `allowedActions` |
| Provider lifecycle timeline | IMPLEMENTED | PARTIAL — CN-EXE-004 | current backend events translated; unknown fallback |
| Reconciliation comparison | IMPLEMENTED | BLOCKED — CN-EXE-005 | never infers MATCH/PASS |
| Degraded read-only | IMPLEMENTED | ACTIVE | stale/partial projection is visibly non-actionable |
| Realtime hardening | IMPLEMENTED PARTIAL | BLOCKED — CN-EXE-007 for full envelope | cursor reconnect, dedupe, per-aggregate order/gap |
| Step-up | UX contract prepared | BLOCKED — CN-EXE-008 | action remains disabled until backend proof |

Verification after this slice: **160/160 Front**, **20/20 BFF/PostgreSQL**, **3/3 real-stack E2E**, production build PASS, architecture/data/legacy guards PASS, Axe **76 audits / 0 serious-critical**, Visual QA **4/4**, performance **37/37**, and Rulebook scanner **0 error / 61 historical warnings**. The preparatory Front slice is complete. Jira `TD2-416` remains in progress and is blocked by `TD2-417` until the backend publishes the canonical OrderIntent/Human Gate/provider/reconciliation contracts and the real Human Gate lifecycle can replace the current fail-closed unavailable state.

### Closure addendum — 2026-09-07

The blocked statement above is retained as the historical status of the original August preparatory slice. The later backend contracts and execution work resolved that dependency; **TD2-416 is now complete for explicit network-disconnection presentation**.

- The transport publishes `OFFLINE`, closes SSE immediately, reconnects with the persisted cursor and waits for canonical query recovery before returning to the connected presentation.
- Live Focus retains and timestamps the last known projection, renders an explicit French offline banner, and keeps sensitive operator actions unavailable while offline or resynchronizing.
- The UI still consumes backend `allowedActions`; it does not infer permission from a local status and does not alter post-Risk fields.
- Real-browser evidence on release `grains-bff-network-resilience-20260907.2`: ten successful BFF probes, session/macro/news available, offline banner visible, zero sensitive action enabled, projection retained, recovery completed, ten responsive viewports and zero serious/critical Axe issue.
- Full validation at closure: frontend **327/327**, targeted BFF/projection **65/65**, backend local **1 608** tests with zero failure, release build **1 608** tests with zero failure.

This addendum certifies network-loss and BFF-source stability only. It does not reinterpret ACK as FILL, create provider authority, or certify a live market event on the 7 September grains holiday.

## Executive status

| Area | Status | Evidence |
| --- | --- | --- |
| Truth & Safety P0-01…P0-09 | IMPLEMENTED | typed `DataValue`, real capability catalog, terminal commands, strict ID details, operator session, view loaders, states, E2E |
| Foundations and shell | IMPLEMENTED | single route registry, permission gates, breadcrumbs/search/mobile navigation, workstation density |
| Design system | IMPLEMENTED FOR CURRENT SLICES | primitives, data/state/action components and command receipt; remaining components are introduced only with a real use case |
| Pilotage + Live | IMPLEMENTED / PARTIAL DATA | Command Center, readiness, sessions, Live, plan, news, timeline, signals and strict signal detail consume real projections |
| Research + Strategies | IMPLEMENTED / PARTIAL DATA | lab, experiments, candidates, agents, datasets, compute, run/strategy details, compare and deployments are wired |
| Replay + Performance | IMPLEMENTED / READ-ONLY DEPTH | overview, ledgers, strict run/day details, compare, calendar, strategies and trade tape read PostgreSQL-backed projections |
| Operations + Execution + Risk | IMPLEMENTED / PARTIAL DATA | queue, workflow/event details, events, incidents, orders, portfolio, risk, providers, reconciliation, runbooks and observability are wired |
| Governance | IMPLEMENTED / PARTIAL DATA | auth, access, settings, administration, prompt parity, policies and Jarvis advisory are wired |
| Quality | IMPLEMENTED FOR WIRED SLICES | 160 frontend tests, 20 combined BFF/PostgreSQL tests, 3 E2E, 76 Axe audits, 4 visual viewports, 37 performance probes |
| Cutover | LOCAL PREPROD COMPLETE | separate `control-plane` container on 8090; production VPS not changed |

## Command Center golden master — 2026-08-15

- The approved `1672 × 941` Command Center is implemented as a dedicated feature slice with a real BFF projection.
- Geometry is locked at ±1 px for the normative desktop and responsive behavior is exercised on Full HD, laptop, tablet and mobile.
- Runtime content is never copied from the visual reference: unavailable sources remain `UNKNOWN`, `UNAVAILABLE` or `PARTIAL`.
- `Execution Mode`, `AUTO`, `LIVE Broker`, provider health and Human Gate actions are backend-driven and fail closed.
- Visual QA: **5/5** scenarios, zero overflow, zero clipped interactive, zero browser-console error.
- Axe for this slice: **2** audits (workstation/mobile), **0** serious/critical blocker.
- Command Center BFF performance: five HTTP 200 samples, observed P75 **164 ms** (< 1,000 ms budget).
- Front component/contract suite: **163/163** assertions passed across the full batch plus the isolated retry of the single worker-start timeout; no logical test failed.
- Production build: PASS. BFF Command Center contract: **26/26** focused tests PASS.
- Remaining integration blockers: `CN-EXE-009` (execution repository SQLSTATE 42703) and `CN-DATA-001` (freshness status/age inconsistency), tracked in Jira `TD2-417`.

## Route inventory

The registry contains **59 routes**. Every product destination now has a concrete BFF view endpoint; there are **0 `backend-gap` routes** and **0 route that fabricates business data or a successful action**. The formerly blocked destinations are backed by 24 PostgreSQL/store projections: six operational P0 projections and eighteen explorer/detail projections.

`CapabilityUnavailablePage` remains part of the state system for an unavailable capability, but no registered product route uses it as a permanent implementation substitute.

## Truth & Safety traceability

| Requirement | Status | Implementation |
| --- | --- | --- |
| P0-01 unknown/incomplete values | IMPLEMENTED | centralized `DataValue<T>` states: KNOWN, UNKNOWN, UNAVAILABLE, NOT_APPLICABLE, STALE, PARTIAL, NOT_IMPLEMENTED, DISCONNECTED, ERROR |
| P0-02 real actions | IMPLEMENTED | `/front-api/v1/capabilities`; only `control_plane.verify` and `research.bootstrap_demo_paper` are published because they are executable |
| P0-03 terminal command + receipt | IMPLEMENTED | REQUESTED → ACCEPTED/RUNNING → terminal; GET by command ID; persisted idempotency/correlation/audit; UI `AuditReceipt` |
| P0-04 details by ID | IMPLEMENTED | experiment, run, strategy, signal, order, position and incident queries use the route ID and return real 404 |
| P0-05 auth/permissions | IMPLEMENTED | fail-closed local operator session, backend capability decisions and permission gate; identity provider named `LOCAL_OPERATOR_SESSION` |
| P0-06 route/shell truth | IMPLEMENTED | one registry powers routing, navigation, breadcrumbs, search and mobile navigation; no fake user, price or environment |
| P0-07 view loaders | IMPLEMENTED | explicit dependency graph per BFF view, timeout, partial warnings and five-second source coalescing |
| P0-08 UI states/telemetry | IMPLEMENTED | loading, empty, partial, stale, unavailable, forbidden, disconnected, error, command progress; frontend telemetry hooks |
| P0-09 critical E2E | IMPLEMENTED | navigation/detail/gap, operator command through SUCCEEDED and audit, mobile reflow |

## Current frontend slices

### Implemented against real BFF views

- Auth & session, operator settings, prompt/policy governance and administration.
- Command Center and Demo/PAPER Readiness.
- Live Trading, live signal list and signal detail.
- Sessions, live plan/setup, point-in-time agenda/news and live timeline.
- Operations queue, workflow/event details, events/audit, runbooks, observability, execution incidents and incident detail.
- Research Lab, experiments, candidates, agents, data catalog/detail, compute, experiment detail and run detail.
- Strategy Center, strategy detail, deployment registry and version comparison.
- Replay overview/run ledger/run detail/compare and performance overview/calendar/day/strategy/trade tape.
- Orders and order detail.
- Portfolio and position detail.
- Risk Center, execution providers and reconciliation.
- Jarvis workspace (advisory only).

### Explicitly partial

- Portfolio capital and unrealized PnL require a real account snapshot. A late snapshot is rendered `STALE`, never current.
- Gross/net exposure, correlation, attribution and equity curve are `NOT_IMPLEMENTED` until an authoritative projection exists.
- Reconciliation remains `PENDING`/`PARTIAL` when the broker authority is unavailable.
- Local real data may legitimately contain no current signal, order or open position; this is not converted into a synthetic object.

### Remaining product depth

The 24 route-level backend gaps tracked by `TD2-414` are resolved. `FRONTEND_V2_REMAINING_BACKEND_GAPS.md` now records narrower capability depth: server pagination/saved views, richer workflow/event payloads, mutable prompt/policy workflows, provider reconciliation actions and complete account/exposure authority. These are not represented as already working UI actions.

## Quality evidence

| Check | Result |
| --- | --- |
| BFF + PostgreSQL unit/integration | 20/20 passed |
| Frontend Vitest | 35 files, 160/160 passed |
| Playwright real stack | 3/3 passed, including operator write lifecycle |
| Axe | 76 page/viewport audits, 0 serious or critical blocker |
| Visual QA | 4/4 viewports; 0 overflow, 0 console error, 0 geometry failure |
| BFF performance | 37/37 static views with P75 < 1,000 ms |
| UI/UX static scanner | 102 files, 0 errors, 61 warnings |
| Runtime data guard | passed; BFF real by default, fixtures test-only |
| Legacy isolation guard | passed; 94 V2 files checked |
| Front architecture guard | passed; 100 runtime files checked |
| Repository architecture guard | passed; 381 files checked |

The 61 static warnings are all heuristic `UXR-0957` detections of `!important` in the consolidated visual stylesheet. They are not interpreted as proof of non-compliance or compliance. No P0 check was disabled. Their progressive removal is non-blocking only while the tested cascade, focus and responsive behavior remain intact.

## Cutover and rollback

- Local V2 is built and served by the `control-plane` Docker service on port 8090.
- The API container is rebuilt from the current BFF and remains healthy on 8787; transient PostgreSQL startup errors are retried with a bounded fail-closed policy.
- The legacy frontend remains independently available on 8080 for comparison and immediate rollback.
- Rollback is `docker compose stop control-plane`; it does not mutate PostgreSQL or the legacy UI.
- No production VPS release, DNS change, worker activation or broker execution was performed in this frontend mission.
