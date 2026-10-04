import path from 'node:path';
import { createHash } from 'node:crypto';
import { ArtifactArchive, ForensicIndexReader } from '@tv-automation/desk-oos-batch';

/** Verified existing PNGs only. No TradingView, market-data or write port is accepted. */
export function researchVisualReader({ archive_root, index_root }) {
  const archive = new ArtifactArchive(archive_root);
  const index = new ForensicIndexReader(index_root ?? path.join(archive_root, 'forensic-index-v2'));
  return async ({ audit, route }) => {
    const day = await index.get(audit.identity.date), images = [];
    if (day.identity.plan_sha256 !== audit.identity.plan_sha256 || day.identity.manifest_sha256 !== audit.identity.manifest_sha256)
      throw Object.assign(new Error('RESEARCH_VISUAL_IDENTITY_MISMATCH'), { code: 'RESEARCH_VISUAL_IDENTITY_MISMATCH' });
    for (const requested of route.requested_artifacts.slice(0,4)) {
      const source = day.sources.find(s => s.path === requested);
      if (!source) continue; // Missing remains missing; never regenerate an artefact.
      const bytes = await archive.read(day.definition, source.path);
      if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
        throw Object.assign(new Error('RESEARCH_VISUAL_HASH_MISMATCH'), { code: 'RESEARCH_VISUAL_HASH_MISMATCH' });
      images.push({ artifact_ref: source.path, crop_ref: null, mime_type: 'image/png', source_sha256: source.sha256,
        ...source.provenance, data: bytes.toString('base64'), pixels_verified: true });
    }
    return images;
  };
}
