# ADR 0030 — Human Gate reversibility and operator outcome attribution

Status: accepted  
Date: 2026-08-30

## Context

The Desk runs in semi-manual mode. The backend tracks the theoretical lifecycle of every canonical post-risk `OrderIntent`, while the operator may confirm, reject, skip or manually execute it. A Human Gate confirmation is an authorization/declaration; it is not proof of provider ACK or broker fill.

## Decision

1. `CONFIRMED` and `REJECTED` may be reverted only through a backend-owned `UNDO` transition.
2. Undo is disabled by default, feature-flagged, limited to 3–60 seconds (10 seconds by default), revision-protected and refused after gate expiry or creation of any provider command.
3. Every accepted or refused Undo attempt is appended to the Human Gate audit ledger. The Front never infers Undo eligibility.
4. The theoretical execution engine remains independent of operator decisions and continues to follow entry, expiry, target and stop deterministically.
5. Operator attribution is derived only from the canonical manual-execution ledger:
   - `CAPTURED`: manual placed/filled/closed evidence exists;
   - `MISSED_OPPORTUNITY`: not taken and theoretical result is positive;
   - `AVOIDED_LOSS`: not taken and theoretical result is negative;
   - `EXECUTION_UNVERIFIED`: confirmed without manual execution evidence;
   - otherwise pending or unknown.
6. Live performance R uses finalized theoretical outcomes only and is labelled `THEORETICAL_BACKEND`.
7. Telegram publishes canonical OrderIntent, theoretical lifecycle and manual acknowledgements; no notification may imply a broker fill without broker evidence.

## Consequences

- The operator gets a short, safe correction window without weakening provider or Risk authority.
- Captured/missed R remains auditable and cannot be manufactured by a Front click.
- Existing historical decisions have no retroactive Undo deadline.
- A later broker integration may add physical attribution, but cannot redefine theoretical history.

## Rollback

Set `DESK_HUMAN_GATE_UNDO_ENABLED=false`. The additive columns and audit events remain readable. The theoretical and Telegram projections can be removed independently without mutating their source ledgers.
