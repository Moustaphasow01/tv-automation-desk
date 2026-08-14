# LOT 014 — Front VNext Cutover Certification

Date: 2026-08-14
Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD baseline: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## 1. Scope

Lot 014 certifies the VNext front as an operator control-plane candidate connected to the backend/BFF, without redesigning new surfaces and without enabling LIVE or AUTO execution.

Non-negotiable policy preserved:

- VNext reads through `/front-api/v1` BFF contracts.
- VNext must not depend on legacy runtime components.
- VNext must not calculate official Portfolio/Risk/TargetPosition.
- VNext must not call a broker/provider directly.
- Human/operator actions must pass through backend capabilities, permissions, preflight and command runtime.
- A production/demo release gate must remain fail-closed while data, operator auth or Telegram/provider state is not proven.

## 2. Implementation changes in this lot

### 2.1 VNext projection hardening

The backend can legally return duplicated or partially missing operational identifiers in read projections. The front must not crash or create React reconciliation ambiguity.

Changes:

- `apps/desk-control-plane/src/pages/ResearchAgentFleetPage.tsx`
  - `runtimeStatus` fallback remains explicit as `UNKNOWN`.
  - `compactId()` now accepts missing values and renders `—` instead of crashing.
  - `formatTime()` now accepts missing timestamps and renders `—`.
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx`
  - operational lists suffix local React keys with their row index.
  - this is only a view key; it does not mutate or invent business IDs.
- `apps/desk-control-plane/src/design-system/data.tsx`
  - `DataTable` and `MobileDataList` both use stable unique display keys when backend row keys repeat.

Proof:

- `apps/desk-control-plane/src/pages/ResearchAgentFleetPage.tsx:103`
- `apps/desk-control-plane/src/pages/ResearchAgentFleetPage.tsx:326`
- `apps/desk-control-plane/src/pages/ResearchAgentFleetPage.tsx:337`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:98`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:115`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:131`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:143`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:172`
- `apps/desk-control-plane/src/pages/OperationsQueuePage.tsx:287`
- `apps/desk-control-plane/src/design-system/data.tsx:29`
- `apps/desk-control-plane/src/design-system/data.tsx:60`
- `apps/desk-control-plane/src/design-system/data.tsx:114`

### 2.2 Demo/PAPER release gate corrected to semi-manual

The previous readiness logic still treated `execution_authority_mode=auto` and `entry_operator_approval_required=false` as acceptable for demo/PAPER. That was a regression against the current target architecture.

The certification gate now requires:

- broker paper/addon path: `execution_authority_mode=semi_auto` and `entry_operator_approval_required=true`;
- manual Telegram path: `execution_authority_mode=semi_auto`, `entry_operator_approval_required=true`, and `submission_possible !== true`;
- release gate remains blocked if the runtime is still `auto`.

Implementation proof:

- `scripts/stack/check_demo_paper_gate.mjs:196`
- `scripts/stack/check_demo_paper_gate.mjs:207`
- `scripts/stack/diagnose_demo_paper_readiness.mjs:82`
- `scripts/stack/diagnose_demo_paper_readiness.mjs:96`
- `scripts/stack/diagnose_demo_paper_readiness.mjs:105`
- `deploy/windows/Prepare-DeskSim101.ps1:124`
- `deploy/windows/Prepare-DeskSim101.ps1:132`

Regression test proof:

- `scripts/stack/check_demo_paper_gate.test.mjs:102`
- `scripts/stack/check_demo_paper_gate.test.mjs:176`
- `scripts/stack/diagnose_demo_paper_readiness.test.mjs`

## 3. Cutover certification matrix

| Requirement | Current status | Gap initial | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| VNext is a separate codebase from legacy | FAIT | Need proof that VNext does not depend on legacy runtime | `apps/desk-control-plane` + isolation guard | `guard:front-vnext-legacy` | `FRONT_VNEXT_LEGACY_ISOLATION_OK checked_files=105` | FAIT |
| VNext defaults to real BFF, not mock runtime | FAIT | Mock fixtures must remain test-only | runtime data-mode guard | `guard:front-vnext-data-mode` | `vnext-defaults-to-real-bff` OK | FAIT |
| BFF is the only logical front API surface | FAIT | Front must not directly call backend internals/provider | repositories + guards | VNext unit suite | `guard:front-architecture` OK | FAIT |
| REST reads and commands are covered | FAIT côté VNext/BFF | Operator write flow cannot fully run without PIN | Lot 013 command catalog + VNext E2E | `front-vnext:e2e` | 2 passed / 1 skipped due missing PIN | PARTIEL / BLOQUÉ EXTERNE |
| Realtime events are available | PARTIEL | Durable resume/replay not fully runtime-proven here | SSE contract from Lot 013 | `realtimeRuntime` tests in full VNext suite | SSE heartbeat proven in Lot 013 | PARTIEL |
| Data freshness/stale is visible and blocks release | FAIT | Stale data previously could be hidden by UI optimism | demo PAPER gate + doctor | gate tests | release gate blocks stale MNQ/MES | FAIT |
| Capabilities/allowedActions come from backend | FAIT | Front must not invent actions from status text | Lot 013 BFF + command catalog | `orderIntentDossier` tests | anonymous capabilities all denied | FAIT |
| Step-up auth/operator PIN is enforced | PARTIEL | Local proof cannot authenticate operator without secret | operator gate | `gate:vnext-operator` | `BLOCKED operator.pin_configured` | BLOQUÉ EXTERNE |
| Human Gate remains mandatory for execution | FAIT côté policy/tests | Runtime DB still configured `auto` and must be changed before release | gate now rejects `auto` | `check_demo_paper_gate.test.mjs` | release gate blocks `broker.paper_environment_safe` | FAIT for guard / BLOQUÉ EXTERNE for env |
| No direct provider/broker call from VNext | FAIT | Need guard and command routing proof | BFF command runtime only | Lot 013 + VNext tests | no provider command from VNext path | FAIT |
| Degraded read-only mode exists | FAIT | Anonymous/browser must not receive fake operator identity | Lot 013 auth hardening | `front_control_plane_api.test.js` | `/views/auth-session` read-only proof | FAIT |
| Visual density/cutover geometry is stable | FAIT local | Windows 150% was previously treated as another breakpoint | density viewport already implemented before this lot, re-certified here | visual QA | 4 captures, 0 failures, 0 console errors | FAIT |
| Accessibility P0 routes are usable | PARTIEL | Full Axe all-routes scanner is still too slow/silent under local load | targeted P0 Axe proof | custom targeted Axe command | 14 audits, 0 serious/critical | PARTIEL |
| Full production/VPS route is proven | NON PROUVÉ | This lot did not deploy to VPS/public route | none | none | needs VPS release/UAT | BLOQUÉ EXTERNE |
| Rollback remains available | PARTIEL | Legacy path still exists, but production cutover not exercised | legacy route preserved | not destructive | local stack keeps legacy/control-plane separate | PARTIEL |

## 4. Commands executed

### VNext unit/contracts/build

```text
npm --prefix apps/desk-control-plane test -- operationsQueueContract researchAgentFleetContract
```

Result:

```text
Test Files 2 passed
Tests 9 passed
```

```text
npm --prefix apps/desk-control-plane run build
```

Result: OK, Vite production build completed.

```text
npm run front-vnext:test
```

Result:

```text
Test Files 35 passed
Tests 161 passed
```

### VNext real browser E2E

Server:

```text
npm --prefix apps/desk-control-plane run dev -- --host 127.0.0.1 --port 8091
```

E2E:

```text
DESK_VNEXT_BASE_URL=http://127.0.0.1:8091 npm run front-vnext:e2e
```

Result:

```text
2 passed
1 skipped
```

Skipped test:

- `session opérateur → commande terminale → audit receipt`
- reason: `DESK_OPERATOR_ADMIN_PIN` is not configured locally.

This is correctly classified as `BLOQUÉ EXTERNE`, not as a failed implementation proof.

### Console proof on corrected pages

Routes:

- `/#/research/agents`
- `/#/operations`

Result:

```text
console-check /research/agents: messages=0
console-check /operations: messages=0
```

### Visual QA

```text
DESK_VNEXT_BASE_URL=http://127.0.0.1:8091 npm run audit:front-visual
```

Result:

```text
Visual QA: 4 captures · 0 failure(s)
workstation-1792x1024: geometryFailures=0 · consoleErrors=0
windows150-1920x878: geometryFailures=0 · consoleErrors=0
laptop-1366x768: geometryFailures=0 · consoleErrors=0
mobile-320x720: geometryFailures=0 · consoleErrors=0
```

Artifact:

- `reports/ui-ux/screenshots/visual-qa.json`

### BFF performance

```text
DESK_VNEXT_BASE_URL=http://127.0.0.1:8091 npm run audit:front-performance
```

Result:

```text
BFF performance: 37/37 views within P75 < 1000 ms
```

Artifact:

- `reports/ui-ux/front-v2-bff-performance.json`

### Accessibility

The full Axe all-routes script was attempted with reduced concurrency. It did not fail with a route violation, but it remained too slow/silent to be a reliable blocking proof in this lot and was interrupted with exit code `130`.

Targeted P0 Axe audit was then executed on the critical operator routes:

- `/command-center`
- `/live`
- `/execution/orders`
- `/execution/portfolio`
- `/governance/access`
- `/jarvis`
- `/live/timeline`

For workstation and mobile:

```text
axe-targeted-summary audits=14 seriousCritical=0
```

Status:

- P0 accessibility routes: `FAIT`
- Full all-routes Axe certification: `PARTIEL`

### Front guards

```text
npm run guard:front-vnext-data-mode
npm run guard:front-vnext-legacy
npm run guard:front-architecture
```

Result:

```text
guard:front-vnext-data-mode OK
guard:front-vnext-legacy OK checked_files=105
guard:front-architecture OK
```

### Demo/PAPER gate tests

```text
node --test scripts/stack/check_demo_paper_gate.test.mjs scripts/stack/diagnose_demo_paper_readiness.test.mjs scripts/stack/check_demo_paper_release_gate.test.mjs
```

Result:

```text
tests 20
pass 20
fail 0
```

### Syntax checks

```text
node --check scripts/stack/check_demo_paper_gate.mjs
node --check scripts/stack/diagnose_demo_paper_readiness.mjs
```

Result: OK.

PowerShell parse check:

```text
powershell.exe -NoProfile -Command 'PSParser.Tokenize(...)'
```

Result:

```text
powershell-parse-ok
```

## 5. Runtime/release gate status

### Operator VNext gate

```text
npm run gate:vnext-operator
```

Result:

```text
VNext operator E2E: BLOCKED
- FAIL operator.pin_configured
```

Status: `BLOQUÉ EXTERNE`.

Required operator action:

- configure `DESK_OPERATOR_ADMIN_PIN` in the target runtime before claiming a write-capable VNext operator session.

### Demo/PAPER gate

```text
npm run gate:demo-paper
```

Result: `BLOCKED`.

Current blockers:

- `service.live_runtime_scheduler.healthy`
- `data.live_fresh`
- `data.source_durable`
- `live_runtime.no_data_blocker`
- `broker.paper_environment_safe`
- `execution.manual_telegram_ready`

Key runtime facts:

```text
data_state=stale
core_age_seconds≈154988
tradingview_status=STALE_FEEDS
tradingview_source_durable=false
execution_authority_mode=auto
manual_telegram_execution_enabled=true
entry_operator_approval_required=false
telegram_trading_ready=false
```

### Demo/PAPER release gate

```text
npm run gate:demo-paper-release
```

Result:

```text
Demo PAPER release gate: BLOCKED
decision=KEEP_AGENTS_CLOSED_OR_SHADOW
```

This is the correct fail-closed decision. Agents must remain closed or SHADOW until the external/runtime blockers are removed.

## 6. Requirements gained in this lot

Strict FAIT gained:

1. VNext local BFF runtime defaults to real BFF, not mock.
2. VNext legacy runtime isolation is guarded.
3. VNext critical operator routes pass browser E2E/read-only navigation.
4. VNext critical operator routes pass targeted a11y without serious/critical violations.
5. VNext geometry/density is re-certified across workstation, Windows 150%, laptop and mobile.
6. VNext corrected pages do not emit runtime console warnings/errors.
7. Demo/PAPER gate no longer accepts hidden AUTO execution.
8. Windows Sim101 prep script no longer prepares AUTO as the default safe mode.

Still PARTIEL:

- Full all-routes Axe audit needs better progress telemetry or route-level timeout reporting.
- Durable SSE replay/resume is not fully runtime-proven by this lot.
- Rollback/cutover on VPS/public route was not exercised here.

Still BLOQUÉ EXTERNE:

- `DESK_OPERATOR_ADMIN_PIN` not configured locally.
- TradingView MNQ/MES M1/M5 durable alerts are stale and current data provenance is rescue/non-durable.
- Telegram trading channel is not configured/enabled.
- Runtime DB/policy still reports `execution_authority_mode=auto` and `entry_operator_approval_required=false`; the release gate now blocks this until changed.
- NinjaTrader/AddOn state is stale/login-required, but current policy is semi-manual/Telegram-first and should not be used to justify AUTO execution.

## 7. Final status

Lot 014 is closed for local VNext certification and release-gate hardening.

Production/demo cutover is **not authorized**.

Required next lot:

`LOT 015 — Security / Observability / Operator Runtime Closure`

Recommended first action in Lot 015:

1. close or explicitly document the runtime policy drift `auto/approval=false`;
2. make the all-routes Axe audit observable instead of silent;
3. continue with secrets, logs, audit/correlation and provider-health proofs.
