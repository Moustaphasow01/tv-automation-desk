import pg from "pg";
import path from "node:path";
import { createOosForensics, PostgresOosRegistry } from "@tv-automation/desk-oos-batch";
import { createOosResearch, configuredResearchModel } from "./oos-research-runtime.js";

/** Separate DB credentials are mandatory; the research application never receives the OOS command runtime. */
export async function openResearchHost({ config, environment = process.env, poolFactory = options => new pg.Pool(options) }) {
  if (!environment.OOS_RESEARCH_DATABASE_URL || !environment.OOS_FORENSIC_DATABASE_URL) {
    throw Object.assign(new Error("OOS_RESEARCH_CONFIGURATION_REQUIRED"), { code: "OOS_RESEARCH_CONFIGURATION_REQUIRED" });
  }
  const researchPool = poolFactory({ connectionString: environment.OOS_RESEARCH_DATABASE_URL, max: 4, connectionTimeoutMillis: 10000 });
  const forensicPool = poolFactory({ connectionString: environment.OOS_FORENSIC_DATABASE_URL, max: 2, connectionTimeoutMillis: 10000 });
  const close = async () => Promise.all([researchPool.end(), forensicPool.end()]);
  try {
    await assertIsolation(researchPool, "writer"); await assertIsolation(forensicPool, "reader");
    await researchPool.query("SELECT cycle_id FROM research_state.t3_cycles LIMIT 0");
    const forensic = createOosForensics({ repository: new PostgresOosRegistry(forensicPool), root: config.archive_root,
      indexRoot: config.index_root ?? path.join(config.archive_root, "forensic-index-v2") });
    const api = createOosResearch({ pool: researchPool, readForensic: forensic.call.bind(forensic), model: configuredResearchModel(config.model) });
    return { api, close };
  } catch (error) { await close(); throw error; }
}

async function assertIsolation(pool, mode) {
  const result = await pool.query(`SELECT r.rolsuper,r.rolcreaterole,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND ($1='reader' OR n.nspname <> 'research_state')
      AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) AS forbidden_write
    FROM pg_roles r WHERE r.rolname=current_user`, [mode]);
  const row = result.rows[0];
  if (!row || row.rolsuper || row.rolcreaterole || row.forbidden_write) {
    throw Object.assign(new Error("RESEARCH_DATABASE_ROLE_NOT_ISOLATED"), { code: "RESEARCH_DATABASE_ROLE_NOT_ISOLATED" });
  }
}
