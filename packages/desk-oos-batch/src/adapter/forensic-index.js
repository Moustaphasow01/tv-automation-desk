import { readFile, mkdir, writeFile, rename, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireFact } from "../domain/batch-contract.js";
import { jsonBytes, sha256 } from "./artifact-archive.js";

/** Public reader cannot write or invoke an OOS provider. All paths come from a verified catalogue. */
export class ForensicIndexReader {
  constructor(root) { this.root = path.resolve(root); this.cache = new Map(); }
  async catalogue() {
    const current = await this.read("CURRENT.json");
    requireFact(/^[a-f0-9]{64}$/.test(current.catalogue_sha256), "FORENSIC_INDEX_INVALID");
    const bytes = await this.bytes(`${current.catalogue_sha256}.json`);
    requireFact(sha256(bytes) === current.catalogue_sha256, "FORENSIC_INDEX_HASH_MISMATCH");
    return { ...JSON.parse(bytes), index_hash: current.catalogue_sha256 };
  }
  async get(date) {
    const catalogue = await this.catalogue(), entry = catalogue.days.find(d => d.date === date);
    requireFact(entry, "FORENSIC_DAY_NOT_INDEXED");
    if (!this.cache.has(entry.snapshot_sha256)) {
      const bytes = await this.bytes(`${entry.snapshot_sha256}.json`);
      requireFact(sha256(bytes) === entry.snapshot_sha256, "FORENSIC_INDEX_HASH_MISMATCH");
      this.cache.set(entry.snapshot_sha256, JSON.parse(bytes));
    }
    return this.cache.get(entry.snapshot_sha256);
  }
  async bytes(name) {
    requireFact(/^(?:CURRENT|[a-f0-9]{64})\.json$/.test(name), "FORENSIC_INDEX_PATH_INVALID");
    requireFact(!(await lstat(this.root)).isSymbolicLink(), "FORENSIC_INDEX_SYMLINK_FORBIDDEN");
    const target = path.join(this.root, name);
    requireFact(!(await lstat(target)).isSymbolicLink(), "FORENSIC_INDEX_SYMLINK_FORBIDDEN");
    return readFile(target);
  }
  async read(name) { return JSON.parse(await this.bytes(name)); }
}

/** Operator-only index publication. Writes exclusively outside the original OOS archive. */
export async function publishForensicIndex({ root, snapshots, generatedAt }) {
  await mkdir(root, { recursive: true });
  requireFact(!(await lstat(root)).isSymbolicLink(), "FORENSIC_INDEX_SYMLINK_FORBIDDEN");
  const days = [];
  for (const snapshot of snapshots) {
    const bytes = jsonBytes(snapshot), hash = sha256(bytes), target = path.join(root, `${hash}.json`);
    await writeFile(target, bytes, { flag: "wx" }).catch(async error => {
      if (error.code !== "EEXIST") throw error;
      requireFact(sha256(await readFile(target)) === hash, "FORENSIC_INDEX_HASH_MISMATCH");
    });
    days.push({ ...snapshot.summary, snapshot_sha256: hash });
  }
  const bytes = jsonBytes({ schema: "OOS_FORENSIC_V2", extractor_version: "2.0.0", days });
  const hash = sha256(bytes), target = path.join(root, `${hash}.json`);
  await writeFile(target, bytes, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const temporary = path.join(root, `${randomUUID()}.pending`);
  await writeFile(temporary, jsonBytes({ catalogue_sha256: hash, generated_at: generatedAt }), { flag: "wx" });
  await rename(temporary, path.join(root, "CURRENT.json"));
  return { indexed_days: days.length, catalogue_sha256: hash, root };
}
