import { VIEWS, requireFact } from "../domain/batch-contract.js";
import { validateCapture, validateManifest } from "../domain/evidence-contract.js";
import { premarketCaptureRecord, premarketManifest } from "./premarket-workflow.js";

/** Explicit technical repair, never a public MCP command or automatic repair of frozen evidence. */
export class PremarketCaptureRepair {
  constructor({ repository, archive, premarket, tradingView, fingerprint, encodeJson, decodeImage, clock }) {
    Object.assign(this, { repository, archive, premarket, tradingView, fingerprint, encodeJson, decodeImage, clock });
  }

  async execute(command) {
    const { day, capture, expected_manifest_sha256 } = command;
    const view = VIEWS.find(v => v.name === capture);
    requireFact(view && /^[a-f0-9]{64}$/.test(expected_manifest_sha256), "CAPTURE_REPAIR_COMMAND_INVALID");
    return this.repository.withDayLock(day, async () => {
      let row = await this.repository.getPreparation(day);
      requireFact(row && !row.plan_sha256 && !await this.archive.optionalJson(day, "plan/plan_meta.json"), "FROZEN_BUNDLE_INTEGRITY_VIOLATION");
      requireFact(row.state === "PREMARKET_READY" && row.checkpoint === "PREMARKET_READY", "CAPTURE_REPAIR_STATE_REJECTED");
      const journalName = `evidence/premarket-repair-${expected_manifest_sha256}/replacement.json`;
      let journal = await this.archive.optionalJson(day, journalName);
      if (!journal) {
        requireFact(row.manifest_sha256 === expected_manifest_sha256, "CAPTURE_REPAIR_HASH_CONFLICT");
        journal = await this.prepare({ day, view, expected_manifest_sha256 });
        await this.archive.putJson(day, journalName, journal);
      }
      requireFact(journal.capture === capture && journal.original_manifest_sha256 === expected_manifest_sha256, "CAPTURE_REPAIR_JOURNAL_CONFLICT");
      requireFact([expected_manifest_sha256, journal.manifest.manifest_sha256].includes(row.manifest_sha256), "CAPTURE_REPAIR_HASH_CONFLICT");
      for (const replacement of journal.replacements) await this.archive.replaceUnfrozenCapture(day, {
        ...replacement, bytes: Buffer.from(replacement.bytes_base64, "base64"), repair_id: expected_manifest_sha256 });
      const bundle = await this.premarket.verify(day);
      if (row.manifest_sha256 !== bundle.manifest_sha256) row = await this.repository.commitCaptureRepair({ day, previous: row,
        manifest_sha256: bundle.manifest_sha256, receipt: { capture, journal_sha256: this.fingerprint(this.encodeJson(journal)) } }, this.clock());
      return { date: day.date, state: row.state, capture_count: 8, manifest_sha256: bundle.manifest_sha256,
        repaired_capture: capture, original_manifest_sha256: expected_manifest_sha256, plan_modified: false, replay_triggered: false };
    });
  }

  async prepare({ day, view, expected_manifest_sha256 }) {
    const original = await this.archive.read(day, "premarket/manifest.json"), manifest = JSON.parse(original.toString("utf8"));
    const { manifest_sha256, ...content } = manifest;
    requireFact(manifest_sha256 === expected_manifest_sha256 && this.fingerprint(this.encodeJson(content)) === manifest_sha256, "MANIFEST_HASH_MISMATCH");
    for (const c of manifest.captures.filter(c => c.path !== view.name)) {
      requireFact(this.fingerprint(await this.archive.read(day, `premarket/${c.path}`)) === c.sha256, "PREMARKET_HASH_MISMATCH");
    }
    const proof = await this.repository.withChartLock(async () => {
      await this.tradingView.preparePremarket(day);
      return this.tradingView.capturePremarket({ ...day, ...view });
    });
    validateCapture(proof, { ...day, ...view });
    const png = this.decodeImage(proof.image_base64), record = premarketCaptureRecord(proof, view, this.fingerprint(png));
    const next = premarketManifest(day, manifest.captures.map(c => c.path === view.name ? record : c), this.fingerprint);
    validateManifest(next, day);
    const replacements = [];
    for (const [name, bytes] of [[`premarket/${view.name}`, png], [`evidence/${view.name}.json`, this.encodeJson(proof)],
      ["premarket/manifest.json", this.encodeJson(next)]]) {
      replacements.push({ name, expected_sha256: this.fingerprint(await this.archive.read(day, name)), bytes_base64: bytes.toString("base64") });
    }
    return { capture: view.name, original_manifest_sha256: manifest_sha256, manifest: next, replacements };
  }
}
