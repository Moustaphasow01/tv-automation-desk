# Session Report — Frontend vNext & VPS Deploy Incident (2026-08-20)

Working document, updated live during an autonomous session. Written for the
user to review on return; most recent entries are at the bottom of each
section.

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

There is also one **unexplained still-running process** on the VPS observed
at the last status check: `Test-DeskLocalHealth.ps1` (PID 2964, started
11:28:20), which is a step that only runs *after* `Install-Desk.ps1`
succeeds (line 196 of `Update-Desk.ps1`) — later than where both of my
attempts failed. This is most likely an orphaned tail of the very *first*
deploy attempt (started 11:03, originally assumed killed by an 8-minute
tool-timeout) that kept running detached from the SSH channel and has been
slowly making progress in the background for ~25 minutes. It was left
untouched — do not assume it has failed or succeeded without checking fresh
service/DB state first, since it may resolve this incident on its own, or it
may be stuck on something else entirely.

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

Commits `673dd2a` (labels.ts + LiveTrading + StrategyCenter) and `e9d1c82`
(the four screens above).

**Not yet covered** (flagged by the audit, not yet migrated — next up if
time allows): `RiskCenterPage.tsx` and `LiveSignalDetailPage.tsx` surface
raw backend `reasonCode` strings directly as user-facing copy.

### 3.4 Note: concurrent modifications to unrelated files

While working, `git status` repeatedly showed uncommitted changes
accumulating in `mcp_gpt_desk/src/research/*` and
`mcp_gpt_desk/test/*` — files I never touched this session. This looks
like another automated process (a Codex/AI worker, per this repo's
existing autonomous-worker setup) actively modifying the research
pipeline concurrently with this session. I left these files alone and
did not include them in any commit — worth checking what that process is
doing when you're back, since it's editing the working tree at the same
time as this session.
