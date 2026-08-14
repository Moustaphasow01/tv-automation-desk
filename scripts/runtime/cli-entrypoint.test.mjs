import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isCliEntrypoint } from "./cli-entrypoint.mjs";

describe("isCliEntrypoint", () => {
  it("accepts relative script paths resolved by the current process", () => {
    assert.equal(
      isCliEntrypoint(pathToFileURL(path.resolve("scripts/stack/check_demo_paper_gate.mjs")).href, [
        "node",
        "scripts/stack/check_demo_paper_gate.mjs",
      ]),
      true,
    );
  });

  it("rejects imported modules", () => {
    assert.equal(
      isCliEntrypoint(pathToFileURL(path.resolve("scripts/stack/check_demo_paper_gate.mjs")).href, [
        "node",
        "scripts/stack/check_demo_paper_release_gate.mjs",
      ]),
      false,
    );
  });

  it("accepts script paths invoked through a deployment junction or symlink", () => {
      const root = mkdtempSync(path.join(tmpdir(), "desk-cli-entrypoint-"));
      try {
      const releaseScript = path.join(root, "releases", "v1", "scripts", "gate.mjs");
      const currentScript = path.join(root, "current", "scripts", "gate.mjs");
      mkdirSync(path.dirname(releaseScript), { recursive: true });
      writeFileSync(releaseScript, "", { flag: "w" });
      symlinkSync(path.join(root, "releases", "v1"), path.join(root, "current"), "junction");

      assert.equal(
        isCliEntrypoint(pathToFileURL(releaseScript).href, ["node", currentScript]),
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
