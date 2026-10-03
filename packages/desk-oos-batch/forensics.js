import { ArtifactArchive, jsonBytes, sha256 } from "./src/adapter/artifact-archive.js";
import { ForensicIndexReader, publishForensicIndex } from "./src/adapter/forensic-index.js";
import { cropForensicPng } from "./src/adapter/forensic-png.js";
import { ForensicSource } from "./src/application/forensic-source.js";
import { ForensicArtifacts } from "./src/application/forensic-artifacts.js";
import { ForensicQueries } from "./src/application/forensic-queries.js";
import { ForensicSearch } from "./src/application/forensic-search.js";
import { ForensicMarket } from "./src/application/forensic-market.js";
import { ForensicApi } from "./src/application/forensic-api.js";

export function createOosForensics({ repository, root, indexRoot }) {
  const index = new ForensicIndexReader(indexRoot), archive = new ArtifactArchive(root);
  const artifacts = new ForensicArtifacts({ index, archive, fingerprint: sha256, crop: cropForensicPng });
  const queries = new ForensicQueries({ index, artifacts, repository, fingerprint: sha256 });
  return new ForensicApi({ queries, artifacts, search: new ForensicSearch(queries), market: new ForensicMarket(queries) });
}

/** Offline operator entry point. Source is read-only; only the separate content-addressed index is written. */
export async function buildOosForensicIndex({ repository, root, indexRoot, batchId, smokeDates = [] }) {
  const source = new ForensicSource({ archive: new ArtifactArchive(root), fingerprint: sha256, encodeJson: jsonBytes, smokeDates });
  const snapshots = [];
  for (const row of await repository.list(batchId)) {
    if (row.plan_sha256 && row.state === "COMPLETED") snapshots.push(await source.build(row));
  }
  return publishForensicIndex({ root: indexRoot, snapshots, generatedAt: new Date().toISOString() });
}
