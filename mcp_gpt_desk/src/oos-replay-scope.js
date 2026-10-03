import { oosHash, oosTvError } from "./oos-tradingview-engine.js";

const instant = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const scopeHash = scope => oosHash(JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key => [key, scope[key]]))));

/** Only immutable replay identity is hashed. Browser/TV IDs are attachment metadata. */
export function replayScope(input) {
  const immutable_scope = { date: input.date, symbol: input.symbol,
    plan_sha256: input.plan_sha256, manifest_sha256: input.meta.premarket_manifest_sha256,
    engine_version: input.engine_version, book_mode: input.book_mode, execution_timeframe: "15m",
    cutoff: instant(input.cutoff), session_end: instant(`${input.date}T20:00:00+02:00`) };
  const hash = scopeHash(immutable_scope);
  return { immutable_scope, immutable_scope_hash: hash, replay_scope_hash: hash };
}

export function verifyReplayScope(input) {
  const expected = replayScope(input), prior = input.progress;
  if (!prior) return expected;
  const scope = prior.tv_replay_state?.immutable_scope;
  const checks = { plan: prior.plan_sha256 === input.plan_sha256,
    target: instant(prior.replay_target_time) === expected.immutable_scope.session_end,
    cutoff: !prior.tv_replay_state?.cutoff_proof ||
      prior.tv_replay_state.cutoff_proof.expected_cutoff === expected.immutable_scope.cutoff,
    hash: !(prior.immutable_scope_hash ?? prior.tv_replay_state?.immutable_scope_hash)
      || (prior.immutable_scope_hash ?? prior.tv_replay_state?.immutable_scope_hash) === expected.immutable_scope_hash,
    definition: !scope || scopeHash(scope) === expected.immutable_scope_hash };
  if (!Object.values(checks).every(Boolean)) throw scopeError(checks, expected, prior);
  return expected;
}

function scopeError(checks, expected, prior) {
  return Object.assign(oosTvError("TV_REPLAY_RESUME_SCOPE_MISMATCH"), { details: {
    checks, expected_scope: expected.immutable_scope, persisted_scope: prior.tv_replay_state?.immutable_scope ?? null,
    expected_scope_hash: expected.immutable_scope_hash, persisted_scope_hash: prior.immutable_scope_hash ?? null,
    previous_confirmed_bar: prior.last_confirmed_bar_time, reason: "IMMUTABLE_SCOPE_DIFFERENT" } });
}

export function replayAttachment(observation, browserSessionId) {
  return { browser_session_id: browserSessionId ?? null, tv_replay_session_id: observation.tv_replay_session_id ?? null };
}

export function attachmentChanged(prior, current) {
  const previous = prior?.ephemeral_scope ?? prior?.tv_replay_state?.ephemeral_scope;
  if (!previous) return !!prior?.browser_session_id && prior.browser_session_id !== current.browser_session_id;
  return !!previous && Object.keys(current).some(key => previous[key] !== current[key]);
}
