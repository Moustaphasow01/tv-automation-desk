import { createHash } from "node:crypto";

export const fingerprint = value => createHash("sha256").update(String(value)).digest("hex");
export const clock = () => "2026-10-04T09:00:00.000Z";
export const identity = { date: "2026-07-02", plan_sha256: "a".repeat(64), manifest_sha256: "b".repeat(64),
  snapshot_sha256: "c".repeat(64), sample_purpose: "OOS", scorable: true };
export function packet(scenario_id = "S001", attempt = 1) {
  const provenance = { provenance_ref: "plan-ref", ...identity };
  return { scenario_id, attempt, PLAN_DEFINITION: { scenario_id, direction: "LONG", priority: 1,
    entry_rule: "FIXED", stop_rule: "FIXED", steps_count: 2, provenance,
    records: [{ record_type: "SCN", raw: "TEST_FIXTURE_ONLY", provenance_ref: "plan-ref", decoded: {} }] },
    EPISODE_METADATA: attempt === null ? { available: false, reason: "NOT_PERSISTED" } : { episode_id: `episode-${attempt}` },
    TRADE_REF: [], TICKET_SNAPSHOT: { available: false, reason: "NOT_PERSISTED" }, provenance,
    MARKET_WINDOW_REF: { available: false, reason: "NOT_PERSISTED" } };
}
export function event(event, timestamp) {
  return { event_id: event, event, timestamp, provenance_ref: `ref-${event}`, reason_codes: [], source_event_hash: fingerprint(event) };
}
export class MemoryFixture {
  constructor() { this.cycles = new Map(); this.artifacts = new Map(); this.events = []; this.locked = new Set(); }
  async beginCycle(row) {
    if (this.cycles.has(row.cycle_id)) return this.cycles.get(row.cycle_id);
    const cycle = { ...row, status: "OBSERVING", revision: 0 }; this.cycles.set(row.cycle_id, cycle); return cycle;
  }
  async getCycle(id) { return this.cycles.get(id); }
  async transition(row) {
    const current = this.cycles.get(row.cycle_id);
    if (current.revision !== row.expected_revision) throw Object.assign(new Error("REVISION"), { code: "REVISION" });
    const next = { ...current, ...row, revision: current.revision + 1 }; this.cycles.set(row.cycle_id, next); return next;
  }
  async putArtifact(row) {
    const key = `${["hypothesis", "experiment"].includes(row.kind) ? "GLOBAL" : row.cycle_id}:${row.kind}:${row.id}`, old = this.artifacts.get(key);
    if (old && old.payload_hash !== row.payload_hash) throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
    this.artifacts.set(key, old ?? row); return old ?? row;
  }
  async findArtifact({ kind, id }) { return [...this.artifacts.values()].find(r => r.kind === kind && r.id === id) ?? null; }
  async listArtifacts({ cycle_id, kind, limit = 50, cursor = "0" }) {
    const rows = [...this.artifacts.values()].filter(r => r.cycle_id === cycle_id && r.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
    const offset = Number(cursor);
    return { items: rows.slice(offset, offset + limit), next_cursor: offset + limit < rows.length ? String(offset + limit) : null };
  }
  async addEvent(row) { if (!this.events.some(e => e.event_id === row.event_id)) this.events.push(row); }
  async listEvents(cycle_id) { return this.events.filter(e => e.cycle_id === cycle_id); }
  async latestEvent(type) { return this.events.filter(e=>e.type===type).at(-1)??null; }
  async executeExclusive(id, operation) {
    if (this.locked.has(id)) throw new Error("RESEARCH_CYCLE_BUSY");
    this.locked.add(id); try { return await operation(); } finally { this.locked.delete(id); }
  }
}

export function unknownAnswers() {
  return { answers: "ABCDEFG".split("").map(question_id => ({ question_id, statement: "Unknown in this fixture",
    kind: "UNKNOWN", evidence_refs: [], missing_reason: "NOT_PERSISTED" })), attribution: "UNKNOWN", alternative_explanations: [], hypothesis: null };
}
