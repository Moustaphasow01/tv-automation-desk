# Lot 006 — AI Context Gate certification

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Scope: certify that the AI Context Gate can only contextualize an already-deterministic signal/allocation and cannot create, confirm, mutate or submit execution objects.

## Executive result

Lot 006 is closed on repository evidence.

The AI Context Gate now has a closed, auditable contract:

```text
deterministic signal/candidate
→ AI Context Gate advisory/evaluation
→ TAKE | TAKE_REDUCED | WAIT | REJECT
→ read-only / portfolio-policy input only
→ no OrderIntent, no Human Confirm, no ProviderCommand, no broker write
```

The gate fails safe to `WAIT` for timeout, invalid/malformed output, disabled policy, model/provider unavailability, and unvalidated `ENFORCED` mode.

## Requirement matrix

| Requirement | Current status | Gap closed | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Context Gate only contextualizes deterministic signal/allocation | PARTIEL | Subject is explicit and restricted to `SIGNAL`, `POSITION`, `CANDIDATE_ALLOCATION` | `packages/desk-domain/src/ai-context-advisory-v1.js:5`, `packages/desk-domain/src/ai-context-advisory-v1.js:108` | `packages/desk-domain/test/ai-context-advisory-v1.test.js:12` | Full MCP/domain tests pass | FAIT |
| Closed decisions `TAKE/TAKE_REDUCED/WAIT/REJECT` | PARTIEL | Closed enum at domain + SQL | `packages/desk-domain/src/ai-context-advisory-v1.js:5`, `infra/postgres/init/051_ai_context_gate_decisions.sql:17` | `packages/desk-domain/test/ai-context-gate-v1.test.js:12`, `mcp_gpt_desk/test/ai_context_gate_sql_schema.test.js:12` | SQL migration applied locally; invalid execution side effects rejected by DB constraint | FAIT |
| Confidence, bounded risk multiplier, reason codes, anomalies, invalidation | PARTIEL | Structured decision payload now carries all required fields; risk multiplier bounded 0..1 | `packages/desk-domain/src/ai-context-advisory-v1.js:47`, `packages/desk-domain/src/ai-context-advisory-v1.js:183`, `packages/desk-domain/src/ai-context-gate-v1.js:67` | `packages/desk-domain/test/ai-context-advisory-v1.test.js:29`, `packages/desk-domain/test/ai-context-advisory-v1.test.js:85` | Targeted and full suites pass | FAIT |
| Provenance and policy/model version | PARTIEL | `policy_version`, `model_policy_version`, `model_ref`, hashes persisted | `packages/desk-domain/src/ai-context-gate-v1.js:54`, `packages/desk-domain/src/ai-context-gate-v1.js:155`, `infra/postgres/init/051_ai_context_gate_decisions.sql:33` | `packages/desk-domain/test/ai-context-gate-v1.test.js:12`, `mcp_gpt_desk/test/ai_context_gate_sql_schema.test.js:12` | SQL smoke selected `policy_version=lot-006-smoke-policy-v1` | FAIT |
| Timeout / model unavailable / malformed output / retry / fallback | PARTIEL | Fail-safe `WAIT`, bounded retry metadata, `AI_CONTEXT_MODEL_UNAVAILABLE` added | `packages/desk-domain/src/ai-context-gate-v1.js:14`, `packages/desk-domain/src/ai-context-gate-v1.js:170`, `packages/desk-domain/src/ai-context-gate-v1.js:179` | `packages/desk-domain/test/ai-context-gate-v1.test.js:36`, `packages/desk-domain/test/ai-context-gate-v1.test.js:53`, `packages/desk-domain/test/ai-context-gate-v1.test.js:86` | Targeted and full suites pass | FAIT |
| SHADOW mode first | PARTIEL | Default policy mode is `SHADOW`; result is observed-only | `packages/desk-domain/src/ai-context-gate-v1.js:101`, `packages/desk-domain/src/ai-context-gate-v1.js:155` | `packages/desk-domain/test/ai-context-gate-v1.test.js:12`, `mcp_gpt_desk/test/ai_context_gate_service.test.js:6` | Service persists `SHADOW_RECORDED` decisions idempotently | FAIT |
| ENFORCED mode cannot activate accidentally | PARTIEL | Unvalidated `ENFORCED` blocks to fallback; validated enforced produces only a Portfolio-policy input, not execution permission | `packages/desk-domain/src/ai-context-gate-v1.js:21`, `packages/desk-domain/src/ai-context-gate-v1.js:107` | `packages/desk-domain/test/ai-context-gate-v1.test.js:109`, `packages/desk-domain/test/ai-context-gate-v1.test.js:123` | Full suites pass | FAIT |
| AI cannot create OrderIntent / Human Confirm / ProviderCommand / broker writes | PARTIEL | Prohibited capabilities and field patterns added at domain; SQL constraint rejects side-effect arrays | `packages/desk-domain/src/ai-context-advisory-v1.js:8`, `packages/desk-domain/src/ai-context-advisory-v1.js:20`, `packages/desk-domain/src/ai-context-gate-v1.js:79`, `infra/postgres/init/051_ai_context_gate_decisions.sql:48` | `packages/desk-domain/test/ai-context-advisory-v1.test.js:53`, `packages/desk-domain/test/ai-context-advisory-v1.test.js:68`, `mcp_gpt_desk/test/ai_context_gate_sql_schema.test.js:21` | PostgreSQL rejected a payload with `provider_commands_created` | FAIT |
| Audit trail for decisions/events | PARTIEL | Canonical tables and repository added; events record decision/fallback/retry/enforcement block | `infra/postgres/init/051_ai_context_gate_decisions.sql:1`, `infra/postgres/init/051_ai_context_gate_decisions.sql:65`, `mcp_gpt_desk/src/ai-context-gate-repository.js:16`, `mcp_gpt_desk/src/ai-context-gate-repository.js:166` | `mcp_gpt_desk/test/ai_context_gate_service.test.js:6`, `mcp_gpt_desk/test/ai_context_gate_service.test.js:35` | Migration applied to local PostgreSQL; tables exist | FAIT |
| Runtime supervisor persists AI Context output before completing task | PARTIEL | Agent supervisor can be injected with `AiContextGateService`; context tasks persist gate result before completion | `mcp_gpt_desk/src/agent-runtime-supervisor.js:28`, `mcp_gpt_desk/src/agent-runtime-supervisor.js:186`, `mcp_gpt_desk/src/agent-runtime-supervisor.js:222`, `mcp_gpt_desk/src/agent-runtime-supervisor.js:457` | `mcp_gpt_desk/test/agent_runtime_supervisor.test.js:164` | Full MCP suite pass | FAIT |

## Files/classes changed

- `packages/desk-domain/src/ai-context-advisory-v1.js`
- `packages/desk-domain/src/ai-context-gate-v1.js`
- `packages/desk-domain/index.js`
- `packages/desk-domain/index.d.ts`
- `infra/postgres/init/051_ai_context_gate_decisions.sql`
- `docs/engineering/sql-migration-policy.json`
- `mcp_gpt_desk/src/ai-context-gate-repository.js`
- `mcp_gpt_desk/src/ai-context-gate-service.js`
- `mcp_gpt_desk/src/agent-runtime-supervisor.js`
- `packages/desk-domain/test/ai-context-advisory-v1.test.js`
- `packages/desk-domain/test/ai-context-gate-v1.test.js`
- `mcp_gpt_desk/test/ai_context_gate_sql_schema.test.js`
- `mcp_gpt_desk/test/ai_context_gate_service.test.js`
- `mcp_gpt_desk/test/agent_runtime_supervisor.test.js`

## Commands executed

```text
node --test \
  packages/desk-domain/test/ai-context-advisory-v1.test.js \
  packages/desk-domain/test/ai-context-gate-v1.test.js \
  mcp_gpt_desk/test/ai_context_gate_service.test.js \
  mcp_gpt_desk/test/ai_context_gate_sql_schema.test.js \
  mcp_gpt_desk/test/front_ai_context_projection.test.js \
  mcp_gpt_desk/test/front_operations_api.test.js
```

Result:

```text
44 pass / 0 fail
```

```text
node --test \
  mcp_gpt_desk/test/ai_context_gate_service.test.js \
  mcp_gpt_desk/test/agent_runtime_supervisor.test.js \
  packages/desk-domain/test/ai-context-gate-v1.test.js \
  packages/desk-domain/test/ai-context-advisory-v1.test.js
```

Result:

```text
29 pass / 0 fail
```

```text
npm --prefix packages/desk-domain test
```

Result:

```text
454 pass / 0 fail
```

```text
npm --prefix mcp_gpt_desk test
```

Result:

```text
1061 pass / 0 fail
```

## Guards executed

```text
npm run guard:architecture        OK
npm run guard:runtime-safety      OK
npm run guard:mcp-slices          OK
npm run guard:windows-deployment  OK
npm run guard:sql-migrations      OK
npm run guard:exceptions          OK
npm run guard:problem-details     OK
npm run guard:static-quality      KO connu
```

`guard:static-quality` remains intentionally unmasked and is unchanged as a known technical-debt blocker for Lot 017:

```text
front-control-plane-api.js too long
strategy-dsl-compiler-v1.js too long
canonical-simulation-engine-v1.js too long
oversized functions: 248 / allowed 243
high complexity functions: 640 / allowed 592
duplicate blocks: 73 / allowed 50
possibly dead files: 17 / allowed 14
```

## PostgreSQL runtime proof

Migration applied locally:

```text
docker compose exec -T postgres psql -U desk -d desk -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/051_ai_context_gate_decisions.sql
```

Verified tables:

```text
ai_context_gate_decisions
ai_context_gate_events
```

Smoke proof:

- a valid consultative decision inserted and selected with:
  - recommendation `TAKE_REDUCED`
  - risk multiplier `0.25`
  - no fallback
  - policy version `lot-006-smoke-policy-v1`
- a forbidden payload with `execution_side_effects.provider_commands_created = ["forbidden"]` was rejected by:

```text
ai_context_gate_decisions_no_direct_execution
```

## Non-regression notes

- The AI Context Gate has no path to create `OrderIntent`, `TargetPosition`, `CandidateAllocation`, `HumanExecutionGate`, provider command or broker write.
- Validated `ENFORCED` mode still produces a Portfolio-policy constraint only; it does not grant execution permission.
- The Agent Runtime Supervisor only records AI Context Gate output for context-decision task types; other task behavior is unchanged.
- The runtime live/research business flows still need vertical E2E proof in the next lots. This lot certifies the gate and its persistence, not the whole Research→PAPER lifecycle.

## Status after Lot 006

- FAIT gained: AI Context Gate certification requirements closed.
- PARTIEL remaining: vertical slice through Research/Simulation/SHADOW/PAPER; BFF surfaces for context decisions if required by VNext; static quality debt.
- NON FAIT: none introduced.
- NON PROUVÉ: production runtime deployment proof remains out of scope for this lot.
- BLOQUÉ EXTERNE: none for this lot.

## Next recommended lot

Lot 007 — Research Vertical Slice E2E.

Goal: choose one existing P0 `Strategy_ID`, then prove the full chain:

```text
Hypothesis
→ Research Mission
→ Strategy Spec
→ immutable Strategy Version
→ Dataset Version
→ baseline
→ bounded screening
→ canonical simulation
→ Train / Validation / OOS
→ robustness
→ Portfolio Fit
→ SHADOW
→ SEMI_MANUAL/PAPER validation when available
```
