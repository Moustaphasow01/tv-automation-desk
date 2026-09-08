import { canonicalSha256, evaluateMarketContextPrefilterV1, GRAINS_DATA_POLICIES, normalizeGrainsDataPolicy } from "@tv-automation/desk-domain";
import { evaluateCausalGrainContextAtBus } from "./grains-causal-context-prefilter.js";

const GRAIN_INSTRUMENTS = new Set(["ZC", "ZW", "ZC1!", "ZW1!"]);

export class MarketContextPrefilterService {
  constructor({ repository, pool, eventOutbox = null, dataPolicy } = {}) {
    this.repository = repository;
    this.pool = pool;
    this.eventOutbox = eventOutbox;
    this.dataPolicy = normalizeGrainsDataPolicy(dataPolicy);
  }

  async evaluate(signals, nowUtc, options = {}) {
    const grains = signals.filter((signal) => GRAIN_INSTRUMENTS.has(String(signal.instrument || "").toUpperCase()));
    const passthrough = signals.filter((signal) => !grains.includes(signal)).map((signal) => ({
      signal, decision: "ADMISSIBLE", admissible: true, reasonCodes: ["CONTEXT_PREFILTER_NOT_APPLICABLE_CURRENT_UNIVERSE"],
    }));
    if (!grains.length) return passthrough;
    const preferEmbedded = options.preferEmbeddedContextGateDecision === true
      || options.prefer_embedded_context_gate_decision === true;
    const current = await this.repository?.current("US_GRAINS_CBOT", nowUtc);
    const evaluated = grains.map((signal) => evaluateGrainContext({ signal, nowUtc, preferEmbedded,
      dataPolicy: this.dataPolicy, snapshot: current?.snapshot || null }));
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
        ON CONFLICT (market_context_prefilter_decision_id) DO UPDATE SET
          decision = EXCLUDED.decision,
          reason_codes = EXCLUDED.reason_codes,
          decided_at_utc = EXCLUDED.decided_at_utc,
          payload = EXCLUDED.payload`, [
          id, item.marketContextSnapshotId, item.signal.signal_id, item.decision, item.reasonCodes,
          item.signal.source_data_cutoff_utc || item.signal.generated_at_utc, nowUtc,
          JSON.stringify({ signalId: item.signal.signal_id, decision: item.decision, reasonCodes: item.reasonCodes,
            contextGate: item.contextGate || null, contextSource: item.contextSource || "SNAPSHOT_OR_LEGACY_EMBEDDED" }),
          item.signal.correlation_id || id, item.signal.signal_id,
        ]);
        if (this.eventOutbox) await this.eventOutbox.append({
          aggregateId: id, aggregateType: "market_context_prefilter_decision",
          eventType: "market.context.prefilter.decided", occurredAt: nowUtc,
          source: "market-context-prefilter", correlationId: item.signal.correlation_id || id,
          causationId: item.signal.signal_id,
          payload: { signalId: item.signal.signal_id, snapshotId: item.marketContextSnapshotId, decision: item.decision, reasonCodes: item.reasonCodes,
            contextGate: item.contextGate || null, contextSource: item.contextSource || "SNAPSHOT_OR_LEGACY_EMBEDDED" },
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

function evaluateGrainContext({ signal, nowUtc, preferEmbedded, snapshot, dataPolicy }) {
  const fallback = fallbackContextScope({ signal, snapshot });
  const causal = preferEmbedded || fallback.signal ? evaluateCausalGrainContextAtBus({ signal, nowUtc, dataPolicy }) : null;
  if (causal) return causal;
  if (fallback.signal || fallback.snapshot)
    return { signal, decision: "WAIT", admissible: false, reasonCodes: ["GRAIN_M5_FALLBACK_CAUSAL_SIGNAL_REQUIRED"],
      marketContextSnapshotId: null, contextSource: "M5_FALLBACK_SCOPE_GUARD" };
  const embedded = preferEmbedded ? embeddedGrainContextDecision(signal) : null;
  if (embedded) return { signal, ...embedded, marketContextSnapshotId: null, contextSource: "LEGACY_SIGNAL_EMBEDDED" };
  const lookaheadReason = contextLookaheadReason(snapshot, nowUtc);
  const decision = lookaheadReason
    ? { decision: "WAIT", admissible: false, reasonCodes: [lookaheadReason] }
    : evaluateMarketContextPrefilterV1({
      signal: contextSignalIdentity(signal), snapshot, at: nowUtc,
      familyRequiresAgriEvents: signal.payload?.family_requires_agri_events !== false,
    });
  return { signal, ...decision, contextSource: "MARKET_CONTEXT_SNAPSHOT",
    marketContextSnapshotId: snapshot?.marketContextSnapshotId || snapshot?.market_context_snapshot_id || null };
}

function fallbackContextScope({ signal, snapshot }) {
  return {
    signal: signal.setup?.context?.data_quality?.data_policy === GRAINS_DATA_POLICIES.M5_FALLBACK,
    snapshot: array(snapshot?.reasonCodes).includes("US_GRAINS_M5_FALLBACK_POLICY_ACTIVE")
      || array(snapshot?.sourceStates).some((source) => array(source.reasonCodes).includes("US_GRAINS_M5_FALLBACK_POLICY_ACTIVE")),
  };
}

function contextSignalIdentity(signal) {
  return {
    instrument: signal.instrument,
    side: signal.direction,
    strategyFamily: signal.payload?.strategy_family || signal.setup?.family || signal.setup?.setup_type || signal.setup?.setup_kind,
    createdAt: signal.generated_at_utc,
  };
}

function embeddedGrainContextDecision(signal = {}) {
  const gate = signal.signal_quality?.context_gate || signal.payload?.context_gate || null;
  const recommendation = String(gate?.recommendation || gate?.decision || "").toUpperCase();
  if (!recommendation) return null;
  const decision = embeddedRecommendationToPrefilterDecision(recommendation);
  if (!decision) return null;
  const reasonCodes = [
    "US_GRAINS_EMBEDDED_CONTEXT_GATE_TRUTH",
    ...array(gate.reason_codes || gate.reasonCodes),
  ];
  return {
    decision,
    admissible: decision === "ADMISSIBLE",
    reasonCodes: [...new Set(reasonCodes)],
  };
}

function embeddedRecommendationToPrefilterDecision(value) {
  if (["TAKE", "ACCEPT", "TAKE_REDUCED", "ACCEPT_REDUCED", "ACCEPT_WITH_ADJUSTMENT"].includes(value)) return "ADMISSIBLE";
  if (value === "WAIT") return "WAIT";
  if (value === "REJECT") return "REJECT";
  return null;
}

function stableId(item) {
  return `context-prefilter-${canonicalSha256({
    signalId: item.signal.signal_id,
    snapshotId: item.marketContextSnapshotId || "missing",
  }).slice(0, 24)}`;
}

function contextLookaheadReason(snapshot, nowUtc) {
  const decisionAt = Date.parse(nowUtc);
  const contextCutoff = Date.parse(snapshot?.sourceDataCutoff || snapshot?.source_data_cutoff || snapshot?.source_data_cutoff_utc);
  if (Number.isFinite(decisionAt) && Number.isFinite(contextCutoff) && contextCutoff > decisionAt) {
    return "MARKET_CONTEXT_CUTOFF_AFTER_DECISION_TIME";
  }
  return null;
}

function array(value) { return Array.isArray(value) ? value : []; }
