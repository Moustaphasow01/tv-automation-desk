import { requireFact } from "./batch-contract.js";
import { publishedNumber, publishedTime } from "./forensic-evidence.js";

const SNAPSHOT_FIELDS = { entry: 16, stop: 17, tp1: 18, tp2: 19, quantity: 20, atr: 21,
  minRisk: 22, maxRisk: 23, rr_gross: 24, rr_net: 25, cost: 26, risk: 27,
  used_extreme: 28, sequence_low: 29, sequence_high: 30, retest_low: 31, retest_high: 32 };

export function decodePublishedEvent(line) {
  const raw = JSON.parse(line), fields = String(raw.message).split("|");
  if (fields[0] === "SMC_SHADOW") return { scenario_id: fields[3], attempt: Number(fields[4]), event: fields[5],
    timestamp: publishedTime(raw.barTime + 900000), bar_open: publishedTime(raw.barTime), bar_close: publishedTime(raw.barTime + 900000),
    event_from: publishedTime(fields[6]), event_to: publishedTime(fields[7]), stage_after: null, reason_codes: [],
    detail: fields.slice(8).join("|"), publication: "SMC_SHADOW", raw_message: raw.message,
    timestamp_classification: "DERIVED_LOCAL", timestamp_basis: "outer barTime plus published execution timeframe 15m" };
  if (fields[0] !== "SMC_AUDIT") return null;
  requireFact(fields.length >= 35 && fields[1] === "3.9.8", "FORENSIC_ENGINE_LOG_FORMAT_UNSUPPORTED");
  const detail = fields.slice(34).join("|"), ohlc = /O\/H\/L\/C=([\d.-]+)\/([\d.-]+)\/([\d.-]+)\/([\d.-]+)/.exec(detail);
  return { scenario_id: fields[11], attempt: Number(fields[12]), event: fields[13], stage_after: fields[14],
    timestamp: publishedTime(fields[7]), bar_open: publishedTime(raw.barTime), bar_close: publishedTime(fields[7]),
    event_from: publishedTime(fields[8]), event_to: publishedTime(fields[9]), reason_codes: fields[15].split(";").filter(Boolean),
    ...Object.fromEntries(Object.entries(SNAPSHOT_FIELDS).map(([key, index]) => [key, publishedNumber(fields[index])])),
    OHLC: ohlc ? Object.fromEntries(["O", "H", "L", "C"].map((k, i) => [k, publishedNumber(ohlc[i + 1])])) : null,
    quality: fields[33], detail, publication: "SMC_AUDIT", native_plan_id: fields[2],
    native_plan_fingerprint: fields[3], native_config_hash: fields[4], raw_message: raw.message };
}

/** Duplicate publication lines retained as aliases, never counted as additional ENGINE events. */
export function normalizeForensicEvents({ text, identity, fingerprint, provenance }) {
  const events = [], seen = new Map();
  let offset = 0, sequence = 0;
  for (const line of text.split("\n")) {
    const event = line.trim() ? decodePublishedEvent(line) : null;
    if (event) {
      const hash = fingerprint(line), key = hash;
      if (seen.has(key)) { const prior = seen.get(key); prior.source_offsets.push(offset); prior.duplicate_count++; }
      else {
        const episode = fingerprint(`${identity.date}|${event.scenario_id}|${event.attempt}|${identity.plan_sha256}`);
        const item = { ...event, sequence, episode_id: episode,
          event_id: fingerprint(`${episode}|${event.timestamp}|${event.event}|${sequence}`),
          source_offsets: [offset], duplicate_count: 0, ...provenance(offset, hash),
          derived_fields: ["episode_id", "event_id", "sequence", "duplicate_count", "stage_before"] };
        events.push(item); seen.set(key, item);
      }
    }
    offset += Buffer.byteLength(line, "utf8") + 1; sequence++;
  }
  events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || a.sequence - b.sequence);
  const stages = new Map();
  for (const event of events) {
    event.stage_before = stages.get(event.episode_id) ?? null;
    if (event.stage_after) stages.set(event.episode_id, event.stage_after);
  }
  return events;
}
