export function humanGateUndoPolicyFromEnvironment(env = {}) {
  return {
    enabled: String(env.DESK_HUMAN_GATE_UNDO_ENABLED || "false").trim().toLowerCase() === "true",
    windowSeconds: Number(env.DESK_HUMAN_GATE_UNDO_WINDOW_SECONDS || 10),
  };
}
