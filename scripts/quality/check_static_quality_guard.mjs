#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_STATIC_QUALITY_ROOT || defaultRoot);
const baselinePath = path.resolve(process.env.DESK_STATIC_QUALITY_BASELINE || path.join(root, "docs/engineering/static-quality-baseline.json"));
const printBaseline = process.argv.includes("--print-baseline");
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".css"]);
const functionExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const ignoredSegments = new Set([".git", ".local", ".worktrees", "dist", "node_modules", "output", "test", "generated", "__pycache__"]);
const sourceRoots = ["src", "mcp_gpt_desk/src", "packages"];
const fixedEntrypoints = [
  "mcp_gpt_desk/src/agent-runtime-postgres-repository.js",
  "mcp_gpt_desk/src/agent-runtime-supervisor.js",
  "mcp_gpt_desk/src/agent-runtime-supervisor-host.js",
  "mcp_gpt_desk/src/full-system-dress-rehearsal-certifier.js",
];
const standards = {
  max_file_lines: 600,
  max_function_lines: 60,
  max_cyclomatic_complexity: 15,
  duplicate_window_lines: 12,
};

const sourceFiles = [];
for (const sourceRoot of sourceRoots) await collectSourceFiles(path.join(root, sourceRoot), sourceFiles);
const sourceFileSet = new Set(sourceFiles.map(normalize));
const cliDrivenEntrypoints = new Set([
  ...fixedEntrypoints,
  ...(await discoverCliEntrypoints(path.join(root, "mcp_gpt_desk/scripts"), sourceFileSet)),
]);
const importGraph = await buildImportGraph(sourceFiles);
const metrics = await measureStaticQuality(sourceFiles, importGraph);

if (printBaseline) {
  process.stdout.write(`${JSON.stringify(toBaseline(metrics), null, 2)}\n`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const failures = compareToBaseline(metrics, baseline);
if (failures.length) {
  console.error("[static-quality-guard] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error(`Baseline: ${relative(baselinePath)}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    checked_files: metrics.checked_files,
    max_file_lines: metrics.max_file_lines,
    oversized_function_count: metrics.oversized_functions.length,
    high_complexity_function_count: metrics.high_complexity_functions.length,
    duplicate_block_count: metrics.duplicate_blocks.length,
    possibly_dead_file_count: metrics.possibly_dead_files.length,
    baseline: relative(baselinePath),
  }, null, 2));
}

function compareToBaseline(metrics, baseline) {
  const failures = [];
  const budgets = baseline.aggregate_budgets || {};
  const fileBudgets = baseline.file_line_budgets || {};
  for (const file of metrics.files) {
    const allowedLines = fileBudgets[file.path] || standards.max_file_lines;
    if (file.lines > allowedLines) {
      failures.push(`${file.path} has ${file.lines} lines; allowed ${allowedLines}`);
    }
  }
  compareCount(failures, "oversized functions", metrics.oversized_functions.length, budgets.oversized_function_count);
  compareCount(failures, "high complexity functions", metrics.high_complexity_functions.length, budgets.high_complexity_function_count);
  compareCount(failures, "duplicate blocks", metrics.duplicate_blocks.length, budgets.duplicate_block_count);
  compareCount(failures, "possibly dead files", metrics.possibly_dead_files.length, budgets.possibly_dead_file_count);
  return failures;
}

function compareCount(failures, label, actual, allowed = 0) {
  if (actual > allowed) failures.push(`${label}: ${actual}; allowed ${allowed}`);
}

function toBaseline(metrics) {
  return {
    schema: "desk_static_quality_baseline_v1",
    generated_at_utc: new Date().toISOString(),
    source: "npm run guard:static-quality -- --print-baseline",
    standards,
    aggregate_budgets: {
      oversized_function_count: metrics.oversized_functions.length,
      high_complexity_function_count: metrics.high_complexity_functions.length,
      duplicate_block_count: metrics.duplicate_blocks.length,
      possibly_dead_file_count: metrics.possibly_dead_files.length,
    },
    file_line_budgets: Object.fromEntries(
      metrics.files
        .filter((file) => file.lines > standards.max_file_lines)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => [file.path, file.lines]),
    ),
    top_legacy_hotspots: {
      largest_files: metrics.files.slice().sort((left, right) => right.lines - left.lines).slice(0, 20),
      longest_functions: metrics.oversized_functions.slice(0, 20),
      highest_complexity_functions: metrics.high_complexity_functions.slice(0, 20),
    },
  };
}

async function measureStaticQuality(files, graph) {
  const fileMetrics = [];
  const functions = [];
  const duplicateBlocks = [];
  const duplicateIndex = new Map();
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const rel = relative(file);
    const lines = countLines(content);
    fileMetrics.push({ path: rel, lines });
    if (functionExtensions.has(path.extname(file))) functions.push(...extractFunctions(rel, content));
    indexDuplicateBlocks(rel, content, duplicateIndex);
  }
  for (const [fingerprint, locations] of duplicateIndex) {
    const uniqueFiles = new Set(locations.map((location) => location.file));
    if (locations.length > 1 && uniqueFiles.size > 1) duplicateBlocks.push({ fingerprint, locations: locations.slice(0, 6), occurrences: locations.length });
  }
  const inbound = inboundCounts(graph);
  const possiblyDeadFiles = fileMetrics
    .map((file) => file.path)
    .filter((file) => !file.endsWith(".d.ts") && !entrypoint(file) && (inbound.get(file) || 0) === 0)
    .sort();
  return {
    checked_files: fileMetrics.length,
    files: fileMetrics.sort((left, right) => left.path.localeCompare(right.path)),
    max_file_lines: Math.max(0, ...fileMetrics.map((file) => file.lines)),
    oversized_functions: functions.filter((item) => item.lines > standards.max_function_lines).sort(byFunctionSeverity),
    high_complexity_functions: functions.filter((item) => item.complexity > standards.max_cyclomatic_complexity).sort(byComplexitySeverity),
    duplicate_blocks: duplicateBlocks.sort((left, right) => right.occurrences - left.occurrences || left.fingerprint.localeCompare(right.fingerprint)),
    possibly_dead_files: possiblyDeadFiles,
  };
}

function extractFunctions(file, content) {
  const lines = content.split(/\r?\n/);
  const functions = [];
  let active = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!active && startsFunction(line)) {
      active = { file, start_line: index + 1, brace_depth: 0, body: [] };
    }
    if (!active) continue;
    active.body.push(line);
    active.brace_depth += braceDelta(line);
    if (active.brace_depth <= 0 && active.body.some((bodyLine) => bodyLine.includes("{"))) {
      const body = active.body.join("\n");
      functions.push({
        file,
        start_line: active.start_line,
        lines: active.body.length,
        complexity: estimateComplexity(body),
      });
      active = null;
    }
  }
  return functions;
}

function startsFunction(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;
  if (/^(if|for|while|switch|catch|else|try)\b/.test(trimmed)) return false;
  return /\bfunction\b.*\{/.test(trimmed)
    || /=>\s*\{/.test(trimmed)
    || /^(export\s+)?(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(trimmed)
    || /^[A-Za-z_$][\w$]*\s*[:=]\s*(async\s*)?\([^)]*\)\s*=>\s*\{/.test(trimmed);
}

function estimateComplexity(body) {
  const matches = body.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g);
  return 1 + (matches?.length || 0);
}

function braceDelta(line) {
  const withoutStrings = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
  return (withoutStrings.match(/\{/g)?.length || 0) - (withoutStrings.match(/\}/g)?.length || 0);
}

function indexDuplicateBlocks(file, content, duplicateIndex) {
  const normalized = content
    .split(/\r?\n/)
    .map(normalizeDuplicateLine)
    .filter(Boolean);
  for (let index = 0; index <= normalized.length - standards.duplicate_window_lines; index += 1) {
    const window = normalized.slice(index, index + standards.duplicate_window_lines);
    const fingerprint = window.join("\n");
    if (!duplicateIndex.has(fingerprint)) duplicateIndex.set(fingerprint, []);
    duplicateIndex.get(fingerprint).push({ file, start_line: index + 1 });
  }
}

function normalizeDuplicateLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  if (/^(import|export)\b/.test(trimmed)) return "";
  return trimmed.replace(/\s+/g, " ");
}

async function buildImportGraph(files) {
  const graph = new Map(files.map((file) => [relative(file), new Set()]));
  for (const file of files) {
    const rel = relative(file);
    const content = await readFile(file, "utf8");
    for (const specifier of parseSpecifiers(content)) {
      const target = resolveLocalSpecifier(file, specifier);
      if (target) graph.get(rel).add(relative(target));
    }
  }
  return graph;
}

function inboundCounts(graph) {
  const inbound = new Map();
  for (const [file, targets] of graph) {
    if (!inbound.has(file)) inbound.set(file, 0);
    for (const target of targets) inbound.set(target, (inbound.get(target) || 0) + 1);
  }
  return inbound;
}

function entrypoint(file) {
  return cliDrivenEntrypoints.has(file)
    || file === "src/main.tsx"
    || file === "src/App.tsx"
    || file === "mcp_gpt_desk/src/server.js"
    || /(^|\/)index\.(js|mjs|ts)$/.test(file)
    || /(^|\/)collections\.js$/.test(file)
    || /(^|\/)bin\/.+\.mjs$/.test(file)
    || /(^|\/)codegen\/.+\.mjs$/.test(file);
}

async function discoverCliEntrypoints(directory, sourceSet) {
  const scripts = [];
  await collectScriptFiles(directory, scripts);
  const entrypoints = [];
  for (const script of scripts) {
    const content = await readFile(script, "utf8");
    for (const specifier of parseSpecifiers(content)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveExistingSourcePathForSet(path.resolve(path.dirname(script), specifier), sourceSet);
      if (target) entrypoints.push(relative(target));
    }
  }
  return entrypoints;
}

async function collectScriptFiles(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectScriptFiles(path.join(directory, entry.name), files);
    } else if (entry.isFile() && [".js", ".mjs", ".cjs"].includes(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
}

function parseSpecifiers(content) {
  const pattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  return [...content.matchAll(pattern)].map((match) => match[1] || match[2] || match[3]).filter(Boolean);
}

function resolveLocalSpecifier(file, specifier) {
  if (specifier.startsWith("@/")) return resolveExistingSourcePath(path.join(root, "src", specifier.slice(2)));
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  return resolveExistingSourcePath(path.resolve(path.dirname(file), specifier));
}

function resolveExistingSourcePath(base) {
  return resolveExistingSourcePathForSet(base, sourceFileSet);
}

function resolveExistingSourcePathForSet(base, sourceSet) {
  const extension = path.extname(base);
  if (sourceExtensions.has(extension) && sourceSet.has(normalize(base))) return base;
  for (const ext of sourceExtensions) {
    const candidate = `${base}${ext}`;
    if (sourceSet.has(normalize(candidate))) return candidate;
  }
  for (const ext of sourceExtensions) {
    const candidate = path.join(base, `index${ext}`);
    if (sourceSet.has(normalize(candidate))) return candidate;
  }
  return null;
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
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(absolute);
  }
}

function countLines(content) {
  if (!content) return 0;
  return content.endsWith("\n") ? content.split(/\r?\n/).length - 1 : content.split(/\r?\n/).length;
}

function byFunctionSeverity(left, right) {
  return right.lines - left.lines || left.file.localeCompare(right.file) || left.start_line - right.start_line;
}

function byComplexitySeverity(left, right) {
  return right.complexity - left.complexity || left.file.localeCompare(right.file) || left.start_line - right.start_line;
}

function normalize(value) {
  return path.resolve(value).replaceAll(path.sep, "/");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
