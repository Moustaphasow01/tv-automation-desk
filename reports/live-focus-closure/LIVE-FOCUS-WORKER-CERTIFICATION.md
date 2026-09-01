# Live Focus context worker certification

## Authority and routing

Task type: `LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH`; lane: `live`; dedicated pool pattern: `LIVE_US_GRAINS_MARKET_CONTEXT_*`; maximum concurrency: 1. The runner calls Codex through the existing `CodexExecAdapter` with a strict output schema and no repository access.

## Bounded input

The bundle contains only cutoff-safe ZC/ZW M1/M5 observations, canonical grains session, agricultural events known at the cutoff, source manifests and optional weather state. It never includes future published values.

## Failure behavior

Timeout/failure never creates an available snapshot. The deterministic strategy runtime continues; the prefilter waits only where context is mandatory. Retry/DLQ and latency/token/cost metrics remain owned by Agent Runtime.

## Static/integration proof

- scheduler event/cadence test: PASS;
- strict worker syntax/schema check: PASS;
- PostgreSQL transaction/outbox integration: PASS;
- actual VPS canary: pending deployment section in final certification.
