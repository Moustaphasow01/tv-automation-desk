# Live Focus VNext — baseline

- Audit timestamp: 2026-09-01T04:30:00+02:00
- Local branch: `codex/live-focus-vnext-intelligence`
- Local worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_LIVE_FOCUS_VNEXT`
- Local commit: `c1f714b1f6b2e0ac01579f1d7a3f7477ef741ddb`
- Local worktree status before implementation: clean
- VPS release observed: `preprod-v2-theoretical-exit-resilience-20260901.2`
- VPS commit observed: `c1f714b1f6b2e0ac01579f1d7a3f7477ef741ddb`
- VPS readiness: ready, PostgreSQL connected, CBOT grains `POSTCLOSE`
- Canonical grains session observed: `cbot_us_grains_rth` / `CBOT_GRAINS_CLOSED`
- Safety observed: automatic execution off, physical live off, Human Gate required

The implementation is isolated from the older dirty `TV_Automation_PREPROD` worktree and starts from the release actually served by the VPS.
