export function normalizeV2MonitorIngressV1(rawMonitor = {}) {
  const monitor = object(rawMonitor);
  const command = object(monitor.command);
  const existingRequested = object(monitor.requested_command);
  const dataQuality = object(monitor.data_quality);
  const hardGateStates = array(dataQuality.hard_gate_states);
  const softGateStates = array(dataQuality.soft_gate_states);
  const normalized = {
    ...monitor,
    plan_id: monitor.plan_id || monitor.links?.plan_id || command.plan_id || null,
    command_id: monitor.command_id || command.command_id || null,
    expected_revision: monitor.expected_revision ?? command.expected_revision ?? null,
    contract_name: monitor.contract_name || monitor.contract?.name,
    contract_version: monitor.contract_version || monitor.contract?.version,
    schema_version: monitor.schema_version || monitor.contract?.version,
    monitor_id: monitor.monitor_id || monitor.source?.monitor_id || command.monitor_id,
    pack_id: monitor.pack_id || monitor.source?.pack_id || null,
    pack_build_id: monitor.pack_build_id || monitor.source?.pack_build_id || null,
    strategy_id: monitor.strategy_id
      || monitor.scope?.strategy_id || command.scope?.strategy_id || null,
    linked_master_analysis_id: monitor.linked_master_analysis_id
      || monitor.links?.master_analysis_id,
    linked_active_thesis_id: monitor.linked_active_thesis_id
      || monitor.links?.active_thesis_id,
    linked_position_id: monitor.linked_position_id || monitor.links?.position_id,
    checkpoint_paris: monitor.checkpoint_paris || monitor.checkpoint?.checkpoint_paris,
    timestamp_paris: monitor.timestamp_paris
      || monitor.checkpoint?.checkpoint_paris
      || command.created_at_paris,
    scope: {
      ...object(command.scope),
      ...object(monitor.scope),
    },
    active_thesis_update: normalizeActiveThesisUpdate(monitor.active_thesis_update),
    gates: {
      hard: hardGateStates,
      soft: softGateStates,
    },
    decision_gates: [...hardGateStates, ...softGateStates],
    alert_payload: monitor.alert_payload ?? monitor.alert,
  };

  if (Object.keys(existingRequested).length > 0) {
    return { ...normalized, requested_command: existingRequested };
  }
  if (Object.keys(command).length === 0) return normalized;

  const noAction = normalizeEnum(command.requested_action) === "NO_ACTION";
  return {
    ...normalized,
    requested_command: {
      thesis_command: noAction
        ? "NOOP"
        : command.transformation
          ? machineIntent(command.transformation, "command")
          : "NOOP",
      setup_command: noAction
        ? "NOOP"
        : command.setup_transition
          ? machineIntent(command.setup_transition, "command")
          : "NOOP",
      position_request: noAction
        ? "NONE"
        : command.management_request
          ? machineIntent(command.management_request, "type")
          : "NONE",
      replan_request: noAction
        ? "NOOP"
        : command.replan_request
          ? machineIntent(command.replan_request, "command")
          : "NOOP",
      reason: firstText(
        command.setup_transition?.reason,
        command.transformation?.reason,
        command.management_request?.reason,
        command.replan_request?.reason,
      ),
    },
  };
}

function machineIntent(value, discriminator) {
  const source = object(value);
  return {
    ...source,
    type: source[discriminator] || source.type || source.command || source.request,
  };
}

function normalizeActiveThesisUpdate(value) {
  const update = object(value);
  if (Object.keys(update).length === 0) return update;
  return {
    ...update,
    status: update.status || update.state,
  };
}

function firstText(...values) {
  const value = values.find((candidate) => (
    candidate !== null
      && candidate !== undefined
      && String(candidate).trim().length > 0
  ));
  return value === undefined ? null : String(value).trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
