# Design QA — Operator desktop density and shared screens

Date: 2026-08-10

## Comparison targets

### Canonical Portfolio golden slice

- Source truth: `design-evidence/portfolio/portfolio-control-target-1792x1024.png`
- Implementation: `design-evidence/portfolio/portfolio-control-implementation-1792x1024.png`
- Source pixels: `1792 × 1024`
- Implementation pixels: `1792 × 1024`
- CSS viewport: `1792 × 1024`
- Device scale factor: `1`
- State: `#/portfolio`, dark operator desktop, canonical VNext projection

### Windows 150% / Chrome 100% density target

- User source capture: `C:/Users/CES/AppData/Local/Temp/codex-clipboard-8e8988bb-b9b1-4058-8c81-f10d65ff6714.png`
- Normalized source page crop: `design-evidence/density/portfolio-win150-target-browser67-page.png`
- Browser-rendered implementation: `design-evidence/density/portfolio-win150-implementation-browser100-page.png`
- Full comparison: `design-evidence/density/portfolio-win150-side-by-side.png`
- Overlay: `design-evidence/density/portfolio-win150-overlay.png`
- Absolute diff: `design-evidence/density/portfolio-win150-diff.png`
- Focused shell/KPI comparison: `design-evidence/density/portfolio-win150-focus-shell-kpis-side-by-side.png`
- Focused panel comparison: `design-evidence/density/portfolio-win150-focus-grids-side-by-side.png`
- Source pixels: `1920 × 1008`, with `131 px` of Chrome UI and a normalized `1920 × 877` page crop
- Implementation pixels: `1920 × 878`, normalized to `1920 × 877` for comparison
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Browser zoom: source `67%`; implementation `100%`
- Density normalization: internal `workstation` canvas at `150vw × 150vh`, rendered at `2/3`

### Second operator screen

- Command Center desktop: `design-evidence/command-center/command-center-win150-browser100.png`
- Command Center mobile: `design-evidence/command-center/command-center-mobile-390x844.png`
- Command Center runtime: `design-evidence/command-center/command-center-runtime-workstation.png`
- State: `#/command-center`, same shell/tokens/density as Portfolio

### Auth & Session

- Auth workstation top capture: `design-evidence/auth/auth-workstation-top.png`
- Auth workstation command capture: `design-evidence/auth/auth-workstation-refresh-command.png`
- Auth mobile top capture: `design-evidence/auth/auth-mobile-top-390x844.png`
- Auth mobile command capture: `design-evidence/auth/auth-mobile-refresh-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/auth`, canonical VNext projection from `/views/auth-session`
- Command Runtime proof: clicked `auth.session.refresh`; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `If-Match` from the session expected version.
- Contract proof: SSO identity summary, PAPER/STAGING/LIVE environment states, roles, desks, account scopes, trading permissions, route guards, MFA/step-up readiness, expiry/refresh/logout and read-only/denied decisions are all read from the Auth Session DTO.
- Safety proof: rendered browser copy contains no sensitive terms; session is represented as httpOnly + CSRF-bound, with `browserMaterialExposure=NONE` and `legacyStoreImported=false`.
- Mobile proof: native density, bottom navigation visible, identity/environments/permissions/step-up/route guards/actions stacked, refresh command accepted and no horizontal overflow.

### Operator Settings

- Settings workstation top capture: `design-evidence/settings/settings-workstation-top.png`
- Settings workstation command capture: `design-evidence/settings/settings-workstation-save-command.png`
- Settings mobile top capture: `design-evidence/settings/settings-mobile-top-390x844.png`
- Settings mobile command capture: `design-evidence/settings/settings-mobile-save-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/settings`, canonical VNext projection from `/views/operator-settings`
- Command Runtime proof: clicked `settings.preferences.save`; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `If-Match` from the settings expected version.
- Contract proof: theme, density, language, timezone, money format, dashboard widgets, notification rules, Jarvis push-to-talk/voice state, shortcuts, devices/sessions and privacy policies are all read from the Operator Settings DTO.
- Safety proof: all command types are `settings.*`; risk/execution/provider/order controls remain in their dedicated domains. Optimistic UI is allowed only for non-critical cockpit preferences; device/session revoke is step-up gated and not optimistic.
- Mobile proof: native density, bottom navigation visible, preferences/widgets/notifications/Jarvis/devices/actions stacked, save command accepted and no horizontal overflow.

### Research Lab cockpit

- Research Lab workstation capture: `design-evidence/research-lab/research-lab-workstation.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research`, canonical VNext projection from `/views/research-lab`
- Layout contract: 6 KPI cards, top row 3 panels, bottom row 3 panels, compact operator typography and shared shell tokens

### Research Experiment Detail

- Experiment workstation capture: `design-evidence/research-experiment/research-experiment-workstation-command.png`
- Experiment mobile top capture: `design-evidence/research-experiment/research-experiment-mobile-top-390x844.png`
- Experiment mobile command capture: `design-evidence/research-experiment/research-experiment-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research/experiments/exp_breakout_retest_mnq_oos_vnext`, canonical VNext projection from `/views/research-experiment-detail`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Research coherence proof: same `experimentId`, `missionId`, `runId`, owner agent and dataset IDs as the Research Lab global projection.
- Mobile proof: native density, bottom navigation visible, drill-down cards stacked, vertical document flow and no horizontal overflow.

### Research Run Detail

- Run workstation capture: `design-evidence/research-run/research-run-workstation-command.png`
- Run mobile top capture: `design-evidence/research-run/research-run-mobile-top-390x844.png`
- Run mobile command capture: `design-evidence/research-run/research-run-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research/runs/run_research_mnq_oos_fold_18_24`, canonical VNext projection from `/views/research-run-detail`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Reproducibility proof: `runId`, `datasetId/hash`, engine/runtime versions, seed, parameters, benchmark, ambiguity policy and trade list are all displayed from the run DTO.
- Mobile proof: native density, bottom navigation visible, compact long IDs, vertical document flow and no horizontal overflow.

### Research Agent Fleet

- Agents workstation capture: `design-evidence/research-agents/research-agents-workstation-command.png`
- Agents mobile top capture: `design-evidence/research-agents/research-agents-mobile-top-390x844.png`
- Agents mobile command capture: `design-evidence/research-agents/research-agents-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research/agents`, canonical VNext projection from `/views/research-agent-fleet`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Agent coherence proof: same `agentId` and `missionId` values as Research Lab; queue, conversations, incidents and actions all point to known AI research agents.
- Separation proof: this screen supervises AI Research workers only; deterministic Risk, Execution, Portfolio and broker engines are not modeled as agents.
- Mobile proof: native density, bottom navigation visible, command cards stacked, vertical document flow and no horizontal overflow.

### Research Data & Feature Catalog

- Data workstation capture: `design-evidence/research-data/research-data-workstation-command.png`
- Data mobile top capture: `design-evidence/research-data/research-data-mobile-top-390x844.png`
- Data mobile command capture: `design-evidence/research-data/research-data-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research/data`, canonical VNext projection from `/views/research-data-catalog`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Dataset coherence proof: same `datasetId` values as Research Lab, Experiment Detail and Run Detail; instruments, features, incidents and command actions all reference known datasets.
- Anti-lookahead proof: datasets/features expose `pointInTime`, provenance, version, freshness and `lookaheadStatus`.
- Mobile proof: native density, bottom navigation visible, stacked dataset/action cards, vertical document flow and no horizontal overflow.

### Research Compute Scheduler

- Compute workstation capture: `design-evidence/research-compute/research-compute-workstation-command.png`
- Compute mobile top capture: `design-evidence/research-compute/research-compute-mobile-top-390x844.png`
- Compute mobile command capture: `design-evidence/research-compute/research-compute-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/research/compute`, canonical VNext projection from `/views/research-compute-scheduler`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Research coherence proof: scheduler includes the same `jobId` values as Research Lab compute queue.
- LIVE priority proof: LIVE reserved pool, active LIVE reservation and `LIVE_PROTECTED` job are visible; UI does not perform authoritative local scheduling.
- Mobile proof: native density, bottom navigation visible, stacked pool/job/action cards, vertical document flow and no horizontal overflow.

### Strategy Center cockpit

- Strategy Center workstation capture: `design-evidence/strategy-center/strategy-center-workstation-command.png`
- Strategy Center mobile top capture: `design-evidence/strategy-center/strategy-center-mobile-top-390x844.png`
- Strategy Center mobile command capture: `design-evidence/strategy-center/strategy-center-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/strategies`, canonical VNext projection from `/views/strategy-center`
- Command Runtime proof: clicked `Demander shadow test`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Contract proof: Definition, Version, Instance and Runtime Bundle IDs are distinct; lifecycle enums are strict and the command uses `strategyVersionId` as `If-Match` while keeping `runtimeBundleId` only in payload.
- Mobile proof: native density, bottom navigation visible, catalogue rendered through mobile cards, command accepted text visible and no horizontal overflow.

### Strategy Detail

- Strategy Detail workstation capture: `design-evidence/strategy-detail/strategy-detail-workstation-command.png`
- Strategy Detail mobile top capture: `design-evidence/strategy-detail/strategy-detail-mobile-top-390x844.png`
- Strategy Detail mobile command capture: `design-evidence/strategy-detail/strategy-detail-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/strategies/str_breakout_retest`, canonical VNext projection from `/views/strategy-detail`
- Command Runtime proof: clicked first enabled `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Contract proof: Strategy Definition, Strategy Version, Strategy Instance and Runtime Bundle are displayed and validated as separate IDs; `strategyVersionId` is used as command `If-Match`, while `runtimeBundleId` remains payload-only.
- Safety proof: LIVE request is present but `DENIED` by backend capabilities in the mock; the UI disables non-`ALLOWED` actions and does not invent LIVE authority.
- Mobile proof: native density, bottom navigation visible, long strategy IDs compacted/truncated, command accepted text visible and no horizontal overflow.

### Strategy Compare

- Strategy Compare workstation capture: `design-evidence/strategy-compare/strategy-compare-workstation-command.png`
- Strategy Compare mobile top capture: `design-evidence/strategy-compare/strategy-compare-mobile-top-390x844.png`
- Strategy Compare mobile command capture: `design-evidence/strategy-compare/strategy-compare-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/strategies/str_breakout_retest/compare`, canonical VNext projection from `/views/strategy-compare`
- Command Runtime proof: clicked first enabled `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Contract proof: baseline/candidate Strategy Versions and Runtime Bundles remain separate; the candidate `strategyVersionId` is used as command `If-Match`, while runtime bundle IDs remain payload/deep-link data.
- Diff proof: spec, parameter, metric, regime, divergent-trade, cost and parity rows are read from the DTO; the front does not recompute promotion metrics locally.
- Mobile proof: native density, bottom navigation visible, compare actions stacked, command accepted text visible and no horizontal overflow.

### Live Trading & Risk cockpit

- Live Trading workstation capture: `design-evidence/live-trading/live-trading-workstation-command.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/live`, canonical VNext projection from `/views/live-trading`
- Command Runtime proof: clicked `Réconcilier`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Pipeline proof: all `12` authoritative deterministic steps are rendered in the panel; AI advisory is displayed separately in SHADOW mode.

### Live Signal Detail

- Live Signal Detail workstation capture: `design-evidence/live-signal-detail/live-signal-detail-workstation-command.png`
- Live Signal Detail mobile top capture: `design-evidence/live-signal-detail/live-signal-detail-mobile-top-390x844.png`
- Live Signal Detail mobile command capture: `design-evidence/live-signal-detail/live-signal-detail-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/live/signals/sig_vnext_demo_mnq_0940`, canonical VNext projection from `/views/live-signal-detail`
- Command Runtime proof: clicked `TAKE full`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Contract proof: signal, strategy version, strategy instance, feature snapshot, arbitration, risk check, order and event IDs are reconciled with Live Trading, Strategy Detail, Portfolio and Events.
- Authority proof: AI Context Gate is visible in a separate SHADOW block with `authority=NONE`; authoritative order path remains Strategy → Portfolio → Risk → Execution.
- Capability proof: TAKE / TAKE_REDUCED / WAIT / REJECT actions are backend-capability driven; one `STEP_UP_REQUIRED` action is disabled and every submitted decision requires a non-empty reason plus `expectedVersion`.
- Mobile proof: native density, bottom navigation visible, command accepted text visible, stacked action cards and no horizontal overflow.

### Orders

- Orders workstation capture: `design-evidence/orders/orders-workstation-command.png`
- Orders mobile top capture: `design-evidence/orders/orders-mobile-top-390x844.png`
- Orders mobile command capture: `design-evidence/orders/orders-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/orders`, canonical VNext projection from `/views/orders`
- Command Runtime proof: clicked `Cancel ordre`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Contract proof: `orderIntentId`, provider order ids, strategy instance ids, account, instrument, side, quantity, order type, limit/stop prices, TIF, provider state, fills, average fill, commissions, slippage, protection state, `idempotencyKey` and `correlationId` are displayed from the Orders DTO.
- Coherence proof: order and fill IDs reconcile with Live Trading, Live Signal Detail, Portfolio and Timeline & Audit (`ord_sig_vnext_demo_mnq_0940_001`, `fill_nt_sim101_20260810_00029`, `fill_nt_sim101_20260810_00030`).
- Safety proof: cancel and reconcile are `ALLOWED`, replace is `STEP_UP_REQUIRED`, close/reduce is `DENIED`; disabled actions stay disabled and every submitted command requires a reason plus `expectedVersion`.
- Mobile proof: native density, bottom navigation visible, intents/orders/fills/actions stacked, command accepted text visible and no horizontal overflow.

### Risk Center

- Risk workstation top capture: `design-evidence/risk/risk-workstation-top.png`
- Risk workstation command capture: `design-evidence/risk/risk-workstation-kill-switch-command.png`
- Risk mobile top capture: `design-evidence/risk/risk-mobile-top-390x844.png`
- Risk mobile command capture: `design-evidence/risk/risk-mobile-kill-switch-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/risk`, canonical VNext projection from `/views/risk`
- Command Runtime proof: entered step-up phrase `act_risk_kill_switch`, clicked `Kill switch`; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `dryRun=true`.
- Contract proof: global risk, daily loss, max/trailing drawdown, gross/net exposure, leverage, limits, headroom, status, reason codes, last changes, contributors, prop constraints, breaches and stress tests are all read from the Risk DTO.
- No local calculation proof: every risk limit exposes `officialSource`, `changedBy`, `reasonCodes`, `usedPct`, `headroomValue` and contributors; tests assert these fields instead of recomputing them in the front.
- Coherence proof: Risk reconciles Live risk checks, Portfolio strategy instances, Orders order/fill IDs and Timeline & Audit correlation IDs.
- Safety proof: stress test and reduce allocation are `ALLOWED`; modify limit, suspend strategy and kill switch are `STEP_UP_REQUIRED`; disable instrument is `DENIED`; kill switch is Emergency dry-run only and does not trigger broker execution from the front.
- Mobile proof: native density, bottom navigation visible, limits/exposures/constraints/stress/breaches/actions stacked, kill switch command accepted and no horizontal overflow.

### Execution Providers

- Execution Providers workstation top capture: `design-evidence/execution-providers/execution-providers-workstation-top.png`
- Execution Providers workstation command capture: `design-evidence/execution-providers/execution-providers-workstation-switch-command.png`
- Execution Providers mobile top capture: `design-evidence/execution-providers/execution-providers-mobile-top-390x844.png`
- Execution Providers mobile command capture: `design-evidence/execution-providers/execution-providers-mobile-switch-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/execution/providers`, canonical VNext projection from `/views/execution-providers`
- Command Runtime proof: entered step-up phrase `act_provider_switch_to_pmt_shadow`, clicked `Switch primary`; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `simulationOnly=true`.
- Contract proof: primary/standby/demo providers, accounts, adapters, heartbeat, latency, fill rate, slippage, last reconciliation, incidents and capabilities are all read from the Execution Providers DTO.
- PickMyTrade proof: the provider catalog exposes all required states: `NOT_CONFIGURED`, `VALIDATION_PENDING`, `DEMO`, `SHADOW`, `ACTIVE`, `STANDBY`, `DEGRADED`, `DISCONNECTED` and `DISABLED`.
- Coherence proof: provider, account, order, fill, risk breach and timeline event IDs reconcile with Orders, Risk Center and Timeline & Audit.
- Safety proof: no sensitive provider material is exposed in browser data or visible copy; primary-provider switch is simulation-only and step-up gated, while demo order routing through the standby provider is denied.
- Mobile proof: native density, bottom navigation visible, providers/accounts/adapters/actions stacked, switch command accepted and no horizontal overflow.

### Execution Incidents

- Execution Incidents workstation top capture: `design-evidence/execution-incidents/execution-incidents-workstation-top.png`
- Execution Incidents workstation command capture: `design-evidence/execution-incidents/execution-incidents-workstation-reconcile-command.png`
- Execution Incidents mobile top capture: `design-evidence/execution-incidents/execution-incidents-mobile-top-390x844.png`
- Execution Incidents mobile command capture: `design-evidence/execution-incidents/execution-incidents-mobile-reconcile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/execution/incidents`, canonical VNext projection from `/views/execution-incidents`
- Command Runtime proof: clicked the `execution.incident.reconcile` action; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `If-Match` from the incident expected version.
- Contract proof: list filters, incident severity/domain/provider/order/position/status, impact, machine recommendation, chronology, payload/meta, reconciliation results, retries and post-mortem are all read from the Execution Incidents DTO.
- Coherence proof: `inc_live_broker_netting_cl_delta`, `inc_provider_shadow_latency` and `inc_archive_retention_blocked` reconcile with Live Trading, Execution Providers and Operations; selected chronology event IDs reconcile with Timeline & Audit.
- Safety proof: acknowledge/reconcile/escalate are permission-driven; resolve/suspend require step-up; emergency close is denied; the screen exposes operator gates only as exceptional controls, not daily assignment ownership.
- Mobile proof: native density, bottom navigation visible, incidents/payload/reconciliation/chronology/retries/actions stacked, reconcile command accepted and no horizontal overflow.

### Admin Access

- Admin Access workstation top capture: `design-evidence/admin/admin-workstation-top.png`
- Admin Access workstation command capture: `design-evidence/admin/admin-workstation-export-command.png`
- Admin Access mobile top capture: `design-evidence/admin/admin-mobile-top-390x844.png`
- Admin Access mobile command capture: `design-evidence/admin/admin-mobile-export-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`; Playwright uses `?density=workstation` because headless Linux cannot auto-detect the user's Windows 150% workstation environment.
- State: `#/admin`, canonical VNext projection from `/views/admin-access`
- Command Runtime proof: clicked `admin.audit.export`; mock/BFF command returned `ACCEPTED` with generated idempotent command id and `If-Match` from the admin expected version.
- Contract proof: users, masked emails, roles, capabilities, account groups, policies, provider access, audit events and command actions are all read from the Admin Access DTO.
- RBAC proof: the current operator is read-only; audit export is allowed, admin mutations require step-up or are denied, and every command requires a non-empty reason plus `expectedVersion`.
- Safety proof: browser-facing provider material exposure is `NONE`; screenshots and DOM text expose no password, secret, token, credential, bearer or API key terms.
- Mobile proof: native density, bottom navigation visible, admin sections stacked, export command accepted and no horizontal overflow.

### Jarvis Workspace

- Jarvis workstation capture: `design-evidence/jarvis/jarvis-workstation-command.png`
- Jarvis mobile capture: `design-evidence/jarvis/jarvis-mobile-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/jarvis`, canonical VNext projection from `/views/jarvis-workspace`
- Command Runtime proof: clicked `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Authority proof: Jarvis displays brief, cited conversation, pending action and voice status; confirmed actions go through Command Runtime and do not bypass Risk/Execution/PermissionGate.
- Mobile proof: native density, bottom navigation visible, vertical document flow and no horizontal overflow.

### Autonomous Operations Queue

- Operations workstation capture: `design-evidence/operations/operations-workstation-command.png`
- Operations mobile capture: `design-evidence/operations/operations-mobile-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/operations`, canonical VNext projection from `/views/operations-queue`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Autonomy proof: mission rows expose `missionId`, AI owner agent, expected/received event, next transition, policy gate, budgets, retries and DLQ. No human assignment field or daily assignee copy is exposed.
- Mobile proof: native density, bottom navigation visible, vertical document flow and no horizontal overflow.

### Timeline & Audit global

- Events workstation capture: `design-evidence/events/events-workstation-command.png`
- Events mobile top capture: `design-evidence/events/events-mobile-top-390x844.png`
- Events mobile command capture: `design-evidence/events/events-mobile-command-390x844.png`
- Implementation CSS viewport: `1280 × 585`
- Device scale factor: `1.5`
- Density mode: `workstation`
- State: `#/events`, canonical VNext projection from `/views/events-audit`
- Command Runtime proof: clicked first `Confirmer`; mock/BFF command returned `ACCEPTED` with generated idempotent command id.
- Audit proof: rendered `10` events, `9` authoritative order-path nodes, `1` AI advisory branch, `9` relations, payload preview, logs and export/copy commands.
- Separation proof: AI advisory is displayed as a shadow/advisory branch and is not part of the authoritative order path.
- Mobile proof: native density, bottom navigation visible, compact event rows with status/latency aligned, vertical document flow and no horizontal overflow.

## Findings and comparison history

### Iteration 1 — blocked P1 density drift

- Evidence: at Chrome 100%, Windows exposed `1280 × 585 CSS px` at DPR `1.5`.
- Mismatch: `@media (max-width: 1280px)` selected a 210 px sidebar, three KPI columns and hid topbar operations; the golden slice only ran above 1281 px.
- Impact: the user saw a materially different screen and had to set Chrome to 67%.
- Fix: added `DeskDensityViewport`, a fixed workstation profile and a logical-canvas container query. The shell now normalizes Windows display scaling while leaving Chrome at 100%.

### Iteration 2 — passed desktop density

- Measured DOM at `1280 × 585`, DPR `1.5`: sidebar `131 CSS px` (`196.5 physical px`), topbar `43 CSS px` (`64.5 physical px`), footer `21 CSS px` (`31.5 physical px`), six KPI cards and both three-panel rows.
- The 877 px physical page height is shorter than the canonical 1024 px frame. The content area now scrolls by 60 px with a hidden scrollbar, so the lower row remains accessible without changing the initial composition.
- Whole normalized frame metrics, including dynamic clock text: MAE `7.805 / 255`, RMSE `30.850`, `87.621%` of pixels with max-channel delta ≤ 10, `51.536%` exact pixels.

### Iteration 3 — blocked P2 mobile flow

- Evidence: the later compact CSS layer re-exposed the desktop sidebar and the Command Center activity table had no mobile representation.
- Fix: the final mobile layer now hides the sidebar, restores document scrolling, uses the bottom navigation and renders workflow activity through `MobileDataList`.
- Post-fix evidence: `390 × 844` viewport, document `390 × 2793`, no horizontal overflow, mobile activity list visible.

## Required fidelity surfaces

- Fonts and typography: Inter/ui-sans hierarchy, compact sizes, tight line-height and operator weights match the golden slice. Residual raster differences are browser/OS antialiasing only.
- Spacing and layout: 196 px sidebar, 64 px topbar, 32 px footer, 16 px content padding, 10 px gaps, 94 px KPI row and named three-column operator grids are shared across screens.
- Colors and tokens: navy surfaces, borders, green/amber/red states, blue selection and violet accents are centralized in `deskTokens` and the logical workstation container.
- Image and icon fidelity: the interface contains no raster content requiring recreation; visible icons use the same Font Awesome family through `react-icons`, with no emoji, text-glyph or handcrafted SVG substitutes.
- Copy and content: Portfolio retains the supplied target labels. Command Center uses operator-facing names and relegates technical identifiers to future zoom/audit surfaces.
- States and interactions: search input, sidebar navigation, Command Center quick link back to Portfolio, vertical content scrolling and mobile bottom navigation were exercised.
- Accessibility: explicit `auto`, `native` and `workstation` density preferences exist; a forced native mode does not remove user zoom. Focusable controls remain semantic buttons/links.

## Automated verification

- Browser console errors: `0`
- Uncaught page errors: `0`
- Vitest: `140 passed / 0 failed`
- TypeScript + Vite production build: passed
- VNext/legacy isolation guard: passed (`85` files checked)
- Native desktop: `1792 × 1024`, DPR `1`, six KPI cards, no document overflow
- Windows workstation: `1280 × 585`, DPR `1.5`, auto-selected `workstation`, six KPI cards
- Mobile: `390 × 844`, native density, vertical document flow and mobile navigation
- Route sweep: `23` VNext routes passed on `1280 × 585 @ DPR 1.5` workstation and `390 × 844` mobile, `0` console/page errors and no horizontal overflow.
- BFF transport: `VITE_DATA_MODE=bff` contract test proves reads through `/front-api/v1/views/:view`, writes through `/front-api/v1/commands`, idempotency headers, correlation headers and `If-Match` revision propagation.
- PWA shell: manifest + service worker are present; the service worker caches shell/static assets only and explicitly excludes `/front-api/` and `/api/` to avoid showing stale market/BFF data as live.
- Realtime runtime: WebSocket URL, SSE fallback and command idempotency tests passed; workstation browser capture shows `MOCK`, `2 events reçus`, `Out-of-order : 0`, `0` console errors
- Auth Session runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `3` environments, `7` permissions, `3` step-up methods, `6` route guards, `4` auth audit events, `3` command actions, no sensitive browser terms, `0` console errors and no horizontal overflow. Workstation command capture shows session refresh accepted. Mobile captures show native density, bottom navigation visible, stacked auth sections, refresh command accepted and no horizontal overflow.
- Auth Session contract: `27` Vitest files passed with `121` assertions, including PAPER/STAGING/LIVE environment controls, httpOnly/CSRF/non-legacy browser exposure, capability-driven route guards, Command Runtime `If-Match` refresh, step-up logout and empty-reason rejection.
- Operator Settings runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `5` cockpit preferences, `5` widgets, `4` notification rules, `4` shortcuts, `3` devices, `4` guardrails, `5` command actions, no sensitive browser terms, no forbidden domain command text, `0` console errors and no horizontal overflow. Workstation command capture shows preferences save accepted. Mobile captures show native density, bottom navigation visible, stacked settings sections, save command accepted and no horizontal overflow.
- Operator Settings contract: `28` Vitest files passed with `128` assertions, including optimistic UI limited to non-critical preferences, no sensitive browser material, no risk/execution domain mutation commands, Auth Session device/session coherence, Command Runtime `If-Match` save and step-up device revoke.
- Research Lab runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `4` experiments, `4` research agents, `3` compute jobs, `0` console errors and no document overflow.
- Research Experiment Detail runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `3` datasets, `3` iterations, `4` metric segments, `3` command actions, command accepted text, `0` console errors and no document overflow. Mobile capture shows native density, bottom navigation visible and no horizontal overflow.
- Research Experiment Detail contract: `15` Vitest files passed with `48` assertions, including Research Lab ID coherence, dataset reuse, reconstructible version lineage, no human-assignment fields/copy and Command Runtime-only experiment actions.
- Research Run Detail runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `6` parameters, `4` regimes, `5` trades, `3` command actions, command accepted text, `0` console errors and no document overflow. Mobile capture shows native density, compact long IDs and no horizontal overflow.
- Research Run Detail contract: `16` Vitest files passed with `53` assertions, including experiment/dataset/version linkage, reproducibility fields, distribution/regime/hour trade-count consistency and Command Runtime-only run actions.
- Research Agent Fleet runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `4` AI research agents in a compact 2×2 roster, `5` queue items, `4` conversations, `2` incidents, `4` command actions, command accepted text, `0` console errors and no document overflow. Mobile captures show native density, bottom navigation visible, stacked command actions and no horizontal overflow.
- Research Agent Fleet contract: `17` Vitest files passed with `58` assertions, including Research Lab agent/mission coherence, queue/incident/action reference integrity, no deterministic-engine-as-agent confusion and Command Runtime-only agent actions.
- Research Data Catalog runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `3` canonical datasets, `10` instruments, `6` features, `9` lineage edges, `2` incidents, `4` command actions, command accepted text, `0` console errors and no document overflow. Mobile captures show native density, bottom navigation visible, stacked datasets/actions and no horizontal overflow.
- Research Data Catalog contract: `18` Vitest files passed with `63` assertions, including dataset ID parity with Research Lab/Experiment/Run, feature dependency integrity, point-in-time/no-lookahead fields and Command Runtime-only data actions.
- Research Compute Scheduler runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `3` pools, `5` jobs, `5` workers, `3` reservations, `1` DLQ item, `4` command actions, command accepted text, `0` console errors and no document overflow. Mobile captures show native density, bottom navigation visible, stacked pools/jobs/actions and no horizontal overflow.
- Research Compute Scheduler contract: `19` Vitest files passed with `68` assertions, including Research Lab jobId parity, pool/job/worker/DLQ reference integrity, explicit LIVE reserved capacity and Command Runtime-only compute actions.
- Strategy Center runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `4` strategy rows, `4` lifecycle items, `3` top strategies, command accepted text, `0` console errors and no horizontal overflow. Mobile captures show native density, bottom navigation visible, `4` catalogue cards, command accepted text and no horizontal overflow.
- Strategy Center contract: `19` Vitest files passed with `70` assertions, including Definition/Version/Instance/Runtime Bundle separation, strict lifecycle/runtime enums, selected-inspector reconciliation, Research/Live/Portfolio ID coherence and Command Runtime-only shadow-test action.
- Strategy Detail runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `5` strategy rules, `3` versions, `2` instances, `6` command actions, `2` disabled non-allowed actions, command accepted text visible, `0` console errors and no horizontal overflow. Mobile captures show native density, bottom navigation visible, command accepted text visible and no horizontal overflow.
- Strategy Detail contract: `20` Vitest files passed with `75` assertions, including Strategy Center/Research/Live/Portfolio ID reconciliation, strict Strategy Version vs Runtime Bundle separation, non-invented LIVE capability and Command Runtime-only actions.
- Strategy Compare runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `2` compared versions, `5` spec diffs, `4` parameter diffs, `5` metric rows, `3` divergent trades, `4` command actions, `1` disabled step-up action, command accepted text visible, `0` console errors and no horizontal overflow. Mobile captures show native density, bottom navigation visible, stacked command actions, command accepted text visible and no horizontal overflow.
- Strategy Compare contract: `21` Vitest files passed with `80` assertions, including Strategy Detail linkage, strict Strategy Version vs Runtime Bundle separation, deterministic DTO diff display, resolvable deep links and Command Runtime-only compare actions.
- Live Trading runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `12` deterministic pipeline steps, `2` signals, `2` orders, `2` providers, `6` timeline events, command accepted text, `0` console errors and no document overflow.
- Live Signal Detail runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `4` predicates, `4` command actions, `1` disabled step-up action, command accepted text, AI advisory visible, `0` console errors and no horizontal overflow. Mobile captures show native density, bottom navigation visible, stacked command actions, command accepted text, AI advisory visible and no horizontal overflow.
- Live Signal Detail contract: `22` Vitest files passed with `85` assertions, including Live/Strategy/Portfolio/Events ID reconciliation, point-in-time feature snapshot, AI advisory separation, reason-required manual decisions and Command Runtime `If-Match` via signal `expectedVersion`.
- Orders runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `2` order intents, `2` active orders, `2` fills, `2` providers, `4` command actions, `2` disabled non-allowed actions, command accepted text visible, `0` console errors and no horizontal overflow. Mobile captures show native density, bottom navigation visible, stacked intents/orders/fills/actions, command accepted text visible and no horizontal overflow.
- Orders contract: `23` Vitest files passed with `91` assertions, including Live/Signal/Portfolio/Events ID reconciliation, provider/protection states, fill economics, reason-required commands and Command Runtime `If-Match` via order `expectedVersion`.
- Risk Center runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `4` official limits, `4` exposure classes, `3` prop constraints, `3` stress tests, `2` breaches, `7` command actions, Emergency kill switch visible, `0` console errors and no horizontal overflow. Workstation command capture shows kill switch dry-run accepted. Mobile captures show native density, bottom navigation visible, stacked risk sections, kill switch command accepted and no horizontal overflow.
- Risk Center contract: `24` Vitest files passed with `98` assertions, including Live/Portfolio/Orders/Events ID reconciliation, no local front risk calculation fields, breach audit correlation, stress-test Command Runtime `If-Match`, Emergency kill-switch step-up and denied-command preflight.
- Execution Providers runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `3` providers, `3` accounts, `3` adapters, `4` health checks, `9` provider states, `6` switch workflow steps, `4` timeline events, `1` incident, `6` command actions, `0` sensitive browser terms, `0` console errors and no horizontal overflow. Workstation command capture shows simulation-only provider switch accepted. Mobile captures show native density, bottom navigation visible, stacked provider sections, switch command accepted and no horizontal overflow.
- Execution Providers contract: `25` Vitest files passed with `107` assertions, including Orders/Risk/Events provider ID reconciliation, complete PickMyTrade lifecycle states, browser non-exposure checks, reason-required provider commands, step-up primary switch and denied demo-order preflight.
- Execution Incidents runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `4` incidents, `4` reconciliation result rows, `4` chronology steps, `4` retries, `6` command actions, `3` disabled non-allowed actions, no daily assignment copy, `0` console errors and no horizontal overflow. Workstation command capture shows targeted incident reconcile accepted. Mobile captures show native density, bottom navigation visible, stacked incident sections, reconcile command accepted and no horizontal overflow.
- Execution Incidents contract: `26` Vitest files passed with `115` assertions, including Live/Providers/Operations incident ID reconciliation, Timeline & Audit event linkage, known provider/order references, reason-required incident commands, step-up resolve/suspend and denied emergency-close preflight.
- Admin Access runtime: workstation top capture shows `workstation` density, `6` KPI cards in one row, `3` top panels, `3` bottom panels, `4` users, `4` roles, `8` capabilities, `3` account groups, `4` policies, `3` provider access rows, `5` audit events, `6` command actions, `5` disabled non-allowed actions, no sensitive browser terms, `0` console errors and no horizontal overflow. Workstation command capture shows read-only audit export accepted. Mobile captures show native density, bottom navigation visible, stacked admin sections, export command accepted and no horizontal overflow.
- Admin Access contract: `31` Vitest files passed with `140` assertions, including RBAC read-only current access, browser non-exposure checks, Auth/Execution Providers ID coherence, Command Runtime `If-Match` audit export, step-up admin mutations, denied policy preflight, PWA safe-cache contract and BFF transport contract.
- Jarvis Workspace runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `3` brief sections, `3` conversation messages, `1` pending action, `6` citations, `2` alerts, command accepted text, `0` console errors and no document overflow. Mobile capture shows native density, bottom navigation visible, no horizontal overflow and document height `2155 px`.
- Jarvis contract: `12` Vitest files passed with `34` assertions, including resolvable citations and Command Runtime-only pending actions.
- Operations Queue runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `5` missions, `6` event-flow rows, `4` policy gates, `3` command actions, `2` DLQ rows, `2` incidents, command accepted text, `0` console errors and no document overflow. Mobile capture shows native density, bottom navigation visible, no horizontal overflow and document height `2237 px`.
- Operations Queue contract: `13` Vitest files passed with `38` assertions, including no human-assignment fields/copy and Command Runtime-only operator interventions.
- Timeline & Audit runtime: workstation browser capture shows `6` KPI cards, `3` top panels, `3` bottom panels, `10` events, `9` authoritative nodes, `1` advisory node, `9` relations, command accepted text, `0` console errors and no document overflow. Mobile captures show native density, bottom navigation visible, no horizontal overflow and compact event rows.
- Timeline & Audit contract: `14` Vitest files passed with `43` assertions, including resolvable event/causation references, AI advisory separated from deterministic order flow and Command Runtime-only export/copy actions.

## Remaining P3 notes

- Clock/date values are intentionally live and therefore differ from the reference capture.
- The source screenshot contains Chrome's temporary “Zoom: 67%” bubble; it is browser chrome and is not reproduced by the application.
- Each future domain and zoom route still needs its own content-specific golden-slice QA even though it inherits the approved shell and density system.

final result: passed
