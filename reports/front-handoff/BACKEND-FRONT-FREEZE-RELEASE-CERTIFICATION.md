# Backend / Front Contract Freeze — Release Certification

Generated at: 2026-08-15T15:11:25Z  
Release ID: `preprod-v2-front-freeze-20260815.1`  
Backend release commit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`  
VPS: `https://vps-6d6969db.vps.ovh.net`

## Final verdict

`FRONT_CONTRACT_FREEZE: READY`

The backend/domain/front-freeze release is clean, deployed, probed, and the public handoff artifacts were regenerated from the deployed backend contract state.

## Baseline

- Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
- Branch: `codex/preprod-v4-local-parity-cleanup`
- Previous VPS release observed before deployment: `preprod-v2-convergence-20260814.12-td2-420-output-ref-fix`
- Previous VPS commit observed before deployment: `50bd436757349cf40dd640f0d98e356922c720d0`
- Previous VPS manifest dirty flag observed before deployment: `true`

## Static quality

Before final refactor:

- `guard:static-quality`: FAIL
- oversized functions: `256 / 250`
- high complexity functions: `672 / 650`
- known oversized files included:
  - `mcp_gpt_desk/src/broker-execution-repository.js`
  - `mcp_gpt_desk/src/front-control-plane-api.js`
  - `mcp_gpt_desk/src/store.js`
  - `packages/desk-domain/index.js`

After final refactor:

```json
{
  "ok": true,
  "checked_files": 417,
  "max_file_lines": 4812,
  "oversized_function_count": 250,
  "high_complexity_function_count": 650,
  "duplicate_block_count": 71,
  "possibly_dead_file_count": 17,
  "baseline": "docs/engineering/static-quality-baseline.json"
}
```

## Refactors included in backend release commit

- Front BFF/control-plane behavioral split:
  - `mcp_gpt_desk/src/front-control-plane-domain-completeness.js`
  - `mcp_gpt_desk/src/front-control-plane-projection-helpers.js`
  - `mcp_gpt_desk/src/front-control-plane-row-mappers.js`
  - `mcp_gpt_desk/src/front-control-plane-incident-projection.js`
  - `mcp_gpt_desk/src/front-control-plane-time-series-contracts.js`
  - `mcp_gpt_desk/src/front-control-plane-permissions.js`
  - `mcp_gpt_desk/src/front-control-plane-live-plan-projection.js`
  - `mcp_gpt_desk/src/front-control-plane-live-signal-projection.js`
- Broker execution repository behavioral split:
  - `mcp_gpt_desk/src/broker-execution-normalizers.js`
  - `mcp_gpt_desk/src/broker-protection-snapshot.js`
- Domain barrel compaction:
  - `packages/desk-domain/index.js`
- Legacy monitor contract byte lock preserved:
  - `.gitattributes`
  - `packages/desk-contracts/contracts/DeskHourlyThesisMonitorContract_v1_0_0.md`

## Tests and guards

Passed before release build:

- targeted BFF / broker / diff checks: `31 pass / 0 fail`
- targeted Domain Completeness suite: `50 pass / 0 fail`
- `npm --prefix packages/desk-domain test`: `467 pass / 0 fail`
- `npm --prefix mcp_gpt_desk test`: `1135 pass / 0 fail`
- `npm run guard:strategy-contracts`: PASS

Passed guards:

- `guard:architecture`
- `guard:runtime-safety`
- `guard:mcp-slices`
- `guard:sql-migrations`
- `guard:exceptions`
- `guard:problem-details`
- `guard:browser-secrets`
- `guard:windows-deployment`
- `guard:api-compatibility`
- `guard:jarvis-authority`
- `guard:front-vnext-data-mode`
- `guard:front-vnext-legacy`
- `guard:front-architecture`
- `guard:static-quality`

## Handoff generator

Official read-only generator:

- `scripts/front-handoff/generate_front_handoff.mjs`
- `scripts/front-handoff/front-contract-freeze-registry.json`
- `scripts/front-handoff/probe_front_contract.mjs`

Scripts:

- `npm run handoff:front-freeze`
- `npm run probe:front-contract`

Generated artifacts:

- `reports/front-handoff/FRONT-ENDPOINT-CATALOG.json`
- `reports/front-handoff/FRONT-ENDPOINT-CATALOG.md`
- `reports/front-handoff/DOMAIN-PAYLOAD-CATALOG.json`
- `reports/front-handoff/FRONT-CONTRACT-FREEZE.json`
- `reports/front-handoff/BACKEND-FRONT-WIRING-GAPS.md`
- `reports/front-handoff/DOMAIN-RELATION-GRAPH.mmd`
- `reports/front-handoff/BACKEND-FRONT-HANDOFF.md`
- `reports/front-handoff/BACKEND-DOMAIN-COMPLETENESS-FRONT-FREEZE.md`
- `reports/front-handoff/VPS-FRONT-CONTRACT-RUNTIME-PROBE-preprod-v2-front-freeze-20260815.1.json`

Final regenerated metadata:

- repository commit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- active VPS release: `preprod-v2-front-freeze-20260815.1`
- active VPS commit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- runtime probe timestamp: `2026-08-15T15:10:13.211Z`

## Catalog counts

- endpoint catalog count: `171`
- VNext views: `51`
- VNext commands: `11`
- VNext control endpoints: `3`
- OpenAPI operations: `106`
- broker-effect commands exposed to frontend: `0`

Freeze matrix:

- `FROZEN_FOR_FRONT`: `10`
- `STABLE_ADDITIVE_ONLY`: `9`
- `NOT_FROZEN`: `1`
- `LEGACY`: `1`
- `P0_BEFORE_FRONT_FREEZE`: `0`

## Release

Release candidate built from a Windows-compatible clean clone, not from the dirty main worktree.

- release ID: `preprod-v2-front-freeze-20260815.1`
- release commit: `ac8c418a9f87687090c5779f01fdfc2b753bb00f`
- release profile: `standard`
- manifest dirty flag: `false`
- release verified locally: `Release verified: preprod-v2-front-freeze-20260815.1 (5035 files)`
- artifact: `preprod-v2-front-freeze-20260815.1.zip`
- artifact SHA256: `96ac2c5aac420700c01543b76c2357039a4faa53edbd2e42988b07302b5b94b0`

Secret checks:

- `guard:browser-secrets`: PASS
- strict tracked-source + release-config/front scan: `0 findings`

## Front diffs excluded

`apps/desk-control-plane/**` changes were not included in the backend release commit.

Other local-only/concurrent items still dirty or untracked after backend release:

- `apps/desk-control-plane/**`
- `design-qa.md`
- `docs/front-redesign/**`
- `docs/ui-ux/PROJECT_OVERRIDES.md`
- `reports/visual-references/**`

## VPS deployment

Deployment method:

- `C:\DeskFutures\current\deploy\windows\Update-Desk.ps1`
- backup enabled
- drain enabled
- migrations/canary enabled
- rollback path available through deployment script

Backup proofs:

- database backup: `C:\ProgramData\DeskFutures\backups\desk-native-20260815T150153Z.dump`
- database backup SHA256: `bbad546d95a9c96260baeaf13d063286a5bd39f152e64ad2c84af3c9789c51d0`
- object store backup: `C:\ProgramData\DeskFutures\backups\desk-objects-20260815T150317Z.tar.gz`
- object store backup SHA256: `2f379edd2979ca9d948776af04617207de67b21709371a474744628d93b86b13`

Deployment proof:

- deployment ID: `deploy-20260815T150719Z-945f3f2b`
- result: `Desk update preprod-v2-front-freeze-20260815.1 verified and reopened.`
- public deployment smoke test: PASS
- webhook rejects missing secret: PASS

Active VPS state after deployment:

```text
DESK_RELEASE_VERSION=preprod-v2-front-freeze-20260815.1
DESK_EXPECTED_SERVICE_IDS=telegram_alert_worker
DESK_AI_WORKER_MODE=disabled
DESK_RUNTIME_PROFILE=deterministic_strategy_v5_frozen
```

Active VPS manifest:

```json
{
  "version": "preprod-v2-front-freeze-20260815.1",
  "git_commit": "ac8c418a9f87687090c5779f01fdfc2b753bb00f",
  "dirty": false,
  "release_profile": "standard"
}
```

Safety policy:

- `AUTO_EXECUTION`: OFF
- `LIVE`: OFF
- AI worker mode: `disabled`
- expected runtime worker service: `telegram_alert_worker`
- Human Gate remains mandatory.

## VPS probes

Official probe command:

```bash
npm run probe:front-contract -- --base-url https://vps-6d6969db.vps.ovh.net --output reports/front-handoff/VPS-FRONT-CONTRACT-RUNTIME-PROBE-preprod-v2-front-freeze-20260815.1.json
```

Probe result:

- total: `13`
- ok: `13`
- fail: `0`

Checked routes:

- `/healthz`
- `/readyz`
- `/status`
- `/front-api/v1/capabilities`
- `/front-api/v1/views/command-center`
- `/front-api/v1/views/live-trading`
- `/front-api/v1/views/portfolio`
- `/front-api/v1/views/risk`
- `/front-api/v1/views/orders`
- `/front-api/v1/views/events-audit`
- `/front-api/v1/views/research-lab`
- `/front-api/v1/views/strategy-center`
- `/front-api/v1/views/jarvis-workspace`

Probe validation included:

- HTTP status
- JSON shape
- front view meta/data/permissions
- capabilities/action list
- broker action exposure guard
- secret-like field/value guard
- schemaVersion/asOf availability where applicable

## P0 remaining

`0`

## Final statement

The backend release is clean and deployed. The frontend public handoff is regenerated from the deployed backend contract state and is ready to be used as the public Front Contract Freeze baseline.
