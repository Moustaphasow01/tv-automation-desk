#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SystemClock } from "../../packages/desk-time/index.js";
import { buildFrontApiV2Catalog } from "../../mcp_gpt_desk/src/front-api-catalog-v2.js";
import { FRONT_COMMAND_CATALOG } from "../../mcp_gpt_desk/src/front-control-plane-command.js";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "reports", "front-handoff");
const registryPath = join(import.meta.dirname, "front-contract-freeze-registry.json");
const generatorVersion = "front_handoff_generator_v1.0.0";
const schemaVersion = "front_handoff_v1";
const clock = new SystemClock();

const metadata = {
  generatedAt: clock.now().utc,
  repositoryBranch: git(["branch", "--show-current"]) || "unknown",
  repositoryCommit: git(["rev-parse", "HEAD"]) || "unknown",
  schemaVersion,
  generatorVersion,
  activeVpsRelease: process.env.DESK_ACTIVE_VPS_RELEASE || null,
  activeVpsCommit: process.env.DESK_ACTIVE_VPS_COMMIT || null,
  runtimeProbeTimestamp: process.env.DESK_RUNTIME_PROBE_TIMESTAMP || null,
};

await mkdir(outDir, { recursive: true });
const source = await sourceSnapshot();
const freezeRegistry = JSON.parse(await readFile(registryPath, "utf8"));
const endpointCatalog = buildEndpointCatalog(source);
const payloadCatalog = await buildPayloadCatalog(source);
const freezeMatrix = buildFreezeMatrix(freezeRegistry);
const gaps = buildWiringGaps(freezeMatrix);
const graph = buildRelationGraph(source, freezeMatrix);

await writeJson("FRONT-ENDPOINT-CATALOG.json", endpointCatalog);
await writeText("FRONT-ENDPOINT-CATALOG.md", endpointCatalogMarkdown(endpointCatalog));
await writeJson("DOMAIN-PAYLOAD-CATALOG.json", payloadCatalog);
await writeJson("FRONT-CONTRACT-FREEZE.json", freezeMatrix);
await writeText("BACKEND-FRONT-WIRING-GAPS.md", wiringGapsMarkdown(gaps, freezeMatrix));
await writeText("DOMAIN-RELATION-GRAPH.mmd", graph);
await writeText("BACKEND-FRONT-HANDOFF.md", handoffMarkdown(endpointCatalog, payloadCatalog, freezeMatrix, gaps));
await writeText("BACKEND-DOMAIN-COMPLETENESS-FRONT-FREEZE.md", freezeSummaryMarkdown(endpointCatalog, payloadCatalog, freezeMatrix, gaps));

console.log(JSON.stringify({
  ok: true,
  generatorVersion,
  repositoryCommit: metadata.repositoryCommit,
  endpointCatalogCount: endpointCatalog.counts.total,
  vnextViews: endpointCatalog.counts.vnextViews,
  frozenContracts: freezeMatrix.counts.FROZEN_FOR_FRONT || 0,
  stableAdditiveContracts: freezeMatrix.counts.STABLE_ADDITIVE_ONLY || 0,
  notFrozenContracts: freezeMatrix.counts.NOT_FROZEN || 0,
  p0BeforeFrontFreeze: freezeMatrix.p0BeforeFrontFreeze.length,
  outputDir: relative(root, outDir),
}, null, 2));

async function sourceSnapshot() {
  const controlPlanePath = join(root, "mcp_gpt_desk", "src", "front-control-plane-api.js");
  const controlPlaneSource = await readFile(controlPlanePath, "utf8");
  const viewNames = extractQuotedArray(controlPlaneSource, "VIEW_NAMES");
  const dependencies = extractDependencyMap(controlPlaneSource);
  const openApiCatalog = buildFrontApiV2Catalog();
  const migrations = await listMigrations();
  return {
    controlPlanePath,
    controlPlaneSource,
    viewNames,
    dependencies,
    commands: FRONT_COMMAND_CATALOG,
    openApiCatalog,
    migrations,
  };
}

function buildEndpointCatalog(source) {
  const viewEntries = source.viewNames.map((viewName) => ({
    id: `front-view:${viewName}`,
    type: "VNEXT_VIEW",
    method: "GET",
    path: `/front-api/v1/views/${viewName}`,
    source: "front-control-plane-api:VIEW_NAMES",
    sourceReference: "mcp_gpt_desk/src/front-control-plane-api.js",
    dependencies: source.dependencies[viewName] || [],
    freshness: "backend-projected",
    contractStatus: freezeStatusForView(viewName),
    sideEffects: "READ_ONLY",
  }));
  const commandEntries = Object.entries(source.commands).map(([commandType, command]) => ({
    id: `front-command:${commandType}`,
    type: "VNEXT_COMMAND",
    method: "POST",
    path: "/front-api/v1/commands",
    commandType,
    source: "front-control-plane-command:FRONT_COMMAND_CATALOG",
    sourceReference: "mcp_gpt_desk/src/front-control-plane-command.js",
    capability: command.capability,
    environments: [...command.environments],
    mutation: command.mutation,
    brokerExecution: command.brokerExecution === true,
    sideEffects: command.brokerExecution === true ? "BROKER_FORBIDDEN_IN_FRONT_FREEZE" : "NO_DIRECT_BROKER_EFFECT",
  }));
  const controlEntries = [
    endpoint("front-capabilities", "VNEXT_CAPABILITIES", "GET", "/front-api/v1/capabilities", "capabilities registry"),
    endpoint("front-events", "VNEXT_REALTIME", "GET", "/front-api/v1/events", "SSE cursor stream"),
    endpoint("front-command-status", "VNEXT_COMMAND_STATUS", "GET", "/front-api/v1/commands/{commandId}", "operator command status"),
  ];
  const openApiEntries = source.openApiCatalog.operations.map((operation) => ({
    id: `api-v2:${operation.operationId}`,
    type: "LEGACY_OR_TRANSITIONAL_API",
    method: operation.method,
    path: operation.path,
    operationId: operation.operationId,
    domain: operation.domain,
    source: "front-api-catalog-v2:OpenAPI",
    sourceReference: "mcp_gpt_desk/src/front-api-catalog-v2.js",
    stability: operation.stability,
    sideEffects: operation.method === "GET" ? "READ_ONLY" : operation.writePolicy,
  }));
  const entries = [...controlEntries, ...viewEntries, ...commandEntries, ...openApiEntries]
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.id.localeCompare(right.id));
  return {
    ...metadata,
    schemaVersion: "front_endpoint_catalog_v1",
    classificationNote: "Generated from front-control-plane VIEW_NAMES, FRONT_COMMAND_CATALOG and OpenAPI-derived front API catalog. No historical commit is hardcoded.",
    counts: {
      total: entries.length,
      vnextViews: viewEntries.length,
      vnextCommands: commandEntries.length,
      vnextControl: controlEntries.length,
      openApiOperations: openApiEntries.length,
      brokerEffectCommands: commandEntries.filter((entry) => entry.brokerExecution).length,
    },
    entries,
  };
}

function buildPayloadCatalog(source) {
  const objects = [
    payload("front.view.envelope", "VNext view envelope", "SCHEMA_DERIVED", "mcp_gpt_desk/src/front-control-plane-api.js", ["meta", "permissions", "data", "source", "asOf", "revision", "warnings"]),
    payload("front.command.receipt", "Operator command receipt", "SCHEMA_DERIVED", "mcp_gpt_desk/src/front-control-plane-command.js", ["commandId", "status", "correlationId", "causationId", "aggregateId", "idempotencyKey", "acceptedAt", "environment"]),
    payload("front.realtime.event", "SSE event envelope", "SCHEMA_DERIVED", "mcp_gpt_desk/src/front-control-plane-realtime.js", ["eventId", "aggregateId", "aggregateType", "eventType", "occurredAt", "receivedAt", "source", "correlationId", "causationId", "schemaVersion", "sequence", "payload"]),
    payload("strategy.signal", "Strategy Signal Bus", "SCHEMA_DERIVED", "packages/desk-domain/src/strategy-signal-bus-v1.js", ["signalId", "strategyVersionId", "strategyInstanceId", "instrument", "side", "timeframe", "dedupeKey", "source"]),
    payload("ai.context.decision", "AI Context Gate decision", "SCHEMA_DERIVED", "packages/desk-domain/src/ai-context-gate-v1.js", ["decision", "confidence", "riskMultiplier", "reasonCodes", "anomalies", "invalidation"]),
    payload("portfolio.allocation", "Portfolio candidate allocation", "SCHEMA_DERIVED", "packages/desk-domain/src/portfolio-candidate-allocation-v1.js", ["allocationId", "strategySignalId", "side", "quantity", "conflictState", "lineage"]),
    payload("risk.decision", "Global Risk decision", "SCHEMA_DERIVED", "packages/desk-domain/src/portfolio-risk-budget-v1.js", ["riskDecisionId", "decision", "requestedQuantity", "approvedQuantity", "reasonCodes", "lineage"]),
    payload("target.position", "Target Position", "SCHEMA_DERIVED", "packages/desk-domain/src/portfolio-target-position-v1.js", ["targetPositionId", "instrument", "accountId", "targetQuantity", "riskDecisionId", "lineage"]),
    payload("order.intent", "Canonical OrderIntent dossier", "SCHEMA_DERIVED", "packages/desk-domain/src/portfolio-order-intent-v1.js", ["orderIntentId", "targetPositionId", "riskDecisionId", "idempotencyKey", "brokerSubmissionAllowed", "terms"]),
    payload("human.gate", "Human Gate lifecycle", "SCHEMA_DERIVED", "infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql", ["status", "revision", "operatorId", "confirmationPhrase", "approvedAt", "rejectedAt", "expiresAt"]),
    payload("provider.command", "Execution Provider Command", "SCHEMA_DERIVED", "infra/postgres/init/045_execution_provider_port.sql", ["providerCommandId", "provider", "commandType", "idempotencyKey", "ackStatus", "fillStatus"]),
    payload("migration.inventory", "PostgreSQL migration inventory", "SCHEMA_DERIVED", "infra/postgres/init", ["latestMigration", "migrationCount", "owners"]),
  ];
  return {
    ...metadata,
    schemaVersion: "domain_payload_catalog_v1",
    sanitization: "No REAL_DB payload is generated by this read-only script. All examples are schema-derived and contain no secrets.",
    sourcePriority: ["REAL_DB", "TEST_FIXTURE", "SCHEMA_DERIVED"],
    objectCount: objects.length,
    viewCount: source.viewNames.length,
    commandCount: Object.keys(source.commands).length,
    latestMigration: source.migrations.at(-1)?.file || null,
    objects,
  };
}

function buildFreezeMatrix(registry) {
  const contracts = registry.contracts.map((contract) => ({
    ...contract,
    sourceExists: existsSync(join(root, contract.sourceFile)),
    testsExist: (contract.tests || []).map((test) => ({ path: test, exists: existsSync(join(root, test)) })),
  }));
  const counts = contracts.reduce((acc, contract) => {
    acc[contract.status] = (acc[contract.status] || 0) + 1;
    return acc;
  }, {});
  const missingSources = contracts.filter((contract) => !contract.sourceExists).map((contract) => ({
    id: `missing-source:${slug(contract.contract)}`,
    owner: "Backend",
    exactGap: `Missing source file: ${contract.sourceFile}`,
    affectedContract: contract.contract,
    blockingReason: "The contract cannot be frozen without source evidence.",
    nextAction: "Restore or correct sourceReference.",
  }));
  return {
    ...metadata,
    schemaVersion: "front_contract_freeze_matrix_v1",
    policy: registry.policy,
    counts,
    contracts,
    p0BeforeFrontFreeze: [...(registry.p0BeforeFrontFreeze || []), ...missingSources],
  };
}

function buildWiringGaps(freezeMatrix) {
  const p0 = freezeMatrix.p0BeforeFrontFreeze || [];
  const notFrozen = freezeMatrix.contracts.filter((contract) => contract.status === "NOT_FROZEN");
  const missingTests = freezeMatrix.contracts
    .filter((contract) => contract.testsExist?.some((item) => !item.exists))
    .map((contract) => ({
      contract: contract.contract,
      missingTests: contract.testsExist.filter((item) => !item.exists).map((item) => item.path),
    }));
  return { ...metadata, p0, notFrozen, missingTests };
}

function buildRelationGraph(source, freezeMatrix) {
  const frozen = freezeMatrix.counts.FROZEN_FOR_FRONT || 0;
  const stable = freezeMatrix.counts.STABLE_ADDITIVE_ONLY || 0;
  const views = source.viewNames.length;
  return [
    "flowchart LR",
    `  Data["Data / PostgreSQL"] --> Signal["Strategy Signal deterministic"]`,
    `  Signal --> Context["AI Context Gate"]`,
    `  Context --> Portfolio["Portfolio Arbitration"]`,
    `  Portfolio --> Risk["Global Risk"]`,
    `  Risk --> Target["Target Position"]`,
    `  Target --> Intent["OrderIntent"]`,
    `  Intent --> Human["Human Gate"]`,
    `  Human --> Gateway["Execution Gateway"]`,
    `  Gateway --> Provider["Provider adapter"]`,
    `  Data --> BFF["/front-api/v1 BFF"]`,
    `  Intent --> BFF`,
    `  BFF --> Views["VNext views: ${views}"]`,
    `  BFF --> SSE["SSE /events cursor stream"]`,
    `  Views --> Front["Front VNext"]`,
    `  SSE --> Front`,
    `  Freeze["Freeze matrix: ${frozen} frozen / ${stable} stable-additive"] -. governs .-> BFF`,
    "",
  ].join("\n");
}

function endpoint(id, type, method, path, source) {
  return {
    id,
    type,
    method,
    path,
    source,
    sourceReference: "mcp_gpt_desk/src/front-control-plane-api.js",
    sideEffects: "READ_ONLY",
  };
}

function payload(id, label, sourceType, sourceReference, fields) {
  return {
    id,
    label,
    sourceType,
    sourceReference,
    sourceExists: existsSync(join(root, sourceReference)),
    fields,
    samplePolicy: sourceType,
  };
}

function freezeStatusForView(viewName) {
  if (["command-center", "live-trading", "portfolio", "risk", "orders", "events-audit", "research-lab", "strategy-center", "jarvis-workspace"].includes(viewName)) {
    return "STABLE_ADDITIVE_ONLY";
  }
  return "NOT_CLASSIFIED_VIEW";
}

function extractQuotedArray(content, constantName) {
  const pattern = new RegExp(`const\\s+${constantName}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\);`);
  const match = content.match(pattern);
  if (!match) throw new Error(`Unable to extract ${constantName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

function extractDependencyMap(content) {
  const body = extractObjectLiteralBody(content, "VIEW_SOURCE_DEPENDENCIES");
  const map = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:"([^"]+)"|([a-zA-Z0-9_-]+))\s*:\s*\[([^\]]*)\]/);
    if (!match) continue;
    const key = match[1] || match[2];
    map[key] = [...match[3].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  }
  return map;
}

function extractObjectLiteralBody(content, constantName) {
  const startToken = `const ${constantName} = {`;
  const start = content.indexOf(startToken);
  if (start < 0) throw new Error(`Unable to find ${constantName}`);
  const bodyStart = start + startToken.length;
  let depth = 1;
  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return content.slice(bodyStart, index);
  }
  throw new Error(`Unable to close ${constantName}`);
}

async function listMigrations() {
  const migrationDir = join(root, "infra", "postgres", "init");
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  return Promise.all(files.map(async (file) => {
    const fullPath = join(migrationDir, file);
    const info = await stat(fullPath);
    return { file, bytes: info.size, sha256: await sha256File(fullPath) };
  }));
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function endpointCatalogMarkdown(catalog) {
  const rows = catalog.entries.map((entry) => `| ${entry.type} | ${entry.method} | \`${entry.path}\` | ${entry.commandType || entry.operationId || entry.id} | ${entry.sideEffects || ""} |`);
  return [
    "# Front endpoint catalog",
    "",
    metadataBlock(),
    "",
    `Total endpoints: **${catalog.counts.total}**`,
    "",
    "| Type | Method | Path | Contract | Side effects |",
    "|---|---:|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function wiringGapsMarkdown(gaps, freezeMatrix) {
  const p0Rows = gaps.p0.length ? gaps.p0.map((gap) => `| ${gap.id} | ${gap.owner} | ${gap.affectedContract} | ${gap.exactGap} | ${gap.nextAction} |`) : ["| — | — | — | Aucun P0 codable détecté par le générateur. | — |"];
  const notFrozenRows = gaps.notFrozen.map((contract) => `| ${contract.contract} | ${contract.reason || "Frontend must keep UNKNOWN/UNAVAILABLE fallback."} | ${contract.sourceFile} |`);
  return [
    "# Backend/front wiring gaps",
    "",
    metadataBlock(),
    "",
    "## P0_BEFORE_FRONT_FREEZE",
    "",
    "| ID | Owner | Contract | Gap | Next action |",
    "|---|---|---|---|---|",
    ...p0Rows,
    "",
    "## NOT_FROZEN contracts",
    "",
    "| Contract | Reason | Source |",
    "|---|---|---|",
    ...notFrozenRows,
    "",
    `Freeze counts: \`${JSON.stringify(freezeMatrix.counts)}\``,
    "",
  ].join("\n");
}

function handoffMarkdown(endpointCatalog, payloadCatalog, freezeMatrix, gaps) {
  return [
    "# Backend/front handoff",
    "",
    metadataBlock(),
    "",
    "## Contract source",
    "",
    "- Source of truth: current repository code, migrations, registries and tests.",
    "- Generator: `scripts/front-handoff/generate_front_handoff.mjs`.",
    "- Freeze registry: `scripts/front-handoff/front-contract-freeze-registry.json`.",
    "- No historical commit is hardcoded.",
    "",
    "## Counts",
    "",
    `- Endpoint catalog: ${endpointCatalog.counts.total}`,
    `- VNext views: ${endpointCatalog.counts.vnextViews}`,
    `- VNext commands: ${endpointCatalog.counts.vnextCommands}`,
    `- Payload objects: ${payloadCatalog.objectCount}`,
    `- Frozen contracts: ${freezeMatrix.counts.FROZEN_FOR_FRONT || 0}`,
    `- Stable additive contracts: ${freezeMatrix.counts.STABLE_ADDITIVE_ONLY || 0}`,
    `- Not frozen contracts: ${freezeMatrix.counts.NOT_FROZEN || 0}`,
    `- P0 before front freeze: ${gaps.p0.length}`,
    "",
    "## Non-negotiable frontend rules",
    "",
    "- The frontend must use `/front-api/v1` or documented API routes; it must not call a provider/broker directly.",
    "- Official Portfolio/Risk/Target/OrderIntent values are backend-sourced.",
    "- Commands are idempotent, audited and broker-side-effect free during front freeze.",
    "- `NOT_FROZEN` contracts require graceful `UNKNOWN` / `UNAVAILABLE` handling.",
    "",
  ].join("\n");
}

function freezeSummaryMarkdown(endpointCatalog, payloadCatalog, freezeMatrix, gaps) {
  return [
    "# Backend Domain Completeness / Front Freeze",
    "",
    metadataBlock(),
    "",
    "## Verdict local",
    "",
    gaps.p0.length === 0 ? "**P0_BEFORE_FRONT_FREEZE: 0**" : `**P0_BEFORE_FRONT_FREEZE: ${gaps.p0.length}**`,
    "",
    "This file is generated from the current backend handoff generator and must be regenerated after backend contract changes.",
    "",
    "## Evidence inventory",
    "",
    `- Endpoint catalog count: ${endpointCatalog.counts.total}`,
    `- Domain payload objects: ${payloadCatalog.objectCount}`,
    `- Freeze matrix counts: ${JSON.stringify(freezeMatrix.counts)}`,
    `- Repository commit: ${metadata.repositoryCommit}`,
    "",
    "## Current limitation",
    "",
    "Runtime VPS metadata is populated only when the generator is executed with `DESK_ACTIVE_VPS_RELEASE`, `DESK_ACTIVE_VPS_COMMIT` and `DESK_RUNTIME_PROBE_TIMESTAMP` after deployment probes.",
    "",
  ].join("\n");
}

function metadataBlock() {
  return [
    `- generatedAt: \`${metadata.generatedAt}\``,
    `- repositoryBranch: \`${metadata.repositoryBranch}\``,
    `- repositoryCommit: \`${metadata.repositoryCommit}\``,
    `- schemaVersion: \`${metadata.schemaVersion}\``,
    `- generatorVersion: \`${metadata.generatorVersion}\``,
    `- activeVpsRelease: \`${metadata.activeVpsRelease || "null"}\``,
    `- activeVpsCommit: \`${metadata.activeVpsCommit || "null"}\``,
    `- runtimeProbeTimestamp: \`${metadata.runtimeProbeTimestamp || "null"}\``,
  ].join("\n");
}

async function writeJson(name, value) {
  await writeFile(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(name, value) {
  await writeFile(join(outDir, name), value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}
