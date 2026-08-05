import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("NinjaTrader installer adds every framework reference required by the AddOn", async () => {
  const installer = await readFile(path.join(repositoryRoot, "deploy/windows/Install-DeskNinjaTrader.ps1"), "utf8");

  assert.match(installer, /System\.Net\.Http/);
  assert.match(installer, /System\.Web\.Extensions/);
  assert.match(installer, /NinjaTrader\.Custom\.csproj/);
  assert.match(installer, /desk-reference\.bak/);
});

test("NinjaTrader AddOn configuration fallback can report errors through its instance", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "integrations/ninjatrader/DeskExecutionAddOn/DeskExecutionAddOn.cs"),
    "utf8",
  );

  assert.match(source, /private string Env\(string name, string fallback\)/);
  assert.doesNotMatch(source, /private static string Env\(string name, string fallback\)/);
  assert.match(source, /System\.Web\.Script\.Serialization/);
  assert.doesNotMatch(source, /System\.Runtime\.Serialization/);
  assert.doesNotMatch(source, /\[DataContract\]|\[DataMember/);
});
