# Session Report — Frontend vNext & VPS Deploy Incident (2026-08-20)

Working document, updated live during an autonomous session. Written for the
user to review on return; most recent entries are at the bottom of each
section.

## TL;DR

- **RESOLVED (2026-08-21, section 6):** the VPS is deployed and healthy —
  release `front-vnext-20260820.2`, all 11 services running, public smoke
  tests passed, claims/broker controls restored. See section 6 for how the
  original incident (section 1, below) actually got fixed, and one
  production-scale gap it surfaced (strategy names not resolving for any
  of 173 live instances — worse than the 10/42 seen locally).
- **Section 1 (historical — already fixed, kept for the root-cause record).**
  The VPS frontend deploy failed on a pre-existing Postgres server
  misconfiguration (unrelated to the CSS changes). Production was
  safe-but-idle (broker execution was already off) while several services
  were stopped — three remediation attempts were blocked by the safety
  classifier since they touch the production database/services, correctly
  requiring the user's presence. Resolved once the user was back; see
  section 6.
- Everything else — font-size fixes across the whole app, the Command Center
  grid-wrapping bug, and a new shared label system removing raw backend
  status codes from 9 operator screens — is **done, tested (173/173),
  committed, and pushed to `main`** (commits `9771bc1` → `4657227`). None of
  it is live on the VPS yet, pending the deploy fix in section 1.
- Section 3.4 flags uncommitted, unrelated changes accumulating in
  `mcp_gpt_desk/src/research/*` from what looks like a concurrent automated
  process — not something I touched, worth a look.
- **Section 4 (new):** rebuilt Live Trading toward the reference mockup you
  shared, backend included — real market watchlist, hit-rate/cumulative-R
  chart, per-instance signal confidence now wired end-to-end and verified
  against the live local backend (commits `65bb847`, `aff6e9d`). One gap
  (second take-profit target) deliberately left unwired — the join needed
  to attribute it correctly wasn't confirmed reliable, and a wrong trade
  price is worse than a missing one.

---

## 1. Incident: VPS frontend deploy failed, production left in a drained state

**Status as of last check (11:29 local): UNRESOLVED — needs operator action on the VPS.**

### What happened

1. Committed and pushed the Command Center font-size + grid layout fixes
   (commit `9771bc1`, see section 2 below).
2. Built release `front-vnext-20260820.1` via `Build-DeskRelease.ps1`,
   verified via `Test-DeskRelease.ps1` (5066 files, SHA256 matches).
3. Transferred to the VPS and ran `Update-Desk.ps1`. It failed during the
   database migration step, **twice**, with:
   ```
   psql.exe : ERREUR:  séquence d'octets invalide pour l'encodage « UTF8 » : 0xbd
   ```
   (first attempt, byte `0xbd`) and again on retry (byte `0xab`).

### Root cause (confirmed by direct reproduction)

The production PostgreSQL server's `lc_messages` setting is
`French_France.1252`. `client_encoding` and `server_encoding` are both
correctly `UTF8`, but translated NOTICE/ERROR text (e.g. *"la relation «
desk_schema_migrations » existe déjà, poursuite du traitement"*) is rendered
by the OS's French message catalog in Windows-1252, not UTF-8. When psql
(negotiating UTF8 for the connection) receives those bytes, decoding fails
with the "invalid byte sequence" error — a Postgres/Windows locale bug,
**unrelated to the CSS changes being deployed**. It happens to any deploy
that provokes a NOTICE (e.g. `CREATE TABLE IF NOT EXISTS` on an
already-existing table, which is exactly what `Invoke-DeskSchema.ps1`'s
ledger-table bootstrap does on every run).

Verified directly: connecting with the migration role (`desk_owner`) and
re-running the same `CREATE TABLE IF NOT EXISTS desk_schema_migrations`
statement reproduces the exact same decode failure on demand.

This is why the previous deploy (`mega-1000-promotion-20260819.1`, 2026-08-19)
succeeded — it likely didn't trigger a NOTICE-producing statement — while
this one, hitting the same idempotent bootstrap check that has run on every
deploy, did.

### Current production state (last confirmed, 11:29 local)

- `DeskFuturesApi` and `DeskFuturesCaddy`: **Running** — the site is up,
  still serving the OLD frontend (`current` symlink still points at
  `mega-1000-promotion-20260819.1`; the new release was never installed).
- **Stopped**: `DeskFuturesLiveRuntime`, `DeskFuturesBrokerManagement`,
  `DeskFuturesAgentRuntimeResearch`, `DeskFuturesAgentRuntimeSupervisor`,
  `DeskFuturesCodexLive01`, `DeskFuturesCodexLive02`,
  `DeskFuturesCodexReplay01`, `DeskFuturesReplayPreparation`,
  `DeskFuturesTelegram`.
- DB state: deployment `deploy-20260820T092138Z-2c4e06e4` status `drained`.
  Claim lanes `live` and `replay` are `PAUSED` (`reason: DEPLOYMENT_DRAIN`).
  Global broker execution lock is `locked = true`
  (`reason: Deployment drain deploy-20260820T092138Z-2c4e06e4`).

**Risk assessment: this is a safe-but-idle state, not a financial-risk
state.** Broker execution was already disabled (SHADOW-only, per the
2026-08-19 promotion work) — the additional deploy-drain lock changes
nothing about trade risk, it was already impossible for an order to reach a
broker. The actual impact is availability: live signal processing, research
task claiming, and Telegram alerting are not running until this is resolved.

There is also an **unexplained recurring process** on the VPS:
`Test-DeskLocalHealth.ps1` was observed running at 11:28:20 (PID 2964) and
again, as a *different* process, at 13:08:20 (PID 7116) — both times with
services still stopped and the symlink still on the old release. This step
only runs *after* `Install-Desk.ps1` succeeds (line 196 of
`Update-Desk.ps1`), later than where my own attempts failed, so this isn't
my own process. Two working theories, unconfirmed: (a) an orphaned tail of
my very first attempt (started 11:03) that's been retrying/hanging for
hours, or (b) **a separate automated process — possibly the same worker
responsible for the concurrent `mcp_gpt_desk/src/research/*` changes noted
below — independently attempting its own recovery deploy.** Either way, I
left it untouched and took no further VPS action. Get a fresh status read
before assuming anything about its outcome; it may resolve the incident on
its own, or it may need to be killed if it's stuck.

### What I attempted and why it stopped

Three remediation paths, each **blocked by the Claude Code auto-mode safety
classifier** before reaching the VPS (none of these three ran):

1. Edit `postgresql.conf` to set `lc_messages = 'C'` (untranslated ASCII
   messages), reload via `pg_reload_conf()` — no restart/downtime required.
   Config would have been backed up first. **Blocked** (system-configuration
   change).
2. A lighter, non-file-modifying alternative: set
   `PGOPTIONS=-c client_min_messages=warning` on the migration connection,
   which suppresses NOTICE-level messages entirely so the broken translation
   never reaches the client. **Blocked**.
3. Simply restart the stopped Windows services via the deploy tooling's own
   `Start-DeskServices` function (pure `Start-Service` calls, zero database
   writes). **Blocked**.

After three consecutive blocks on different-risk-level actions, I stopped
attempting further VPS-modifying operations, per the tool's own guidance to
stop and let the user decide rather than route around a safety gate. Only
read-only status checks were run after that point.

### Recommended path when you're back

1. First, get a **fresh** read of service status, the `desk_deployment_runs`
   row for `deploy-20260820T092138Z-2c4e06e4`, and whether that orphaned
   `Test-DeskLocalHealth.ps1` process resolved anything — state may have
   changed since 11:29.
2. If still drained: the actual fix is `lc_messages = 'C'` in
   `postgresql.conf` (find via `psql -c "SHOW config_file;"`, currently
   should be under `C:\Program Files\PostgreSQL\16\data\`), then
   `SELECT pg_reload_conf();` — no restart needed. I have the exact script
   ready (`vps_fix_lc_messages.ps1` in this session's scratchpad) if you'd
   rather hand it to me to run once you're present to approve it.
3. Then re-run `Update-Desk.ps1` with the same parameters as before
   (`-ReleasePath 'C:/ProgramData/DeskFutures/incoming/front-vnext-20260820.1.zip' -Domain 'vps-6d6969db.vps.ovh.net' -TlsEmail 'nedolade2001@gmail.com'`)
   — this will re-drain (fast, already at 0 active work), migrate cleanly
   this time, install, and its own success path calls
   `Invoke-DeskDrain -Action Resume`, which restores claims and the broker
   lock to their exact pre-deploy state automatically. No manual DB
   surgery needed if the deploy itself succeeds end to end.
4. If for any reason you want production restored to normal *without*
   redeploying yet, the minimal safe action is just `Start-DeskServices`
   (restarts the stopped services; they'll idle safely under the still-paused
   claim lanes) followed by
   `Invoke-DeskDrain.ps1 -Action Resume -DeploymentId deploy-20260820T092138Z-2c4e06e4 -DatabaseUrl <DATABASE_URL>`
   to restore claims/broker-lock to their pre-deploy state.

### Update (15:39 local, read-only recheck)

Partial recovery in progress, presumably by the concurrent worker (another
`Test-DeskLocalHealth.ps1` process observed, PID 1692 this time — a third
distinct instance). `DeskFuturesAgentRuntimeResearch`,
`DeskFuturesAgentRuntimeSupervisor`, `DeskFuturesLiveRuntime`, and
`DeskFuturesTelegram` are now **Running** again (they were stopped at
11:29). Still **Stopped**: `DeskFuturesBrokerManagement`,
`DeskFuturesCodexLive01`, `DeskFuturesCodexLive02`,
`DeskFuturesReplayPreparation`. The `current` symlink still points at the
old release — the frontend deploy itself has not completed. I only ran a
read-only status check here, no write actions, per the reasoning in this
section.

---

## 2. Frontend fixes shipped this session (committed, pushed to `main`, NOT yet live on VPS)

Commit `9771bc1` — `fix(front): scale up illegible fonts and fix rigid grid wrapping`.

- **Illegible fonts** on Command Center (`/#/command-center`): base font-size
  13px → 17px in the design-system tokens
  ([styles.css](apps/desk-control-plane/src/design-system/styles.css)), plus
  every hardcoded `font-size` declaration (down to 6px in places) scaled up
  via a monotonic mapping preserving the type hierarchy, across both
  `styles.css` and
  [command-center.css](apps/desk-control-plane/src/features/command-center/command-center.css)
  (349 declarations total).
- **KPI row wrapping/dead-space bug** (user-reported from a real Edge
  screenshot): `.cc-kpis` rigid 6-column `fr` template replaced with
  `repeat(auto-fit, minmax(212px, 1fr))`. Verified at 1920×1040 (the user's
  actual resolution): all 6 cards in one row, no dead space.
- **Same bug in the panel grids** (`.cc-grid--top/middle/bottom`): these had
  an identical rigid `@media (max-width: 1599px)` breakpoint forcing exactly
  2 columns regardless of actual fit. Measured each panel's real minimum
  content width (top 1044px, middle 1186px, bottom 1126px) and confirmed via
  live overflow testing that the natural fluid columns hold down to ~1390px.
  Lowered the forced-2-column breakpoint to 1399px (from 1599px), reclaiming
  ~200px of viewport range that was wrapping unnecessarily. Verified no
  horizontal overflow at the new boundary (1340px still safe via fallback,
  1420px clean via natural columns).

**This is built into `front-vnext-20260820.1` but not live** — see the
incident above. Once the VPS deploy issue is resolved and this release
installs successfully, these fixes go live automatically as part of that
same deploy.

---

## 3. Broader frontend improvement work (in progress, autonomous)

Per the user's instruction to continue improving the frontend
autonomously while away: remaining small fonts (without growing
containers), component widths, a naming formatter to remove backend
technical names from the UI, general polish, and the same pass on the Live
Trading screen.

### 3.1 Remaining illegible fonts (done)

Beyond Command Center, three more CSS files had the same 5-11px
illegibility problem: `live-trading.css` (worst — down to **5px**),
`order-intent.css`, `operator-menu.css`. Scaled all 74 remaining
declarations with the same monotonic mapping used for Command Center.
Commit `673dd2a`.

### 3.2 Live Trading layout check (done — no bug found)

Checked whether Live Trading has the same rigid-grid dead-space/wrapping
bug as Command Center's KPI row. It doesn't: `.lt-grid` uses fixed-px side
rails + one flexible middle column (not proportional `fr` units across
uniform cards), which doesn't produce the same failure mode. Measured no
horizontal overflow at 1920px or 1550px. The "same problems" the user
reported on this screen were the font-size issue, now fixed.

### 3.3 Technical-name removal — shared label system (in progress)

Dispatched a research pass that mapped where raw backend enum codes
(`SHADOW`, `RUNNING`, `DEPLOYMENT_DRAIN`, etc.) get rendered directly to
the operator. Findings: a decent pattern already existed
(`features/order-intent/statusRegistry.ts`, French labels + tone) but only
covered order-lifecycle statuses in 2 files; ~8 other vocabularies
(strategy execution mode, deployment/ops status, provider availability,
RBAC permissions/decisions, incident severity, gate state, session state)
rendered raw across ~10+ pages.

Built [`design-system/labels.ts`](apps/desk-control-plane/src/design-system/labels.ts):
a set of `presentX(rawCode)` functions, one per vocabulary domain, each
returning `{ label, tone }` — French label for known codes, and for any
code without an explicit entry, a **humanized fallback** (spaces instead
of underscores, capitalized) so nothing ever renders as raw
`SCREAMING_SNAKE_CASE`, even for codes not yet catalogued.

**Wired in so far** (verified via `tsc --noEmit`, the full test suite —
173/173 passing throughout — and live browser checks against real BFF
data, including the actual 67-strategy data-driven catalog deployed
earlier this session):
- `LiveTradingPanels.tsx` / `LiveHumanGate.tsx` — worst offender, most
  operator-critical screen (runtime state, availability, signal state,
  reconciliation, provider status, kill switch, AI advisory mode).
- `StrategyCenterPage.tsx` — execution mode, version status, runtime
  status, live health, gate state, command eligibility, event severity.
  Confirmed live: `SHADOW`/`DRAFT`/`STOPPED`/`OFF` now render as
  *"Observation seule"*/*"Brouillon"*/*"Arrêtée"*/*"Inactive"*.
- `OperationsQueuePage.tsx` — mission/event/gate state, permission,
  incident severity. Removed the page's own weak local label helpers
  (`stateLabel`/`eventLabel`/`gateLabel`/`permissionLabel`) now
  superseded by the shared registry.
- `ExecutionProvidersPage.tsx` — provider/account/adapter availability,
  health-check result, switch-workflow state, event status, incident
  severity, permission.
- `AdminAccessPage.tsx` — access mode, user status, MFA state, RBAC
  decision, provider access level, audit outcome, risk level.
- `AuthSessionPage.tsx` — session state, environment status, step-up
  method availability, RBAC decision, audit event status. Confirmed live:
  `READ_ONLY`/`LOCKED`/`ALLOW`/`DENY` now render as *"Lecture seule"*/
  *"Verrouillé"*/*"Autorisé"*/*"Refusé"*.

- `RiskCenterPage.tsx` — exposure/correlation/constraint/breach status,
  stress-test state, risk-check result, free-form reason codes.
- `LiveSignalDetailPage.tsx` — signal lifecycle state, predicate/feature-
  snapshot status, arbitration decision, conflict resolution, linked-order
  state, AI advisory mode/recommendation.

Commits `673dd2a` (labels.ts + LiveTrading + StrategyCenter), `e9d1c82`
(Operations Queue, Execution Providers, Admin Access, Auth Session), and
`4657227` (Risk Center, Live Signal Detail). **All 9 pages the audit
flagged as raw-string-dense are now migrated.** Full test suite (173/173)
and `tsc --noEmit` clean after every commit in this section.

### 3.5 Shared KPI-strip width check (done — no bug found)

Checked whether the shared `.operator-kpi-strip` class (used by all 7 of
the pages above, defined once in `design-system/styles.css`) had the same
rigid-column bug as Command Center's original KPI row: it's a
`@container`-based (not `@media`) responsive rule, fixed 3 columns below
a 1281px container width and fixed 6 columns above it. This pattern *can*
produce the same dead-space bug Command Center had, but every one of these
7 pages renders exactly 6 `KpiCard`s (confirmed via grep), which divides
evenly into both 3 and 6 columns — no uneven trailing row is possible.
Measured card widths at 1100px and 1920px viewports: ~275px either way,
consistent, no dead space, no wrapping. Left as-is — this one turned out to
already be fine, unlike Command Center's.

### 3.4 Note: concurrent modifications to unrelated files (confirmed)

While working, `git status` repeatedly showed uncommitted changes
accumulating in `mcp_gpt_desk/src/research/*` and
`mcp_gpt_desk/test/*` — files I never touched this session. I left these
alone and excluded them from every commit above.

**Confirmed, not just suspected:** a `git push` at the end of this session
came back as `22a4066..f750b2d` instead of the `4657227..f750b2d` I
expected — meaning another process pushed commit `22a4066
feat(research): add diversified v2 strategy cohort` to `main` directly,
in between my own pushes, while this session was running. This is almost
certainly the same autonomous research/Codex worker referenced elsewhere
in this repo's docs, actively running its own campaign and shipping to
`main` concurrently with this session. It merged cleanly (fast-forward,
no conflict), so no action was needed from me, but it's worth knowing two
agents were writing to the same branch at the same time this session —
and it may also explain the mysterious recurring `Test-DeskLocalHealth.ps1`
process noted in section 1 (theory (b) there).

---

## 4. Live Trading redesign against the user-provided reference mockup

The user shared a screenshot of the original target design for Live
Trading (the mockup Codex was meant to implement) and asked for the
screen to be rebuilt toward it, backend included. Commits `65bb847`
(frontend structural fixes) and `aff6e9d` (backend data wiring).

### 4.1 Frontend structural fixes (commit `65bb847`)

Three data-backed gaps closed using data the frontend already had:
- Instrument chart now overlays Entry/Stop/Target as labeled dashed price
  lines (from the pending OrderIntent's existing limitPrice/stopPrice/
  targetPrice — previously only shown as plain text elsewhere, never
  drawn on the chart).
- Position Reconciliation: replaced the raw `<pre>{key: value}</pre>` JSON
  dump with a proper two-column table per side plus a circular sync/diff
  status badge.
- Human Execution Gate: added Initiated By / Requested At / Expires In
  (live countdown) directly on the main panel.

### 4.2 Backend evolution (commit `aff6e9d`)

Investigated where the remaining mockup gaps' data actually lived in the
backend before writing anything (see the dispatched investigation — full
findings not reproduced here, only the outcome). Three of four gaps had
real data sitting unused elsewhere in the backend; wired all three in:

- **Watchlist** (`liveWatchlist()` in `front-live-trading-support.js`):
  `getFrontLiveMarketSnapshot()` already computed per-symbol
  last/change%/intraday-series for MNQ, MES, CL, NVDA, AAPL, MSFT, TSLA,
  SMH, SOXX — used only by the Sessions view until now. Added as a
  `live-trading` resource dependency, replaced Market Context's old
  pipeline-health table (which was showing internal source names under a
  misleading "Market Context" label) with the real watchlist + sparklines.
  **Note:** the mockup's exact symbol list (adds VIX, QQQ) isn't fully
  covered — those two aren't in the configured instrument specs and I did
  not confirm real market-feed data exists for them, so they're left out
  rather than added blind. In the local dev DB only MNQ and MES currently
  have data; the other 7 configured symbols return no rows there (expected
  for a dev database, not a bug).
- **Hit-rate + cumulative-R chart**: `getOperationsPerformance()` already
  returns `totals.winRate` and a proper cumulative-R equity series, but
  `livePerformanceR()` was silently dropping both. Extended it to surface
  `hitRatePct` and a capped 60-point series; added a cumulative-R
  sparkline to the Performance panel.
- **Per-instance confidence**: no direct field exists on strategy
  instances. Derived it (`liveInstanceConfidence()`) by joining each
  active instance to its own most recent **non-expired** signal's
  confidence — both already loaded in the same view-builder call, joined
  on `strategyInstanceId` (the same key used throughout this codebase).
  Returns `null` (rendered as "—") when an instance has no current active
  signal, rather than showing a stale number.
- **Explicitly not attempted**: a second take-profit target on the order
  intent. The data exists (`setup.take_profit_2`/`tp2` in the session/
  thesis domain, confirmed via `front-session-projection.js`) but wiring
  it requires a new resource dependency plus a join key between an order
  intent and its originating setup that I could not confirm is reliable.
  Getting a trade price wrong is worse than omitting it — left for a
  follow-up with more careful backend investigation rather than guessed
  at here.

### 4.3 Verification

The local `api` Docker container (`tv-automation-preprod-api-1`) runs
from a built image, not a live source mount — had to `docker compose
build api && docker compose up -d api` to pick up the backend changes
before they'd show up (worth knowing for next time: editing
`mcp_gpt_desk/src/*.js` alone does nothing to the running local backend
until it's rebuilt). Verified via direct `fetch()` against the running
endpoint, not just type-checks:
- Watchlist: real MNQ/MES quotes + 30-point sparklines confirmed in the
  live response.
- `hitRatePct`/`series`: correctly `null`/`[]` (no closed trades in the
  local dev DB — honest empty state, not a bug).
- Confidence: correctly `null` → renders "—" for all 42 currently-active
  instances (0 active signals in this environment right now, also an
  honest empty state).
- Caught and fixed one real bug during verification: the confidence cell
  briefly rendered `"NaN%"` because the original `=== null` check didn't
  account for the value arriving as `undefined` from a stale cached
  response during the container restart window. Fixed to check
  `typeof === "number"` instead, reverified clean via hard reload.
- Backend test suite 32/32, frontend suite 173/173, `tsc --noEmit` clean
  on both sides, throughout.
- The `tv-automation-preprod-api-1` container shows Docker health status
  "(unhealthy)" — confirmed this predates my changes (it was already
  unhealthy the first time I checked, before touching anything) and the
  API demonstrably serves correct requests despite the label. Not
  something I chased down — out of scope for this task, flagging it here
  in case it's actually meaningful and worth a separate look.

### 4.4 Second round after live feedback on the actual rendered screen (commits `371beaf`, `3db8367`)

User checked the rendered screen against the mockup and gave four
concrete, specific complaints — much more actionable than guessing at
pixel fidelity, and all four were real:

1. **Strategy names unreadable** (raw UUIDs like `a28b6e39` in Active
   Strategy Instances). Fixed by resolving each instance's
   `strategy_definition_id` (or its version's, via the existing
   version→definition map) against `strategy.definitions`' real `name`
   column — the same mechanism Strategy Center already uses. Backend
   change in `activeStrategyInstanceRows()`
   (`front-control-plane-domain-completeness.js`). Real result in the
   local dev DB: 10 of 42 instances resolve to a real name (e.g.
   *"Data-driven MES — VWAP upper deviation fade short"*); the other 32
   have a genuinely unavailable `strategy_definition_id` in the
   underlying data — a real gap, not hidden, falls back to a shortened id.
2. **Chart dominating the whole right side of the screen.** Root cause:
   `.lt-grid`'s chart column used `minmax(560px, 1fr)` while the other
   three columns were fixed pixels, so on any viewport wider than the
   1599px breakpoint, 100% of the extra space went to the chart alone.
   Measured the mockup's actual column proportions (~290:580:230:290px)
   and changed all four columns to `minmax(floor, fr)` with matching fr
   ratios (1.25 : 2.5 : 1 : 1.25) so the whole row scales together.
   Verified: 274:547:219:274px at 1400px viewport, ratio held, no
   overflow.
3. **Macro/Session card too wide.** Switched to the already-existing
   2-column definition-list layout (`Session|Market state`,
   `Trading date|Timezone`, `Last known|Signal cutoff`) instead of one
   pair per row, matching the mockup's denser layout; bumped value text
   12px → 13px since the layout is more compact now.
4. **General style fidelity** ("really respect the mockup — layout,
   width, style, colors, down to the details"). Did a second, more
   targeted pass on the specific components most visually far from the
   mockup: Provider Runtime's tiny unlabeled 11px dots replaced with
   large numbered circles (1, 2, 3…) on a connecting line, matching the
   mockup's stepper; Human Execution Gate's status text turned into a
   proper uppercase badge instead of plain bold text, plus added the
   "View Audit" link the mockup always shows (was missing entirely);
   AI Context/Portfolio/Global Risk's authority rows now render their
   status as colored `StatusBadge` chips instead of plain text, matching
   the mockup's badge-heavy visual language.

Verified in a **fresh browser tab** — an existing tab had accumulated so
many rapid HMR reloads across this session that it got stuck in a broken
dev-only state (`"signal is aborted without reason"`); confirmed via a
clean tab load this was a Vite dev artifact, not a real bug, before
concluding anything. Full suite 173/173, `tsc --noEmit` clean throughout.

**Where this stands:** the structural/proportional fidelity issues (the
ones a screenshot comparison can actually catch precisely) are fixed and
verified. Further fine visual-detail matching (exact border-radius,
exact spacing values, etc.) is harder to verify reliably without a
proper side-by-side comparison tool — I did not keep guessing at pixel
values I couldn't confirm against the mockup. If there's more still off
after this round, the same pattern that worked twice now (you look at
the real rendered page and point at specific things) will be much faster
than me iterating blind.

## 5. Menu redesign, clipping bugs, and click-to-expand panels

Third round of user feedback, three items: the sidebar menu is
disorganized/not centralized (full redesign explicitly authorized);
Human Gate's Confirm/Reject buttons are cut off and Provider Runtime's
content overlaps; add a click-to-expand/zoom capability to panels.

### 5.1 Clipping/overlap bug fix (commit `a4585d6`)

Regression from my own previous commit (`3db8367`): adding Human Gate's
metadata row + "View Audit" link, and enlarging Provider Runtime's
numbered circles, grew both panels' needed content height without
checking their containing grid rows still had room. Measured with
`getBoundingClientRect`/`scrollHeight` this time instead of guessing
(the mistake last round). Root causes: Provider Runtime's row was a
hardcoded `94px` that never grew with viewport height while its content
now needed ~130px; some of my new additions were less compact than
necessary. Fixed by: bumping the hardcoded row to 130px, tightening the
new additions (saved ~45px without shrinking any font), and — since even
after tightening some viewport heights genuinely can't fit every panel's
natural content with zero slack anywhere to redistribute from — applying
this app's own existing pattern for exactly that situation
(`overflow-y: auto`, already used by 4 other panels) so content that
doesn't fit becomes scrollable instead of invisibly hard-clipped.
Verified the actual complaint, not just "no CSS overflow flag": Confirm/
Reject buttons and all 5 provider steps confirmed fully within visible
bounds at both 850px and 960px viewport heights without needing to
scroll; confirmed zero pixel gap/overlap between provider steps and the
panel footer.

### 5.2 Sidebar menu redesign (commit `d15063d`)

Investigated before writing any code: a complete grouped-sidebar system
already existed — `routes.ts`'s `navGroup` taxonomy, a
`groupRoutesByNavigation()`/`NAV_GROUP_LABELS` helper in
`shell/navigation.ts`, and a `.sidebar-nav-group`/`h2` CSS block in the
design system — but `DeskShell.tsx` just rendered all 14 nav items as one
flat `.map()`; the grouping data was only ever consumed by the search
dropdown and breadcrumb, never the persistent sidebar.

Didn't reuse the existing 9-way taxonomy for the sidebar itself (6 of
those groups have exactly one item each — would render as 6 near-empty
one-item sections, not more "centralized"). Defined a separate,
sidebar-specific 5-section grouping instead: **Pilotage** (Command
Center, Live Trading), **Stratégie** (Strategy Center, Research Lab,
Replay, Performance), **Exécution** (Portfolio, Risk Center, Orders,
Execution), **Supervision** (Incidents, Audit), **Système** (Jarvis,
Settings). `routes.ts`'s own taxonomy is untouched — breadcrumbs/search
still use it as before.

Wired into all three sidebar widths in the app: default shell (210px,
full text headers), Command Center's rail (164px, headers fit, added
matching styling, hidden at its own icon-only collapse breakpoint),
Live Trading's rail (96px, too narrow for header text at any size — same
grouping renders as a visual divider instead of a label). Verified
in-browser on all three: correct labels/order, no horizontal overflow,
negligible (2px, pre-existing) vertical overflow on Command Center's
already-scrollable nav.

### 5.3 Click-to-expand panels (commit `b88611c`)

New capability: every panel on Live Trading (all 13, via the shared
`LivePanel` component) now has an expand button in its header. Clicking
it grows the same panel to ~920×720px, centered over a semi-transparent
backdrop (`rgba(2,8,19,.72)`) — the live screen stays visible, dimmed,
behind it, matching "une pop-up centralisée avec l'écran live derrière"
exactly. Closes via backdrop click or Escape.

Implementation choice worth recording: no React portal, no content
duplication. The panel just switches to `position: fixed` in place — same
component instance, same position in the tree, so no state is lost and no
double-render/sync risk for panels with local state (Human Gate's confirm
dialog). `position: fixed` correctly escapes every ancestor's
`overflow: hidden` (`.lt-grid`, `.lt-execution-rail`, etc.) since none of
them use a `transform` that would create a new containing block — this is
the whole reason a portal wasn't needed here.

One real bug caught during verification, not by luck: Human Gate's own
inner confirm dialog was `z-index: 50`. With the expanded panel at 901,
the dialog would have rendered *behind* an expanded Human Gate panel —
bumped it to 950. Only found this by actually exercising the interaction
(expand the panel → try to open its dialog), not by checking the toggle
in isolation.

Also hit — twice now — the same stuck-dev-tab artifact from prior
rounds (rapid HMR reloads leave a tab's module graph in a broken state
where clicks silently no-op); resolved every time by testing in a freshly
opened tab instead of debugging the stale one. Worth remembering for next
time rather than re-diagnosing from scratch.

**Explicitly scoped out, not forgotten:** the user asked for this "pareil
pour les autres composants du front" (same for the other front
components). This commit only touches `LivePanel` (Live Trading-only).
Every other page in the app uses the shared `Card` component from
`design-system/primitives` instead — extending the identical pattern
there would make expand-to-zoom available app-wide with one change, and
is the natural next step, but is a separate, sizeable piece of surface
area (used across ~20 pages) that wasn't attempted in this pass.

Full suite 173/173, `tsc --noEmit` clean after every commit in this
section.

---

## 6. VPS deploy — resolved (2026-08-21)

User confirmed presence and asked directly to commit/push and deploy to
the VPS. Since the classifier's earlier blocks (section 1) were about
touching production without a human present, not the actions
themselves, this time went ahead.

**Status check first:** re-read the VPS read-only — all 11 services were
already back up and `current` had moved to
`mega-2000-diversified-v3-research-20260820.1`. The concurrent worker
(Codex) had completed its own deploy and resolved the drained-services
state on its own at some point after section 4 was written. Checked
whether they'd also fixed the root cause: `SHOW lc_messages` on the
migration connection still returned `French_France.1252` — **not**
fixed, they'd just not triggered a NOTICE-producing statement in their
deploy. My deploy would still hit the exact same wall (the schema
migration step's ledger-table bootstrap unconditionally runs
`CREATE TABLE IF NOT EXISTS`, which always produces an "already exists"
NOTICE against a table that's existed since day one).

**Build:** the working tree had Codex's own in-progress uncommitted
changes (`mcp_gpt_desk/src/research/*`, two test files, one script) that
would have made `Build-DeskRelease.ps1` refuse to run (it requires a
clean tree). Used `git stash push --include-untracked`, built release
`front-vnext-20260820.2` from the clean, fully-committed `main` HEAD
(capturing every commit from this whole session plus Codex's committed
work), then `git stash pop` immediately after — nothing of theirs was
touched or lost, just set aside for the ~4 minutes the build took. Ran
the build *without* `-SkipTests` this time (full backend test suite as
part of the build, not just my own quick checks) given this was going
straight to production.

**Deploy, this time avoiding the known trap:** rather than retry the
config-file edit or wait on a human to do it, set
`PGOPTIONS="-c client_min_messages=warning"` as a session environment
variable for the *entire* `Update-Desk.ps1` invocation (not just an
isolated psql call like the earlier diagnostic) — every psql process
spawned during the deploy inherits it, so the broken French-locale
NOTICE text never gets sent to any client to fail decoding in the first
place. Worked cleanly end to end: backup → drain (0 active work) →
schema migration (all 57 migrations correctly `SKIP`ped, ledger current,
zero errors) → canary passed → all 11 services reinstalled and
restarted → public smoke test passed (front/health/readiness/oauth all
200) → claims and broker-execution lock automatically restored to their
pre-deploy state by the update script's own success path. Exit code 0.

**Verified against the live public URL, not just the deploy log:**
navigated to `https://vps-6d6969db.vps.ovh.net/#/live` directly — sidebar
grouping present, panel expand buttons present, watchlist now returns all
9 configured symbols with real quotes (better coverage than the local dev
DB's 2), `performanceR.hitRatePct` field present.

**New finding, not chased further today:** of the 173 currently-active
strategy instances in production, **zero** resolved to a real name (vs
10 of 42 locally) — every single one has `strategyDefinitionId:
"unavailable"` and no match via the version→definition fallback either.
Suspect `loadStrategyV2Overview`'s hardcoded `limit: 500` on
`listVersions`/`listDefinitions` doesn't actually cover every version tied
to an active instance once the catalog grows this large (173 active
instances plus however many retired/historical versions exist could
plausibly exceed 500 combined, especially given how many strategies
recent research campaigns have generated) — but this is a hypothesis, not
confirmed. Instance names in production still fall back to a shortened
UUID rather than showing something wrong, so this is a missed
improvement, not a regression or a truth violation. Worth a dedicated
look if strategy names in Live Trading matter enough to chase — flagging
rather than guessing at a fix under production pressure.

Nothing left uncommitted on my side; Codex's own uncommitted research
files were restored exactly as found.

## Section 6 — Strategy Center and Research Lab rebuilt to match new mockups

After Live Trading, the user shared two new reference mockups (Research
Lab, Strategy Center) with the same standing instruction as before:
match structure/colors/sizing exactly to what was built for Live
Trading, evolve the backend as needed, don't invent data. Dispatched a
background investigation agent first to map, item by item against both
mockups, what backend data already existed vs needed new wiring vs
didn't exist at all — its report (12 mockup items across both screens)
drove every decision below instead of guessing.

### Strategy Center

**Backend (`mcp_gpt_desk/src/front-control-plane-api.js`,
`strategyCenter()`):** previously a near-stub — `selectedInspector.gates`
was hardcoded to `[]` and `thesis` a static placeholder. Rebuilt to
thread a new `strategy-promotion-lineage` dependency (see below) plus
`performance` into the view, and now returns, for the operator-selected
strategy:
- **Meta grid** — owner, published date, build hash, session scope,
  deployment mode, entry/stop/target/risk model (reusing the existing
  `strategySpecProjection` helper). Two fields (Volatility Filter, Max
  Trades/Session) have no backing column anywhere in the schema —
  verified by grep, not fabricated, and simply not rendered rather than
  invented.
- **Gate Progression (G0–G7)** — real data from
  `research_evaluation_reports.criteria_snapshot.gates`, keyed to the
  exact `research_candidate_id` for the *selected strategy version*
  (not just "some recent candidate"). Relabeled the eight raw gate keys
  (`G0_DATASET_VERSIONED` → "G0 · Données versionnées", etc.) to French
  without changing their underlying semantics.
- **Validation & Performance** — equity curve and expectancy/PF/win-rate/
  max-DD sourced from `getPerformanceOverview({ strategyId })`, the same
  persisted trade/equity data already used by the Performance pages.
- **Runtime Instances table** — reuses the strategy's own `instances[]`
  (already loaded, previously discarded after picking one "primary"
  instance), enriched with a real per-instance "signals today" count.
- **Research Lineage flow** — a genuinely new join: candidate →
  hypothesis → experiment → (winner run, if any) → strategy version →
  instance, each with a real timestamp.

**The interesting bug this surfaced:** the obvious way to fetch gates
(reuse the `research` dependency already loaded for the Research Lab
view) silently returns nothing for almost every strategy, because that
dependency is capped at `limit: 100` out of **3,335** candidates and
**5,850** evaluation reports — any candidate outside the newest 100 is
invisible to it. Confirmed this by direct Postgres query before writing
a single line of fix, per the debugging discipline used all session:
counted the real table sizes, found a candidate a strategy actually
resolved to, and verified it fell well outside the top-100 slice.
Fixed properly rather than just raising the limit (which caps at 500 in
the repository regardless, still not enough): added a `strategyVersionId`
filter all the way down through
`research-experiment-registry-repository.js` →
`research-experiment-registry-service.js`, added a new targeted store
method `getStrategyPromotionLineage({ strategyVersionId })`, and a new
front-control-plane dependency that only fires when the frontend passes
a concrete `strategyVersionId` — which it now does, via a two-phase
fetch (load once with no selection to learn the backend's own default
pick, then immediately refetch scoped to that exact strategy so gates/
equity/lineage all resolve correctly on first paint, exactly mirroring
what happens when an operator clicks a different row).

**Second bug caught in the same pass:** the frontend's initial "click a
strategy" handler forwarded `strategyVersionId: "none"` verbatim for any
strategy that has no published version yet (a real, valid state — 105
of 127 current strategies are still DRAFT). `"none"` is not a UUID, and
it was landing straight in a Postgres `::uuid` cast two different ways
(one in the new lineage lookup, one already-existing in
`loadStrategyV2Overview`), producing a `22P02 invalid_text_representation`
error that the source-degradation system caught gracefully but still
blanked the entire strategy catalog for that render. Fixed by only
forwarding a `strategyVersionId` when it's a real, non-sentinel value
(both in the React state setter and as a defense-in-depth UUID-shape
regex guard server-side, since a malformed query param should degrade
one dependency, not silently produce a confusing "0 strategies" flash).

**Frontend:** new `features/strategy-center/strategy-center.css`
golden-surface stylesheet, reusing the exact same token palette as
Live Trading (`--sc-*` aliasing the same hex values as `--lt-*`, per the
user's "respect what was built" instruction) rather than inventing a
fourth look. `StrategyCenterPage.tsx` rebuilt around a two-column
cockpit: catalog (clickable, searchable-by-scroll list of all 127
strategies) on the left, and a stacked inspector (meta → gates → equity
chart w/ R-Multiple/Distribution tabs → runtime instances → lineage
flow) on the right, keeping the existing "performance by family / top
strategies / recent events" analytical row underneath largely as-is.
Wired a new `desk-app-shell--strategy-center` golden-surface class into
`DeskShell.tsx` alongside Command Center/Live Trading's.

**A CSS bug caught before calling it done:** first render showed the
header correctly but a completely blank body below it. Root cause (found
by comparing computed styles against Command Center's working pattern,
not guessing): the golden-surface override that gives `.desk-content`
`height:100%; overflow:hidden` so the page's *own* single child can
fill and scroll independently didn't exist yet for
`--strategy-center` — the generic default `.desk-main` grid
(`64px topbar-row / 1fr / 30px footer-row`) was still active, and with
no topbar/footer rendered (golden surfaces suppress those), the page's
lone child collapsed into just the first 64px row. Added the same
`.desk-main`/`.desk-content` override Command Center already has.

### Research Lab

**Backend:** additive only — nothing removed, so the existing
experiment/pipeline-shaped view keeps working for any other consumer.
Added:
- A real **Research Activity Stream**: `agent_events` had been written
  to on every task claim/complete/fail since early in the project but
  never read back anywhere. Added `LIST_EVENTS` to the (fixed, enum-style)
  `AGENT_RUNTIME_ADMIN_ACTIONS_V1` policy whitelist in
  `packages/desk-domain`, a `listEvents()` method on
  `AgentRuntimeAdminService`, and wired it through as a new
  `activityStream[]` field.
- **Active Workers heartbeat/lease** — the columns
  (`lease_expires_at_utc`, `updated_at_utc`) already existed on
  `agent_tasks`, just weren't threaded through `projectTask()`'s mapping;
  now exposed as `leaseActive`/`leaseExpiresAt`/`lastHeartbeatAt`.
- **Candidate composite score** — a transparent weighted blend
  (`robustness × 0.5 + max(0, OOS R) × 10 × 0.3 + max(0, Sharpe) × 20 × 0.2`)
  computed from data the view already carried, so "Candidate Ranking"
  isn't dominated by one noisy metric.

**A second, more subtle key-collision bug, only visible with real
production-scale data:** `agentRow()`'s `agentId` field had silently
always been the *task* id, because the code was reading
`item.worker_id`, a field that doesn't exist on the actual query result
(`projectTask()` returns `assigned_worker_id`) — a pre-existing typo bug.
Fixed the field name (so `agentId` now genuinely identifies the worker),
but that surfaced a real consequence at scale: one batch-runner worker
identity (`data-driven-mes-v2-robustness-batch-001`) legitimately owns
44 of the 50 rows shown, so using `agentId` as the React list key
produced 44 duplicate-key warnings and (per React's own docs) undefined
child identity. Added a `taskId` field specifically for list-key use
(genuinely unique per row) rather than repurposing `agentId` back into
a dual-meaning field. Caught by reading the *browser console*, not just
the rendered screenshot — the visual output looked fine even while
React was warning underneath, and a stale HMR tab briefly made the fix
look like it hadn't taken effect until verified in a fresh tab (the
same recurring artifact noted earlier this session).

**Frontend:** new `features/research-lab/research-lab.css` (same
token-palette-reuse approach as Strategy Center). `ResearchLabPage.tsx`
rebuilt around: KPI strip → horizontal pipeline tracker → a two-column
grid (Mission Queue table + click-to-inspect "Selected Mission" panel
on the left; Active Workers, Candidate Ranking, and the new Activity
Stream on the right) → the existing Datasets/Knowledge-Graph/Compute-
queue/Incidents analytical row kept underneath, re-skinned into the new
panel style rather than rebuilt from scratch.

**Verification:** both screens checked against the real local Docker
backend (rebuilt after every backend change) with actual production-
scale data — 127 strategies, 3,335 research candidates, 5,850
evaluation reports, 50 active agent-runtime rows — not synthetic
fixtures. Full test suites green throughout: 36/36 backend
(`front_control_plane_api`, `research_lab_front_projection`), 3/3
`desk-domain` policy tests, 179/179 frontend (`vitest`), plus a clean
`tsc --noEmit` (caught, the hard way, that piping `tsc` through `head`
silently hides a non-zero exit code — re-ran capturing the real exit
code after a first pass wrongly looked clean).

## Section 7 — Full French-translation pass

The user's final, explicitly emphasized ask for this round: no English
text left anywhere in the front-end. Before touching anything, dispatched
a read-only investigation agent to inventory every remaining English
string across all ~48 non-test, non-mock frontend files — it came back
with a large, precise file:line list plus several cross-cutting patterns
(the same `<InlineAction>Command Runtime</InlineAction>` eyebrow repeated
in 16 files; `"Reason obligatoire"` — a mixed English/French form label —
in 8 files; local `permissionLabel()`/`statusLabel()` helpers in half a
dozen research/strategy pages that duplicated, in raw English, what the
shared `design-system/labels.ts` registry already does correctly in
French elsewhere).

**One judgment call worth recording:** the four main section names
("Command Center", "Live Trading", "Strategy Center", "Research Lab")
are used constantly throughout the app as page titles, nav entries, and
cross-links. Given the user has used exactly these English names
themselves while speaking French about this app, it was genuinely
ambiguous whether they were living jargon/branding or leftover English —
asked directly rather than guessing on something that pervasive.
Answer: translate them too, no exceptions. Settled on Centre de
contrôle / Trading en direct / Centre des stratégies / Laboratoire de
recherche, plus Rejeu for "Replay" and Centre de risque for "Risk
Center" — applied consistently everywhere those names appear (routes,
sidebar, headers, breadcrumbs, cross-page links, search targets).

**Execution:** handled the shared, high-blast-radius files directly
(`app/routes.ts`, `shell/navigation.ts`, `shell/DeskShell.tsx`,
`design-system/{primitives,states,actions,labels}.tsx`,
`domains/permissions/PermissionGate.tsx`) plus every file touched
earlier this session (Live Trading panels/header/human-gate, Strategy
Center, Research Lab) myself, for consistency with what was already
built. Dispatched 6 parallel background agents for the remaining page
clusters (Command Center panels; the 6-subpage `OperationalP0Pages.tsx`;
Orders/Risk/Execution/Admin/Auth/Settings; order-intent + live-signal +
position/incident detail; the remaining research/strategy detail pages;
audit/ops/Jarvis/explorer), each given the exact file:line findings,
the settled naming conventions, and firm guardrails (display text only,
never touch backend field names/command types/payload keys, wire raw
badges through the existing `presentX()` labelers instead of hardcoding
French, verify with `tsc`+`vitest` before reporting back).

**What went sideways, and how it was caught:** partway through, the
session hit its usage limit and all 6 agents were killed mid-work; some
had only read files without editing yet, others had edited several
files and were mid-verification. Rather than trust the "reset, please
continue" cue at face value, checked `git status` to see exactly which
files had real edits, then re-diffed against `HEAD` file-by-file for
anything ambiguous. That surfaced something important: `mapper.ts`,
`model.ts`, and the golden-master test in `features/live-trading/` had
a large, unrelated, uncommitted diff — Codex's own in-progress feature
(`targetPosition`, `theoreticalExecution`, `deriveAuditTimeline`) sitting
in the same working tree, already producing one pre-existing test
failure before any translation work touched it. Confirmed it wasn't
mine, left it untouched, and made sure every subsequently re-dispatched
agent was told explicitly to leave that one test alone rather than
"fix" someone else's in-flight work.

Translating did legitimately break 3 (different, mine) test assertions
that hardcoded the old English strings — expected, since the strings
themselves changed. Fixed the assertions to match the new French text
rather than reverting the translation.

**Post-agent audit:** rather than take the six "done" reports at face
value, ran repeated global greps across the whole `src/pages` and
`src/features` trees afterward (`title="..."`, `aria-label="..."`,
`placeholder="..."`, all-caps `label="..."`) looking for anything still
English. Found and fixed a real, if smaller, tail the agents' scoped
instructions hadn't covered: the `Command Runtime` eyebrow in 6 files
none of the prompts had explicitly listed it for; two of my own
Strategy Center/Research Lab panel headers where the visible `<h2>`
still said the English name while the `aria-label` right next to it
already said the French one; `PortfolioPage.tsx` (never assigned to any
agent) still rendering raw `executionMode`/`health` enum codes and an
English "Strategy instance" column header; a handful of `aria-label`s
still carrying the untranslated section names (`"Indicateurs Risk
Center"`, `"Indicateurs Orders"`, etc.); "Replay" left untranslated in
`ExplorerPages.tsx`'s route definitions even after the app-wide rename
to "Rejeu"; and 10 leftover English mock `label:` strings in
`canonicalDataset.ts`.

**Verification:** `npx tsc --noEmit` clean throughout every round.
`npx vitest run` at 180/181 passing at every checkpoint — the sole,
constant exception being the one Codex-owned pre-existing failure,
confirmed unrelated and deliberately left alone. `design-system/labels.ts`
grew by roughly a dozen new `presentX()` entries over the course of
this pass (`presentConnectionStatus`, `presentCommandStatus`,
`presentResearchDecision`, `presentDomain`, `presentRelationKind`,
`presentDeviceState`, `presentNotificationSeverity`,
`presentIncidentStatus`, `presentIncidentDomain`, `presentChronologyState`,
`presentRetryState`, `presentReconciliationStatus`, `presentOperatorGate`),
each replacing a spot that had been silently rendering a raw backend
enum code instead of a French label.

Not yet done: committing/deploying this work — pending, same as every
other round this session, on the user being present to authorize a
VPS-touching deploy.

## Section 8 — Backend work silently reverted, reconstructed; commit and deploy

The user said "YES" to committing and deploying everything above. Before
running any git command, did the usual pre-flight `git status` — and
found that `mcp_gpt_desk/src/front-control-plane-api.js` had **zero
diff against HEAD**: `strategyCenter()` was back to a bare stub
(`gates: []`, `lifecycleDistribution: []`, hardcoded zeros), `agentRow()`
back to its pre-fix, mis-keyed version, the whole `research-lab`
`agent-events` wiring gone. Confirmed via `git show HEAD` that this
exact stub *is* what's committed — none of Section 6's backend work
(Tasks around gates/lineage/instances/equity/composite-score) had ever
actually landed in git; it had only ever existed as uncommitted
working-tree content, and something wiped it back to HEAD.

**Root cause, found via `git reflog`:** three entries mid-session —
`checkout: moving from main to codex/theoretical-execution-hotfix-20260821`,
a commit on that branch, then `checkout: moving from
codex/theoretical-execution-hotfix-20260821 to main`. Codex operates in
this same physical working tree (not a separate clone), and switching
branches there discarded uncommitted changes to any tracked file that
differed from the target branch — collateral damage to a completely
unrelated part of the same file, not anything adversarial. Checked
`git fsck --unreachable --dangling` for a recoverable stash/commit
first, before assuming the worst; the dangling objects found all
predated this backend work by hours, so recovery had to come from
directly re-deriving the code from earlier in this same conversation
rather than from git.

**Recovery:** rebuilt `strategyRow` (with the `selectStrategyInstance`/
`selectStrategyVersion` derivation helpers), `strategyCenter()` and its
six new helpers (meta row, the 8-gate mapping, lineage, runtime
instances, performance block, command eligibility), `agentRow`'s field
fix, and `researchLab`'s `activityStream`/`researchResultRow`'s
composite score — all from the exact code already produced earlier in
this conversation, not reconstructed from memory of intent. Verified
with the same rigor as the first time: `node --check` for syntax, then
the full backend suite (not just the two files touched) —
**1171/1173 passing**, one unrelated pre-existing failure, one skip.

**That one remaining backend failure turned out to be a second,
separate pre-existing gap**, surfaced only by running the full suite
instead of just the files touched today: `front_control_plane_api.test.js`
expects `marketSessionState()` (in `front-live-trading-support.js`, a
file with zero uncommitted diff of its own) to map
`market_session.state: "trading_day"` to `"TRADING_DAY"`; the committed
function only recognizes `OPEN/PREOPEN/HALTED/CLOSED` and reads a
different field path, so it falls through to `"UNKNOWN"`. Confirmed
this can't be something introduced by tonight's work (never touched
`marketSessionState`/`liveSession`/the `liveTrading()` builder) —
flagged it to the user directly rather than quietly shipping past it or
scope-creeping into fixing an unfamiliar feature under deploy pressure.
Asked the same way as the Codex test: ship with it documented, or stop
and investigate first. Same answer both times: ship, document.

**Frontend re-verified one more time after all of the above:**
`tsc --noEmit` clean, `vitest run` 180/181 (the one Codex-owned
failure, unchanged, still the only frontend exception).

Two known, pre-existing, out-of-scope failures ship with this release,
by explicit user decision after being shown each one directly rather
than discovered after the fact:
1. `src/test/liveTradingGoldenMaster.test.ts` — Codex's own in-progress
   `targetPosition`/`theoreticalExecution` feature, its own test not yet
   wired up on its end.
2. `mcp_gpt_desk/test/front_control_plane_api.test.js` — the
   `marketSessionState`/`TRADING_DAY` gap above.

Neither is reachable from anything shipped in this release's actual
user-facing changes (Strategy Center, Research Lab, the French pass);
both are pre-existing gaps this session's work happened to make visible
by running the full suite rather than a scoped subset.

**Committed and deployed.** Staged and committed the 70 files that are
this session's own work (commit `e1327a2`), explicitly excluding
Codex's separate, unrelated research-pipeline files by path — never
`git add -A`. Pushed to `origin/main` clean (fast-forward, no
divergence).

Building the release required stashing Codex's remaining uncommitted
research files again for a clean tree (`Build-DeskRelease.ps1` requires
one); this time, mid-build, Codex was caught actively editing one of
the very files just stashed (`canonical-strategy-evaluation-scheduler.js`)
plus a brand-new file (`strategy-signal-decision-pipeline-service.js`)
that didn't exist when the stash was taken. A plain `git stash pop`
correctly refused rather than overwriting that live edit. Recovered by
`git checkout stash@{0} -- <path>` for each of the 9 non-conflicting
files individually, leaving Codex's two actively-edited files
completely untouched, then dropped the now-empty stash. Nothing of
Codex's was lost or overwritten.

Used `-SkipTests` on the release build itself — not to skip
verification, but because the two known, user-approved pre-existing
failures would otherwise abort the build's own full-suite gate, and
everything had already been directly verified via `vitest`/`node --test`
immediately beforehand.

Deployed release `front-vnext-20260821.1` via `Update-Desk.ps1` with
the established `PGOPTIONS` workaround for the `lc_messages` encoding
bug. Full pipeline succeeded: native + object backup, all 57 schema
migrations correctly `SKIP`ped (ledger current), all 11 Windows
services reinstalled, local health check passed, public smoke test
passed (front/health/readiness/oauth-resource/oauth-server/webhook all
200), claims and broker-execution controls automatically restored.
Verified against the live public URL directly rather than trusting the
deploy log alone: the served `index-BKn9gzdW.js` bundle hash matches
this build's own output exactly, and the login screen itself now reads
"Identifiant" instead of "Login" — the French pass is confirmably live.
