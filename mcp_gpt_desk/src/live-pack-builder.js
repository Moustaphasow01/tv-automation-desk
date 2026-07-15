export function liveRollingPackScriptArgs({ date, session, checkpoint_paris }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    throw new Error(`LIVE_PACK_DATE_INVALID:${date || "missing"}`);
  }
  if (!["asia_open", "ny_open"].includes(session)) {
    throw new Error(`LIVE_PACK_SESSION_INVALID:${session || "missing"}`);
  }
  if (!Number.isFinite(Date.parse(String(checkpoint_paris || "")))) {
    throw new Error(`LIVE_PACK_CHECKPOINT_INVALID:${checkpoint_paris || "missing"}`);
  }
  return [
    "--date", date,
    "--session", session,
    "--purpose", "live_rolling",
    "--end-paris", checkpoint_paris,
  ];
}

export async function buildAndPublishLiveRollingPack(input) {
  liveRollingPackScriptArgs(input);
  throw new Error("LOCAL_LIVE_PACK_BUILD_DISABLED");
}
