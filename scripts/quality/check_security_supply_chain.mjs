#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_SECURITY_SUPPLY_CHAIN_ROOT || defaultRoot);
const failures = [];
const warnings = [];

const secretRules = [
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "Telegram bot token", pattern: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
];

const deniedLicensePatterns = [
  /^AGPL/i,
  /^GPL/i,
  /^LGPL/i,
  /^SSPL/i,
  /^BUSL/i,
  /Commons-Clause/i,
];

const repositoryFiles = listRepositoryFiles();
const secretFindings = await scanSecrets(repositoryFiles);
if (secretFindings.length) failures.push(...secretFindings);

const packages = await inspectPackages([
  "package-lock.json", "mcp_gpt_desk/package-lock.json",
  "apps/desk-control-plane/package-lock.json",
]);
const images = await inspectImages(repositoryFiles);
const sbom = buildSbom(packages, images, secretFindings);
await writeSbom(sbom);

if (failures.length) {
  console.error("[security-supply-chain] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    scanned_files: repositoryFiles.length,
    scope: "git tracked + untracked non-ignored files",
    packages: packages.map((item) => ({
      lockfile: item.lockfile,
      dependencies: item.dependencies.length,
      missing_license_count: item.missingLicense.length,
    })),
    docker_images: images,
    warnings,
    sbom: sbom.path,
  }, null, 2));
}

function listRepositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "buffer" });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString("utf8")}`);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith(".worktrees/"))
    .filter((file) => !file.startsWith("node_modules/"))
    .filter((file) => !file.startsWith("dist/"))
    .sort();
}

async function scanSecrets(files) {
  const findings = [];
  const scanTargets = files.filter((file) => shouldScan(file));
  for (const file of scanTargets) {
    const content = await readFile(path.join(root, file), "utf8").catch(() => "");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isAllowedExample(line)) return;
      for (const rule of secretRules) {
        if (rule.pattern.test(line)) findings.push(`${file}:${index + 1}: possible ${rule.name}`);
      }
    });
  }
  return findings;
}

function shouldScan(file) {
  if (/\.(png|jpg|jpeg|gif|ico|pdf|zip|gz|tgz|woff2?)$/i.test(file)) return false;
  if (file.endsWith("package-lock.json")) return false;
  return true;
}

function isAllowedExample(line) {
  return /example|placeholder|change-me|local-|dummy|your_/i.test(line);
}

async function inspectPackages(lockfiles) {
  const inspected = [];
  for (const lockfile of lockfiles) {
    const lockPath = path.join(root, lockfile);
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const dependencies = Object.entries(lock.packages || {})
      .filter(([name]) => name.includes("node_modules/"))
      .map(([name, metadata]) => ({
        name: name.replace(/^node_modules\//, ""),
        version: metadata.version || null,
        license: metadata.license || null,
        integrity: metadata.integrity || null,
        workspace_link: metadata.link === true,
      }));
    const registryDependencies = dependencies.filter((item) => !item.workspace_link);
    const missingIntegrity = registryDependencies.filter((item) => !item.integrity);
    const deniedLicenses = dependencies.filter((item) => isDeniedLicense(item.license));
    const missingLicense = registryDependencies.filter((item) => !item.license);
    for (const item of missingIntegrity) {
      failures.push(`${lockfile}: registry dependency without integrity: ${item.name}`);
    }
    for (const item of deniedLicenses) {
      failures.push(`${lockfile}: denied license ${item.license} on ${item.name}`);
    }
    if (missingLicense.length) warnings.push(`${lockfile}: ${missingLicense.length} dependencies without explicit license`);
    inspected.push({ lockfile, dependencies, missingLicense });
  }
  return inspected;
}

function isDeniedLicense(license) {
  return Boolean(license && deniedLicensePatterns.some((pattern) => pattern.test(license)));
}

async function inspectImages(files) {
  const imageRefs = [];
  const targets = files.filter((file) => /(^|\/)(Dockerfile[^/]*|[^/]+\.Dockerfile|docker-compose.*\.ya?ml)$/.test(file));
  for (const file of targets) {
    const content = await readFile(path.join(root, file), "utf8");
    content.split(/\r?\n/).forEach((line, index) => {
      const fromMatch = line.match(/^\s*FROM\s+([^\s]+)/i);
      const imageMatch = line.match(/^\s*image:\s*["']?([^"'\s]+)["']?/i);
      const image = fromMatch?.[1] || imageMatch?.[1];
      if (!image || image.includes("${")) return;
      validateImage(file, index + 1, image, imageRefs);
    });
  }
  return imageRefs.sort((left, right) => left.image.localeCompare(right.image));
}

function validateImage(file, line, image, imageRefs) {
  if (image.endsWith(":latest")) failures.push(`${file}:${line}: Docker image must not use latest (${image})`);
  if (!image.includes(":") && !image.includes("@sha256:")) {
    failures.push(`${file}:${line}: Docker image must use a tag or digest (${image})`);
  }
  imageRefs.push({ file, line, image });
}

function buildSbom(packages, images, secretFindings) {
  return {
    schema: "desk_security_supply_chain_sbom_v1",
    generated_at_utc: new Date().toISOString(),
    path: null,
    secrets: { scanned: true, findings: secretFindings.length },
    packages: packages.map((item) => ({
      lockfile: item.lockfile,
      dependencies: item.dependencies,
      missing_license_count: item.missingLicense.length,
    })),
    docker_images: images,
    policy: {
      denied_licenses: deniedLicensePatterns.map((item) => item.source),
      docker_latest_allowed: false,
      secret_values_logged: false,
    },
  };
}

async function writeSbom(sbom) {
  const outputRoot = path.join(root, ".local/security");
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "supply-chain-sbom.json");
  sbom.path = outputPath;
  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
}
