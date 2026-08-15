# Backend/front handoff

- generatedAt: `2026-08-15T11:27:55.597Z`
- repositoryBranch: `codex/preprod-v4-local-parity-cleanup`
- repositoryCommit: `670b05778896c2e936be9193a218e144bd4eb163`
- schemaVersion: `front_handoff_v1`
- generatorVersion: `front_handoff_generator_v1.0.0`
- activeVpsRelease: `null`
- activeVpsCommit: `null`
- runtimeProbeTimestamp: `null`

## Contract source

- Source of truth: current repository code, migrations, registries and tests.
- Generator: `scripts/front-handoff/generate_front_handoff.mjs`.
- Freeze registry: `scripts/front-handoff/front-contract-freeze-registry.json`.
- No historical commit is hardcoded.

## Counts

- Endpoint catalog: 171
- VNext views: 51
- VNext commands: 11
- Payload objects: 12
- Frozen contracts: 10
- Stable additive contracts: 9
- Not frozen contracts: 1
- P0 before front freeze: 0

## Non-negotiable frontend rules

- The frontend must use `/front-api/v1` or documented API routes; it must not call a provider/broker directly.
- Official Portfolio/Risk/Target/OrderIntent values are backend-sourced.
- Commands are idempotent, audited and broker-side-effect free during front freeze.
- `NOT_FROZEN` contracts require graceful `UNKNOWN` / `UNAVAILABLE` handling.
