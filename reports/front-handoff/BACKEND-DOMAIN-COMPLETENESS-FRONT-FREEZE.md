# Backend Domain Completeness / Front Freeze

- generatedAt: `2026-08-15T11:27:55.597Z`
- repositoryBranch: `codex/preprod-v4-local-parity-cleanup`
- repositoryCommit: `670b05778896c2e936be9193a218e144bd4eb163`
- schemaVersion: `front_handoff_v1`
- generatorVersion: `front_handoff_generator_v1.0.0`
- activeVpsRelease: `null`
- activeVpsCommit: `null`
- runtimeProbeTimestamp: `null`

## Verdict local

**P0_BEFORE_FRONT_FREEZE: 0**

This file is generated from the current backend handoff generator and must be regenerated after backend contract changes.

## Evidence inventory

- Endpoint catalog count: 171
- Domain payload objects: 12
- Freeze matrix counts: {"FROZEN_FOR_FRONT":10,"STABLE_ADDITIVE_ONLY":9,"NOT_FROZEN":1,"LEGACY":1}
- Repository commit: 670b05778896c2e936be9193a218e144bd4eb163

## Current limitation

Runtime VPS metadata is populated only when the generator is executed with `DESK_ACTIVE_VPS_RELEASE`, `DESK_ACTIVE_VPS_COMMIT` and `DESK_RUNTIME_PROBE_TIMESTAMP` after deployment probes.
