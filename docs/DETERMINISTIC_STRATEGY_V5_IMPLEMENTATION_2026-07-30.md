# Desk strategy V5.1/V2.1 — deterministic implementation

Status: release candidate under `ENGINE_V5_VALIDATION_HOLD`.

## Objective

Align the Master, Monitor, worker prompts, schemas and backend on one versioned
machine contract. GPT remains the analytical proposer. The backend remains the
only authority for condition state, setup trigger, fill, position management
and realised result in R.

The change must increase opportunity capture without increasing the configured
capital risk ceiling. `risk_pct=0.25` remains the maximum per trade, contracts
remain integer, a valid stop and a minimum RR remain mandatory, and
anti-lookahead remains fail-closed.

## Versioned artifacts

- runtime Autopilot `5.1.0`
- `DeskMasterAnalysisContract_v5_1_0` (`schema_version=5.1.0`)
- `DeskHourlyThesisMonitorContract_v2_1_0` (`schema_version=2.1.0`)
- `DeskExecutionPlanContract_v1_1_0` (`schema_version=1.1.0`)
- `DeskMonitorCommandContract_v1_1_0` (`schema_version=1.1.0`)
- `DeskConditionCatalogContract_v1_1_0` (`schema_version=1.1.0`)
- `DeskDeterministicExecutionPolicy_v4_1_0` (`schema_version=4.1.0`)
- deterministic compiler `1.1.0`
- condition engine `1.1.0`

V5.0/V2.0 and V4/V1 analytical contracts remain immutable, read-only legacy
contracts for historical runs. New work must pin the V5.1/V2.1 hashes, the
V1.1 machine-contract versions, Policy V4.1, compiler 1.1 and condition engine
1.1. No historical work item is implicitly repinned.

## Canonical boundary

Raw GPT output is accepted only at the save boundary and is compiled once:

```text
raw Master  -> compileMasterPlanV1  -> deterministic_execution_plan_v1_1
raw Monitor -> compileMonitorCommandV1 -> desk_monitor_command_v1_1
```

Every downstream consumer reads the canonical objects only. Raw output is kept
for audit and never parsed by the runtime, front, broker or replay engine.

## Separate state machines

The canonical command separates:

- thesis state and thesis command;
- setup lifecycle and setup command;
- position lifecycle and position request;
- replan/workflow state and replan request.

No GPT value can directly create `TRIGGERED`, a fill or a position.

## Opportunity-seeking controlled profile

`OPPORTUNITY_SEEKING_CONTROLLED` changes opportunity gating, not broker risk.

Hard gates remain blocking:

- invalid or missing canonical MNQ/MES trigger data;
- anti-lookahead failure;
- scope, cutoff, pack or contract mismatch;
- missing/invalid geometry, stop or targets;
- RR below the configured minimum;
- expired or terminal setup;
- active deterministic veto;
- broker reconciliation or account safety failure.

Contextual gaps become soft gates unless a setup explicitly declares the datum
mandatory:

- NQ/ES confirmation;
- DXY, VIX, rates, CL and GC;
- calendar, news, indices, mega caps and semis;
- expected closed-market or not-yet-open sources.

The profile must:

- require all true structural activation conditions;
- score primary and secondary confirmations;
- exclude optional/advisory evidence from mandatory completion;
- default the weighted confirmation threshold to `0.55`;
- retain `rr_minimum >= 2.0` and `risk_pct <= 0.25`;
- validate zone-based RR at the same conservative boundary used by execution
  (upper bound for a long, lower bound for a short), never at the midpoint;
- permit multiple ranked conditional setups per Master;
- require a structured proof when no executable opportunity exists.

The threshold is a versioned policy value and must be observable in every plan,
condition evaluation and trade audit. It is not editable by a free-form GPT
field.

## Canonical data profile

The release candidate requires these closed canonical datasets:

- `MNQ_M1` and `MES_M1` for deterministic setup, fill and position lifecycle;
- `MNQ_M5` and `MES_M5` for the GPT trigger cadence and analytical checkpoints.

Higher-timeframe and cross-asset sources are optional context unless a
versioned setup explicitly promotes one to a mandatory condition. This includes
NQ/ES confirmation, H1/H4 structure, DXY, VIX, rates, CL, GC, calendar, news,
indices, mega caps and semiconductors. Their absence must be reported and may
degrade confidence, but must not fabricate a hard failure or success.

Dataset timestamps represent bar-open time unless an explicit close timestamp
or `BAR_CLOSE` semantic is present. A row is visible at cutoff `T` only when its
close is at or before `T`: an implicit M1 row needs `timestamp + 1m <= T`, and
an implicit M5 row needs `timestamp + 5m <= T`. Therefore, at an M5 checkpoint
the latest admissible M5 open is normally `T-5m`. Partial candles remain
fail-closed in LIVE, Replay, raw dataset reads and bundle projections.

## June 11 import-ready evidence

The sealed 2026-06-11 acquisition has been mechanically converted to the
canonical import envelope for the exact Paris window
`[2026-06-11T00:00:00+02:00, 2026-06-11T22:00:00+02:00)`:

- `mnq1_m1.csv`: 1,320 rows, SHA-256
  `e6a1269a67570b5eb9b2c2de5f6582383a2952fb34a1dc01cfad277558fa7e3a`;
- `mes1_m1.csv`: 1,320 rows, SHA-256
  `c2d13f82e504308fa379a348a97c12289e8aa73c464005210e0c7628b3f0ff61`;
- canonical r2 manifest: 2,640 total rows, SHA-256
  `0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054`;
- capture proof: 2,640 rows, policy `settled_closed_bar_v2`, minimum
  settlement lag 119 seconds, SHA-256
  `0af3a904dc924e558c775292a5d7b4b1d0766ae22bb341cc8d8c6144937d507c`;
- package: `.local/backfills/2026-06-11-v5-m1-r2/import-ready`;
- deterministic M5 comparison: 528 complete, exact buckets.

The frozen preparer verifies the exact completed PostgreSQL import receipt and
the canonical M1 row lineage before it can build anything. It then seals the
same evidence into the immutable pack scope, its MNQ/MES dataset references,
the disabled replay config and a durable preparation receipt. Any missing or
different receipt, row, hash, policy, proof or pack lineage fails closed. This
does not assert that the release candidate has been deployed or started.

## Frozen release guarantee

`ENGINE_V5_VALIDATION_HOLD` remains authoritative:

- the transactional market-data importer can stage, validate, quarantine and
  update canonical market tables, but cannot create a replay run, work item or
  enabled replay configuration; `--dry-run` always rolls back;
- frozen replay preparation may validate a pack and persist only a disabled,
  `PAUSED` V5.1 configuration; it must assert that no replay run was created;
- LIVE and Replay claim lanes remain paused, AI worker services remain
  disabled, and broker execution remains globally locked;
- import or preparation success cannot implicitly lift the hold, start
  analytics, claim work or submit/manage an order.

Only an explicit operator-approved release step may change those frozen states.

## Condition runtime

Every predicate returns a state and evidence:

```text
NOT_STARTED | PENDING | SATISFIED | FAILED | INVALIDATED | EXPIRED | UNKNOWN
```

Break/retest is ordered and stateful:

```text
WAITING_BREAK -> BREAK_CONFIRMED -> WAITING_RETEST
-> RETEST_TOUCHED -> REJECTION_CONFIRMED -> SATISFIED
```

A retest before the break is not valid. A missing source is `UNKNOWN`, never a
synthetic failure or success. A hard blocker is terminal only when observed on
an authorised closed candle.

## Required certification

- contract and schema examples validate;
- generated types and runtime catalogues are current;
- prompts contain only active enum values and versions;
- Master/Monitor saves reject conflicting aliases;
- LIVE and Replay compile the same analytical payload to the same canonical
  hash;
- the M1 engine evaluates the same predicates in LIVE and Replay;
- replay compatibility is isolated at ingress and audited;
- no downstream module parses the raw contract output;
- backend, domain, front and deployment tests pass;
- the VPS deployment preserves paused LIVE/Replay claim lanes and disabled AI
  worker services.

No replay or LIVE analyst may be restarted until these checks pass and the
operator explicitly approves the comparison run.
