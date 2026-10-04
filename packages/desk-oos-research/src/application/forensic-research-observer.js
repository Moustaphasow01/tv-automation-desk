import { createScenarioSelfAudit } from "../domain/scenario-self-audit.js";
import { requireResearch, sourceIdentity } from "../domain/research-evidence.js";

const READS = new Set(["get_forensic_capabilities", "get_forensic_index", "verify_forensic_integrity", "list_forensic_scenarios",
  "list_scenario_attempts", "get_scenario_forensic_packet", "get_forensic_events", "get_trade_forensics"]);

/** A narrow public read port. The application has no reference to any OOS command. */
export class ForensicResearchObserver {
  constructor({ readForensic, fingerprint }) { Object.assign(this, { readForensic, fingerprint }); }
  async read(name, args = {}) {
    requireResearch(READS.has(name), "RESEARCH_READ_FORBIDDEN", { tool: name });
    const result = await this.readForensic(name, args);
    requireResearch(result && !result.isError, "RESEARCH_FORENSIC_READ_FAILED", { tool: name });
    return result.structuredContent ?? result;
  }
  async pages(name, args) {
    const rows = [], visited = new Set();
    let cursor;
    do {
      const page = await this.read(name, { ...args, limit: 200, ...(cursor ? { cursor } : {}) });
      if (page.available === false) return rows;
      rows.push(...page.items); cursor = page.next_cursor;
      requireResearch(!cursor || !visited.has(cursor), "RESEARCH_PAGINATION_LOOP");
      visited.add(cursor);
    } while (cursor);
    return rows;
  }
  async day(date, expectedCorpus) {
    await this.assertCorpus(expectedCorpus);
    const [day] = await this.pages("get_forensic_index", { date });
    requireResearch(day && day.state === "COMPLETED", "RESEARCH_PUBLISHED_DAY_REQUIRED", { date });
    const identity = sourceIdentity(day), integrity = await this.read("verify_forensic_integrity", { date });
    requireResearch(integrity.status === "PASS", "RESEARCH_SOURCE_INTEGRITY_FAILED", { date });
    const scenarios = await this.pages("list_forensic_scenarios", { date }), cases = [];
    requireResearch(scenarios.length === day.scenario_count && new Set(scenarios.map(s => s.scenario_id)).size === scenarios.length,
      "RESEARCH_SCENARIO_COVERAGE_MISMATCH", { date });
    for (const scenario of scenarios) cases.push(...await this.scenario({ identity, scenario }));
    await this.assertCorpus(expectedCorpus);
    return { identity, cases, coverage: { scenario_count: scenarios.length, audit_count: cases.length,
      observed_attempt_count: cases.filter(c => c.attempt !== null).length, expected_attempt_count: day.attempt_count } };
  }
  async scenario({ identity, scenario }) {
    const args = { date: identity.date, scenario_id: scenario.scenario_id };
    const attempts = await this.pages("list_scenario_attempts", args), cases = [];
    requireResearch(new Set(attempts.map(a => a.attempt)).size === attempts.length, "RESEARCH_ATTEMPT_DUPLICATE");
    for (const attempt of attempts.length ? attempts : [{ attempt: null }]) {
      const query = { ...args, ...(attempt.attempt === null ? {} : { attempt: attempt.attempt }) };
      const packet = await this.read("get_scenario_forensic_packet", query);
      requireResearch(packet.scenario_id === scenario.scenario_id && packet.attempt === attempt.attempt, "RESEARCH_PACKET_SCOPE_MISMATCH");
      requireResearch(packet.provenance?.plan_sha256 === identity.plan_sha256
        && packet.provenance?.manifest_sha256 === identity.manifest_sha256, "RESEARCH_IDENTITY_MISMATCH");
      const events = attempt.attempt === null ? [] : await this.pages("get_forensic_events", query);
      requireResearch(events.every(e => e.scenario_id === scenario.scenario_id && e.attempt === attempt.attempt
        && e.date === identity.date), "RESEARCH_EVENT_SCOPE_MISMATCH");
      const trades = [];
      for (const ref of packet.TRADE_REF) trades.push(await this.read("get_trade_forensics", { date: identity.date, trade_id: ref.trade_id }));
      cases.push(createScenarioSelfAudit({ identity, packet, events, trades, fingerprint: this.fingerprint }));
    }
    return cases;
  }
  async assertCorpus(hash) {
    const capabilities = await this.read("get_forensic_capabilities");
    requireResearch(capabilities.index_hash === hash, "RESEARCH_CORPUS_DRIFT");
  }
}
