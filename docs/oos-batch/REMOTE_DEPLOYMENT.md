# Desk OOS remote host

Dedicated Windows service `DeskOos`, loopback port 8795, separate database and
non-superuser role `desk_oos`. The existing Caddy gateway adds only `/oos/*`
and the path-qualified OAuth discovery endpoints. No stable trading service
is replaced. The OOS process has no broker credentials or broker tool.

The available stable-desk PostgreSQL roles have neither CREATEDB nor CREATEROLE.
For VPS isolation, run `Install-OosPostgres.ps1` first. It creates a separate
`DeskOosPostgres` cluster on loopback 5434 with the already installed PG16
binaries, a 32 MB shared-buffer allocation and a private bootstrap credential.
It does not change authentication, roles, services or tables on port 5432.

## Release

Use branch `feature/oos-batch-mcp-v1`; never merge automatically. Package
`mcp_gpt_desk`, its local package dependencies, migrations 070/071 and the
standalone `dist-oos` frontend. Build with Node >=22:

```sh
node --test packages/desk-oos-batch/test/*.test.js mcp_gpt_desk/test/oos_*.test.js
cd apps/desk-control-plane
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.oos.config.ts
```

`oos_postgres.test.js` needs `OOS_TEST_DATABASE_URL`; a skipped test is not
database evidence. It creates and removes only a UUID-named test schema.

Install the technical TradingView MCP provider with its original license in
`C:\ProgramData\DeskOos\providers\tradingview-mcp`. Install release dependencies
with `npm ci --ignore-scripts`. Copy `dist-oos` to the release's `front` folder.
Run `deploy/windows/Install-Oos.ps1 -ReleaseRoot C:\DeskOos\releases\<release>`.
Secrets are generated into administrator/SYSTEM-only `config\oos.env`, never
written to Git or printed. Configuration is `config\oos.json`; archives are
`C:\ProgramData\DeskOos\OOS\YYYY-MM\YYYY-MM-DD`.

The capture worker reaches the operator's TradingView Desktop through a
loopback-only SSH reverse tunnel, not an Internet-facing CDP port. The desktop
must remain running and authenticated. `Start-OosTradingViewTunnel.ps1`
reconnects the tunnel; register it as an operator scheduled task. The provider
and queue workers run inside the persistent VPS service. A desktop outage
produces `FAILED_TECHNICAL`, never fabricated screenshots.

## Capture-only acceptance

`replay_enabled=false` is enforced at HTTP, MCP and worker boundaries.
Only `capture` / `retry-capture` commands may run. The authenticated OOS BFF
queues the date `2026-07-30`, symbol `CME_MINI:MES1!`, cutoff `09:00` Paris.
Stop at `PREMARKET_READY`. No plan is generated and no replay is advanced.
Selecting TradingView's historical cutoff is capture positioning, not a replay
execution. Existing engine/audit study drawings are hidden without changing
their inputs, to avoid disclosing a pre-existing plan or session results.

The manifest v2 digest is SHA-256 of pretty-printed UTF-8 JSON plus LF, omitting
only `manifest_sha256`. A separate `manifest_file_sha256` covers the complete
file. PNG bytes are independently hashed. Delayed source symbols are recorded
explicitly, not relabelled as an undelayed feed.

TradingView uses an exclusive cutoff: selecting 09:00 yields `currentDate`
08:59:59 Paris. The bridge accepts exactly that one-second difference, not a
generic stale-data tolerance, and rejects autoplay or any bar beyond the bound.

An additional M1 consistency check found that a cursor alone cannot certify
an unfinished H4 candle. The bridge now captures CLOSED_ONLY bars and records
`last_bar_open`, `last_bar_close` and `capture_cutoff` for every screenshot.
For the requested 09:00 Paris observation, H4 uses the last complete candle
ending at 08:00 Paris; M5/M15/H1 end at 09:00. This is data-provenance protection,
not a trading filter or a change to the ENGINE.

The initial, never-frozen smoke capture (manifest starting `c63804ccf650`)
was withdrawn and preserved under `quarantine/2026-07-30-c63804ccf650`, together
with a hashed registry/events snapshot. No PNG or plan was deleted or overwritten.
The test-owned active registry entry was reset only after backup; the database
immutability trigger remains unchanged. The operator-only recovery script is
bounded to that exact date/hash and refuses any existing plan. It is not a tool
exposed to ChatGPT and is not a general automatic replacement mechanism.

The accepted CLOSED_ONLY bundle has manifest SHA-256
`703c0fb4fd122beef3c824d0d653b426c6a271fbb842ad2e8cf334213b3c9d71`.
The remote MCP delivered eight real PNG image blocks with matching hashes.
`technical_smoke_dates=["2026-07-30"]` marks this day as `TECHNICAL_SMOKE`
in remote responses and UI, excluding it from OOS performance aggregates
without changing, filtering or inventing any ENGINE trade/result.

## Syntax provenance

The builtin validator was compared with the technical parser of the user's
TradingView script `USER;c7ba7db4087d40b482feeff8688eddc7`, Pine version `19.0`,
title `SMC PRO 3.9.8 — Audit` on 2026-09-30. UTF-8 source SHA-256:
`ae35d503e0971258281a5f8ebc2affcef84375f49a9d70771432875d53fd2cd8`.
Only grammar, IDs/references, date/symbol/version, tick alignment and engine
compatibility constraints are checked. It does not evaluate signals, impose
an RR minimum, limit branches to 3/5, or modify the original plan.

## Authentication / ChatGPT

MCP: `https://vps-6d6969db.vps.ovh.net/oos/mcp`

OAuth issuer: `https://vps-6d6969db.vps.ovh.net/oos`

Protected resource and token audience: `https://vps-6d6969db.vps.ovh.net/oos/mcp`.
Canonical discovery: `/.well-known/oauth-authorization-server/oos` and
`/.well-known/oauth-protected-resource/oos/mcp`. The old `/oos/.well-known/*`
and `/.well-known/oauth-protected-resource/oos` URLs remain aliases.
Scopes: `desk.read desk.write`. Issuer is exactly the value above, without a
trailing slash; successful and denied authorization redirects include `iss`.
The authorization code, access token, refresh flow and token response preserve
the MCP `resource`; mismatched audiences are rejected, never normalized silently.
Previously issued tokens with audience `/oos` require reconnecting with OAuth.
Authorize with the existing desk operator PIN on the OOS consent screen;
the OOS signing secret and token audience are distinct from the stable desk.
Never put PINs or bearer tokens in URLs, screenshots, commits or reports.

In ChatGPT, connect the remote MCP URL with OAuth. Check `get_write_probe`,
then `write_probe("chatgpt-write-test-001")`, then `get_write_probe`.
The probe uses a dedicated table, no day/plan/runtime foreign keys, and repeated
values preserve the original timestamp. A successful SDK test does NOT prove
that a particular ChatGPT subscription permits write actions. Record any
ChatGPT-side refusal verbatim; do not weaken backend validation to bypass it.

### OAuth-only compatibility update

Use `deploy/windows/Update-OosOAuth.ps1 -PatchRoot <extracted-patch> -Revision <git-sha>`.
It copies the existing release, replaces only OAuth/HTTP source files, shares
unchanged dependencies, updates the one OOS Caddy matcher, and restarts only
`DeskOos`. It does not run `Install-Oos.ps1`, migrations, PostgreSQL configuration,
TradingView commands, capture, plan or replay actions. The release setting is
the only OOS JSON configuration value changed. Rollback XML/config/Caddy bytes
are retained in `config/oauth-rollback-<git-sha>`; automatic rollback runs on failure.

From a machine outside the VPS, set `OOS_PUBLIC_URL` and provide the operator PIN
securely in `DESK_OAUTH_ADMIN_PIN`, then run:

```sh
node mcp_gpt_desk/scripts/verify_oos_oauth.mjs --inspector
```

The acceptance script checks SDK discovery, DCR, PKCE, issuer/audience binding,
single-use codes, refresh and tools/list. Inspector 2.8.0 scans the same endpoint
using the actual OAuth access token, with a temporary mode-0600 configuration
removed afterwards. No MCP tool is invoked and no plan/probe/replay is written.
The script never prints credentials. A passing external Inspector scan still
does not substitute for a real reconnect in the user's ChatGPT account.

## Remaining certification boundary

The real TradingView bridge currently exposes capture positioning only.
Replay protocol / freeze / fingerprint / result archive are tested through the
existing ports, but the concrete V3.9.8 replay/audit adapter must be certified
before enabling `replay_enabled`. Unsupported operations fail explicitly with
`OOS_REPLAY_BRIDGE_NOT_CERTIFIED`. Never report a real replay as verified from
mock evidence. A later external plan and explicit replay acceptance are needed.

Rollback: stop only `DeskOos`; restore the previous OOS release XML or remove
the marked Caddy route using `Caddyfile.before-oos`. Validate and reload Caddy.
Retain the database and immutable archive; do not delete captured evidence.
