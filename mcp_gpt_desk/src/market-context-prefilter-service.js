import { canonicalSha256, evaluateMarketContextPrefilterV1 } from "@tv-automation/desk-domain";

const GRAIN_INSTRUMENTS = new Set(["ZC", "ZW", "ZC1!", "ZW1!"]);

export class MarketContextPrefilterService {
  constructor({ repository, pool, eventOutbox = null } = {}) {
    this.repository = repository;
    this.pool = pool;
    this.eventOutbox = eventOutbox;
  }

  async evaluate(signals, nowUtc) {
    const grains = signals.filter((signal) => GRAIN_INSTRUMENTS.has(String(signal.instrument || "").toUpperCase()));
    const passthrough = signals.filter((signal) => !grains.includes(signal)).map((signal) => ({
      signal, decision: "ADMISSIBLE", admissible: true, reasonCodes: ["CONTEXT_PREFILTER_NOT_APPLICABLE_CURRENT_UNIVERSE"],
    }));
    if (!grains.length) return passthrough;
    const current = await this.repository?.current("US_GRAINS_CBOT", nowUtc);
    const evaluated = grains.map((signal) => ({
      signal,
      ...evaluateMarketContextPrefilterV1({
        signal: {
          instrument: signal.instrument,
          side: signal.direction,
          strategyFamily: signal.payload?.strategy_family || signal.setup?.family || signal.setup?.setup_type,
          createdAt: signal.generated_at_utc,
        },
        snapshot: current?.snapshot || null,
        at: signal.generated_at_utc,
        familyRequiresAgriEvents: signal.payload?.family_requires_agri_events !== false,
      }),
      marketContextSnapshotId: current?.snapshot?.marketContextSnapshotId || null,
    }));
    await this.#persist(evaluated, nowUtc);
    return [...passthrough, ...evaluated];
  }

  async #persist(decisions, nowUtc) {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of decisions) {
        const id = stableId(item);
        await client.query(`INSERT INTO market_context_prefilter_decisions (
          market_context_prefilter_decision_id, market_context_snapshot_id, signal_id,
          universe, decision, reason_codes, source_data_cutoff_utc, decided_at_utc,
          payload, correlation_id, causation_id
        ) VALUES ($1,$2,$3,'US_GRAINS_CBOT',$4,$5,$6,$7,$8::jsonb,$9,$10)
        ON CONFLICT (signal_id, market_context_snapshot_id) DO NOTHING`, [
          id, item.marketContextSnapshotId, item.signal.signal_id, item.decision, item.reasonCodes,
          item.signal.source_data_cutoff_utc || item.signal.generated_at_utc, nowUtc,
          JSON.stringify({ signalId: item.signal.signal_id, decision: item.decision, reasonCodes: item.reasonCodes }),
          item.signal.correlation_id || id, item.signal.signal_id,
        ]);
        if (this.eventOutbox) await this.eventOutbox.append({
          aggregateId: id, aggregateType: "market_context_prefilter_decision",
          eventType: "market.context.prefilter.decided", occurredAt: nowUtc,
          source: "market-context-prefilter", correlationId: item.signal.correlation_id || id,
          causationId: item.signal.signal_id,
          payload: { signalId: item.signal.signal_id, snapshotId: item.marketContextSnapshotId, decision: item.decision, reasonCodes: item.reasonCodes },
        }, client);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function stableId(item) {
  return `context-prefilter-${canonicalSha256({
    signalId: item.signal.signal_id,
    snapshotId: item.marketContextSnapshotId || "missing",
  }).slice(0, 24)}`;
}
