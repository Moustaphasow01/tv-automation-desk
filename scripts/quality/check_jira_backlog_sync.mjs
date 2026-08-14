#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const backlogPath = resolve(root, "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml");
const text = readFileSync(backlogPath, "utf8");

const failures = [];
const jiraBlock = extractBlock("jira");
const jira = Object.fromEntries(
  jiraBlock
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{2}([a-zA-Z0-9_]+):\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], unquote(match[2])]),
);

if (jira.sync_status !== "connected") failures.push("jira.sync_status must be connected once TD2 Jira is active");
if (jira.project_key !== "TD2") failures.push("jira.project_key must be TD2");
if (!["summary_prefix", "external_id"].includes(jira.external_id_field)) {
  failures.push("jira.external_id_field must document the idempotency key strategy");
}

const epics = [...text.matchAll(/^\s{2}- key:\s*([A-Z0-9-]+)\n\s{4}summary:\s*(.+)$/gm)]
  .map((match) => ({ key: match[1].trim(), summary: unquote(match[2].trim()) }));
const tickets = [...text.matchAll(/^\s{6}- \{([^}]+)\}/gm)]
  .map((match) => parseInlineObject(match[1]));

assertUnique("epic key", epics.map((item) => item.key));
assertUnique("external_id", tickets.map((item) => item.external_id));

if (epics.length < 15) failures.push(`expected at least 15 epics, got ${epics.length}`);
if (tickets.length < 120) failures.push(`expected at least 120 tickets, got ${tickets.length}`);

const stableIds = new Set([...epics.map((item) => item.key), ...tickets.map((item) => item.external_id)]);
const allowedStatuses = new Set(["Backlog", "Ready", "In Progress", "In Review", "Validated", "Blocked", "Done"]);

for (const epic of epics) {
  if (!/^[A-Z0-9-]+$/.test(epic.key)) failures.push(`invalid epic key ${epic.key}`);
  if (!epic.summary) failures.push(`epic ${epic.key} has no summary`);
}

for (const ticket of tickets) {
  if (!ticket.external_id) failures.push(`ticket without external_id: ${JSON.stringify(ticket)}`);
  if (ticket.external_id && !/^TD2-[A-Z0-9-]+$/.test(ticket.external_id)) failures.push(`invalid external_id ${ticket.external_id}`);
  if (!ticket.summary) failures.push(`ticket ${ticket.external_id} has no summary`);
  if (ticket.status && !allowedStatuses.has(ticket.status)) failures.push(`ticket ${ticket.external_id} has invalid status ${ticket.status}`);
  if (ticket.jira_key && !/^TD2-[0-9]+$/.test(ticket.jira_key)) failures.push(`ticket ${ticket.external_id} has invalid jira_key ${ticket.jira_key}`);
  for (const dependency of parseArray(ticket.depends_on)) {
    if (!stableIds.has(dependency)) failures.push(`ticket ${ticket.external_id} depends on unknown id ${dependency}`);
  }
  for (const blocker of parseArray(ticket.blocked_by)) {
    if (blocker === "jira_connector" && jira.sync_status === "connected") {
      failures.push(`ticket ${ticket.external_id} is still blocked by jira_connector while Jira is connected`);
    }
  }
}

if (failures.length) {
  console.error("[jira-backlog-sync] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    source: "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml",
    jira: {
      sync_status: jira.sync_status,
      project_key: jira.project_key,
      external_id_field: jira.external_id_field,
    },
    epics: epics.length,
    tickets: tickets.length,
  }, null, 2));
}

function extractBlock(key) {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\n([\\s\\S]*?)(?=^[a-zA-Z0-9_]+:|\\z)`, "m");
  const match = text.match(pattern);
  return match?.[1] || "";
}

function parseInlineObject(raw) {
  return Object.fromEntries(splitTopLevel(raw, ",").map((part) => {
    const [key, ...valueParts] = part.split(":");
    return [key.trim(), unquote(valueParts.join(":").trim())];
  }));
}

function parseArray(value) {
  if (!value || value === "[]") return [];
  const match = value.match(/^\[(.*)\]$/);
  if (!match) return [unquote(value)];
  return splitTopLevel(match[1], ",").map((item) => unquote(item.trim())).filter(Boolean);
}

function splitTopLevel(value, separator) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function assertUnique(label, values) {
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) failures.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function unquote(value) {
  return String(value || "").replace(/^["']|["']$/g, "").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
