# Semi-Manual Operating Runbook

Date: 2026-08-14
Mode: `environment=PAPER`, `executionMode=SEMI_MANUAL`, `autoExecutionEnabled=false`

This runbook defines the only approved near-term operating mode for the Trading Desk.

## Policy

```text
AUTO EXECUTION = OFF
LIVE = OFF
Broker/provider direct auto-submit = OFF
Human execution gate = REQUIRED
Telegram alert = OPERATOR NOTIFICATION ONLY
ACK != FILL
Reconciliation = final truth
```

The backend may automatically perform:

```text
Data
→ StrategySignal
→ AI Context Gate
→ Portfolio Arbitration
→ Global Risk
→ TargetPosition
→ OrderIntent
→ theoretical tracking
→ monitoring
→ Telegram/operator notification
```

The backend must not assume that an alert equals a market entry.

## Theoretical execution rules

The theoretical engine follows the strategy/order semantics:

- A `MARKET` strategy may become theoretically filled immediately according to the market execution policy.
- A `LIMIT` strategy becomes theoretically filled only if price actually touches/crosses the limit according to the configured intrabar rules.
- A stop is hit only by price behavior, not by an operator action alone.
- A target is hit only by price behavior, not by notification delivery.
- An expired/stale OrderIntent must fail closed.
- Human confirmation must not mutate instrument, side, account, authorized quantity, entry, stop or targets.

Manual operator events are separate:

```text
OrderIntent proposed
→ operator receives Telegram/front alert
→ operator may place manually at broker
→ operator records PLACED / FILLED / SKIPPED / CLOSED
→ backend reconciles manual actual vs theoretical expected
```

## Pre-start checklist

Run from `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`.

### 1. Repository quick guards

```bash
npm run guard:architecture
npm run guard:runtime-safety
npm run guard:mcp-slices
npm run guard:sql-migrations
npm run guard:browser-secrets
npm run guard:front-vnext-legacy
npm run guard:front-vnext-data-mode
```

All must pass before any release candidate is considered.

### 2. Demo/Paper stack readiness

```bash
npm run --silent gate:demo-paper -- --json --profile=stack --status-url=http://127.0.0.1:8787/status
```

This may pass with warnings for stack smoke tests, but must not hide stale live data.

### 3. Strict Demo/Paper gate

```bash
npm run --silent gate:demo-paper -- --json --profile=demo-paper --status-url=http://127.0.0.1:8787/status
```

This must be green before a real semi-manual Paper test.

### 4. Readiness doctor

```bash
npm run --silent doctor:demo-paper -- --json --exit-zero --status-url=http://127.0.0.1:8787/status
```

Follow the returned actions. Do not override data or provider blockers.

### 5. Release gate

```bash
npm run --silent gate:demo-paper-release -- --json --exit-zero --status-url=http://127.0.0.1:8787/status --vnext-base-url=http://127.0.0.1:8090
```

If operator PIN/step-up is required, configure it in the environment and rerun.

## Required environment posture

The target environment should keep:

```text
DESK_AUTO_EXECUTION_ENABLED=false
DESK_LIVE_TRADING_ENABLED=false
DESK_LEGACY_POSITION_EXECUTION_ENABLED=false
DESK_EXECUTION_MODE=SEMI_MANUAL
DESK_BROKER_KILL_SWITCH_ENABLED=true unless explicitly cleared for paper test
```

Never infer `autoExecutionEnabled=true` from `environment=PAPER`.

## Telegram alert requirements

Each operator trade alert should include at least:

- clear emoji/status prefix;
- environment and execution mode;
- `OrderIntentId`;
- strategy/instance/version identifiers when available;
- instrument;
- side;
- authorized quantity;
- entry type: market or limit;
- entry price or range;
- stop;
- targets;
- expiry;
- risk reason codes;
- confidence/context summary;
- required operator action;
- explicit reminder that this is not auto-executed.

Example wording:

```text
⚠️ SEMI-MANUAL PAPER ALERT — NOT AUTO EXECUTED
MNQ LONG x1
Entry: LIMIT 19850.25
Stop: 19820.25
Targets: 19890.25 / 19920.25
OrderIntent: ...
Action: place manually only if you accept. Reply/update FILLED, SKIPPED or CLOSED after action.
```

## Front/operator actions

Allowed operator actions in semi-manual mode:

- view signal/context/risk/order intent;
- confirm/reject Human Gate if backend allowedActions permits it;
- mark manual status such as placed/filled/skipped/closed when implemented and authorized;
- reconcile expected vs actual;
- inspect degraded/stale/provider health state.

Forbidden:

- changing quantity after Risk;
- changing account after Risk;
- changing side/instrument/entry/stop/targets during confirmation;
- assuming provider ACK is fill;
- forcing a fill from frontend state;
- direct provider/NinjaTrader/PickMyTrade/Tradovate/Rithmic API call from browser.

## During-run monitoring

Watch:

- data freshness for MNQ/MES M1/M5;
- context source freshness;
- strategy signals created;
- Context Gate decisions;
- Portfolio/Risk decisions;
- OrderIntent lifecycle;
- Human Gate status;
- Telegram delivery;
- theoretical fill status;
- manual fill status;
- reconciliation differences;
- circuit breaker/provider health;
- incident log and latency.

## Stop rules

Stop the semi-manual test and keep agents closed/shadow if any of these occur:

- live data is stale or rescue-only;
- TradingView webhook routing is uncertain;
- Telegram trading/manual channel is not delivering;
- account/environment is not paper/simulation;
- provider health is unknown while attempting provider dispatch;
- circuit breaker is open;
- duplicate send suspicion;
- post-risk mutation attempt;
- reconciliation mismatch not understood;
- backend reports degraded state that affects execution safety;
- operator step-up/capability state is unknown;
- any LIVE account is detected.

## End-of-day reconciliation

At the end of each session:

1. Export/order all OrderIntents created.
2. Compare theoretical fills vs manual/broker actual events.
3. Record mismatches explicitly.
4. Do not overwrite actual broker state with theoretical state.
5. Persist lessons in Research/Strategy evaluation artifacts.
6. Keep rejected/failed strategies as failure memory.

## Promotion boundary

No strategy moves beyond SHADOW/PAPER unless its artifacts answer:

- what dataset was used;
- what Strategy Spec and version;
- what engine version;
- what parameters;
- what trades;
- what costs/slippage;
- profit factor and expectancy;
- max drawdown;
- OOS result;
- robustness/stress tests;
- Portfolio Fit;
- approval decision;
- SHADOW parity;
- reconciliation proof.
