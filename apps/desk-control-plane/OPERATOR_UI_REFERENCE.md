# Desk Control Plane — Operator UI reference

## Source of truth

The Portfolio screen is the first desktop golden slice and the visual contract for every subsequent VNext screen.

- Visual target: `design-evidence/portfolio/portfolio-control-target-1792x1024.png`
- Canonical route: `#/portfolio`
- Shared shell: `src/shell/DeskShell.tsx`
- Density viewport: `src/shell/DeskDensityViewport.tsx`
- Shared primitives: `src/design-system/`

## Workstation geometry

- Logical desktop canvas: at least `1281 px` wide.
- Sidebar: `196 px`.
- Topbar: `64 px`.
- Status footer: `32 px`.
- Content padding: `16 px`.
- Panel gap: `10 px`.
- KPI row: six cards, `94 px` high.
- Panel radius: `8 px` with a `1 px` navy stroke.

Windows workstations running a 1920 × 1080 display at 150% scaling use the `workstation` density mode. It provides a logical canvas at 150% of the CSS viewport and renders it at a fixed internal scale of two thirds. Chrome remains at 100% and user browser zoom is not rewritten.

The query parameter `?density=auto|native|workstation` can override the local preference for QA. Explicit preferences are persisted under `desk-control-plane:density`.

## Navigation model

Every domain is built as a pair:

1. A global screen that summarizes the domain with compact KPIs, prioritized tables and actionable states.
2. Dedicated zoom routes for one run, signal, strategy, incident, order or experiment.

Selecting an item opens its zoom route. The zoom route owns the complete context and provides a deterministic back path. Persistent split-screen detail panes are not the default navigation pattern.

## Data contract

- A screen reads one typed BFF projection through `useFrontView`.
- The projection validator and canonical fixture are created before the page.
- Components never read legacy endpoints directly.
- Loading, empty, stale, degraded, error and read-only states remain explicit.
- Technical identifiers are available in zoom/audit surfaces, not used as primary labels on global screens.

## Rollout order

1. Portfolio — implemented golden slice.
2. Command Center — implemented second golden slice.
3. Live Trading and Signal zoom.
4. Risk, Orders, Execution Providers, Incidents and Operations.
5. Strategy catalogue, detail and compare.
6. Research overview, experiments, runs, agents, data and compute.
7. Jarvis workspace.
8. Settings, authentication and administration.

Each slice must pass visual QA at native DPR 1 and on the Windows 150% workstation profile before the next family is promoted.
