import { ArtifactArchive, decodePng, jsonBytes, sha256 } from "./src/adapter/artifact-archive.js";
import { PostgresOosRegistry } from "./src/adapter/postgres-registry.js";
import { PostgresOosCommands } from "./src/adapter/postgres-commands.js";
import { PostgresReplayProgress } from "./src/adapter/postgres-replay-progress.js";
import { TradingViewMcpAdapter } from "./src/adapter/tradingview-mcp.js";
import { PremarketWorkflow } from "./src/application/premarket-workflow.js";
import { PremarketCaptureRepair } from "./src/application/premarket-capture-repair.js";
import { PlanFreeze } from "./src/application/plan-freeze.js";
import { ReplayWorkflow } from "./src/application/replay-workflow.js";
import { OosDayWorkflow } from "./src/application/day-workflow.js";
import { SubmittedPlan } from "./src/application/submitted-plan.js";
import { PostgresOosProbe } from "./src/adapter/postgres-probe.js";
import { PostgresPremarketBatches } from "./src/adapter/postgres-premarket-batches.js";
import { PremarketOrchestration } from "./src/application/premarket-orchestration.js";
import { readRuntimeContractSource, pineSourceFacts, pineFunctionSource } from "./src/adapter/runtime-contract-source.js";
import { describeEngineConstraints } from "./src/domain/engine-constraints-contract.js";
import { OosRuntimeContracts, buildSmc3Contract, ruleInputFingerprint } from "./src/application/runtime-contracts.js";
export { OosPortal } from "./src/application/oos-portal.js";
export { validateSmc3Syntax } from "./src/domain/smc3-syntax.js";
export { batchDays } from "./src/domain/batch-contract.js";
export { projectDay, aggregateBatch } from "./src/application/batch-projection.js";
export { PostgresOosRegistry, ArtifactArchive };

export async function createOosRuntimeContracts({ readInstalled }) {
  const basis = await readRuntimeContractSource(), facts = pineSourceFacts(basis);
  const installed = basis.snapshot.installed;
  const provenance = { pine_script_id: "USER;c7ba7db4087d40b482feeff8688eddc7", pine_version: installed.pine.version,
    pine_digest: installed.pine.digest, source_sha256: basis.snapshot.source_sha256,
    config_sha256: ruleInputFingerprint({ installed, fingerprint: sha256 }),
    parser_sources: basis.syntax.map(({ path, sha256 }) => ({ path, sha256 })) };
  const functions = ["f_truth", "f_cond", "f_geometry", "f_guard_errors", "f_portfolio_error", "f_frozen_errors",
    "f_try_rearm", "f_restart", "f_select_candidates", "f_pending", "f_manage_trade", "f_complete_intrabar_coverage",
    "f_resolve_oco_slice", "f_direction_ambiguous"].map(name => pineFunctionSource(basis.source, name));
  const description = { ...describeEngineConstraints({ facts, provenance, functions }),
    active_inputs: Object.fromEntries(Object.entries(facts.inputs).filter(([name]) =>
      !["dashView", "dashPage", "dashRows", "dashWidthPct", "uiFont", "pinBars", "drawTickets"].includes(name))
      .map(([name, input]) => [name, { value: input.value, default: input.default, input_id: input.id }])) };
  const engine = { ...description, engine_constraints_sha256: sha256(jsonBytes(description)) };
  const smc3 = buildSmc3Contract({ syntax: basis.syntax, facts, provenance, fingerprint: sha256, encodeJson: jsonBytes });
  return new OosRuntimeContracts({ engine, smc3, installed, readInstalled, fingerprint: sha256 });
}

export function createPremarketOrchestration(options) {
  return new PremarketOrchestration({ clock: () => new Date().toISOString(), ...options, fingerprint: sha256, encodeJson: jsonBytes });
}

export function createOosRuntime({ pool, root, tradingViewCall, builderCall, validatorCall, sessionCalendar, clock = () => new Date().toISOString() }) {
  const archive = new ArtifactArchive(root), repository = new PostgresOosRegistry(pool);
  const tradingView = new TradingViewMcpAdapter(tradingViewCall);
  const common = { archive, tradingView, fingerprint: sha256, encodeJson: jsonBytes, decodeImage: decodePng, clock };
  const premarket = new PremarketWorkflow({ ...common, sessionCalendar });
  const freeze = new PlanFreeze({ ...common, premarket, scenarioBuilder: { request: builderCall }, syntaxValidator: { validate: validatorCall } });
  const replay = new ReplayWorkflow({ ...common, freeze, progress: new PostgresReplayProgress(pool) });
  return { archive, repository, premarket, freeze, replay, probe: new PostgresOosProbe(pool),
    captureRepair: new PremarketCaptureRepair({ ...common, repository, premarket }),
    batches: new PostgresPremarketBatches(repository),
    submittedPlan: new SubmittedPlan({ ...common, repository, premarket, freeze }),
    commands: new PostgresOosCommands(repository),
    workflow: new OosDayWorkflow({ repository, premarket, freeze, replay, clock }) };
}
