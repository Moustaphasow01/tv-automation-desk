import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_prompt_registry.mjs");

describe("prompt registry guard", () => {
  it("passes on the current prompt runtime inventory", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
    assert.match(result.stdout, /runtime-prompt-inventory\.v1\.json/);
  });

  it("rejects prompt hash drift and secret-looking prompt content", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-prompt-registry-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /hash drift/);
      assert.match(result.stderr, /possible OpenAI API key/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: root,
    env: { ...process.env, DESK_PROMPT_REGISTRY_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "config/prompt-registry"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "contracts"), { recursive: true });
  await writeFile(path.join(root, "docs/prompt.md"), `Secret ${openAiKeyFixture()}\n`);
  await writeFile(path.join(root, "docs/replay.md"), "Replay {{WORKER_ID}}\n");
  await writeFile(path.join(root, "contracts/contract.md"), "contract\n");
  await writeFile(path.join(root, "consumer.json"), "{}\n");
  await writeFile(path.join(root, "config/prompt-registry/runtime-prompt-inventory.v1.json"), JSON.stringify(inventory(), null, 2));
  await writeFile(path.join(root, "config/prompt-registry/live-replay-2.4.0-seed.v1.json"), JSON.stringify(seed(), null, 2));
  await writeFile(path.join(root, "config/prompt-registry/prompt-governance.v1.json"), JSON.stringify(governance(), null, 2));
}

function openAiKeyFixture() {
  return ["sk", "-1234567890abcdefghijklmnopqrstuvwxyz"].join("");
}

function inventory() {
  return {
    schema_version: "desk_prompt_runtime_inventory_v1",
    active_runtime_prompts: [{
      prompt_key: "BAD_PROMPT",
      semantic_version: "1.0.0",
      source_path: "docs/prompt.md",
      content_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      consumer_paths: ["consumer.json"],
      contracts: [{
        name: "Contract",
        path: "contracts/contract.md",
        sha256: `sha256:${createHash("sha256").update("contract\n").digest("hex")}`,
      }],
      secret_policy: "NO_SECRET_ALLOWED",
    }],
    dynamic_runtime_prompts: [],
  };
}

function seed() {
  return {
    schema_version: "desk_prompt_registry_seed_v1",
    parity_mode: "BYTE_EXACT_SOURCE",
    entries: [
      seedEntry("BAD_PROMPT", "docs/prompt.md", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      seedEntry("REPLAY_PROMPT", "docs/replay.md", `sha256:${createHash("sha256").update("Replay {{WORKER_ID}}\n").digest("hex")}`),
    ],
  };
}

function seedEntry(promptKey, sourcePath, contentHash) {
  return {
    prompt_definition: { prompt_key: promptKey },
    prompt_version: { status: "PUBLISHED", source_path: sourcePath, content_sha256: contentHash },
    composition: {
      status: "PUBLISHED",
      rendered_sha256: contentHash,
      items: [{ ordinal: 1, item_key: "root", source_path: sourcePath, content_sha256: contentHash }],
    },
    binding: { deployment_stage: "ACTIVE" },
  };
}

function governance() {
  return {
    schema_version: "desk_prompt_registry_governance_v1",
    secret_policy: "NO_SECRET_ALLOWED",
    default_effect: "DENY",
    write_actions: [{
      action: "DEPLOY_PROMPT_COMPOSITION",
      roles: ["prompt_registry_admin"],
      confirmation_phrase: "CONFIRM_DEPLOY_PROMPT",
      audit_required: true,
      requires_reason: true,
    }],
  };
}
