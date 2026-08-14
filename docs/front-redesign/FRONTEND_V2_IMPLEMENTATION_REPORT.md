# Desk Control Plane V2 — Implementation Report

**Date:** 2026-08-14
**Scope:** production-quality V2 frontend, BFF projections, local preproduction cutover
**Status:** complete route-level BFF coverage in local preproduction; advanced product depth remains explicitly scoped

## Résumé de l’implémentation

Desk Control Plane V2 is now a separate React application under `apps/desk-control-plane`. It is not a skin over the legacy frontend. It consumes versioned `/front-api/v1` view models, validates responses at runtime, maps them to domain view models and renders only real data or an explicit truth state.

The local release is available at `http://127.0.0.1:8090`. The legacy application remains on 8080 as the rollback path. Production was not modified.

## Status by mission phase

| Phase | Result | Notes |
| --- | --- | --- |
| 0 — Truth & Safety | IMPLEMENTED | all P0-01…P0-09 controls are present and tested |
| 1 — Foundations | IMPLEMENTED | providers, query cache, route registry, shell, density, permissions, error boundary |
| 2 — Core UI & Data | IMPLEMENTED FOR CURRENT USE CASES | reusable action/data/state/workspace primitives; no speculative component factory |
| 3 — Pilotage + Live | IMPLEMENTED / PARTIAL DATA | sessions, Live, plan, news, timeline and strict signal detail consume real projections |
| 4 — Research + Strategies | IMPLEMENTED / PARTIAL DATA | experiments, candidates, datasets, deployments and all principal detail/compare routes are wired |
| 5 — Replay + Performance | IMPLEMENTED / READ-ONLY DEPTH | overview, ledgers, strict details, comparison, calendar and trade tape consume canonical backend results |
| 6 — Operations + Execution + Risk | IMPLEMENTED / PARTIAL DATA | workflow/event details, runbooks, observability and reconciliation join the main ledgers/details |
| 7 — Governance + Jarvis | IMPLEMENTED / PARTIAL DATA | prompt hash parity and policy projection join session/access/settings/admin/Jarvis |
| 8 — Advanced UX | IMPLEMENTED FOR WIRED SLICES | drill-down, URL IDs, responsive mobile navigation, realtime heartbeat, command progress |
| 9 — Quality | IMPLEMENTED FOR WIRED SLICES | tests, Axe, visual geometry, scanner, architecture and performance gates |
| 10 — Cutover | LOCAL ONLY | Docker cutover complete on 8090; production release intentionally not authorized |

## Décisions UX et architecture

### Truth before beauty

- Unknown values never become zero, PASS or NOMINAL.
- A stale account snapshot remains visible with its timestamp/source and `STALE` state.
- Historical closed trades are not projected as open broker positions.
- Missing exposure/correlation/attribution data uses `NOT_IMPLEMENTED` or `UNAVAILABLE`.
- An empty source caused by failure is `PARTIAL`/`UNAVAILABLE`, not a business empty state.

### Real actions only

The capability catalog exposes only two implemented, non-broker commands:

1. `control_plane.verify`;
2. `research.bootstrap_demo_paper`.

Unsupported actions return 422; LIVE commands fail closed with 403. An accepted command does not produce a success toast. The client follows its command ID to a terminal state and renders the audit receipt.

### Global-to-zoom navigation

The route parameter is the entity identity. Experiment, run, strategy, signal, order, position and incident detail requests have independent query keys and real 404 behavior. There is no fallback to the first or active object.

### Workstation density without browser zoom

`DeskDensityViewport` provides an explicit workstation canvas. On a Windows 150% display at browser zoom 100%, the physical shell remains 196 px sidebar, 64 px topbar and 32 px footer. Smaller devices use task-prioritized reflow rather than a scaled desktop.

## Architecture delivered

```text
Backend/PostgreSQL
  -> /front-api/v1 view and command contracts
  -> runtime validators
  -> repositories and per-view query keys
  -> typed ViewModels / DataValue truth model
  -> feature pages
  -> reusable design-system primitives
  -> route-driven shell
```

The BFF has an explicit source dependency graph for each view. Reads share a five-second in-flight/cache window, stay below the live monitoring cadence, and degrade individual sources after a bounded timeout rather than blocking the entire page. Replay detail has a dedicated operator summary projection: it reads the canonical run and indexed timeline without hydrating the full price series and every GPT payload, reducing the observed response from 17.5 s to about 1.1 s while retaining the specialist historical endpoint.

PostgreSQL initialization now retries only transient recovery/connectivity failures with bounded exponential backoff. Missing migrations and schema incompatibility remain fail-closed and are never retried into a false healthy state.

## Données, permissions et commandes

- The frontend defaults to the real BFF; runtime mock opt-in is rejected by a repository guard.
- `src/mocks/canonicalDataset.ts` is test-only and cannot be selected in production runtime.
- Auth is a local operator session in preproduction, named `LOCAL_OPERATOR_SESSION`; read-only access remains fail-closed.
- Route and command visibility use backend capabilities/permissions.
- Command records retain idempotency key, correlation ID, actor, reason, audit ID and terminal result.
- Jarvis is advisory and cannot bypass the command runtime.

## États et responsive

The reusable state layer covers loading, empty, partial, stale, unavailable/not implemented, disconnected, forbidden and error. Command UI additionally covers requested, accepted, running and terminal outcomes.

Validated viewports:

- workstation 1792×1024;
- Windows 150% physical 1920×878 browser area at browser zoom 100%;
- laptop 1366×768;
- mobile 320×720.

At all four viewports the automated check found no global overflow, sidebar overflow or console error. Workstation and Windows 150% physical shell geometry is within one pixel of the contract.

## Tests et commandes exécutées

```text
node --test mcp_gpt_desk/test/front_control_plane_api.test.js
node --test mcp_gpt_desk/test/postgres_schema_mode.test.js
  20 passed / 0 failed (combined)

npm --prefix apps/desk-control-plane test
  34 files / 152 tests passed

DESK_OPERATOR_ADMIN_PIN=<local pin> DESK_VNEXT_BASE_URL=http://127.0.0.1:8090 npm run front-vnext:e2e
  3 passed / 0 skipped / 0 failed

npm run test:uiux-rules
  50 chapters / 1,000 rules valid; selector and scanner self-tests passed

npm run audit:uiux:report
  95 files / 0 errors / 61 heuristic warnings

npm run audit:front-a11y
  76 audits / 0 serious or critical blocker

npm run audit:front-visual
  4 captures / 0 failure

npm run audit:front-performance
  37/37 static BFF views below P75 1,000 ms

npm run guard:front-vnext-data-mode
npm run guard:front-vnext-legacy
npm run guard:front-architecture
npm run guard:architecture
  all passed with their self-tests
```

## Captures et preuves

- `reports/ui-ux/screenshots/workstation-1792x1024.png`
- `reports/ui-ux/screenshots/windows150-1920x878.png`
- `reports/ui-ux/screenshots/laptop-1366x768.png`
- `reports/ui-ux/screenshots/mobile-320x720.png`
- `reports/ui-ux/screenshots/visual-qa.json`
- `reports/ui-ux/front-v2-axe.json`
- `reports/ui-ux/front-v2-bff-performance.json`
- `reports/ui-ux/front-v2-static-audit.json`

## Limites et contrôles non exécutés

- A manual NVDA/VoiceOver session was not performed. Axe and keyboard-oriented Playwright checks do not replace this review.
- The local database did not expose a current complete signal → order → open position chain during the final run. Real-stack navigation follows available entities; strict ID/404 behavior and view contracts are proved by BFF integration tests.
- Visual tests assert geometry, overflow, console and responsive invariants. They do not claim pixel identity for every dynamic data glyph.
- The 24 former route-level backend gaps now have real read projections. Several screens still expose read-only explorer depth rather than their final specialized charts, saved views, server pagination or governed mutation flows; those residual gaps remain itemized separately.
- Production VPS cutover was not executed because this mission only authorizes local preproduction work.

## Risques et dérogations

- No UXR P0 derogation is granted.
- The consolidated stylesheet contains 61 `!important` warnings detected by the heuristic scanner. They are recorded debt, not hidden; the dynamic layout and accessibility gates are green.
- The legacy frontend is retained only as rollback. V2 has no imports from it.

## Prochaine validation humaine

1. Perform one keyboard-only and screen-reader smoke test on Command Center, Live, Orders and Auth.
2. Review the workstation and Windows 150% captures with the product owner.
3. Prioritize the missing BFF contracts in `FRONTEND_V2_REMAINING_BACKEND_GAPS.md`.
4. After those contracts exist, replace each capability-gap route with its vertical slice and repeat the same gates.
5. Authorize a separate VPS release only after a release candidate and rollback rehearsal.
