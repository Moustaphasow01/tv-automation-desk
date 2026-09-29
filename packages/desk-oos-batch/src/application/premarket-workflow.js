import { VIEWS, requireFact } from "../domain/batch-contract.js";
import { validateCapture, validateManifest } from "../domain/evidence-contract.js";

export class PremarketWorkflow {
  constructor({ archive, tradingView, fingerprint, encodeJson, decodeImage }) {
    Object.assign(this, { archive, tradingView, fingerprint, encodeJson, decodeImage });
  }

  async capture(day, onCapture = async () => {}) {
    await this.tradingView.preparePremarket(day);
    const captures = [];
    for (const view of VIEWS) {
      captures.push(await this.captureView(day, view));
      await onCapture(captures.length);
    }
    const manifest = { schema_version: "oos-premarket/1", date: day.date, symbol: day.symbol,
      timezone: day.timezone, cutoff: day.cutoff, captures, status: "PREMARKET_READY" };
    validateManifest(manifest, day);
    await this.archive.putJson(day, "premarket/manifest.json", manifest);
    return this.verify(day);
  }

  async captureView(day, view) {
    const proofName = `evidence/${view.name}.json`;
    let proof = await this.archive.optionalJson(day, proofName);
    if (!proof) {
      proof = await this.tradingView.capturePremarket({ ...day, ...view });
      validateCapture(proof, { ...day, ...view });
      this.decodeImage(proof.image_base64);
      await this.archive.putJson(day, proofName, proof);
    }
    validateCapture(proof, { ...day, ...view });
    const bytes = this.decodeImage(proof.image_base64);
    const artifact = await this.archive.put(day, `premarket/${view.name}`, bytes);
    return { timeframe: view.timeframe, view: view.view, path: view.name, sha256: artifact.sha256,
      captured_at: proof.captured_at, visible_as_of: proof.visible_as_of, source: proof.source,
      indicator_fingerprint: proof.indicator_fingerprint ?? null };
  }

  async verify(day) {
    const bytes = await this.archive.read(day, "premarket/manifest.json");
    const manifest = JSON.parse(bytes.toString("utf8"));
    validateManifest(manifest, day);
    const images = [];
    for (const capture of manifest.captures) {
      const png = await this.archive.read(day, `premarket/${capture.path}`);
      requireFact(this.fingerprint(png) === capture.sha256, "PREMARKET_HASH_MISMATCH");
      this.decodeImage(png.toString("base64"));
      images.push({ name: capture.path, mime_type: "image/png", sha256: capture.sha256, data: png.toString("base64") });
    }
    return { manifest, manifest_sha256: this.fingerprint(bytes), images };
  }
}
