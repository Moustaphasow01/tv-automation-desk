# Backend/front wiring gaps

- generatedAt: `2026-08-15T15:11:25.122Z`
- repositoryBranch: `codex/preprod-v4-local-parity-cleanup`
- repositoryCommit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- schemaVersion: `front_handoff_v1`
- generatorVersion: `front_handoff_generator_v1.0.0`
- activeVpsRelease: `preprod-v2-front-freeze-20260815.1`
- activeVpsCommit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- runtimeProbeTimestamp: `2026-08-15T15:10:13.211Z`

## P0_BEFORE_FRONT_FREEZE

| ID | Owner | Contract | Gap | Next action |
|---|---|---|---|---|
| — | — | — | Aucun P0 codable détecté par le générateur. | — |

## NOT_FROZEN contracts

| Contract | Reason | Source |
|---|---|---|
| VNext SSE envelope | Only selected event streams have complete persisted cursor/gap evidence; frontend must keep refetch/resubscribe fallback. | mcp_gpt_desk/src/front-control-plane-realtime.js |

Freeze counts: `{"FROZEN_FOR_FRONT":10,"STABLE_ADDITIVE_ONLY":9,"NOT_FROZEN":1,"LEGACY":1}`
