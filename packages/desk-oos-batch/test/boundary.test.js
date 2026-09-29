import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("OOS core imports only its own technical modules or Node primitives, never legacy analytics/execution", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const file = path.join(entry.parentPath, entry.name), content = await readFile(file, "utf8");
    for (const match of content.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith("."), `Third-party domain dependency in ${entry.name}`);
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(target.startsWith(root), `Cross-context dependency in ${entry.name}`);
    }
    assert.ok(!/\beval\(|new Function\(|\bfetch\(/.test(content), "No arbitrary plan code or network execution in OOS core");
  }
});
