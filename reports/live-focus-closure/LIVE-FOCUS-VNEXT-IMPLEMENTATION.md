# Live Focus VNext — implementation

## Outcome

The `US_GRAINS_CBOT` cockpit now consumes one backend-owned projection from `GET /front-api/v1/views/live-focus`. It distinguishes market context, observed signals, qualified trade dossiers, operator authority, theoretical outcomes and source degradation without promoting a raw signal locally.

## Canonical flow

`ZC/ZW data + agri calendar + canonical grains session → Market Context task → MarketContextSnapshot + MarketDeskBrief → deterministic Context prefilter → existing AI Context Gate → Portfolio → Global Risk → TargetPosition → OrderIntent → HumanGate → Live Focus Trade Card`.

The strategy engines keep evaluating. A missing/stale mandatory source yields `WAIT`; it does not stop the engines and cannot become a false `NO_RISK`.

## Persistence and provenance

Migration `062_live_focus_market_intelligence.sql` adds source coverage manifests, the canonical agricultural event calendar, context snapshots, operator briefs, prefilter decisions, bounded adjustment proposals and scheduler dispatch evidence. Context and brief publication is transactional and emits durable outbox events. Every object carries cutoff, validity, source states, model/prompt policy, worker/task identity and provenance.

## Worker

One Agent Runtime mission owns the US grains universe. The scheduler publishes a bounded, cutoff-safe task every 30 minutes during the canonical open session and every 60 minutes outside it. Session/source transitions, volatility shocks, structure breaks and nearby high-impact agricultural events can invalidate and refresh the context. The Codex runner has read-only analytical authority and cannot call Provider, broker, Risk or Human Gate mutations.

## Operator projection

Trade Cards require the canonical `TargetPosition + OrderIntent + HumanGate` triplet. Upstream StrategySignals remain in the secondary Observed Opportunities queue. The main stack sorts actionable, active/pending and terminal dossiers. Each dossier preserves Strategy-proposed, Context-adjusted and Risk-authorized plans separately. All actions come from backend `allowedActions`.

## Realtime

A browser without a cursor receives a current snapshot checkpoint and future events only. A valid cursor resumes after the cursor. An unknown/old cursor receives `desk.resync_required`, refetches the canonical Focus projection and installs a fresh checkpoint. Heartbeats are SSE comments, not synthetic domain events.

## Data policy

The official 2026 USDA high-impact release calendar is seeded with explicit coverage and publication provenance. Weather is contractually `OPTIONAL_UNAVAILABLE`/`NOT_IMPLEMENTED` in this slice and is not required by the active deterministic families. It cannot silently influence eligibility.

## Safety

- automatic execution: off;
- physical live execution: off;
- Human Gate: required;
- no frontend Risk/quantity/terms calculation;
- no frontend Provider/broker/database call;
- no runtime mock or legacy fallback added.
