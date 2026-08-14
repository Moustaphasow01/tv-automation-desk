# LOT 008 — Research Industrialisation 160

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD at audit: `e18b48a310085679c94639420ca0b0b8c78ee70f`
Status: **BLOQUÉ EXTERNE + BLOQUÉ PAR PRÉCONDITION INTERNE**

## Objective

Industrialize the existing 160 Strategy_ID research backlog:

`Strategy_ID → Research Mission → Strategy Spec → baseline → bounded screening → canonical simulation → robustness → REJECT / WATCH / PROMOTE`.

## Audit

Searches performed in the repository:

```text
rg -n "Strategy_ID|Strategy ID|160|P0|P1|P2|Strategy_" docs mcp_gpt_desk packages config reports
```

Result:

- No local machine-readable 160 Strategy_ID catalogue was found in the repository.
- No local source of truth mapping the 16 families × 10 Strategy_ID to stable identities was found.
- Atlassian Rovo/Jira lookup had already failed with `INVALID_ARGUMENT` during Lot007.

Lot007 also remains **PARTIAL**:

- it found a promising candidate;
- it preserved source `StrategyDefinition`;
- it persisted baseline/iteration/review/robustness evidence;
- but the best candidate failed robustness and was not promoted;
- true temporal Train/Validation/OOS split usage is not yet persisted/consumed as separate canonical simulations;
- Portfolio Fit is not yet persisted in the vertical slice.

## Decision

Do **not** start 160-strategy industrialization yet.

Reason:

- The programme explicitly says: "Ne pas encore lancer massivement les 160 stratégies avant réussite du vertical slice."
- Starting the full catalogue now would create compute volume before proving the research gates, increasing overfitting and duplicate-strategy risk.

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---|---|---|---|---|---|
| Use existing 160 Strategy_ID | BLOQUÉ EXTERNE | Catalogue not available locally; Jira/Rovo failed. | None in this lot. | N/A | No local catalogue proof. | BLOQUÉ EXTERNE |
| Research Planner over 160 IDs | NON FAIT | Must wait for catalogue and successful vertical slice. | Not implemented deliberately. | N/A | N/A | NON FAIT |
| Pattern Miner / Builder / Experiment Agent industrial loop | PARTIEL | Individual primitives exist, full 160 planner not safe yet. | Existing research runners and domain policies. | Existing research/domain tests. | Lot007 single-slice proof only. | PARTIEL |
| Similarity/novelty/failure memory | FAIT at domain level, PARTIEL runtime | Domain has tests; not applied to 160 catalogue. | `research-candidate-genome`, `research-failure-memory`, `research-knowledge-graph`. | Domain tests passed. | No 160 runtime proof. | PARTIEL |
| Research budget/P0/P1/P2 | PARTIEL | Domain priority policy exists; no 160 backlog ingestion proof. | Existing domain policies. | Domain tests passed. | No catalogue-backed run. | PARTIEL |
| Multiple-testing ledger | PARTIEL | Robustness/multiple testing primitives exist only in pieces. | Existing robustness/promotion domain. | Domain/replay tests passed. | Not applied to 160. | PARTIEL |

## FAIT gained

No code change was made in Lot008 by design. The gain is governance: the desk did not violate the explicit instruction to avoid premature mass research.

## PARTIEL

- Research primitives exist.
- Vertical slice exists but is not fully closed.
- Similarity/failure memory is proven at domain level but not against 160 Strategy_ID runtime.

## NON FAIT

- 160 Strategy_ID planner.
- 160 catalogue ingestion.
- 160 industrial run scheduler.

## NON PROUVÉ

- Jira-backed strategy catalogue identity.
- P0/P1/P2 mapping for the 160 strategies in local runtime.

## BLOQUÉ EXTERNE

- Atlassian/Jira catalogue access.

Required human/external action:

- Provide/export the 160 Strategy_ID catalogue locally, or restore Atlassian Rovo search/update.

Expected proof:

- A machine-readable catalogue containing `Strategy_ID`, family, priority, instrument/timeframe/session constraints and initial Strategy Spec seeds.

## Next

Proceed to the non-blocked prerequisite work:

- close statistical robustness and promotion gates;
- persist true split-based evidence;
- only then return to Lot008 industrialization.
