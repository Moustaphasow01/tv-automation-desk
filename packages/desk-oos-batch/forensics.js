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
  const registryRead = { get: repository.get.bind(repository) };
  const queries = new ForensicQueries({ index, artifacts, repository: registryRead, fingerprint: sha256 });
  return new ForensicApi({ queries, artifacts, search: new ForensicSearch(queries), market: new ForensicMarket(queries) });
}

/** Offline operator entry point. Source is read-only; only the separate content-addressed index is written. */
export async function buildOosForensicIndex({ repository, root, indexRoot, batchId, smokeDates = [], fileInventory = [] }) {
  const source = new ForensicSource({ archive: new ArtifactArchive(root), fingerprint: sha256, encodeJson: jsonBytes, smokeDates });
  const snapshots = [];
  for (const row of await repository.list(batchId)) {
    if (row.plan_sha256 && row.state === "COMPLETED") {
      const snapshot = await source.build(row), prefix = `${row.day.slice(0, 7)}/${row.day}/`;
      snapshot.inventory = fileInventory.filter(f => f.path.startsWith(prefix)).map(file => {
        const sourcePath = `${row.batch_id}/${file.path}`;
        return { path: file.path.slice(prefix.length), sha256: file.sha256,
          provenance: { ...snapshot.identity, source_type: "PERSISTED_FILE_INVENTORY", classification: "DERIVED_LOCAL",
            source_path: sourcePath, source_sha256: file.sha256, record_offset: 0,
            provenance_ref: sha256(`${sourcePath}|${file.sha256}|0`) } };
      });
      snapshots.push(snapshot);
    }
  }
  return publishForensicIndex({ root: indexRoot, snapshots, generatedAt: new Date().toISOString() });
}
