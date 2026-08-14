#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_ARCHITECTURE_ROOT || defaultRoot);
const sourceExtensions = [".js", ".mjs", ".cjs", ".ts", ".tsx"];
const ignoredSegments = new Set([
  ".git",
  ".local",
  ".worktrees",
  "dist",
  "node_modules",
  "output",
  "test",
  "generated",
  "__pycache__",
]);
const sourceRoots = ["src", "mcp_gpt_desk/src", "packages"];
const packageByName = await loadWorkspacePackages();
const exportedPackageSpecifiers = buildExportedSpecifiers(packageByName);
const allowedPackageDeps = new Map([
  ["@tv-automation/desk-domain", new Set(["@tv-automation/desk-audit"])],
  ["@tv-automation/desk-audit", new Set()],
  ["@tv-automation/desk-time", new Set()],
  ["@tv-automation/desk-replay-engine", new Set(["@tv-automation/desk-domain"])],
  ["@tv-automation/desk-contracts", new Set()],
]);
const packageRuntimeForbiddenImports = new Map([
  ["@tv-automation/desk-domain", new Set(["pg", "react", "react-dom", "react-router-dom", "@tanstack/react-query", "@modelcontextprotocol/sdk"])],
  ["@tv-automation/desk-audit", new Set(["pg", "react", "react-dom", "react-router-dom", "@tanstack/react-query", "@modelcontextprotocol/sdk"])],
  ["@tv-automation/desk-time", new Set(["pg", "react", "react-dom", "react-router-dom", "@tanstack/react-query", "@modelcontextprotocol/sdk"])],
  ["@tv-automation/desk-replay-engine", new Set(["pg", "react", "react-dom", "react-router-dom", "@tanstack/react-query", "@modelcontextprotocol/sdk"])],
]);
const packageNodeRuntimeForbiddenImports = new Map([
  ["@tv-automation/desk-domain", new Set(["node:fs", "node:fs/promises", "node:http", "node:https", "node:child_process", "node:net", "node:tls"])],
  ["@tv-automation/desk-audit", new Set(["node:fs", "node:fs/promises", "node:http", "node:https", "node:child_process", "node:net", "node:tls"])],
  ["@tv-automation/desk-time", new Set(["node:fs", "node:fs/promises", "node:http", "node:https", "node:child_process", "node:net", "node:tls"])],
]);
const layerRanks = { domain: 0, application: 1, api: 1, adapter: 2 };

const sourceFiles = [];
for (const sourceRoot of sourceRoots) {
  await collectSourceFiles(path.join(root, sourceRoot), sourceFiles);
}
const sourceFileSet = new Set(sourceFiles.map(normalize));

const failures = [];
const graph = new Map();
for (const file of sourceFiles) {
  const owner = ownerForFile(file);
  if (!owner) continue;
  const content = await readFile(file, "utf8");
  for (const specifier of parseSpecifiers(content)) {
    verifyImport({ file, owner, specifier });
  }
}
detectOwnerCycles(graph).forEach((cycle) => {
  failures.push(`module cycle: ${cycle.join(" -> ")}`);
});

if (failures.length) {
  console.error("[architecture-boundaries] FAILED");
  failures.sort().forEach((failure) => console.error(`- ${failure}`));
  console.error("See docs/engineering/architecture-boundary-guard.md and docs/engineering/exception-register.md.");
  process.exitCode = 1;
} else {
  const owners = [...new Set(sourceFiles.map(ownerForFile).filter(Boolean))].sort();
  console.log(JSON.stringify({
    ok: true,
    checked_files: sourceFiles.length,
    owners,
    legacy_exceptions: ["EXC-TD-001", "EXC-TD-002", "EXC-TD-003"],
  }, null, 2));
}

function verifyImport({ file, owner, specifier }) {
  if (!specifier || specifier.startsWith("node:")) {
    verifyForbiddenExternal({ file, owner, specifier });
    return;
  }

  const packageTarget = packageImportTarget(specifier);
  if (packageTarget) {
    verifyPackageImport({ file, owner, specifier, targetOwner: packageTarget.owner });
    verifyForbiddenExternal({ file, owner, specifier });
    return;
  }

  if (isExternalSpecifier(specifier)) {
    verifyForbiddenExternal({ file, owner, specifier });
    return;
  }

  const targetPath = resolveLocalSpecifier(file, specifier);
  if (!targetPath) return;
  const targetOwner = ownerForFile(targetPath);
  if (!targetOwner) return;

  addGraphEdge(owner, targetOwner);
  verifyLocalBoundary({ file, owner, specifier, targetOwner });
  verifyLayerBoundary({ file, specifier, targetPath, owner, targetOwner });
}

function verifyPackageImport({ file, owner, specifier, targetOwner }) {
  addGraphEdge(owner, targetOwner);
  if (owner === "front") {
    failures.push(`${relative(file)} imports ${specifier}; front transition must use API/BFF, not packages directly`);
    return;
  }
  if (owner === targetOwner || owner === "legacy-mcp-host") {
    if (!isExportedPackageSpecifier(specifier)) {
      failures.push(`${relative(file)} imports non-exported package path ${specifier}`);
    }
    return;
  }
  if (!owner.startsWith("@tv-automation/")) return;
  if (!isExportedPackageSpecifier(specifier)) {
    failures.push(`${relative(file)} imports ${specifier}; packages may only consume public package exports`);
    return;
  }
  const allowed = allowedPackageDeps.get(owner) || new Set();
  if (!allowed.has(targetOwner)) {
    failures.push(`${relative(file)} imports ${targetOwner}; ${owner} does not declare this architecture dependency`);
  }
}

function verifyLocalBoundary({ file, owner, specifier, targetOwner }) {
  if (owner === targetOwner) return;
  if (owner === "legacy-mcp-host" && targetOwner.startsWith("@tv-automation/")) {
    failures.push(`${relative(file)} imports ${specifier}; MCP host must use package public exports, not relative internals`);
    return;
  }
  if (owner.startsWith("@tv-automation/")) {
    failures.push(`${relative(file)} imports ${specifier}; packages cannot reach ${targetOwner} by relative path`);
    return;
  }
  if (owner === "front") {
    failures.push(`${relative(file)} imports ${specifier}; front cannot reach ${targetOwner} internals`);
  }
}

function verifyLayerBoundary({ file, specifier, targetPath, owner, targetOwner }) {
  if (owner !== targetOwner || !owner.startsWith("@tv-automation/")) return;
  const fromLayer = layerOf(file);
  const toLayer = layerOf(targetPath);
  if (!fromLayer || !toLayer) return;
  if (layerRanks[fromLayer] < layerRanks[toLayer]) {
    failures.push(`${relative(file)} imports ${specifier}; ${fromLayer} layer cannot depend on ${toLayer}`);
  }
}

function verifyForbiddenExternal({ file, owner, specifier }) {
  if (!owner.startsWith("@tv-automation/")) return;
  const runtimeForbidden = packageRuntimeForbiddenImports.get(owner);
  if (runtimeForbidden?.has(specifier)) {
    failures.push(`${relative(file)} imports ${specifier}; pure package must stay framework/provider independent`);
  }
  const nodeForbidden = packageNodeRuntimeForbiddenImports.get(owner);
  if (nodeForbidden?.has(specifier)) {
    failures.push(`${relative(file)} imports ${specifier}; pure package cannot perform infrastructure I/O`);
  }
}

function parseSpecifiers(content) {
  const pattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  return [...content.matchAll(pattern)].map((match) => match[1] || match[2] || match[3]).filter(Boolean);
}

async function collectSourceFiles(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignoredSegments.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(absolute, files);
      continue;
    }
    if (entry.isFile() && sourceExtensions.includes(path.extname(entry.name))) files.push(absolute);
  }
}

async function loadWorkspacePackages() {
  const packagesRoot = path.join(root, "packages");
  const packages = new Map();
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(packagesRoot, entry.name);
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    packages.set(packageJson.name, { name: packageJson.name, root: packageRoot, exports: packageJson.exports || {} });
  }
  return packages;
}

function buildExportedSpecifiers(packages) {
  const specifiers = new Set();
  for (const [name, descriptor] of packages) {
    specifiers.add(name);
    for (const exportKey of Object.keys(descriptor.exports || {})) {
      if (exportKey === ".") continue;
      specifiers.add(`${name}${exportKey.slice(1)}`);
    }
  }
  return specifiers;
}

function packageImportTarget(specifier) {
  for (const [name] of packageByName) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return { owner: name };
  }
  return null;
}

function isExportedPackageSpecifier(specifier) {
  return exportedPackageSpecifiers.has(specifier);
}

function resolveLocalSpecifier(file, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : path.resolve(path.dirname(file), specifier);
  return resolveExistingSourcePath(base);
}

function resolveExistingSourcePath(base) {
  const extension = path.extname(base);
  if (sourceExtensions.includes(extension) && sourceFileSet.has(normalize(base))) return base;
  for (const ext of sourceExtensions) {
    const candidate = `${base}${ext}`;
    if (sourceFileSet.has(normalize(candidate))) return candidate;
  }
  for (const ext of sourceExtensions) {
    const candidate = path.join(base, `index${ext}`);
    if (sourceFileSet.has(normalize(candidate))) return candidate;
  }
  return null;
}

function isExternalSpecifier(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("@/");
}

function ownerForFile(file) {
  const normalized = normalize(file);
  if (isInside(normalized, normalize(path.join(root, "src")))) return "front";
  if (isInside(normalized, normalize(path.join(root, "mcp_gpt_desk", "src")))) return "legacy-mcp-host";
  for (const [name, descriptor] of packageByName) {
    if (isInside(normalized, normalize(descriptor.root))) return name;
  }
  return null;
}

function layerOf(file) {
  const parts = relative(file).split("/");
  const srcIndex = parts.indexOf("src");
  if (srcIndex === -1) return null;
  return layerRanks[parts[srcIndex + 1]] === undefined ? null : parts[srcIndex + 1];
}

function addGraphEdge(from, to) {
  if (!from || !to || from === to) return;
  if (!graph.has(from)) graph.set(from, new Set());
  graph.get(from).add(to);
}

function detectOwnerCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  for (const owner of graph.keys()) visit(owner);
  return cycles;

  function visit(owner) {
    if (visited.has(owner)) return;
    if (visiting.has(owner)) {
      const start = stack.indexOf(owner);
      if (start >= 0) cycles.push([...stack.slice(start), owner]);
      return;
    }
    visiting.add(owner);
    stack.push(owner);
    for (const next of graph.get(owner) || []) visit(next);
    stack.pop();
    visiting.delete(owner);
    visited.add(owner);
  }
}

function isInside(file, directory) {
  return file === directory || file.startsWith(`${directory}/`);
}

function normalize(value) {
  return path.resolve(value).replaceAll(path.sep, "/");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
