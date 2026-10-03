import { requireFact } from "../domain/batch-contract.js";
import { absentEvidence } from "../domain/forensic-evidence.js";

const ARTIFACTS = { "5m_final": "replay/5m_final.png", "15m_final": "replay/15m_final.png",
  dashboard_final: "replay/dashboard_final.png", positions_final: "replay/positions_final.png",
  audit_json: "replay/audit.json", run_meta_json: "replay/run_meta.json", logs_txt: "replay/logs.txt" };

export class ForensicArtifacts {
  constructor({ index, archive, fingerprint, crop }) { Object.assign(this, { index, archive, fingerprint, crop }); }
  async bytes({ date, artifact }) {
    const day = await this.index.get(date), name = ARTIFACTS[artifact];
    requireFact(name, "FORENSIC_ARTIFACT_UNKNOWN");
    const source = day.sources.find(s => s.path === name);
    if (!source) return absentEvidence(artifact);
    const bytes = await this.archive.read(day.definition, name);
    requireFact(this.fingerprint(bytes) === source.sha256, "FORENSIC_INTEGRITY_VIOLATION", { path: name });
    return { available: true, bytes, source };
  }
  async artifact(args) {
    const result = await this.bytes(args); if (!result.available) return result;
    const { bytes, source } = result;
    return { available: true, ...source.provenance, exact_utf8: !source.path.endsWith(".png"),
      ...(source.path.endsWith(".png") ? { images: [{ name: args.artifact, mime_type: "image/png", sha256: source.sha256, data: bytes.toString("base64") }] }
        : { text: bytes.toString("utf8"), ...(source.path.endsWith(".json") ? { document: JSON.parse(bytes) } : {}) }) };
  }
  async cropArtifact(args) {
    if (args.start_time || args.end_time) return absentEvidence("persisted_time_to_pixel_mapping");
    const parent = await this.bytes(args); if (!parent.available) return parent;
    const { bytes, ...bounds } = this.crop({ bytes: parent.bytes, ...args });
    return { available: true, classification: "DERIVED_LOCAL", parent_sha256: parent.source.sha256,
      provenance: parent.source.provenance, bounds,
      images: [{ name: `${args.artifact}_crop`, mime_type: "image/png", sha256: this.fingerprint(bytes), data: bytes.toString("base64") }] };
  }
  async panel({ date, view }) {
    const day = await this.index.get(date), source = day.sources.find(s => s.path === "replay/audit.json");
    if (!source) return absentEvidence("native_panel");
    const checked = await this.bytes({ date, artifact: "audit_json" }), audit = JSON.parse(checked.bytes);
    const tables = view === "AUDIT" ? audit.published_tables : audit.published_position_tables;
    if (!tables?.length) return absentEvidence("native_panel");
    const name = view === "AUDIT" ? "dashboard_final.png" : "positions_final.png";
    return { available: true, view, tables, native_table: true, ocr: false, provenance: source.provenance,
      presentation: day.run_meta.capture_provenance?.[name]?.presentation ?? absentEvidence("presentation") };
  }
  async verify({ date, repository }) {
    const day = await this.index.get(date), violations = [];
    for (const source of day.sources) {
      try { requireFact(this.fingerprint(await this.archive.read(day.definition, source.path)) === source.sha256, "HASH_MISMATCH"); }
      catch (error) { violations.push({ path: source.path, reason: error.code || "READ_FAILED" }); }
    }
    const current = await repository.get(day.definition);
    if (current.plan_sha256 !== day.identity.plan_sha256 || current.manifest_sha256 !== day.identity.manifest_sha256
      || current.revision !== day.summary.revision || current.state !== day.summary.state) violations.push({ reason: "BUSINESS_IDENTITY_CHANGED" });
    return { date, status: violations.length ? "FORENSIC_INTEGRITY_VIOLATION" : "PASS", violations,
      checked_sources: day.sources.length, plan_sha256: day.identity.plan_sha256, manifest_sha256: day.identity.manifest_sha256 };
  }
}
