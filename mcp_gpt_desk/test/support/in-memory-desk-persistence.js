import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Port documentaire déterministe réservé aux tests.
 *
 * Les documents écrits restent exclusivement en mémoire. Un fixtureRoot peut
 * fournir des documents JSON et des objets CSV/JSON en lecture seule afin de
 * tester les packs sans réintroduire un second store métier.
 */
export class InMemoryDeskPersistence {
  constructor({ documents = {}, fixtureRoot = null, objectRoot = null } = {}) {
    this.fixtureRoot = fixtureRoot ? resolve(fixtureRoot) : null;
    this.objectRoot = resolve(objectRoot || fixtureRoot || ".");
    this.collections = new Map();
    this.objectFixtures = new Map();
    this.transactionQueue = Promise.resolve();

    for (const [collection, entries] of Object.entries(documents)) {
      for (const [documentId, data] of Object.entries(entries || {})) {
        this.seed(collection, documentId, data);
      }
    }
  }

  async health() {
    return { ok: true, mode: "memory", database: "test" };
  }

  async close() {}

  seed(collection, documentId, data) {
    const bucket = this.#bucket(collection);
    bucket.set(documentId, clone(data));
    this.#registerObjectFixtures(data);
    return this;
  }

  peek(collection, documentId) {
    this.#hydrateCollection(collection);
    const value = this.#bucket(collection).get(documentId);
    return value === undefined ? null : clone(value);
  }

  ids(collection) {
    this.#hydrateCollection(collection);
    return [...this.#bucket(collection).keys()].sort();
  }

  count(collection) {
    return this.ids(collection).length;
  }

  async getDocument(collection, documentId) {
    const value = this.peek(collection, documentId);
    if (!value) throw new Error(`${collection}_document_not_found:${documentId}`);
    return value;
  }

  async listDocuments(collection, limit) {
    this.#hydrateCollection(collection);
    const entries = [...this.#bucket(collection).entries()]
      .sort(([left], [right]) => left.localeCompare(right));
    const bounded = limit === undefined || limit === null ? null : boundedLimit(limit);
    return (bounded ? entries.slice(0, bounded) : entries).map(([, value]) => clone(value));
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
    return documents
      .filter((document) => filters.every((filter) => matchesFilter(document, filter)))
      .sort((left, right) => compareDocuments(left, right, orderBy))
      .slice(0, boundedLimit(limit));
  }

  async setDocument(collection, documentId, data, { merge = false } = {}) {
    if (merge) await this.#hydrateCollection(collection);
    const bucket = this.#bucket(collection);
    const current = bucket.get(documentId);
    const next = merge && current ? { ...current, ...clone(data) } : clone(data);
    assertImmutableSetupIdentity(collection, documentId, current, next, bucket);
    bucket.set(documentId, next);
    this.#registerObjectFixtures(next);
  }

  async createDocument(collection, documentId, data) {
    this.#hydrateCollection(collection);
    if (this.#bucket(collection).has(documentId)) {
      throw persistenceError("DOCUMENT_ALREADY_EXISTS", `${collection}/${documentId} already exists.`);
    }
    await this.setDocument(collection, documentId, data);
  }

  async writeDocuments(writes = []) {
    return this.#exclusive(async () => {
      for (const write of writes) {
        await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
      }
      return { ok: true, write_count: writes.length };
    });
  }

  async commitFrontProjectionMutation({ sourceWrite, projectionWrites = [], currentStatePrecondition = null }) {
    return this.#exclusive(async () => {
      if (currentStatePrecondition) {
        const current = this.peek(currentStatePrecondition.collection, currentStatePrecondition.documentId);
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
        await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
      }
      return { ok: true, projection_write_count: projectionWrites.length };
    });
  }

  async commitBrokerPositionProjection(input) {
    return this.#exclusive(async () => {
      const current = this.peek(input.positionCollection, input.positionId);
      if (!current) return { applied: false, replayed: false, reason: "CANONICAL_POSITION_NOT_FOUND", position: null };
      const currentBrokerRevision = Number(current.broker_projection_revision ?? -1);
      const incomingBrokerRevision = Number(input.brokerRevision);
      if (!Number.isInteger(incomingBrokerRevision) || incomingBrokerRevision < 0) {
        throw persistenceError("BROKER_PROJECTION_REVISION_INVALID", "Broker projection revision must be a non-negative integer.");
      }
      if (currentBrokerRevision >= incomingBrokerRevision) {
        return { applied: false, replayed: true, reason: "BROKER_PROJECTION_ALREADY_APPLIED", position: current };
      }
      const position = { ...current, ...clone(input.positionPatch || {}), broker_projection_revision: incomingBrokerRevision };
      await this.setDocument(input.positionCollection, input.positionId, position);
      if (input.auditWrite) await this.setDocument(input.auditWrite.collection, input.auditWrite.documentId, input.auditWrite.data);
      return { applied: true, replayed: false, reason: "BROKER_ACK_PROJECTED", position: clone(position) };
    });
  }

  async commitLiveMonitorMutation(input) {
    return this.#exclusive(async () => {
      const existingMonitor = this.peek(input.monitorCollection, input.monitorId);
      if (existingMonitor) {
        if (String(existingMonitor.monitor_command_hash || "") !== String(input.commandHash || "")) {
          throw persistenceError("MONITOR_IDEMPOTENCY_CONFLICT", "Monitor identity already exists with different canonical command content.");
        }
        return { replayed: true, revision: Number(existingMonitor.applied_revision ?? existingMonitor.revision ?? 0), monitor: existingMonitor };
      }
      const state = this.peek(input.stateCollection, input.stateId);
      const actualRevision = state === null ? null : Number(state.revision || 0);
      if (state === null || actualRevision !== Number(input.expectedRevision)) {
        throw persistenceError("MONITOR_REVISION_CONFLICT", "Monitor expected_revision no longer matches the canonical active thesis.");
      }
      if (input.frontStatePrecondition) {
        const current = this.peek(input.frontStatePrecondition.collection, input.frontStatePrecondition.documentId);
        const revisionMatches = input.frontStatePrecondition.expectedRevision === null
          ? current === null
          : current !== null && Number(current.revision) === Number(input.frontStatePrecondition.expectedRevision);
        const hashMatches = input.frontStatePrecondition.expectedRevision === null
          || String(current?.projection_hash || "") === String(input.frontStatePrecondition.expectedProjectionHash || "");
        if (!revisionMatches || !hashMatches) {
          throw persistenceError("FRONT_PROJECTION_REVISION_CONFLICT", "Front projection changed before Monitor save.");
        }
      }
      const revision = actualRevision + 1;
      const monitor = { ...clone(input.monitorDoc), expected_revision: actualRevision, applied_revision: revision };
      const nextState = { ...state, ...clone(input.statePatch || {}), revision };
      for (const write of input.writes || []) {
        const data = write.collection === input.monitorCollection && write.documentId === input.monitorId
          ? monitor
          : write.data;
        await this.setDocument(write.collection, write.documentId, data, { merge: write.merge === true });
      }
      await this.setDocument(input.stateCollection, input.stateId, nextState);
      return { replayed: false, revision, monitor: clone(monitor), state: clone(nextState) };
    });
  }

  async commitOperatorCommandMutation(input) {
    return this.#exclusive(async () => {
      const existingCommand = this.peek(input.commandCollection, input.commandId);
      if (existingCommand) {
        if (existingCommand.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Operator command idempotency conflict.");
        return { replayed: true, command: existingCommand, result: existingCommand.result || null };
      }
      const state = this.peek(input.stateCollection, input.stateId);
      if (Number(state?.revision || 0) !== Number(input.expectedRevision)) {
        throw persistenceError("REVISION_CONFLICT", "Operator state revision conflict.");
      }
      for (const condition of input.preconditions || []) {
        const current = this.peek(condition.collection, condition.documentId);
        if (!current || canonicalHash(current) !== condition.expectedHash) throw persistenceError("TARGET_CONFLICT", "Operator target changed before commit.");
      }
      for (const write of input.writes || []) await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
      await this.setDocument(input.stateCollection, input.stateId, input.stateDoc);
      await this.setDocument(input.commandCollection, input.commandId, input.commandDoc);
      await this.setDocument(input.eventCollection, input.eventDoc.event_id, input.eventDoc);
      await this.setDocument(input.auditCollection, input.auditDoc.audit_id, input.auditDoc);
      return { replayed: false, command: input.commandDoc, result: input.result || {} };
    });
  }

  async commitReplayMutation(input) {
    return this.#exclusive(async () => {
      const idempotencyId = replayIdempotencyId(input.backtestId, input.idempotencyKey);
      const existing = this.peek(input.idempotencyCollection, idempotencyId);
      const run = this.peek(input.runCollection, input.backtestId);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay idempotency conflict.");
        return { replayed: true, run: run || {}, result: existing.result || null };
      }
      if (!run) throw persistenceError("RUN_NOT_FOUND", `Replay run not found: ${input.backtestId}.`);
      if (Number(run.revision || 0) !== Number(input.expectedRevision)) throw persistenceError("REVISION_CONFLICT", "Replay revision conflict.");
      for (const condition of input.preconditions || []) {
        const current = this.peek(condition.collection, condition.documentId);
        if (!current || Object.entries(condition.equals || {}).some(([key, value]) => current[key] !== value)) {
          throw persistenceError("WORK_LEASE_CONFLICT", "Desk work lease changed before replay save.");
        }
      }
      const revision = Number(run.revision || 0) + 1;
      const nextRun = { ...run, ...input.runPatch, revision };
      const result = { ...(input.result || {}), revision, idempotent_replay: false };
      await this.setDocument(input.runCollection, input.backtestId, nextRun);
      for (const write of input.writes || []) await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
      await this.setDocument(input.idempotencyCollection, idempotencyId, {
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
      });
      return { replayed: false, run: nextRun, result };
    });
  }

  async claimDeskWorkItem({ collection, workItemId, proposed, tick }) {
    return this.#exclusive(async () => {
      const current = this.peek(collection, workItemId);
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
      await this.setDocument(collection, workItemId, claimed);
      return clone(claimed);
    });
  }

  async claimLiveCursor(input) {
    return this.transitionLiveCursor(input);
  }

  async transitionLiveCursor(input) {
    if (typeof input.transition !== "function") throw new Error("LIVE_CURSOR_TRANSITION_REQUIRED");
    return this.#exclusive(async () => {
      const collection = input.cursorCollection || "desk_live_run_cursor";
      const current = this.peek(collection, input.cursorId) || clone(input.initialCursor);
      if (!current) throw new Error(`LIVE_CURSOR_NOT_FOUND:${input.cursorId}`);
      const outcome = await input.transition(current);
      if (!outcome?.cursor || outcome.cursor.cursor_id !== input.cursorId) throw new Error(`LIVE_CURSOR_TRANSITION_INVALID:${input.cursorId}`);
      await this.setDocument(collection, input.cursorId, outcome.cursor);
      for (const event of outcome.events || []) await this.setDocument(input.eventCollection || "desk_agent_work_events", event.event_id, event);
      for (const item of outcome.dead_letters || []) await this.setDocument(input.deadLetterCollection || "desk_agent_work_dead_letter", item.dead_letter_id, item);
      return clone(outcome);
    });
  }

  async createReplayRun(input) {
    return this.#exclusive(async () => {
      const idempotencyId = replayIdempotencyId(input.run.backtest_id, input.idempotencyKey);
      const existing = this.peek(input.idempotencyCollection, idempotencyId);
      const currentRun = this.peek(input.runCollection, input.run.backtest_id);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay creation idempotency conflict.");
        return { replayed: true, run: currentRun || {}, result: existing.result || null };
      }
      if (currentRun) throw persistenceError("IDEMPOTENCY_CONFLICT", `Replay run already exists: ${input.run.backtest_id}.`);
      const result = { ...(input.result || {}), revision: Number(input.run.revision || 0), idempotent_replay: false };
      await this.setDocument(input.runCollection, input.run.backtest_id, input.run);
      for (const write of input.writes || []) await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
      await this.setDocument(input.idempotencyCollection, idempotencyId, {
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
      });
      return { replayed: false, run: clone(input.run), result };
    });
  }

  async readStorageText(storagePath, options = {}) {
    return (await this.readStorageObject(storagePath, options)).text;
  }

  async readStorageObject(storagePath, { generation = null } = {}) {
    const filePath = this.#objectPath(storagePath);
    const buffer = readFileSync(filePath);
    const metadata = statSync(filePath);
    return {
      buffer,
      text: buffer.toString("utf8"),
      metadata: {
        generation: generation == null ? String(Math.trunc(metadata.mtimeMs)) : String(generation),
        metageneration: "1",
        crc32c: null,
        md5_hash: createHash("md5").update(buffer).digest("base64"),
        size_bytes: buffer.length,
        content_type: contentType(filePath),
        custom: {},
      },
    };
  }

  #bucket(collection) {
    if (!this.collections.has(collection)) this.collections.set(collection, new Map());
    return this.collections.get(collection);
  }

  #hydrateCollection(collection) {
    if (!this.fixtureRoot) return;
    const directory = join(this.fixtureRoot, collection);
    if (!existsSync(directory)) return;
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
      const documentId = file.slice(0, -5);
      if (this.#bucket(collection).has(documentId)) continue;
      try {
        this.seed(collection, documentId, JSON.parse(readFileSync(join(directory, file), "utf8")));
      } catch {
        // Les fixtures malformées sont ignorées comme dans l'ancien store local.
      }
    }
  }

  #registerObjectFixtures(value) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && value.local_path) {
      const localPath = isAbsolute(value.local_path) ? resolve(value.local_path) : resolve(this.objectRoot, value.local_path);
      for (const key of [value.storage_path, value.object_path].filter(Boolean)) this.objectFixtures.set(String(key), localPath);
    }
    for (const entry of Array.isArray(value) ? value : Object.values(value)) this.#registerObjectFixtures(entry);
  }

  #objectPath(storagePath) {
    const text = String(storagePath || "").trim();
    if (!text) throw new Error("local_storage_path_missing");
    if (this.objectFixtures.has(text)) return this.objectFixtures.get(text);
    const candidate = text.startsWith("local://")
      ? resolve(this.objectRoot, text.slice("local://".length))
      : text.startsWith("file://")
        ? resolve(text.slice("file://".length))
        : isAbsolute(text) ? resolve(text) : resolve(this.objectRoot, text);
    if (text.startsWith("gs://")) throw new Error(`test_storage_fixture_not_registered:${text}`);
    const pathFromRoot = relative(this.objectRoot, candidate);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("local_storage_path_outside_object_root");
    return candidate;
  }

  #exclusive(operation) {
    const result = this.transactionQueue.then(operation, operation);
    this.transactionQueue = result.catch(() => undefined);
    return result;
  }
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
  throw new Error(`memory_filter_operator_unsupported:${operator}`);
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

function assertImmutableSetupIdentity(collection, documentId, current, next, bucket) {
  if (!["desk_setups", "desk_replay_setups"].includes(collection)) return;
  const setupRecordId = String(next?.setup_record_id || "");
  const setupId = String(next?.setup_id || "");
  if (setupRecordId && setupRecordId !== String(documentId)) {
    throw persistenceError(
      "SETUP_RECORD_ID_IMMUTABLE",
      "A canonical setup_record_id must equal its document identity.",
      { collection, document_id: documentId, setup_record_id: setupRecordId },
    );
  }
  if (current?.setup_record_id && String(current.setup_record_id) !== setupRecordId) {
    throw persistenceError(
      "SETUP_RECORD_ID_IMMUTABLE",
      "The canonical setup_record_id cannot change after creation.",
      {
        collection,
        document_id: documentId,
        existing_setup_record_id: current.setup_record_id,
        attempted_setup_record_id: setupRecordId || null,
      },
    );
  }
  if (current?.setup_id && String(current.setup_id) !== setupId) {
    throw persistenceError(
      "SETUP_ID_IMMUTABLE",
      "The logical setup_id cannot change on an existing canonical setup record.",
      {
        collection,
        document_id: documentId,
        existing_setup_id: current.setup_id,
        attempted_setup_id: setupId || null,
      },
    );
  }
  if (!setupId) return;
  for (const [candidateDocumentId, candidate] of bucket.entries()) {
    if (candidateDocumentId !== documentId && String(candidate?.setup_id || "") === setupId) {
      throw persistenceError(
        "SETUP_LOGICAL_ID_CONFLICT",
        "A logical setup_id can belong to only one canonical setup record.",
        {
          collection,
          setup_id: setupId,
          document_id: documentId,
          conflicting_document_id: candidateDocumentId,
          conflicting_setup_record_id: candidate?.setup_record_id || null,
        },
      );
    }
  }
}

function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(sortCanonical(value))).digest("hex");
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortCanonical(entry)]));
}

function contentType(filePath) {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}
