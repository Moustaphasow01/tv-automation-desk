# @tv-automation/desk-oos-research

Owner: `research`. Version: T3_INTELLIGENCE_V1. Public API: `index.js`.

Read-only published forensic evidence enters `ForensicResearchObserver`. `ResearchCycle`, `ResearchHypotheses`, `ResearchDiscovery` and `ResearchApi` create durable audits and research dossiers. `ResearchRunner` advances bounded autonomous passes, never experiments or champion promotion. `PostgresResearchMemory` owns transactions, immutable snapshots, revisions and locks.

No market fetch/capture, plan writer, trading runtime, strategy policy, simulator or broker dependency is accepted. Host composition and model transport remain outside the package. Models and SQL are adapters; domain/application do not import providers.

Tests: `node --test packages/desk-oos-research/test/*.test.js`. Real DB tests opt in with `RUN_POSTGRES_TESTS=1` and `DATABASE_URL`; they create and remove only a generated isolated test schema. No production mutation or market command.

See ADR-0050 and `docs/engineering/oos-research-intelligence-runbook.md` for deployment prerequisites, grants, runner commands, incomplete-data semantics and remaining requirements. Production stays OFF until explicitly configured and verified.
