import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

// Operator-only installation entry point. Does not import any trading host or worker.
const root = process.env.OOS_INSTALL_ROOT || "C:/ProgramData/DeskOos";
const releaseRoot = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !/^C:[/\\]DeskOos[/\\]releases[/\\][A-Za-z0-9_.-]+$/i.test(releaseRoot)) throw new Error("OOS_RELEASE_PATH_INVALID");
const parseEnv = text => Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=.*/.test(line)).map(line => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^"(.*)"$/, "$1")];
}));
const maintenance = parseEnv(await readFile("C:/ProgramData/DeskFutures/config/maintenance.env", "utf8"));
const desk = parseEnv(await readFile("C:/ProgramData/DeskFutures/config/desk.env", "utf8"));
let bootstrap = {};
try { bootstrap = parseEnv(await readFile(path.join(root, "config/bootstrap.env"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(path.join(root, "config"), { recursive: true });
const envPath = path.join(root, "config/oos.env");
let existing = null;
try { existing = parseEnv(await readFile(envPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const password = existing ? decodeURIComponent(new URL(existing.OOS_DATABASE_URL).password) : randomBytes(32).toString("hex");
if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("OOS_PASSWORD_FORMAT_INVALID");
const adminUrl = bootstrap.OOS_BOOTSTRAP_DATABASE_URL || maintenance.DESK_DB_MIGRATION_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
try {
  const role = await admin.query("SELECT rolname FROM pg_roles WHERE rolname='desk_oos'");
  if (!role.rowCount) await admin.query(`CREATE ROLE desk_oos LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
  const db = await admin.query("SELECT datname FROM pg_database WHERE datname='desk_oos'");
  if (!db.rowCount) await admin.query("CREATE DATABASE desk_oos OWNER desk_oos");
  await admin.query("REVOKE ALL ON DATABASE desk_oos FROM PUBLIC");
} finally { await admin.end(); }
const databaseUrl = `postgresql://desk_oos:${password}@127.0.0.1:${new URL(adminUrl).port || "5432"}/desk_oos`;
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  for (const migration of ["070_oos_batch_mcp_v1.sql", "071_oos_batch_remote_mcp.sql"]) {
    await pool.query(await readFile(path.join(releaseRoot, "infra/postgres/init", migration), "utf8"));
  }
} finally { await pool.end(); }
const providerRoot = "C:/ProgramData/DeskOos/providers/tradingview-mcp";
const config = { archive_root: root, public_url: "https://vps-6d6969db.vps.ovh.net/oos", port: 8795,
  batch_id: "OOS", symbol: "CME_MINI:MES1!", cutoff_time: "09:00", release: path.basename(releaseRoot),
  replay_enabled: false, front_root: path.join(releaseRoot, "front"), syntax_validator: "builtin-v3.9.8",
  tradingview: { adapter: "tradingview-jackson", transport: "stdio", command: process.execPath,
    args: [path.join(providerRoot, "src/server.js")], chart_id: "fp5gIsIz",
    screenshot_root: path.join(providerRoot, "screenshots"), tools: {} } };
await writeFile(path.join(root, "config/oos.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
const pin = existing?.DESK_OAUTH_ADMIN_PIN || desk.DESK_OAUTH_ADMIN_PIN;
if (!pin || /[\r\n]/.test(pin)) throw new Error("OOS_AUTH_PIN_REQUIRED");
const env = { OOS_BATCH_CONFIG: path.join(root, "config/oos.json"), OOS_DATABASE_URL: databaseUrl,
  DESK_OAUTH_TOKEN_SECRET: existing?.DESK_OAUTH_TOKEN_SECRET || randomBytes(48).toString("hex"),
  DESK_OAUTH_ADMIN_PIN: pin, OOS_OPERATOR_TOKEN: existing?.OOS_OPERATOR_TOKEN || randomBytes(32).toString("hex"),
  CDP_HOST: "127.0.0.1", CDP_PORT: "9222" };
await writeFile(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify({ postgres: "ready", database: "desk_oos", migration: "071_oos_batch_remote_mcp", replay_enabled: false, secrets: "stored_not_displayed" }));
