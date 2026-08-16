# Front VNext Redesign Baseline

**Captured:** 2026-08-15 (Europe/Paris)
**Scope:** Command Center golden master and subsequent Front VNext product slices

## Git baseline

- Branch: `codex/preprod-v4-local-parity-cleanup`
- Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
- SHA: `670b05778896c2e936be9193a218e144bd4eb163`
- Working tree before this slice: clean
- Runtime authority: real BFF `/front-api/v1` backed by PostgreSQL; no runtime mocks or legacy fallback

## Quality baseline inherited by this slice

- Frontend: `160/160` tests reported green in `FRONTEND_V2_IMPLEMENTATION_PROGRESS.md`
- BFF/PostgreSQL: `20/20` tests reported green
- Real-stack E2E: `3/3` scenarios reported green
- Accessibility: `76` Axe audits, `0` serious/critical
- Performance: `37/37` static BFF views below budget
- Visual QA: `4/4` baseline viewports

These results are the pre-change baseline. The Command Center slice must rerun the applicable suites; inherited results are not proof of the new implementation.

## Approved visual authority

- Persisted source: `reports/visual-references/command-center-approved-1672x941.png`
- Source received from the operator clipboard: `1536 x 864` RGBA
- Normative viewport from the written specification: `1672 x 941`
- SHA-256: `46e1900070128975158aa28c438d8f6fbf62b3c32600d7eebca1f83eaa3c17fb`

The bitmap is a scaled representation of the normative layout. Visual review therefore uses both pixel comparison at the source dimensions and geometric assertions at `1672 x 941`.

## Selected governance

- Product contract: `FRONTEND_V2_PAGE_OPERATING_CONTRACTS_2026-08-13.md`
- Reference specification: `Spécification de reproduction — Command Center du Trading Desk`
- Rulebook selection: `reports/ui-ux/command-center-golden-master-rule-selection.json`
- Required skills: image-to-code, frontend-design, impeccable, accessibility remediation, Playwright and design QA

No business rule, risk decision, PnL, provider state or capability may be derived by the frontend during this redesign.
