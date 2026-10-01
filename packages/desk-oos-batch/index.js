import { ArtifactArchive, decodePng, jsonBytes, sha256 } from "./src/adapter/artifact-archive.js";
import { PostgresOosRegistry } from "./src/adapter/postgres-registry.js";
import { PostgresOosCommands } from "./src/adapter/postgres-commands.js";
import { TradingViewMcpAdapter } from "./src/adapter/tradingview-mcp.js";
import { PremarketWorkflow } from "./src/application/premarket-workflow.js";
import { PlanFreeze } from "./src/application/plan-freeze.js";
import { ReplayWorkflow } from "./src/application/replay-workflow.js";
import { OosDayWorkflow } from "./src/application/day-workflow.js";
import { SubmittedPlan } from "./src/application/submitted-plan.js";
import { PostgresOosProbe } from "./src/adapter/postgres-probe.js";
import { PostgresPremarketBatches } from "./src/adapter/postgres-premarket-batches.js";
import { PremarketOrchestration } from "./src/application/premarket-orchestration.js";
export { OosPortal } from "./src/application/oos-portal.js";
export { validateSmc3Syntax } from "./src/domain/smc3-syntax.js";
export { batchDays } from "./src/domain/batch-contract.js";
export { projectDay, aggregateBatch } from "./src/application/batch-projection.js";
export { PostgresOosRegistry, ArtifactArchive };

export function createPremarketOrchestration(options) {
  return new PremarketOrchestration({ clock: () => new Date().toISOString(), ...options, fingerprint: sha256, encodeJson: jsonBytes });
}

export function createOosRuntime({ pool, root, tradingViewCall, builderCall, validatorCall, clock = () => new Date().toISOString() }) {
  const archive = new ArtifactArchive(root), repository = new PostgresOosRegistry(pool);
  const tradingView = new TradingViewMcpAdapter(tradingViewCall);
  const common = { archive, tradingView, fingerprint: sha256, encodeJson: jsonBytes, decodeImage: decodePng, clock };
  const premarket = new PremarketWorkflow(common);
  const freeze = new PlanFreeze({ ...common, premarket, scenarioBuilder: { request: builderCall }, syntaxValidator: { validate: validatorCall } });
  const replay = new ReplayWorkflow({ ...common, freeze });
  return { archive, repository, premarket, freeze, replay, probe: new PostgresOosProbe(pool),
    batches: new PostgresPremarketBatches(repository),
    submittedPlan: new SubmittedPlan({ ...common, repository, premarket, freeze }),
    commands: new PostgresOosCommands(repository),
    workflow: new OosDayWorkflow({ repository, premarket, freeze, replay, clock }) };
}
