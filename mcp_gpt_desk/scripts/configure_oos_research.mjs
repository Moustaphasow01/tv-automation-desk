import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { forensicBusinessBaseline } from './oos_forensic_baseline.mjs';

// Operator-only additive deployment. Credentials are never emitted or passed in argv.
const root = 'C:/ProgramData/DeskOos';
const sha = value => createHash('sha256').update(value).digest('hex');
const parseEnv = text => Object.fromEntries(text.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
}));
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function dumpDatabase({ connection, directory }) {
  const uri = new URL(connection), file = path.join(directory, 'desk_oos-before-research.dump');
  const args = ['--format=custom', '--no-owner', '--file', file, '--host', uri.hostname,
    '--port', uri.port || '5432', '--username', decodeURIComponent(uri.username), uri.pathname.slice(1)];
  await new Promise((resolve, reject) => {
    const child = spawn('C:/Program Files/PostgreSQL/16/bin/pg_dump.exe', args,
      { env: { ...process.env, PGPASSWORD: decodeURIComponent(uri.password) }, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('RESEARCH_BACKUP_TIMEOUT')); }, 180000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('RESEARCH_BACKUP_FAILED')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('RESEARCH_BACKUP_FAILED')); });
  });
  if ((await stat(file)).size < 1000) fail('RESEARCH_BACKUP_INCOMPLETE');
  return { path: file, sha256: sha(await readFile(file)) };
}

async function createRole(admin, { role, password }) {
  if (!['desk_oos_research', 'desk_oos_forensic'].includes(role) || !/^[a-f0-9]{64}$/.test(password)) fail('RESEARCH_ROLE_INVALID');
  const prior = await admin.query('SELECT rolname,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1', [role]);
  if (prior.rowCount) {
    if (prior.rows[0].rolsuper || prior.rows[0].rolcreaterole || prior.rows[0].rolcreatedb) fail('RESEARCH_ROLE_NOT_ISOLATED');
    return;
  }
  await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`);
}

async function grantResearchPrivileges(admin) {
  await admin.query('GRANT CONNECT ON DATABASE desk_oos TO desk_oos_research,desk_oos_forensic');
  await admin.query('GRANT USAGE ON SCHEMA research_state TO desk_oos_research');
  await admin.query('GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA research_state TO desk_oos_research');
  await admin.query('GRANT UPDATE(status,checkpoint,revision,updated_at) ON research_state.t3_cycles TO desk_oos_research');
  await admin.query('GRANT UPDATE(priority,status,worker_id,lease_token,lease_until,attempts,available_at,last_error,heartbeat_at,updated_at) ON research_state.t3_tasks TO desk_oos_research');
  await admin.query('GRANT UPDATE(state,task_id,heartbeat_at,capabilities) ON research_state.t3_workers TO desk_oos_research');
  await admin.query('GRANT USAGE ON SCHEMA public TO desk_oos_forensic');
  const tables = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'oos_%'");
  for (const { tablename } of tables.rows) {
    if (!/^oos_[a-z_]+$/.test(tablename)) fail('RESEARCH_TABLE_NAME_INVALID');
    await admin.query(`GRANT SELECT ON public.${tablename} TO desk_oos_forensic`);
  }
}

async function deniedMutation(connection) {
  const pool = new pg.Pool({ connectionString: connection, max: 1 });
  const client = await pool.connect(); let denied = false;
  try {
    await client.query('BEGIN');
    // No row could be changed even if misconfigured; permission must still fail.
    try { await client.query('UPDATE public.oos_batch_days SET revision=revision WHERE false'); }
    catch (error) { if (error.code !== '42501') throw error; denied = true; }
    await client.query('ROLLBACK');
    if (!denied) fail('RESEARCH_TRADING_WRITE_ISOLATION_FAILED');
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
  return 'PASS';
}

async function installResearch({ admin, adminUrl, env, release }) {
  const migration = await readFile(path.join(release, 'infra/postgres/init/075_oos_research_memory.sql'), 'utf8');
  const queueMigration = await readFile(path.join(release, 'infra/postgres/init/076_oos_research_task_queue.sql'), 'utf8');
  const values = {};
  for (const [key, role] of [['OOS_RESEARCH_DATABASE_URL', 'desk_oos_research'], ['OOS_FORENSIC_DATABASE_URL', 'desk_oos_forensic']]) {
    const password = env[key] ? decodeURIComponent(new URL(env[key]).password) : randomBytes(32).toString('hex');
    await createRole(admin, { role, password });
    const uri = new URL(adminUrl); uri.username = role; uri.password = password;
    values[key] = uri.toString();
  }
  await admin.query(migration);
  await admin.query(queueMigration);
  await grantResearchPrivileges(admin);
  for (const connection of Object.values(values)) await deniedMutation(connection);
  const next = { ...env, ...values };
  await writeFile(path.join(root, 'config/oos.env'), Object.entries(next).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  // The unattended research process never inherits OOS operator/admin credentials.
  const isolated = { ...values, OOS_BATCH_CONFIG: env.OOS_BATCH_CONFIG ?? path.join(root,'config/oos.json'),
    CODEX_HOME: 'C:/ProgramData/DeskFutures/codex' };
  await writeFile(path.join(root,'config/oos.research.env'),Object.entries(isolated).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  return { migration_sha256: sha(migration), queue_migration_sha256: sha(queueMigration), isolation: 'PASS' };
}

async function main() {
  const [mode, release, directory] = process.argv.slice(2);
  if (!['backup', 'install', 'verify'].includes(mode) || !/^C:[/\\]DeskOos[/\\]releases[/\\][a-f0-9]{7,40}$/i.test(release || '')
    || !/^C:[/\\]ProgramData[/\\]DeskOos[/\\]backups[/\\]research[/\\][a-zA-Z0-9_-]+$/i.test(directory || '')) fail('RESEARCH_DEPLOY_ARGUMENT_INVALID');
  const env = parseEnv(await readFile(path.join(root, 'config/oos.env'), 'utf8'));
  const bootstrap = parseEnv(await readFile(path.join(root, 'config/bootstrap.env'), 'utf8'));
  const adminUrl = new URL(bootstrap.OOS_BOOTSTRAP_DATABASE_URL); adminUrl.pathname = '/desk_oos';
  const config = JSON.parse(await readFile(path.join(root, 'config/oos.json'), 'utf8'));
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const baseline = await forensicBusinessBaseline({ pool: admin, config });
    if (mode === 'backup') {
      await mkdir(directory, { recursive: true });
      const backup = await dumpDatabase({ connection: adminUrl.toString(), directory });
      await writeFile(path.join(directory, 'baseline.json'), JSON.stringify(baseline), { mode: 0o600 });
      await writeFile(path.join(directory, 'backup.json'), JSON.stringify({ ...backup, created_at: new Date().toISOString(), release: config.release }), { mode: 0o600 });
      console.log(JSON.stringify({ backup, business_sha256: baseline.business_sha256, archive_sha256: baseline.archive_sha256, file_count: baseline.file_count }));
      return;
    }
    const before = JSON.parse(await readFile(path.join(directory, 'baseline.json'), 'utf8'));
    if (before.business_sha256 !== baseline.business_sha256 || before.archive_sha256 !== baseline.archive_sha256) fail('RESEARCH_HISTORICAL_CORPUS_DRIFT');
    const result = mode === 'install' ? await installResearch({ admin, adminUrl: adminUrl.toString(), env, release }) : {};
    const tables = await admin.query("SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname='research_state'");
    const indexes = await admin.query("SELECT count(*)::int AS indexes FROM pg_indexes WHERE schemaname='research_state'");
    console.log(JSON.stringify({ ...result, tables: tables.rows[0].tables, indexes: indexes.rows[0].indexes,
      historical_business_unchanged: true, historical_artifacts_unchanged: true }));
  } finally { await admin.end(); }
}
await main().catch(error => { console.error(JSON.stringify({ code: error.code || 'RESEARCH_DEPLOY_FAILED' })); process.exitCode = 1; });
