import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CONTROL_FILE = "startup-control.json";
const RUNTIME_FILE = "supervisor-status.json";
const AUDIT_FILE = "startup-audit.jsonl";

export class NinjaTraderStartupControl {
  constructor({
    root = process.env.DESK_NINJA_STARTUP_CONTROL_ROOT || "",
    connectionName = process.env.DESK_NINJA_STARTUP_CONNECTION_NAME || "Simulation",
    connectionProvider = process.env.DESK_NINJA_STARTUP_CONNECTION_PROVIDER || "NinjaTrader",
    clock = () => new Date().toISOString(),
  } = {}) {
    this.root = String(root || "").trim();
    this.connectionName = String(connectionName || "Simulation").trim();
    this.connectionProvider = String(connectionProvider || "NinjaTrader").trim();
    this.clock = clock;
  }

  get available() { return this.root.length > 0; }

  async status() {
    const control = await this.#readJson(CONTROL_FILE);
    const runtime = await this.#readJson(RUNTIME_FILE);
    return normalizeStatus({
      available: this.available,
      control,
      runtime,
      connectionName: this.connectionName,
      connectionProvider: this.connectionProvider,
    });
  }

  async configure({ enabled, expectedRevision, idempotencyKey, actor, reason, now = this.clock() }) {
    if (!this.available) throw startupError("NINJATRADER_STARTUP_CONTROL_UNAVAILABLE", "Le volume de contrôle du superviseur NinjaTrader n’est pas configuré.", 503);
    if (typeof enabled !== "boolean") throw startupError("NINJATRADER_STARTUP_INVALID_STATE", "Le réglage de redémarrage automatique doit être un booléen.");
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw startupError("NINJATRADER_STARTUP_INVALID_REVISION", "La révision attendue est invalide.");
    if (!String(idempotencyKey || "").trim()) throw startupError("NINJATRADER_STARTUP_IDEMPOTENCY_REQUIRED", "Une clé d’idempotence est obligatoire.");

    await mkdir(this.root, { recursive: true });
    const current = await this.#readJson(CONTROL_FILE);
    if (current?.last_idempotency_key === idempotencyKey) return this.status();
    const revision = Number(current?.revision || 0);
    if (revision !== expectedRevision) {
      throw startupError("NINJATRADER_STARTUP_REVISION_CONFLICT", `La configuration NinjaTrader est en révision ${revision}, pas ${expectedRevision}.`, 409, { currentRevision: revision });
    }

    const next = {
      schema_version: "desk_ninjatrader_startup_control_v1",
      enabled,
      revision: revision + 1,
      connection: {
        provider: this.connectionProvider,
        name: current?.connection?.provider === this.connectionProvider && current?.connection?.name
          ? current.connection.name
          : this.connectionName,
        connect_on_startup: true,
        simulation_only: true,
      },
      restart_policy: {
        restart_when_process_exits: true,
        stop_running_process_when_disabled: false,
        fail_closed_execution: true,
      },
      updated_at: now,
      updated_by: actor || "front-operator",
      reason: String(reason || "").trim(),
      last_idempotency_key: idempotencyKey,
    };
    await this.#atomicWrite(CONTROL_FILE, next);
    await appendFile(path.join(this.root, AUDIT_FILE), `${JSON.stringify({
      event_id: `ninja_startup_${randomUUID().replaceAll("-", "")}`,
      event_type: "ninjatrader_autostart_configured",
      previous_enabled: current?.enabled === true,
      enabled,
      revision: next.revision,
      actor: next.updated_by,
      reason: next.reason,
      created_at: now,
    })}\n`, "utf8");
    return this.status();
  }

  async #readJson(filename) {
    if (!this.available) return null;
    try {
      return JSON.parse((await readFile(path.join(this.root, filename), "utf8")).replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      return { read_error: error?.message || String(error) };
    }
  }

  async #atomicWrite(filename, value) {
    const target = path.join(this.root, filename);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
}

function normalizeStatus({ available, control, runtime, connectionName, connectionProvider }) {
  const enabled = control?.enabled === true;
  const lastError = runtime?.last_error || control?.read_error || runtime?.read_error || null;
  const runtimeUpdatedAt = Date.parse(runtime?.updated_at || "");
  const supervisorRunning = runtime?.supervisor_running === true
    && Number.isFinite(runtimeUpdatedAt)
    && Date.now() - runtimeUpdatedAt >= 0
    && Date.now() - runtimeUpdatedAt <= 45_000;
  return {
    available,
    enabled,
    revision: Number(control?.revision || 0),
    connectionName: control?.connection?.name || connectionName,
    connectionProvider: control?.connection?.provider || connectionProvider,
    autoConnectRequired: runtime?.auto_connect_supported === true,
    simulationOnly: true,
    supervisorInstalled: runtime?.supervisor_installed === true,
    supervisorRunning,
    processRunning: runtime?.process_running === true,
    processWindowTitle: runtime?.process_window_title || null,
    loginRequired: runtime?.login_required === true,
    platformReady: runtime?.platform_ready === true,
    autoConnectConfigured: runtime?.auto_connect_configured === true,
    lastStartedAt: runtime?.last_started_at || null,
    lastAppliedAt: runtime?.updated_at || control?.updated_at || null,
    lastError,
    state: !available ? "unavailable"
      : lastError ? "error"
      : !enabled ? "disabled"
      : runtime?.login_required === true ? "login_required"
      : runtime?.process_running === true ? "running"
      : supervisorRunning ? "waiting_restart"
      : "waiting_supervisor",
  };
}

function startupError(code, message, statusCode = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
