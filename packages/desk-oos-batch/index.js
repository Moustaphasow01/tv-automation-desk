import { ArtifactArchive, decodePng, jsonBytes, sha256 } from "./src/adapter/artifact-archive.js";
import { PostgresOosRegistry } from "./src/adapter/postgres-registry.js";
import { PostgresOosCommands } from "./src/adapter/postgres-commands.js";
import { TradingViewMcpAdapter } from "./src/adapter/tradingview-mcp.js";
import { PremarketWorkflow } from "./src/application/premarket-workflow.js";
import { PlanFreeze } from "./src/application/plan-freeze.js";
import { ReplayWorkflow } from "./src/application/replay-workflow.js";
import { OosDayWorkflow } from "./src/application/day-workflow.js";
export { batchDays } from "./src/domain/batch-contract.js";
export { projectDay, aggregateBatch } from "./src/application/batch-projection.js";
export { PostgresOosRegistry, ArtifactArchive };

export function createOosRuntime({ pool, root, tradingViewCall, builderCall, validatorCall, clock = () => new Date().toISOString() }) {
  const archive = new ArtifactArchive(root), repository = new PostgresOosRegistry(pool);
  const tradingView = new TradingViewMcpAdapter(tradingViewCall);
  const common = { archive, tradingView, fingerprint: sha256, encodeJson: jsonBytes, decodeImage: decodePng, clock };
  const premarket = new PremarketWorkflow(common);
  const freeze = new PlanFreeze({ ...common, premarket, scenarioBuilder: { request: builderCall }, syntaxValidator: { validate: validatorCall } });
  const replay = new ReplayWorkflow({ ...common, freeze });
  return { archive, repository, commands: new PostgresOosCommands(repository),
    workflow: new OosDayWorkflow({ repository, premarket, freeze, replay, clock }) };
}
