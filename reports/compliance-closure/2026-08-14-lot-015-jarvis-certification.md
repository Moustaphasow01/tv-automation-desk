# LOT 015 — Jarvis Certification

Date: 2026-08-14
Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD baseline: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## 1. Scope

Jarvis must remain a supervisor/advisory surface. This lot certifies that the current repository does not grant Jarvis any hidden broker/provider authority.

Allowed Jarvis roles:

- read;
- diagnose;
- explain;
- summarize;
- show context, portfolio, risk, OrderIntent and reconciliation;
- prepare a command request;
- notify a human.

Forbidden Jarvis roles:

- automatic Human Gate confirmation;
- simulated operator approval;
- broker/provider order creation;
- ProviderCommand creation;
- Portfolio/Risk/Human Gate bypass;
- permission/step-up bypass;
- AUTO or LIVE enablement.

## 2. Current implementation status

Jarvis backend is not implemented as an autonomous supervisor yet.

Current backend projection:

- endpoint/view: `/front-api/v1/views/jarvis-workspace`
- status: `jarvis-workspace:NOT_IMPLEMENTED`
- pending actions: `[]`
- commands: `[]`
- voice: OFF/degraded informational state only.

Proof:

- `mcp_gpt_desk/src/front-control-plane-api.js:1580`

This is safe-by-absence-of-authority, not a full functional Jarvis implementation.

## 3. Guard added

Added:

- `scripts/quality/check_jarvis_authority.mjs`
- `scripts/quality/check_jarvis_authority.test.mjs`

NPM scripts:

- `guard:jarvis-authority`
- `guard:jarvis-authority:test`

Proof:

- `scripts/quality/check_jarvis_authority.mjs:9`
- `scripts/quality/check_jarvis_authority.mjs:12`
- `scripts/quality/check_jarvis_authority.mjs:22`
- `scripts/quality/check_jarvis_authority.mjs:42`
- `scripts/quality/check_jarvis_authority.mjs:72`
- `scripts/quality/check_jarvis_authority.mjs:94`
- `scripts/quality/check_jarvis_authority.mjs:121`
- `scripts/quality/check_jarvis_authority.test.mjs:7`
- `scripts/quality/check_jarvis_authority.test.mjs:16`
- `scripts/quality/check_jarvis_authority.test.mjs:37`
- `package.json:45`

The guard checks:

1. the BFF Jarvis projection remains read-only/not implemented until certified;
2. no `jarvis.*` front command is present;
3. no front command has `brokerExecution=true`;
4. Jarvis fixture actions do not use broker/provider/Human Gate/auto/live command types;
5. MCP tool slices do not expose tool names matching broker/provider authority patterns;
6. a matrix is produced with tool, read/write, domain, permission, criticality, Human Gate, step-up and broker effect.

## 4. Authority matrix summary

Command:

```text
npm run guard:jarvis-authority
```

Result:

```json
{
  "ok": true,
  "summary": {
    "matrixRows": 123,
    "frontCommands": 4,
    "mcpTools": 117,
    "jarvisFixtureActions": 1,
    "violations": 0
  }
}
```

Representative rows:

| TOOL | READ/WRITE | DOMAIN | PERMISSION | CRITICAL | HUMAN GATE | STEP-UP | BROKER EFFECT | STATUS |
|---|---|---|---|---:|---:|---:|---:|---|
| `front-api:/views/jarvis-workspace` | READ | jarvis-supervisor | `jarvis.read` | false | false | false | false | `READ_ONLY_NOT_IMPLEMENTED` |
| `front-command:control_plane.verify` | WRITE | control_plane | `front.command` | false | false | false | false | `NO_DIRECT_BROKER_EFFECT` |
| `front-command:research.bootstrap_demo_paper` | WRITE | research | `research.command` | false | false | false | false | `NO_DIRECT_BROKER_EFFECT` |
| `front-command:execution.order_intent.confirm` | WRITE | execution | `execution.paper` | true | true | true | false | `NO_DIRECT_BROKER_EFFECT` |
| `front-command:execution.order_intent.reject` | WRITE | execution | `execution.paper` | true | true | true | false | `NO_DIRECT_BROKER_EFFECT` |
| `jarvis-fixture-action:live.reconciliation.request` | WRITE_REQUEST_FIXTURE | live | fixture-only | false | true | false | false | `TEST_FIXTURE_ONLY` |
| `mcp:*` | READ/WRITE by tool prefix | slice-owned | `desk.read`/`desk.write` | slice-dependent | false | write=true | false | `NO_DIRECT_BROKER_EFFECT` |

## 5. Existing front command authority

Current command catalog:

- `control_plane.verify`
- `research.bootstrap_demo_paper`
- `execution.order_intent.confirm`
- `execution.order_intent.reject`

All have:

- `brokerExecution: false`

Proof:

- `mcp_gpt_desk/src/front-control-plane-command.js:3`
- `mcp_gpt_desk/src/front-control-plane-command.js:16`
- `mcp_gpt_desk/src/front-control-plane-command.js:22`
- `mcp_gpt_desk/src/front-control-plane-command.js:120`

The execution confirm/reject commands are Human Gate commands routed through backend services; they are not Jarvis commands and they do not directly call a provider from the front/BFF command layer.

## 6. MCP/tooling audit

MCP tool slice guard remains green:

```text
npm run guard:mcp-slices
```

Result:

```text
actual_tools=117
assigned_tools=117
slice_count=10
autopilot_v4_tools=79
```

Jarvis authority guard cross-checks these 117 tools and found:

```text
broker authority pattern violations=0
```

Important nuance:

- some MCP tools are write-capable for analysis, replay, contracts or agent-runtime administration;
- none is certified here as a Jarvis action;
- none is allowed to become broker authority through Jarvis.

## 7. Tests executed

### Jarvis authority guard

```text
node --test scripts/quality/check_jarvis_authority.test.mjs
```

Result:

```text
tests 3
pass 3
fail 0
```

Negative proofs:

- injected `jarvis.broker.submit` with `brokerExecution=true` is rejected;
- Jarvis BFF view exposing pending actions before backend certification is rejected.

### Jarvis/front/realtime contracts

```text
npm --prefix apps/desk-control-plane test -- jarvisWorkspaceContract realtimeRuntime routes
```

Result:

```text
Test Files 3 passed
Tests 16 passed
```

Covered:

- Jarvis contract fixture is structurally valid;
- Jarvis fixture actions become Command Runtime requests, not direct mutations;
- `jarvis.message.created` maps to Command Center and Jarvis workspace realtime invalidation;
- route registry exposes Jarvis through `/views/jarvis-workspace`.

### BFF / MCP targeted tests

```text
node --test mcp_gpt_desk/test/front_control_plane_api.test.js scripts/quality/check_mcp_tool_slices.test.mjs
```

Result:

```text
tests 19
pass 19
fail 0
```

### Guards

```text
npm run guard:architecture
npm run guard:mcp-slices
npm run guard:runtime-safety
npm run guard:problem-details
npm run guard:static-quality
```

Results:

```text
guard:architecture OK checked_files=391
guard:mcp-slices OK actual_tools=117 assigned_tools=117
guard:runtime-safety OK direct_clock_usages=130 budget=130
guard:problem-details OK codes=12
guard:static-quality KO historique
```

Static-quality remains the known historical blocker assigned to Lot 017:

```text
front-control-plane-api.js too long
strategy-dsl-compiler-v1.js too long
canonical-simulation-engine-v1.js too long
oversized functions 250 > 243
complexity 650 > 592
duplicate blocks 72 > 50
possibly dead files 17 > 14
```

No new static-quality threshold was raised by this lot.

## 8. Compliance matrix

| Requirement | Current status | Gap initial | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Jarvis is supervisor/advisory, not source of truth | PARTIEL | No guard proving absence of hidden authority | `guard:jarvis-authority` + BFF read-only check | guard test | BFF projection read-only/not implemented | FAIT for current repo |
| Jarvis cannot confirm Human Gate automatically | PARTIEL | No automated regression check | no `jarvis.*` command allowed; fixture forbidden patterns | negative guard test | command catalog contains only non-Jarvis execution confirm/reject | FAIT |
| Jarvis cannot create broker/provider order | PARTIEL | Need cross-check across front commands + MCP slices | broker authority patterns across commands/MCP | guard test | 123 matrix rows, 0 violation | FAIT |
| Jarvis cannot bypass Portfolio/Risk | PARTIEL | Jarvis not implemented; needed proof it has no mutation path | BFF returns empty `pendingActions` and `commands` | guard + BFF tests | `/views/jarvis-workspace` not implemented | FAIT for absence of authority / PARTIEL functionally |
| Jarvis can prepare command requests only after certification | PARTIEL | Fixture showed a command request, backend has no real Jarvis actions | fixture classified `TEST_FIXTURE_ONLY`; backend pending actions empty | `jarvisWorkspaceContract` | no runtime Jarvis command action exposed | PARTIEL |
| Jarvis read/diagnostic product capability exists | NON PROUVÉ | Real backend Jarvis supervisor is not implemented | none | contract fixture only | none | NON PROUVÉ |
| Jarvis sensitive action step-up | NON PROUVÉ | No real Jarvis action exists to exercise step-up | n/a | none | none | NON PROUVÉ |

## 9. FRONT_AGENT_ACTION_REQUIRED

None for this lot.

The existing Jarvis page can remain as a read-only/not-implemented placeholder. Any future Jarvis UI action must wait for backend-certified command contracts.

## 10. Final status

LOT 015: `COMPLETE` for authority safety certification.

Functional Jarvis remains `PARTIEL/NON PROUVÉ` because a real supervisor backend is not implemented yet. This is acceptable for the compliance objective: Jarvis currently has no hidden broker authority.

Next lot:

`LOT 016 — Security & Observability`
