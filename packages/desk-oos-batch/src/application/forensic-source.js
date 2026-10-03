import { isDeepStrictEqual } from "node:util";
import { forensicPlanRecords, forensicScenarioDefinitions } from "../domain/forensic-plan.js";
import { normalizeForensicEvents } from "../domain/forensic-events.js";
import { forensicEpisodes } from "../domain/forensic-episodes.js";
import { forensicTrades } from "../domain/forensic-trades.js";
import { evidenceProvenance } from "../domain/forensic-evidence.js";
import { requireFact } from "../domain/batch-contract.js";

/** Reads existing files only. No replay/capture/validator/provider dependency. */
export class ForensicSource {
  constructor({ archive, fingerprint, encodeJson, smokeDates = [] }) {
    Object.assign(this, { archive, fingerprint, encodeJson, smokeDates });
  }
  async source(row, name, classification, expectedHash) {
    const bytes = await this.archive.read(row.definition, name), hash = this.fingerprint(bytes);
    requireFact(!expectedHash || hash === expectedHash, "FORENSIC_INTEGRITY_VIOLATION", { path: name });
    const identity = { date: row.day, plan_sha256: row.plan_sha256, manifest_sha256: row.manifest_sha256,
      engine_version: row.definition.engine_version, generated_at: row.run_meta?.completed_at ?? row.updated_at };
    return { bytes, path: name, sha256: hash, provenance: evidenceProvenance({ identity,
      path: this.archive.relative(row.definition, name), hash, classification, fingerprint: this.fingerprint }) };
  }
  async build(row) {
    requireFact(row.plan_sha256 && row.state === "COMPLETED", "FORENSIC_SOURCE_NOT_PUBLISHED");
    const identity = { date: row.day, plan_sha256: row.plan_sha256, manifest_sha256: row.manifest_sha256,
      engine_version: row.definition.engine_version, generated_at: row.run_meta?.completed_at ?? row.updated_at };
    const plan = await this.source(row, "plan/PLAN_SMC3.txt", "FACT_PLAN", row.plan_sha256);
    const meta = await this.source(row, "plan/plan_meta.json", "FACT_PLAN");
    const planMeta = JSON.parse(meta.bytes);
    requireFact(planMeta.status === "FROZEN" && planMeta.plan_sha256 === row.plan_sha256
      && planMeta.premarket_manifest_sha256 === row.manifest_sha256, "FORENSIC_PLAN_LINKAGE_INVALID");
    const manifest = await this.source(row, "premarket/manifest.json", "ARTIFACT_VISUAL");
    const { manifest_sha256, ...content } = JSON.parse(manifest.bytes);
    requireFact(manifest_sha256 === row.manifest_sha256 && this.fingerprint(this.encodeJson(content)) === manifest_sha256,
      "FORENSIC_MANIFEST_LINKAGE_INVALID");
    const sources = [plan, meta, manifest];
    for (const capture of content.captures) sources.push(await this.source(row,
      `premarket/${capture.path ?? capture.name}`, "ARTIFACT_VISUAL", capture.sha256));
    const records = forensicPlanRecords({ text: plan.bytes.toString("utf8"), provenance: offset => ({ ...plan.provenance,
      record_offset: offset, provenance_ref: this.fingerprint(`${plan.provenance.source_path}|${plan.sha256}|${offset}`) }) });
    const scenarios = forensicScenarioDefinitions(records);
    const published = await this.results(row, identity, sources);
    const episodes = forensicEpisodes({ events: published.events, scenarios });
    const trades = forensicTrades({ events: published.events, scenarios, identity, fingerprint: this.fingerprint });
    const violations = published.events.filter(e => e.scenario_id !== "PLAN" && !scenarios.some(s => s.scenario_id === e.scenario_id));
    requireFact(violations.length === 0, "FORENSIC_SCENARIO_REFERENCE_INVALID");
    const summary = this.summary({ row, scenarios, episodes, trades, published, sources });
    return { schema: "OOS_FORENSIC_V2", extractor_version: "2.0.0", identity, summary,
      definition: row.definition, business_fingerprint: this.fingerprint(this.encodeJson(row)), plan_text: plan.bytes.toString("utf8"),
      plan_meta: planMeta, records, scenarios, episodes, trades, ...published,
      sources: sources.map(({ bytes, ...source }) => source) };
  }
  async results(row, identity, sources) {
    if (row.run_meta?.result_classification === "UNSCORABLE_MARKET_GAP") {
      const receipt = await this.source(row, "evidence/market-session-exhausted.json", "FACT_MARKET_PERSISTED", row.run_meta.coverage_receipt?.sha256);
      sources.push(receipt);
      return { scorable: false, events: [], audit: null, run_meta: row.run_meta, market_gap: JSON.parse(receipt.bytes), logs: [] };
    }
    const integrity = await this.source(row, "evidence/result-integrity.json", "FACT_ENGINE");
    const registry = JSON.parse(integrity.bytes); sources.push(integrity);
    requireFact(registry.plan_sha256 === row.plan_sha256, "FORENSIC_AUDIT_LINKAGE_INVALID");
    const resultSources = [];
    for (const artifact of registry.artifacts) resultSources.push(await this.source(row, artifact.path,
      artifact.path.endsWith(".png") ? "ARTIFACT_VISUAL" : "FACT_ENGINE", artifact.sha256));
    sources.push(...resultSources);
    const audit = JSON.parse(resultSources.find(s => s.path === "replay/audit.json").bytes);
    const runMeta = JSON.parse(resultSources.find(s => s.path === "replay/run_meta.json").bytes);
    requireFact(audit.source === "ENGINE_PUBLISHED_ONLY" && audit.recalculated === false
      && runMeta.plan_sha256 === row.plan_sha256 && runMeta.premarket_manifest_sha256 === row.manifest_sha256,
    "FORENSIC_AUDIT_LINKAGE_INVALID");
    requireFact(isDeepStrictEqual(runMeta.artifacts, registry.artifacts.filter(s => s.path !== "replay/run_meta.json")),
      "FORENSIC_ARTIFACT_REGISTRY_INVALID");
    const logSource = resultSources.find(s => s.path === "replay/logs.txt");
    const text = logSource?.bytes.toString("utf8") ?? "";
    const events = normalizeForensicEvents({ text, identity, fingerprint: this.fingerprint,
      provenance: (offset, eventHash) => ({ ...logSource.provenance, record_offset: offset, source_event_hash: eventHash,
        provenance_ref: this.fingerprint(`${logSource.provenance.source_path}|${logSource.sha256}|${offset}`) }) });
    let offset = 0;
    const logs = text.split("\n").map((line, sequence) => {
      const item = { line, sequence, record_offset: offset, source_event_hash: this.fingerprint(line) };
      offset += Buffer.byteLength(line, "utf8") + 1; return item;
    }).filter(l => l.line.trim());
    return { scorable: true, events, audit, run_meta: runMeta, logs };
  }
  summary({ row, scenarios, episodes, trades, published, sources }) {
    return { date: row.day, state: row.state, scorable: published.scorable,
      sample_purpose: this.smokeDates.includes(row.day) ? "TECHNICAL_SMOKE" : "OOS",
      plan_sha256: row.plan_sha256, manifest_sha256: row.manifest_sha256, scenario_count: scenarios.length,
      attempt_count: episodes.length, confirmation_count: published.events.filter(e => e.event === "CONFIRMED").length,
      fill_count: trades.length, event_count: published.events.length,
      artifact_availability: Object.fromEntries(sources.map(s => [s.path, true])),
      forensic_integrity_status: "PASS", revision: row.revision };
  }
}
