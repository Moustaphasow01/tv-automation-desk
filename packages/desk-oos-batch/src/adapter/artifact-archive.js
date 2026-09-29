import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { requireFact } from "../domain/batch-contract.js";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");

/** Write-once files: publish a fully fsynced file with an atomic, no-clobber link. */
export class ArtifactArchive {
  constructor(root) { this.root = path.resolve(root); }

  relative(day, name) {
    return `${day.batch_id}/${day.date.slice(0, 7)}/${day.date}/${name}`;
  }

  async target(day, name) {
    const relative = this.relative(day, name);
    requireFact(!relative.includes("\\") && relative.split("/").every(part =>
      /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."), "ARTIFACT_PATH_INVALID");
    await mkdir(this.root, { recursive: true });
    let current = this.root;
    requireFact(!(await lstat(current)).isSymbolicLink(), "ARTIFACT_SYMLINK_FORBIDDEN");
    for (const part of relative.split("/").slice(0, -1)) {
      current = path.join(current, part);
      await mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error; });
      requireFact((await lstat(current)).isDirectory() && !(await lstat(current)).isSymbolicLink(), "ARTIFACT_SYMLINK_FORBIDDEN");
    }
    const result = path.join(this.root, relative);
    const existing = await lstat(result).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    requireFact(!existing?.isSymbolicLink(), "ARTIFACT_SYMLINK_FORBIDDEN");
    return result;
  }

  async read(day, name) { return readFile(await this.target(day, name)); }
  async readJson(day, name) { return JSON.parse((await this.read(day, name)).toString("utf8")); }
  async optionalJson(day, name) {
    return this.readJson(day, name).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  }

  async put(day, name, bytes) {
    const target = await this.target(day, name);
    const temporary = `${target}.${randomUUID()}.pending`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      await link(temporary, target).catch(async error => {
        if (error.code !== "EEXIST") throw error;
        requireFact((await readFile(target)).equals(Buffer.from(bytes)), "IMMUTABLE_ARTIFACT_CONFLICT", { name });
      });
    } finally { await unlink(temporary); }
    return { path: name, sha256: sha256(bytes) };
  }

  async putJson(day, name, value) { return this.put(day, name, jsonBytes(value)); }
}

export function decodePng(base64) {
  requireFact(typeof base64 === "string" && base64.length <= 24_000_000
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64), "PNG_ENCODING_INVALID");
  const bytes = Buffer.from(base64, "base64");
  requireFact(bytes.length > 32 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.subarray(12, 16).toString() === "IHDR", "PNG_INVALID");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  requireFact(width > 0 && height > 0 && width * height <= 32_000_000, "PNG_DIMENSIONS_INVALID");
  return bytes;
}
