import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifier = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/verify_release_contract_integrity.mjs",
);

test("release contract verifier recomputes lock, registry and artifact hashes", async (t) => {
  const releaseRoot = await mkdtemp(join(tmpdir(), "desk-release-integrity-"));
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  const fixture = await writeReleaseFixture(releaseRoot);

  const valid = runVerifier(releaseRoot);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /"ok":true/);

  await writeFile(
    join(releaseRoot, "app/packages/desk-contracts/contracts/master.md"),
    "contract drift\n",
    "utf8",
  );
  const drifted = runVerifier(releaseRoot);
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /active_contracts\.master_contract\.sha256/);

  await writeFile(
    join(releaseRoot, "app/packages/desk-contracts/contracts/master.md"),
    fixture.master,
    "utf8",
  );
  await writeFile(
    join(releaseRoot, "app/packages/desk-contracts/schemas/master.schema.json"),
    JSON.stringify({ type: "array" }),
    "utf8",
  );
  const schemaDrifted = runVerifier(releaseRoot);
  assert.equal(schemaDrifted.status, 1);
  assert.match(schemaDrifted.stderr, /active_contracts\.master_contract\.schema_sha256/);

  await writeFile(
    join(releaseRoot, "app/packages/desk-contracts/schemas/master.schema.json"),
    fixture.schema,
    "utf8",
  );
  await writeFile(
    join(releaseRoot, "app/mcp_gpt_desk/src/compiler.js"),
    "compiler drift\n",
    "utf8",
  );
  const compilerDrifted = runVerifier(releaseRoot);
  assert.equal(compilerDrifted.status, 1);
  assert.match(compilerDrifted.stderr, /compiler\.mcp_gpt_desk\/src\/compiler\.js\.sha256/);

  await writeFile(
    join(releaseRoot, "app/mcp_gpt_desk/src/compiler.js"),
    fixture.compiler,
    "utf8",
  );
  const manifest = structuredClone(fixture.releaseManifest);
  manifest.strategy_contract_lock.active_contracts[0].sha256 = "0".repeat(64);
  await writeJson(join(releaseRoot, "release-manifest.json"), manifest);
  const embeddedDrift = runVerifier(releaseRoot);
  assert.equal(embeddedDrift.status, 1);
  assert.match(embeddedDrift.stderr, /release_manifest\.strategy_contract_lock/);
});

async function writeReleaseFixture(releaseRoot) {
  const master = "master contract\n";
  const policy = "policy contract\n";
  const component = "component contract\n";
  const artifact = JSON.stringify({ predicates: ["BREAK_RETEST_SEQUENCE"] });
  const schema = JSON.stringify({ type: "object" });
  const masterHash = sha256(master);
  const policyHash = sha256(policy);
  const componentHash = sha256(component);
  const artifactHash = sha256(artifact);
  const schemaHash = sha256(schema);
  const compiler = "compiler source\n";
  const compilerHash = sha256(compiler);
  const strategyLock = {
    runtime_contract_root: "packages/desk-contracts/contracts",
    active_contracts: [{
      registry_key: "master_contract",
      path: "packages/desk-contracts/contracts/master.md",
      schema_path: "packages/desk-contracts/schemas/master.schema.json",
      schema_version: "5.0.0",
      sha256: masterHash,
      schema_sha256: schemaHash,
    }],
    legacy_contracts: [],
  };
  const executionLock = {
    policy: {
      registry_key: "execution_policy_contract",
      path: "packages/desk-contracts/contracts/policy.md",
      schema_path: "packages/desk-contracts/schemas/policy.schema.json",
      schema_version: "4.0.0",
      sha256: policyHash,
      schema_sha256: schemaHash,
    },
    components: [{
      registry_key: "condition_catalog_contract",
      path: "packages/desk-contracts/contracts/component.md",
      schema_version: "1.0.0",
      sha256: componentHash,
      schema_path: "packages/desk-contracts/schemas/component.schema.json",
      schema_sha256: schemaHash,
      artifact_path: "packages/desk-contracts/catalogs/conditions.json",
      artifact_sha256: artifactHash,
    }],
    legacy_policies: [],
    legacy_components: [],
    compiler: {
      compiler_version: "1.1.0",
      condition_engine_version: "1.1.0",
      artifacts: [{
        path: "mcp_gpt_desk/src/compiler.js",
        sha256: compilerHash,
      }],
    },
  };
  const registry = {
    active_contracts: {
      master_contract: registryEntry("contracts/master.md", "schemas/master.schema.json", "5.0.0", masterHash),
      execution_policy_contract: registryEntry("contracts/policy.md", "schemas/policy.schema.json", "4.0.0", policyHash),
      condition_catalog_contract: {
        ...registryEntry("contracts/component.md", "schemas/component.schema.json", "1.0.0", componentHash),
        catalog_path: "catalogs/conditions.json",
      },
    },
    legacy_contracts: {},
  };
  const releaseManifest = {
    schema: "desk_windows_release_v1",
    release_profile: "deterministic_strategy_v5_frozen",
    strategy_contract_lock: strategyLock,
    execution_policy_lock: executionLock,
  };
  const files = new Map([
    ["config/strategy-contract-lock.json", JSON.stringify(strategyLock)],
    ["config/execution-policy-lock.json", JSON.stringify(executionLock)],
    ["release-manifest.json", JSON.stringify(releaseManifest)],
    ["app/packages/desk-contracts/registry.json", JSON.stringify(registry)],
    ["app/packages/desk-contracts/contracts/master.md", master],
    ["app/packages/desk-contracts/contracts/policy.md", policy],
    ["app/packages/desk-contracts/contracts/component.md", component],
    ["app/packages/desk-contracts/schemas/master.schema.json", schema],
    ["app/packages/desk-contracts/schemas/policy.schema.json", schema],
    ["app/packages/desk-contracts/schemas/component.schema.json", schema],
    ["app/packages/desk-contracts/catalogs/conditions.json", artifact],
    ["app/mcp_gpt_desk/src/compiler.js", compiler],
  ]);
  for (const [relative, content] of files) {
    const target = join(releaseRoot, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { master, schema, compiler, releaseManifest };
}

function registryEntry(markdownPath, schemaPath, schemaVersion, hash) {
  return {
    markdown_path: markdownPath,
    schema_path: schemaPath,
    schema_version: schemaVersion,
    hash,
    status: "active",
    runtime_exposed: true,
  };
}

function runVerifier(releaseRoot) {
  return spawnSync(process.execPath, [
    verifier,
    `--release-root=${releaseRoot}`,
  ], { encoding: "utf8" });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value), "utf8");
}
