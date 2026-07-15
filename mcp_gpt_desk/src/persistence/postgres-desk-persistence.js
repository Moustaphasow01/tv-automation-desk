import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;

export class PostgresDeskPersistence {
  constructor(options = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL || null;
    if (!options.pool && !this.connectionString) {
      throw new Error("DATABASE_URL is required for the PostgreSQL desk store");
    }
    this.pool = options.pool || new Pool({ connectionString: this.connectionString, max: Number(process.env.DESK_DATABASE_POOL_SIZE || 10) });
    this.objectRoot = resolve(options.objectRoot || process.env.DESK_OBJECT_ROOT || "./local_data/objects");
    this.initialized = this.#initialize();
  }

  async health() {
    await this.initialized;
    const result = await this.pool.query("SELECT current_database() AS database, now() AS server_time");
    return {
      ok: true,
      mode: "postgres",
      database: result.rows[0].database,
      server_time: result.rows[0].server_time,
    };
  }

  async close() {
    await this.pool.end();
  }

  async getDocument(collection, documentId) {
    await this.initialized;
    const document = await getDocument(this.pool, collection, documentId);
    if (!document) throw new Error(`${collection}_document_not_found:${documentId}`);
    return document;
  }

  async listDocuments(collection) {
    await this.initialized;
    const result = await this.pool.query(
      "SELECT data FROM desk_documents WHERE collection = $1 ORDER BY document_id ASC",
      [collection],
    );
    return result.rows.map((row) => row.data);
  }

  async queryDocuments({ parentPath, collectionId, fromUtc, toUtc, orderField = "timestamp_utc", limit = 500 }) {
    return this.queryCollectionDocuments({
      collection: `${parentPath}/${collectionId}`,
      filters: [
        { field: orderField, operator: ">=", value: fromUtc },
        { field: orderField, operator: "<=", value: toUtc },
      ],
      orderBy: [{ field: orderField, direction: "asc" }],
      limit,
    });
  }

  async queryCollectionDocuments({ collection, filters = [], orderBy = [], limit = 50 }) {
    const documents = await this.listDocuments(collection);
    const filtered = documents.filter((document) => filters.every((filter) => matchesFilter(document, filter)));
    filtered.sort((left, right) => compareDocuments(left, right, orderBy));
    return filtered.slice(0, boundedLimit(limit));
  }

  async setDocument(collection, documentId, data, { merge = false } = {}) {
    await this.initialized;
    await setDocument(this.pool, collection, documentId, data, merge);
  }

  async createDocument(collection, documentId, data) {
    await this.initialized;
    try {
      await this.pool.query(
        "INSERT INTO desk_documents (collection, document_id, data) VALUES ($1, $2, $3::jsonb)",
        [collection, documentId, JSON.stringify(data)],
      );
    } catch (error) {
      if (error?.code === "23505") throw persistenceError("DOCUMENT_ALREADY_EXISTS", `${collection}/${documentId} already exists.`);
      throw error;
    }
  }

  async writeDocuments(writes = []) {
    return this.#transaction(`batch:${createHash("sha256").update(JSON.stringify(writes.map((write) => [write.collection, write.documentId]))).digest("hex")}`, async (client) => {
      for (const write of writes) {
        await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      }
      return { ok: true, write_count: writes.length };
    });
  }

  async commitFrontProjectionMutation({ sourceWrite, projectionWrites = [], currentStatePrecondition = null }) {
    return this.#transaction(`front:${currentStatePrecondition?.documentId || sourceWrite.documentId}`, async (client) => {
      if (currentStatePrecondition) {
        const current = await getDocument(client, currentStatePrecondition.collection, currentStatePrecondition.documentId);
        const revisionMatches = currentStatePrecondition.expectedRevision === null
          ? current === null
          : current !== null && Number(current.revision) === Number(currentStatePrecondition.expectedRevision);
        const hashMatches = currentStatePrecondition.expectedRevision === null
          || String(current?.projection_hash || "") === String(currentStatePrecondition.expectedProjectionHash || "");
        if (!revisionMatches || !hashMatches) {
          throw persistenceError("FRONT_PROJECTION_REVISION_CONFLICT", "Front projection changed before save.");
        }
      }
      for (const write of [sourceWrite, ...projectionWrites]) {
        await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      }
      return { ok: true, projection_write_count: projectionWrites.length };
    });
  }

  async commitOperatorCommandMutation(input) {
    return this.#transaction(`operator:${input.stateId}`, async (client) => {
      const existingCommand = await getDocument(client, input.commandCollection, input.commandId);
      if (existingCommand) {
        if (existingCommand.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Operator command idempotency conflict.");
        return { replayed: true, command: existingCommand, result: existingCommand.result || null };
      }
      const state = await getDocument(client, input.stateCollection, input.stateId);
      if (Number(state?.revision || 0) !== Number(input.expectedRevision)) {
        throw persistenceError("REVISION_CONFLICT", "Operator state revision conflict.");
      }
      for (const condition of input.preconditions || []) {
        const current = await getDocument(client, condition.collection, condition.documentId);
        if (!current || canonicalHash(current) !== condition.expectedHash) throw persistenceError("TARGET_CONFLICT", "Operator target changed before commit.");
      }
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.stateCollection, input.stateId, input.stateDoc, false);
      await setDocument(client, input.commandCollection, input.commandId, input.commandDoc, false);
      await setDocument(client, input.eventCollection, input.eventDoc.event_id, input.eventDoc, false);
      await setDocument(client, input.auditCollection, input.auditDoc.audit_id, input.auditDoc, false);
      return { replayed: false, command: input.commandDoc, result: input.result || {} };
    });
  }

  async commitReplayMutation(input) {
    return this.#transaction(`replay:${input.backtestId}`, async (client) => {
      const idempotencyId = replayIdempotencyId(input.backtestId, input.idempotencyKey);
      const existing = await getDocument(client, input.idempotencyCollection, idempotencyId);
      const run = await getDocument(client, input.runCollection, input.backtestId);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay idempotency conflict.");
        return { replayed: true, run: run || {}, result: existing.result || null };
      }
      if (!run) throw persistenceError("RUN_NOT_FOUND", `Replay run not found: ${input.backtestId}.`);
      if (Number(run.revision || 0) !== Number(input.expectedRevision)) throw persistenceError("REVISION_CONFLICT", "Replay revision conflict.");
      for (const condition of input.preconditions || []) {
        const current = await getDocument(client, condition.collection, condition.documentId);
        if (!current || Object.entries(condition.equals || {}).some(([key, value]) => current[key] !== value)) {
          throw persistenceError("WORK_LEASE_CONFLICT", "Desk work lease changed before replay save.");
        }
      }
      const revision = Number(run.revision || 0) + 1;
      const nextRun = { ...run, ...input.runPatch, revision };
      const result = { ...(input.result || {}), revision, idempotent_replay: false };
      await setDocument(client, input.runCollection, input.backtestId, nextRun, false);
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.idempotencyCollection, idempotencyId, {
        idempotency_id: idempotencyId,
        idempotency_key: input.idempotencyKey,
        backtest_id: input.backtestId,
        request_hash: input.requestHash,
        expected_revision: input.expectedRevision,
        applied_revision: revision,
        status: "applied",
        result,
        created_at_utc: input.tick?.utc || null,
        created_at_paris: input.tick?.paris || null,
      }, false);
      return { replayed: false, run: nextRun, result };
    });
  }

  async claimDeskWorkItem({ collection, workItemId, proposed, tick }) {
    return this.#transaction(`work:${workItemId}`, async (client) => {
      const current = await getDocument(client, collection, workItemId);
      if (!current) return null;
      const replayWork = current.automation_scope === "replay" && ["REPLAY_MASTER", "REPLAY_MONITOR"].includes(current.workflow);
      const now = Number(tick?.epochMs);
      const expiry = Date.parse(current.lease_expires_at_utc || current.lease_expires_at_paris || "");
      const retryAfter = Date.parse(current.retry_after_utc || current.retry_after_paris || "");
      const retryDue = !Number.isFinite(retryAfter) || (Number.isFinite(now) && retryAfter <= now);
      const claimable = (current.status === "READY" && retryDue)
        || (current.status === "CLAIMED" && Number.isFinite(expiry) && Number.isFinite(now) && expiry <= now);
      if (!replayWork || !claimable || Number(current.attempt_count || 0) >= Number(current.max_attempts ?? 3)) return null;
      const claimed = { ...current, ...proposed, attempt_count: Number(current.attempt_count || 0) + 1 };
      await setDocument(client, collection, workItemId, claimed, false);
      return claimed;
    });
  }

  async claimLiveCursor(input) {
    return this.transitionLiveCursor(input);
  }

  async transitionLiveCursor(input) {
    if (typeof input.transition !== "function") throw new Error("LIVE_CURSOR_TRANSITION_REQUIRED");
    return this.#transaction(`cursor:${input.cursorId}`, async (client) => {
      const current = await getDocument(client, input.cursorCollection || "desk_live_run_cursor", input.cursorId) || input.initialCursor;
      if (!current) throw new Error(`LIVE_CURSOR_NOT_FOUND:${input.cursorId}`);
      const outcome = await input.transition(current);
      if (!outcome?.cursor || outcome.cursor.cursor_id !== input.cursorId) throw new Error(`LIVE_CURSOR_TRANSITION_INVALID:${input.cursorId}`);
      await setDocument(client, input.cursorCollection || "desk_live_run_cursor", input.cursorId, outcome.cursor, false);
      for (const event of outcome.events || []) await setDocument(client, input.eventCollection || "desk_agent_work_events", event.event_id, event, false);
      for (const item of outcome.dead_letters || []) await setDocument(client, input.deadLetterCollection || "desk_agent_work_dead_letter", item.dead_letter_id, item, false);
      return outcome;
    });
  }

  async createReplayRun(input) {
    return this.#transaction(`replay-create:${input.run.backtest_id}`, async (client) => {
      const idempotencyId = replayIdempotencyId(input.run.backtest_id, input.idempotencyKey);
      const existing = await getDocument(client, input.idempotencyCollection, idempotencyId);
      const currentRun = await getDocument(client, input.runCollection, input.run.backtest_id);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay creation idempotency conflict.");
        return { replayed: true, run: currentRun || {}, result: existing.result || null };
      }
      if (currentRun) throw persistenceError("IDEMPOTENCY_CONFLICT", `Replay run already exists: ${input.run.backtest_id}.`);
      const result = { ...(input.result || {}), revision: Number(input.run.revision || 0), idempotent_replay: false };
      await setDocument(client, input.runCollection, input.run.backtest_id, input.run, false);
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.idempotencyCollection, idempotencyId, {
        idempotency_id: idempotencyId,
        idempotency_key: input.idempotencyKey,
        backtest_id: input.run.backtest_id,
        request_hash: input.requestHash,
        applied_revision: Number(input.run.revision || 0),
        status: "applied",
        operation: "create_orchestrated_replay",
        result,
        created_at_utc: input.tick?.utc || null,
        created_at_paris: input.tick?.paris || null,
      }, false);
      return { replayed: false, run: input.run, result };
    });
  }

  async readStorageText(storagePath) {
    return (await this.readStorageObject(storagePath)).text;
  }

  async readStorageObject(storagePath) {
    const filePath = localObjectPath(storagePath, this.objectRoot);
    const [buffer, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
    return {
      buffer,
      text: buffer.toString("utf8"),
      metadata: {
        generation: String(Math.trunc(metadata.mtimeMs)),
        metageneration: "1",
        crc32c: null,
        md5_hash: createHash("md5").update(buffer).digest("base64"),
        size_bytes: buffer.length,
        content_type: contentType(filePath),
        custom: {},
      },
    };
  }

  async #initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS desk_documents (
        collection text NOT NULL,
        document_id text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, document_id)
      );
      CREATE INDEX IF NOT EXISTS desk_documents_collection_updated_idx
        ON desk_documents (collection, updated_at DESC);
      CREATE INDEX IF NOT EXISTS desk_documents_data_gin_idx
        ON desk_documents USING gin (data);
    `);
  }

  async #transaction(lockKey, operation) {
    await this.initialized;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function getDocument(client, collection, documentId) {
  const result = await client.query(
    "SELECT data FROM desk_documents WHERE collection = $1 AND document_id = $2",
    [collection, documentId],
  );
  return result.rows[0]?.data || null;
}

async function setDocument(client, collection, documentId, data, merge) {
  await client.query(
    `INSERT INTO desk_documents (collection, document_id, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (collection, document_id) DO UPDATE
     SET data = CASE WHEN $4::boolean THEN desk_documents.data || EXCLUDED.data ELSE EXCLUDED.data END,
         updated_at = now()`,
    [collection, documentId, JSON.stringify(data), merge],
  );
}

function matchesFilter(document, { field, operator = "==", value }) {
  const actual = fieldValue(document, field);
  if (operator === "==") return actual === value;
  if (operator === "!=") return actual !== value;
  if (operator === "in") return Array.isArray(value) && value.includes(actual);
  if (operator === "not-in") return Array.isArray(value) && !value.includes(actual);
  if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
  if (operator === ">=") return actual >= value;
  if (operator === "<=") return actual <= value;
  if (operator === ">") return actual > value;
  if (operator === "<") return actual < value;
  throw new Error(`postgres_filter_operator_unsupported:${operator}`);
}

function compareDocuments(left, right, orderBy) {
  for (const order of orderBy || []) {
    const a = fieldValue(left, order.field);
    const b = fieldValue(right, order.field);
    if (a === b) continue;
    const comparison = a == null ? -1 : b == null ? 1 : a < b ? -1 : 1;
    return order.direction === "desc" ? -comparison : comparison;
  }
  return 0;
}

function fieldValue(document, field) {
  return String(field || "").split(".").reduce((value, key) => value?.[key], document);
}

function boundedLimit(value) {
  return Math.max(1, Math.min(Number(value) || 50, 5000));
}

function replayIdempotencyId(backtestId, idempotencyKey) {
  const safe = String(backtestId || "").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 180);
  return `${safe}__${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

function persistenceError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  return error;
}

function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(sortCanonical(value))).digest("hex");
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortCanonical(entry)]));
}

function localObjectPath(storagePath, objectRoot) {
  const text = String(storagePath || "").trim();
  if (!text) throw new Error("local_storage_path_missing");
  if (text.startsWith("gs://")) throw new Error("cloud_storage_reference_not_allowed_in_preprod");
  const candidate = text.startsWith("local://")
    ? resolve(objectRoot, text.slice("local://".length))
    : text.startsWith("file://")
      ? resolve(text.slice("file://".length))
      : isAbsolute(text) ? resolve(text) : resolve(objectRoot, text);
  const pathFromRoot = relative(objectRoot, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("local_storage_path_outside_object_root");
  return candidate;
}

function contentType(filePath) {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}
