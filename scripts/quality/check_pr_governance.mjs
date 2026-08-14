#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_PR_GOVERNANCE_ROOT || defaultRoot);
const codeownersPath = path.join(root, ".github/CODEOWNERS");
const templatePath = path.join(root, ".github/pull_request_template.md");
const packagePath = path.join(root, "package.json");
const certifyPath = path.join(root, "scripts/quality/certify_resilience.mjs");

const requiredTemplateHeadings = [
  "## Jira",
  "## Résumé opérateur",
  "## Placement architectural obligatoire",
  "## Frontières et contrats",
  "## Touch-and-improve",
  "## Tests et preuves",
  "## Observabilité, sécurité et exploitation",
  "## Limites assumées",
];

const requiredTemplatePhrases = [
  "Bounded context propriétaire",
  "Couche touchée",
  "Responsabilité ajoutée ou modifiée",
  "Consommateurs",
  "Alternatives écartées",
  "Dette avant",
  "Dette après",
  "Rollback",
];

const requiredValidationCommands = [
  "npm run typecheck",
  "npm run guard:architecture",
  "npm run guard:static-quality",
  "npm run guard:exceptions",
  "npm run guard:architecture-scorecard",
  "npm run guard:pr-governance",
  "npm run guard:security-supply-chain",
  "npm run guard:sql-migrations",
  "npm run guard:problem-details",
  "npm run guard:runtime-safety",
  "npm run guard:mcp-slices",
  "npm run guard:front-architecture",
  "npm run certify:resilience",
  "docker compose config --quiet",
];

const codeowners = await readFile(codeownersPath, "utf8");
const template = await readFile(templatePath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const certify = await readFile(certifyPath, "utf8");

const failures = [];
validateCodeowners(codeowners, failures);
validateTemplate(template, failures);
validateScripts(packageJson, certify, failures);

if (failures.length) {
  console.error("[pr-governance] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    codeowners: {
      path_rules: countPathRules(codeowners),
      logical_teams: [...new Set(codeowners.match(/@trading-desk\/[a-z-]+/g) || [])].sort(),
    },
    template: {
      required_sections: requiredTemplateHeadings.length,
      validation_commands: requiredValidationCommands.length,
    },
  }, null, 2));
}

function validateCodeowners(content, failures) {
  const requiredPaths = [
    "/AGENTS.md",
    "/docs/engineering/",
    "/docs/trading-desk-target-blueprint/",
    "/packages/desk-domain/",
    "/packages/desk-replay-engine/",
    "/packages/desk-contracts/",
    "/packages/desk-audit/",
    "/packages/desk-time/",
    "/mcp_gpt_desk/",
    "/src/",
    "/scripts/",
    "/deploy/",
    "/infra/",
    "/integrations/",
    "/tradingview/",
  ];
  for (const requiredPath of requiredPaths) {
    if (!content.includes(requiredPath)) failures.push(`CODEOWNERS missing ${requiredPath}`);
  }
  const requiredOwners = [
    "@trading-desk/architecture",
    "@trading-desk/platform",
    "@trading-desk/strategy",
    "@trading-desk/simulation",
    "@trading-desk/execution",
    "@trading-desk/market-data",
    "@trading-desk/reporting",
    "@trading-desk/operations",
    "@trading-desk/audit",
    "@trading-desk/agents",
  ];
  for (const requiredOwner of requiredOwners) {
    if (!content.includes(requiredOwner)) failures.push(`CODEOWNERS missing logical owner ${requiredOwner}`);
  }
}

function validateTemplate(content, failures) {
  for (const heading of requiredTemplateHeadings) {
    if (!content.includes(heading)) failures.push(`PR template missing section ${heading}`);
  }
  for (const phrase of requiredTemplatePhrases) {
    if (!content.includes(phrase)) failures.push(`PR template missing phrase "${phrase}"`);
  }
  for (const command of requiredValidationCommands) {
    if (!content.includes(command)) failures.push(`PR template missing validation command ${command}`);
  }
}

function validateScripts(packageJson, certify, failures) {
  if (!packageJson.scripts?.["guard:pr-governance"]) failures.push("package.json missing guard:pr-governance");
  if (!packageJson.scripts?.["guard:pr-governance:test"]) failures.push("package.json missing guard:pr-governance:test");
  if (!certify.includes("guard:pr-governance:test")) failures.push("certify_resilience missing guard:pr-governance:test");
  if (!certify.includes("guard:pr-governance")) failures.push("certify_resilience missing guard:pr-governance");
}

function countPathRules(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .length;
}
