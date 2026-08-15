# Backend Domain Completeness / Front Freeze

- generatedAt: `2026-08-15T15:11:25.122Z`
- repositoryBranch: `codex/preprod-v4-local-parity-cleanup`
- repositoryCommit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- schemaVersion: `front_handoff_v1`
- generatorVersion: `front_handoff_generator_v1.0.0`
- activeVpsRelease: `preprod-v2-front-freeze-20260815.1`
- activeVpsCommit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- runtimeProbeTimestamp: `2026-08-15T15:10:13.211Z`

## Verdict local

**P0_BEFORE_FRONT_FREEZE: 0**

This file is generated from the current backend handoff generator and must be regenerated after backend contract changes.

## Evidence inventory

- Endpoint catalog count: 171
- Domain payload objects: 12
- Freeze matrix counts: {"FROZEN_FOR_FRONT":10,"STABLE_ADDITIVE_ONLY":9,"NOT_FROZEN":1,"LEGACY":1}
- Repository commit: ac8c418a9f87687090c5779f01fdfc2b753bb00f

## Current limitation

Runtime VPS metadata is populated only when the generator is executed with `DESK_ACTIVE_VPS_RELEASE`, `DESK_ACTIVE_VPS_COMMIT` and `DESK_RUNTIME_PROBE_TIMESTAMP` after deployment probes.
