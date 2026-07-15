#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DESK_DOMAIN_COVERAGE_SCHEMA_VERSION = "v2_desk_domain_coverage_gate_v1";
export const DESK_DOMAIN_COVERAGE_THRESHOLDS = {
  line_pct: 90,
  funcs_pct: 90,
};

function repoRoot(cwd = process.cwd()) {
  if (existsSync(path.join(cwd, "packages", "desk-domain", "package.json"))) {
    return cwd;
  }
  if (path.basename(cwd) === "desk-domain" && existsSync(path.join(cwd, "package.json"))) {
    return path.dirname(path.dirname(cwd));
  }
  return cwd;
}

function domainTestFiles(root) {
  const testDir = path.join(root, "packages", "desk-domain", "test");
  return readdirSync(testDir)
    .filter((file) => file.endsWith(".test.js"))
    .sort()
    .map((file) => path.join("packages", "desk-domain", "test", file));
}

export function parseDeskDomainCoverageReport(output) {
  const line = output.split(/\r?\n/).find((entry) => /#\s+all files\s+\|/.test(entry));
  if (!line) {
    throw new Error("desk_domain_coverage_summary_missing");
  }
  const cells = line
    .replace(/^#\s*/, "")
    .split("|")
    .map((cell) => cell.trim());
  return {
    line_pct: Number(cells[1]),
    branch_pct: Number(cells[2]),
    funcs_pct: Number(cells[3]),
  };
}

export function evaluateDeskDomainCoverage(metrics, thresholds = DESK_DOMAIN_COVERAGE_THRESHOLDS) {
  const violations = [];
  for (const [metric, threshold] of Object.entries(thresholds)) {
    if (!Number.isFinite(metrics[metric])) {
      violations.push({ type: "coverage_metric_missing", metric });
      continue;
    }
    if (metrics[metric] < threshold) {
      violations.push({
        type: "coverage_threshold_not_met",
        metric,
        actual: metrics[metric],
        threshold,
      });
    }
  }
  return {
    ok: violations.length === 0,
    schema_version: DESK_DOMAIN_COVERAGE_SCHEMA_VERSION,
    thresholds,
    metrics,
    violations,
  };
}

export function formatDeskDomainCoverage(result) {
  const parts = [
    `[desk-domain-coverage] ok=${result.ok}`,
    `schema=${result.schema_version}`,
    `line_pct=${result.metrics.line_pct}`,
    `line_threshold=${result.thresholds.line_pct}`,
    `branch_pct=${result.metrics.branch_pct}`,
    `funcs_pct=${result.metrics.funcs_pct}`,
    `funcs_threshold=${result.thresholds.funcs_pct}`,
    `violations=${result.violations.length}`,
  ];
  return parts.join(" ");
}

export function runDeskDomainCoverage(options = {}) {
  const root = options.root || repoRoot();
  const args = [
    "--test",
    "--experimental-test-coverage",
    ...domainTestFiles(root),
  ];
  const command = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${command.stdout || ""}${command.stderr || ""}`;
  if (command.stdout) process.stdout.write(command.stdout);
  if (command.stderr) process.stderr.write(command.stderr);
  if (command.status !== 0) {
    return {
      ok: false,
      schema_version: DESK_DOMAIN_COVERAGE_SCHEMA_VERSION,
      thresholds: DESK_DOMAIN_COVERAGE_THRESHOLDS,
      metrics: {},
      violations: [{ type: "desk_domain_tests_failed", status: command.status }],
      output,
    };
  }
  const metrics = parseDeskDomainCoverageReport(output);
  return {
    ...evaluateDeskDomainCoverage(metrics, options.thresholds || DESK_DOMAIN_COVERAGE_THRESHOLDS),
    output,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runDeskDomainCoverage();
  console.log(formatDeskDomainCoverage(result));
  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`[desk-domain-coverage] violation type=${violation.type} metric=${violation.metric || ""} actual=${violation.actual ?? ""} threshold=${violation.threshold ?? ""}`);
    }
    process.exitCode = 1;
  }
}
