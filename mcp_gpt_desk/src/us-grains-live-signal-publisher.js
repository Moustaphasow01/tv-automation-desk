export const US_GRAINS_LIVE_SIGNAL_PUBLISHER_VERSION = "us_grains_live_signal_publisher_v1";

export function selectActionableGrainSignals(input = {}) {
  const asOfUtc = isoOrThrow(input.asOfUtc || input.as_of_utc || input.now_utc);
  const includeExpired = input.includeExpired === true || input.include_expired === true;
  const signals = Array.isArray(input.signals)
    ? input.signals
    : Array.isArray(input.replay?.accepted_signals)
      ? input.replay.accepted_signals
      : [];
  return signals
    .filter((signal) => signalActionableAt(signal, asOfUtc, { includeExpired }))
    .sort(compareSignalPublicationOrder);
}

export async function publishActionableGrainSignals(input = {}) {
  const store = input.store;
  if (!store?.publishStrategyV2Signal) {
    throw new Error("A store with publishStrategyV2Signal is required.");
  }
  const sourceClass = String(input.sourceClass || input.source_class || "SHADOW").toUpperCase();
  const certificationRunId = input.certificationRunId || input.certification_run_id || null;
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const published = [];
  for (const signal of signals) {
    const response = await store.publishStrategyV2Signal({
      input: {
        ...signal,
        source_class: sourceClass,
        certification_run_id: certificationRunId,
        idempotency_key: `us-grains-signal:${signal.signal_id}`,
      },
      actor: { kind: "us-grains-live-signal-publisher" },
    });
    published.push({
      signal_id: response.signal?.signal_id || signal.signal_id,
      signal_outbox_id: response.outbox?.signal_outbox_id || null,
      strategy_instance_id: response.signal?.strategy_instance_id || signal.strategy_instance_id,
      instrument: signal.instrument,
      direction: signal.direction,
      generated_at_utc: signal.generated_at_utc,
      expires_at_utc: signal.expires_at_utc,
      status: response.status,
      source_class: sourceClass,
    });
  }
  return {
    schema_version: "us_grains_signal_publish_result_v1",
    publisher_version: US_GRAINS_LIVE_SIGNAL_PUBLISHER_VERSION,
    source_class: sourceClass,
    certification_run_id: certificationRunId,
    selected_count: signals.length,
    published_count: published.length,
    published,
  };
}

function signalActionableAt(signal, asOfUtc, { includeExpired = false } = {}) {
  const generatedAt = Date.parse(signal.generated_at_utc || "");
  const expiresAt = Date.parse(signal.expires_at_utc || "");
  const asOf = Date.parse(asOfUtc);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)) return false;
  if (generatedAt > asOf) return false;
  return includeExpired || expiresAt > asOf;
}

function compareSignalPublicationOrder(left, right) {
  return Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc)
    || String(left.instrument).localeCompare(String(right.instrument))
    || String(left.signal_id).localeCompare(String(right.signal_id));
}

function isoOrThrow(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) throw new Error("Valid asOfUtc is required.");
  return new Date(parsed).toISOString();
}
