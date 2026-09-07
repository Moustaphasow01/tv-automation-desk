import pg from "pg";

const { Client } = pg;
const HOLD_SCHEMA = "desk_deployment_producer_hold_v1";
const HOLD_STATES = new Set(["OPEN", "DRAIN", "FROZEN", "FAILED"]);
export const DEPLOYMENT_PRODUCER_LOCK_KEYS = Object.freeze([741912, 90]);

export function createDeploymentProducerClient({ connectionString, applicationName }) {
  if (!String(connectionString || "").trim()) throw admissionError("DEPLOYMENT_PRODUCER_DATABASE_REQUIRED");
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
}

export async function runWithDeploymentProducerAdmission(client, operation, options = {}) {
  let acquired = false;
  let closing = false;
  let operationError = null;
  const terminate = options.terminate || ((exitCode) => process.exit(exitCode));
  const connectionLoss = createConnectionLossGuard(client, terminate, () => closing);
  try {
    connectionLoss.listen();
    await client.connect();
    const lock = await client.query(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
      DEPLOYMENT_PRODUCER_LOCK_KEYS,
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return skipped("TRANSITION", null);

    const result = await client.query(
      `SELECT data FROM desk_documents
       WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
       LIMIT 1`,
    );
    if (result.rows.length !== 1) throw admissionError("DEPLOYMENT_PRODUCER_HOLD_MISSING");
    const control = validateDeploymentProducerHold(result.rows[0]?.data);
    if (control.state !== "OPEN") return skipped(control.state, control.deployment_id);
    const value = await Promise.race([operation(), connectionLoss.promise]);
    return { executed: true, value };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    closing = true;
    connectionLoss.remove();
    await closeAdmissionClient(client, { acquired, operationError });
  }
}

function createConnectionLossGuard(client, terminate, isClosing) {
  let rejectLoss;
  let lost = false;
  const promise = new Promise((resolve, reject) => { rejectLoss = reject; });
  const failStop = (cause) => {
    if (isClosing() || lost) return;
    lost = true;
    const error = admissionError("DEPLOYMENT_PRODUCER_ADMISSION_LOST");
    error.cause = cause instanceof Error ? cause : undefined;
    try { terminate(70, error); } finally { rejectLoss(error); }
  };
  return {
    promise,
    listen() {
      client.on("error", failStop);
      client.on("end", failStop);
    },
    remove() {
      client.removeListener("error", failStop);
      client.removeListener("end", failStop);
    },
  };
}

export function validateDeploymentProducerHold(value) {
  const validObject = value && typeof value === "object" && !Array.isArray(value);
  const state = validObject ? value.state : null;
  const held = validObject ? value.held : null;
  const deploymentId = validObject ? value.deployment_id : null;
  const validRevision = Number.isInteger(value?.revision) && value.revision >= 1;
  const open = state === "OPEN" && held === false && deploymentId === null;
  const heldState = state !== "OPEN" && held === true && typeof deploymentId === "string" && deploymentId.length > 0;
  if (!validObject || value.schema_version !== HOLD_SCHEMA || !HOLD_STATES.has(state)
      || !validRevision || (!open && !heldState)) {
    throw admissionError("DEPLOYMENT_PRODUCER_HOLD_INVALID");
  }
  return { state, deployment_id: deploymentId, revision: value.revision };
}

async function closeAdmissionClient(client, { acquired, operationError }) {
  let cleanupError = null;
  if (acquired) {
    try {
      const result = await client.query(
        "SELECT pg_advisory_unlock_shared($1, $2) AS released",
        DEPLOYMENT_PRODUCER_LOCK_KEYS,
      );
      if (result.rows[0]?.released !== true) cleanupError = admissionError("DEPLOYMENT_PRODUCER_UNLOCK_FAILED");
    } catch (error) { cleanupError = error; }
  }
  try { await client.end(); } catch (error) { cleanupError ||= error; }
  if (cleanupError && !operationError) throw cleanupError;
}

function skipped(controlState, deploymentId) {
  return {
    executed: false,
    status: "DEPLOYMENT_PRODUCER_HOLD_ACTIVE",
    control_state: controlState,
    deployment_id: deploymentId,
  };
}

function admissionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
