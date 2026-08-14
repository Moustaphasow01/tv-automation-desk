# TD2-419 — Domain Assistants Runtime / Jarvis read-only supervisor

Date: 2026-08-14  
Scope: repository PREPROD, local proof only  
Status: PARTIEL — core persistence/service/BFF/front/guards implemented and tested; VPS runtime worker + live realtime proof still pending.

## Objective

Close the first safe slice of TD2-419 without giving Jarvis or assistants trading authority:

- create durable domain assistant runtime primitives;
- keep assistants read-only by default;
- expose Research, Live Runtime, Portfolio/Risk, Execution, Data and Platform/Ops assistants;
- persist operator questions before execution;
- create assistant tasks with bounded context snapshots;
- support ON_DEMAND, PERIODIC and EVENT_TRIGGERED wake modes;
- prove retry, DLQ and idempotent recovery;
- expose the Jarvis workspace through the BFF using real desk projections;
- add a VNext operator question form that goes through the BFF command runtime;
- prove Jarvis has no broker/provider side effect and no sensitive command authority.

## Implemented files

### PostgreSQL durable runtime

- `infra/postgres/init/055_domain_assistant_runtime.sql`
  - `assistant_profiles`
  - `assistant_conversations`
  - `assistant_messages`
  - `assistant_context_snapshots`
  - `assistant_tasks`
  - `assistant_task_leases`
  - `assistant_answers`
  - `assistant_task_dead_letters`
  - `assistant_events`
  - `assistant_outbox`

Key proof:

- read-only profile constraint: `assistant_profiles_read_only_default`
- sensitive bypass constraint: `assistant_tasks_no_sensitive_bypass`
- bounded snapshots: `max_messages <= 20`, `max_events <= 100`
- idempotent tasks/outbox through unique keys
- lease and DLQ tables for at-least-once recovery

Ownership proof:

- `docs/engineering/sql-migration-policy.json` now assigns `assistant_*` tables to the `agents` boundary.

### Domain service and repository

- `mcp_gpt_desk/src/domain-assistant-runtime-service.js`
  - default assistant profiles:
    - `assistant_research`
    - `assistant_live_runtime`
    - `assistant_portfolio_risk`
    - `assistant_execution`
    - `assistant_data`
    - `assistant_platform_ops`
  - low-cost model policy default: `domain-assistant.default.low-cost.v1`
  - wake modes: `ON_DEMAND`, `PERIODIC`, `EVENT_TRIGGERED`
  - read-only authority payloads and forbidden action codes
  - bounded context snapshots
  - sensitive action rejection

- `mcp_gpt_desk/src/domain-assistant-runtime-repository.js`
  - PostgreSQL and in-memory implementations
  - idempotent profile/task persistence
  - task claim with lease
  - answer publication with `FRONT_REALTIME` outbox event
  - fail/retry/DLQ/requeue recovery

### BFF command and Jarvis projection

- `mcp_gpt_desk/src/front-control-plane-command.js`
  - adds `assistant.question.submit`
  - command is broker-safe:
    - `brokerExecution: false`
    - `environment: MOCK/PAPER`
    - no order submission flag
  - command routes through `DomainAssistantRuntimeService.submitQuestion`

- `mcp_gpt_desk/src/front-control-plane-api.js`
  - `/front-api/v1/views/jarvis-workspace` now projects real desk context instead of the old `NOT_IMPLEMENTED` placeholder.
  - Jarvis remains read-only:
    - `pendingActions: []`
    - `commands: []`
    - `voice.serviceStatus: OFF`
  - 6 domain assistant missions are exposed using the same IDs as the backend service.
  - Citations/freshness come from BFF sources: data foundation, health, providers, risk and incidents.

### VNext UI

- `apps/desk-control-plane/src/pages/JarvisWorkspacePage.tsx`
  - adds an assistant selector and operator question form;
  - submits through `assistant.question.submit`;
  - includes BFF citations and domain snapshot in payload;
  - keeps the page in controlled/read-only supervisor semantics.

- `apps/desk-control-plane/src/design-system/styles.css`
  - adds compact `.jarvis-question-box` styles.

### Authority guard

- `scripts/quality/check_jarvis_authority.mjs`
  - updated from old `READ_ONLY_NOT_IMPLEMENTED` placeholder policy to `READ_ONLY_CERTIFIED`;
  - verifies the BFF view remains read-only;
  - verifies assistant runtime profile alignment;
  - verifies SQL constraints for read-only/no sensitive bypass;
  - keeps detecting hidden Jarvis broker/provider commands.

- `scripts/quality/check_jarvis_authority.test.mjs`
  - proves current repository policy passes;
  - proves hidden Jarvis broker commands are rejected;
  - proves pending actions in Jarvis BFF are rejected.

## Tests executed

### TD2-419 targeted backend

Command:

```bash
node --test \
  mcp_gpt_desk/test/domain_assistant_runtime_service.test.js \
  mcp_gpt_desk/test/domain_assistant_runtime_sql_schema.test.js \
  mcp_gpt_desk/test/front_control_plane_api.test.js
```

Result:

```text
31 pass / 0 fail
```

Coverage:

- explicit read-only assistant profiles;
- model policy routing;
- question persisted before execution;
- assistant task/outbox creation;
- claim/publish/audit/restore;
- sensitive action rejection;
- forbidden broker instruction rejection;
- retry/DLQ/idempotent requeue;
- periodic and event-triggered wake task creation;
- SQL schema coverage;
- BFF Jarvis read-only projection;
- BFF command persistence for `assistant.question.submit`.

### Full backend suite

Command:

```bash
npm --prefix mcp_gpt_desk test
```

Result:

```text
1118 pass / 0 fail
```

Note: the full suite was re-run after the final ID-alignment patch (`assistant_ops` → `assistant_platform_ops`) and after the TD2-420 certifier addition.

### Front VNext

Commands:

```bash
npm --prefix apps/desk-control-plane run typecheck
npm --prefix apps/desk-control-plane test -- --run
```

Results:

```text
typecheck OK
35 test files passed
161 tests passed
```

### Guards

Commands:

```bash
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:sql-migrations
npm run guard:problem-details
npm run guard:front-architecture
npm run guard:front-vnext-data-mode
npm run guard:front-vnext-legacy
npm run guard:browser-secrets
npm run guard:api-compatibility
npm run guard:jarvis-authority:test
npm run guard:jarvis-authority
git diff --check
```

Results:

```text
guard:architecture            OK
guard:runtime-safety          OK — direct_clock_usages 130 / budget 130
guard:sql-migrations          OK — 55 migrations, 134 tables
guard:problem-details         OK
guard:front-architecture      OK
guard:front-vnext-data-mode   OK
guard:front-vnext-legacy      OK
guard:browser-secrets         OK
guard:api-compatibility       OK — fingerprint b939c84547cacb1b403fc30a7e2275318e4e08eca7cb6cdf0bedb611e94017a3
guard:jarvis-authority:test   OK — 3 pass / 0 fail
guard:jarvis-authority        OK — READ_ONLY_CERTIFIED, 0 violations
git diff --check              OK
```

## Requirement matrix

| Requirement | Current status | Evidence | Gap |
|---|---:|---|---|
| Domain assistants distinct from Jarvis/workers | FAIT local | service default profiles + BFF missions | VPS runtime worker proof pending |
| Research/Live/Risk/Execution/Data/Ops profiles | FAIT local | `DEFAULT_DOMAIN_ASSISTANT_PROFILES`, BFF mission IDs | none local |
| Persistent conversation/task/lease/event model | FAIT local | SQL migration + repository tests | true DB runtime smoke pending |
| User question -> persist -> task -> outbox | FAIT local | service and BFF command tests | worker answer execution pending |
| ON_DEMAND/PERIODIC/EVENT_TRIGGERED wake | FAIT local | service tests | scheduler/event wiring runtime pending |
| Model policy low-cost default | FAIT local | service profiles/tests | real LLM routing policy pending |
| Bounded context snapshot | FAIT local | SQL constraints and service tests | runtime size telemetry pending |
| Read-only enforcement | FAIT local | service, SQL constraints, guard | none local |
| Forbidden sensitive actions | FAIT local | service tests + authority guard | none local |
| SSE/front realtime answer delivery | PARTIEL | repository writes `FRONT_REALTIME` outbox | live SSE publish/resume proof pending |
| Worker LLM answer generation | PARTIEL | task persistence/claim/answer API exists | actual assistant worker not wired/proven |
| VPS deployment/runtime proof | NON PROUVÉ | local only | deploy and run proof after release |

## Production blockers for TD2-419 Done

1. Deploy this slice to VPS in a release after TD2-418/TD2-422 alignment.
2. Apply migration `055_domain_assistant_runtime.sql` on VPS PostgreSQL and prove table creation.
3. Run a real BFF/session operator command against VPS:
   - `assistant.question.submit`
   - verify ACCEPTED -> terminal result
   - verify persisted `assistant_messages`, `assistant_tasks`, `assistant_events`, `assistant_outbox`
   - verify idempotence.
4. Wire/prove an assistant worker that claims a task, invokes the selected LLM/model policy, persists an answer and publishes the realtime event.
5. Prove VNext receives the answer through the realtime path/cursor recovery.
6. Prove zero broker/provider side effect on VPS before/after assistant question.

## Jira recommendation

Do not transition TD2-419 to Done yet.

Recommended Jira state after this lot:

- transition TD2-419 from `À faire` to `En cours`;
- add this report as proof of local closure;
- leave Done blocked by VPS runtime proof and assistant worker/SSE evidence.
