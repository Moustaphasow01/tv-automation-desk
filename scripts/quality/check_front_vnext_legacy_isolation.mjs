#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LEGACY_ROOTS = [
  "src",
  "frontend",
  "web",
  "mcp_gpt_desk/public",
  "mcp_gpt_desk/web"
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

export function checkFrontVNextLegacyIsolation({
  repoRoot = process.cwd(),
  appRelativePath = "apps/desk-control-plane",
  legacyRoots = DEFAULT_LEGACY_ROOTS
} = {}) {
  const appDir = path.resolve(repoRoot, appRelativePath);
  const violations = [];

  if (!existsSync(appDir)) {
    return {
      ok: false,
      checkedFiles: 0,
      violations: [
        {
          file: appRelativePath,
          specifier: "",
          reason: "FRONT_VNEXT_APP_MISSING"
        }
      ]
    };
  }

  const sourceFiles = listSourceFiles(appDir);
  const legacyAbsoluteRoots = legacyRoots
    .map((root) => path.resolve(repoRoot, root))
    .filter((root) => existsSync(root))
    .filter((root) => !isSameOrInside(root, appDir));

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const specifier of extractLocalSpecifiers(content)) {
      const resolved = resolveSpecifier(file, specifier);

      if (!resolved) {
        continue;
      }

      if (!isSameOrInside(resolved, appDir)) {
        violations.push({
          file: path.relative(repoRoot, file),
          specifier,
          reason: "FRONT_VNEXT_IMPORT_OUTSIDE_APP"
        });
        continue;
      }

      const matchingLegacyRoot = legacyAbsoluteRoots.find((legacyRoot) =>
        isSameOrInside(resolved, legacyRoot)
      );

      if (matchingLegacyRoot) {
        violations.push({
          file: path.relative(repoRoot, file),
          specifier,
          reason: `FRONT_VNEXT_IMPORTS_LEGACY_ROOT:${path.relative(repoRoot, matchingLegacyRoot)}`
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    checkedFiles: sourceFiles.length,
    violations
  };
}

function listSourceFiles(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractLocalSpecifiers(content) {
  const specifiers = new Set();
  const importExportPattern =
    /\b(?:from|import)\s*(?:\([^)]*)?["'](?<specifier>[./][^"']+)["']/g;
  const cssImportPattern = /@import\s+["'](?<specifier>[./][^"']+)["']/g;

  for (const pattern of [importExportPattern, cssImportPattern]) {
    let match = pattern.exec(content);
    while (match) {
      if (match.groups?.specifier) {
        specifiers.add(match.groups.specifier);
      }
      match = pattern.exec(content);
    }
  }

  return [...specifiers];
}

function resolveSpecifier(importerFile, specifier) {
  const importerDirectory = path.dirname(importerFile);
  const candidate = path.resolve(importerDirectory, specifier);
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.css`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
    path.join(candidate, "index.js"),
    path.join(candidate, "index.jsx")
  ];

  return candidates.find((possiblePath) => existsSync(possiblePath)) ?? candidate;
}

function isSameOrInside(candidate, parent) {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedParent = path.resolve(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
}

function runCli() {
  const result = checkFrontVNextLegacyIsolation();

  if (result.ok) {
    console.log(`FRONT_VNEXT_LEGACY_ISOLATION_OK checked_files=${result.checkedFiles}`);
    return;
  }

  console.error("FRONT_VNEXT_LEGACY_ISOLATION_FAILED");
  for (const violation of result.violations) {
    console.error(
      `${violation.reason} file=${violation.file} specifier=${violation.specifier}`
    );
  }
  process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
