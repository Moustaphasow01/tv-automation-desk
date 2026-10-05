import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { PostgresResearchMemory, recordResearchRejection, codexResearchRejectionEvidence } from '@tv-automation/desk-oos-research';

// Internal operator transport: no public tool, no model, no OOS command credentials.
const command = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
if (!process.env.OOS_RESEARCH_DATABASE_URL || !process.env.CODEX_HOME
  || !/^[a-f0-9]{64}$/.test(command.cycle_id) || !/^[a-f0-9]{64}$/.test(command.request_id))
  throw new Error('RESEARCH_REJECTION_COMMAND_INVALID');
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, 'utf8'));
if (config.research_enabled !== true) throw new Error('RESEARCH_NOT_ENABLED');
const fingerprint = value => createHash('sha256').update(value).digest('hex');
// The cycle lock holds one connection while immutable evidence writes use another.
const pool = new pg.Pool({ connectionString: process.env.OOS_RESEARCH_DATABASE_URL,
  max: 3, connectionTimeoutMillis: 10000, query_timeout: 10000 });
try {
  const memory = PostgresResearchMemory({ pool, clock: () => new Date().toISOString() });
  const readEvidence = codexResearchRejectionEvidence({ sessions_root: path.join(process.env.CODEX_HOME, 'sessions'), fingerprint });
  const proof = await recordResearchRejection({ memory, readEvidence, fingerprint, command });
  console.log(JSON.stringify({ recorded: true, request_id: proof.request_id, source_sha256: proof.source_sha256,
    reason: proof.reason, validation_version: proof.validation_version, new_model_calls: 0 }));
} finally { await pool.end(); }
