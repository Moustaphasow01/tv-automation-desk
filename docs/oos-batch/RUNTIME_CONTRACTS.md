# Authoritative Desk OOS runtime contracts

Three `desk.read` tools publish the installed ENGINE and the **unchanged** OOS syntax validator:
`get_engine_constraints`, `get_smc3_contract`, `get_runtime_contract`. No arguments, DB/archive
dependencies, queue writes, plan submissions, captures, broker calls or replay advancement.
Existing 13 tools, OAuth endpoints/scopes, ENGINE inputs, parser and frozen results remain unchanged.

## Source and provenance

`packages/desk-oos-batch/contracts/engine-v3.9.8.source.json` preserves the exact UTF-8 Pine
source as gzip/base64, including original CRLF, plus an installed-input snapshot. It is data,
not a new executable ENGINE. Read-only export from installed TradingView script
`USER;c7ba7db4087d40b482feeff8688eddc7`, Pine `19.0`, short title `SMC398`:

- Source SHA-256: `ae35d503e0971258281a5f8ebc2affcef84375f49a9d70771432875d53fd2cd8`.
- Pine digest: `d9058545573cf5e4d9165e0310698b5dff4522d6`.
- Active rules/config SHA-256: `a7062651739d2f87b8820b0c0fbf4f0d29344b59a783d4ada87814b2f602c39a`.

Source constants/input mappings are extracted, not imported from legacy analyst policies.
Execution constraints include the exact relevant Pine function bodies for verification;
syntax records describe the three deployed `smc3-syntax*.js` files, each with its SHA-256.
All 18 record examples are complete, synthetic plans validated at contract construction.
They are **syntax fixtures only**, never submitted or injected as market data.

The syntax validator is not the execution ENGINE. Syntax-valid plans can fail ENGINE
RR, ATR, cost or portfolio checks. This distinction is explicit. No validation is changed.
Native ENGINE also recognizes SMC1/SMC2 and MNQ; this OOS validator exposes only SMC3/MES.

## Hashes and drift

Each hash is SHA-256 of UTF-8 `JSON.stringify(document_without_its_own_hash, null, 2) + "\n"`.
No response timestamps, prices, historical plans, results or logs enter the hash.
Before **every** contract read, the provider checks the reserved chart, installed study
name, Pine version/digest and active rule input hash. Plan text and display-only controls
are deliberately excluded, using the existing replay bridge fingerprint algorithm.
The original source hash is verified on startup; pinned Pine version/digest identify that
source at read time without reopening/editing the Pine editor.

Changed source/input settings return `CONTRACT_DRIFT`, not a silently regenerated contract.
Work must pin both hashes at batch start and HALT on a changed hash/error. Rebaselining
is an explicit later versioned operation, never performed automatically during July/August.
If the reserved TradingView chart/provider is unavailable, contract reads fail rather than
claiming a verified runtime. Existing endpoints can still start without querying TradingView.

## Acceptance and rollout

Native Node >=22:

```sh
node --test packages/desk-oos-batch/test/*.test.js mcp_gpt_desk/test/oos_*.test.js
```

Windows operator, secrets supplied only through the existing private env file:

```powershell
node --env-file=C:/ProgramData/DeskOos/config/oos.env mcp_gpt_desk/scripts/verify_oos_runtime_contracts.mjs
```

This acceptance runner calls authenticated **public HTTPS** tools/list and the three read
tools, verifies their hashes, validates examples and the unmodified frozen 30/07 plan,
and compares the original run's config hash with the installed ENGINE. It proves no DB
or frozen artifact changed before/after, and refuses an active queue. No result metrics
are printed and no existing replay is run. `preflight` emits a hash-only baseline which
can be supplied as the runner's argument to prove deployment preserved the same state.

`deploy/windows/Update-OosRuntimeContracts.ps1` copies an explicit contract-only file
allowlist to a new release, verifies unchanged parser bytes, restarts **DeskOos only**,
and rolls back service/config pointers if health or public acceptance fails. No SQL,
OAuth, reverse proxy, UI bundle, trading parameter or stable service modification.
Public tools/list must contain **16** tools; compilation alone is not acceptance.

Existing ChatGPT connector catalogues may require `Actualiser les outils` on the existing
Desk OOS App. Never change MCP_URL, OAuth credentials or scope to refresh discovery.

## Scoped verification (2026-10-01)

- OOS suite: 91 tests, 89 passed, 0 failed, 2 PostgreSQL integration tests explicitly
  skipped locally without `OOS_TEST_DATABASE_URL`. Public acceptance separately performs
  real PostgreSQL SELECTs and verifies unchanged OOS rows; a skipped test is not a PASS.
- New contract conformance/isolation tests: 9 passed, including all 18 syntax examples,
  current input/constant concordance, hash stability, drift, scopes and write isolation.
- TypeScript typecheck and standalone OOS Vite build passed. No rebuilt UI is deployed.
- Architecture, Windows deployment-kit and browser-secret guards passed.
- Repository-wide static-quality guard remains failing: unchanged legacy
  `front-session-projection.js` is 1726 lines vs 1659 baseline; aggregate oversized
  functions/complexity/duplicate totals also exceed existing limits. This mission does
  not alter those legacy modules or raise the baseline. New production modules stay
  below the per-file limit and new functions below the 60-line limit.
