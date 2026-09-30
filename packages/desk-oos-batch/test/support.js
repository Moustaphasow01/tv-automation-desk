import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ArtifactArchive, decodePng, sha256 } from "../src/adapter/artifact-archive.js";
import { batchDays, requireFact } from "../src/domain/batch-contract.js";
import { PremarketWorkflow } from "../src/application/premarket-workflow.js";
import { PlanFreeze } from "../src/application/plan-freeze.js";
import { ReplayWorkflow } from "../src/application/replay-workflow.js";
import { OosDayWorkflow } from "../src/application/day-workflow.js";

export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==";
export const PLAN = "SYNTHETIC TRANSPORT FIXTURE\r\n  opaque external bytes\r\n";
export const DAY = batchDays({ batch_id: "fixture", date: "2026-07-01", cutoff_time: "09:00", symbol: "MES1!" })[0];
export class MemoryRegistry {
  constructor() { this.row = null; this.events = []; this.locked = false; }
  async withDayLock(day, fn) {
    requireFact(!this.locked, "OOS_BUSY"); this.locked = true;
    try { return await fn(); } finally { this.locked = false; }
  }
  async withChartLock(fn) { return fn(); }
  async get() { return structuredClone(this.row); }
  async ensureDay(day) {
    this.row ||= { definition: day, batch_id: day.batch_id, day: day.date, state: "NEW", checkpoint: "NEW",
      revision: 0, candidate_attempt: 1, capture_count: 0, error: null };
    return structuredClone(this.row);
  }
  async save(row, change, at) {
    requireFact(row.revision === this.row.revision, "OOS_VERSION_CONFLICT");
    this.row = { ...row, ...change, revision: row.revision + 1, updated_at: at };
    this.events.push(structuredClone(this.row));
    return structuredClone(this.row);
  }
}

export async function fixture() {
  const archive = new ArtifactArchive(await mkdtemp(path.join(os.tmpdir(), "oos-workflow-")));
  const repository = new MemoryRegistry();
  const calls = [], submissions = [];
  const clock = () => "2026-09-29T12:00:00Z";
  const tradingView = {
    async preparePremarket() { calls.push("prepare"); },
    async capturePremarket(input) {
      calls.push(input.name);
      return { ...input, replay: true, visible_as_of: input.cutoff, captured_at: clock(), source: "TEST_ONLY", image_base64: PNG };
    },
    async prepareFrozenReplay(input) { calls.push("load"); this.loaded = input; },
    async readPlanFingerprint() { return { ...DAY, plan_sha256: sha256(PLAN) }; },
    async replayTo(input) { calls.push("replay"); return { replay: true, at: input.end, symbol: input.symbol, plan_sha256: input.plan_sha256 }; },
    async collectResults(input) {
      calls.push("results");
      return { ...DAY, at: input.end, plan_sha256: input.plan_sha256, source: "TEST_ONLY",
        images: { "dashboard_final.png": PNG, "5m_final.png": PNG, "15m_final.png": PNG },
        positions_distinct: false, logs_accessible: false,
        capture_provenance: Object.fromEntries(["dashboard", "5m", "15m"].map(view => [`${view}_final.png`, {
          symbol: input.symbol, at: input.end, plan_sha256: input.plan_sha256, captured_at: clock(), source: "TEST_ONLY",
          timeframe: view === "dashboard" ? "15m" : view,
          ...(view === "dashboard" ? { presentation: { dedicated_panel: true, maximized: true, complete_table: true,
            view: "AUTO", title: "AUDIT FIN SESSION", pane_index: 1, bounds: { width: 1920, height: 1500 }, minimum_font_size: 14 } } : {})
        }])),
        audit: { event_count: 0, missing_metrics: ["net_r", "net_usd"] } };
    }
  };
  const scenarioBuilder = { async request(input) {
    submissions.push(input);
    return { status: "READY", plan_text: PLAN, generated_by: "TEST_ONLY", generated_at: clock() };
  } };
  const syntaxValidator = { async validate(input) { return { ...input, syntax_valid: true, validation_scope: "SYNTAX_ONLY" }; } };
  const common = { archive, tradingView, fingerprint: sha256, decodeImage: decodePng, clock };
  const premarket = new PremarketWorkflow(common);
  const freeze = new PlanFreeze({ ...common, premarket, scenarioBuilder, syntaxValidator });
  const replay = new ReplayWorkflow({ ...common, freeze });
  const workflow = new OosDayWorkflow({ repository, premarket, freeze, replay, clock });
  return { archive, repository, calls, submissions, tradingView, scenarioBuilder, syntaxValidator, premarket, freeze, replay, workflow };
}
