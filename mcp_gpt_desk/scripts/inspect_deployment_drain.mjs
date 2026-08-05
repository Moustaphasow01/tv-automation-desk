#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const appRoot = process.env.DESK_APP_ROOT || process.cwd();
const require = createRequire(resolve(appRoot, "package.json"));
const { Client } = require("pg");
const envFile = process.env.DESK_ENV_FILE || "C:\\ProgramData\\DeskFutures\\config\\desk.env";
const env = parseEnv(await readFile(envFile, "utf8"));
const client = new Client({ connectionString: process.env.DATABASE_URL || env.DATABASE_URL });
await client.connect();

try {
  const result = await client.query(`
    SELECT 'agent' AS kind, document_id AS id, data->>'status' AS status,
           data->>'lease_expires_at_utc' AS lease_expires_at_utc
      FROM desk_documents
     WHERE collection = 'desk_agent_work_items'
       AND data->>'status' = 'CLAIMED'
       AND NULLIF(data->>'lease_expires_at_utc','')::timestamptz > now()
    UNION ALL
    SELECT 'live', document_id, data#>>'{attempt,status}',
           data#>>'{attempt,lease_expires_at_utc}'
      FROM desk_documents
     WHERE collection = 'desk_live_run_cursor'
       AND data#>>'{attempt,status}' = 'LEASED'
       AND NULLIF(data#>>'{attempt,lease_expires_at_utc}','')::timestamptz > now()
    UNION ALL
    SELECT 'broker_execution', execution_outbox_id, status::text, COALESCE(lease_expires_at::text,'')
      FROM broker_execution_outbox
     WHERE status IN ('rendered','delivered')
        OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now()))
    UNION ALL
    SELECT 'broker_management', management_outbox_id, status::text, COALESCE(lease_expires_at::text,'')
      FROM broker_management_outbox
     WHERE status IN ('rendered','delivered')
        OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now()))
    ORDER BY kind, id
  `);
  process.stdout.write(`${JSON.stringify({ ok: true, active: result.rows.length, items: result.rows }, null, 2)}\n`);
} finally {
  await client.end();
}

function parseEnv(value) {
  return Object.fromEntries(String(value || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
}
