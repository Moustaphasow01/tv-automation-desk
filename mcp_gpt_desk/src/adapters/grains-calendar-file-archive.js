import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export function createGrainsCalendarFileArchive({ outputRoot, statusFile }) {
  const root = path.resolve(outputRoot);
  return {
    archiveDocument: async ({ source, text, bytes, receivedAtUtc }) => {
      const content = documentContent({ text, bytes });
      const documentHash = sha256(content);
      const suffix = archiveSuffix(source, bytes);
      const document = await immutableFile(root, "documents", documentHash, content, suffix);
      const receipt = JSON.stringify({
        sourceId: source.sourceId, sourceUrl: source.url, receivedAtUtc,
        documentSha256: `sha256:${documentHash}`, document, bytes: content.byteLength,
      });
      return immutableFile(root, "receipts", sha256(receipt), receipt, ".json");
    },
    archiveCollection: async (collection) => {
      const text = JSON.stringify(collection, null, 2);
      return immutableFile(root, "collections", sha256(text), text, ".json");
    },
    writeStatus: async (status) => {
      const previous = await readStatus(statusFile);
      const document = {
        schemaVersion: "grains-calendar-refresh.v1", ...status,
        lastSuccessfulAtUtc: status.status === "AVAILABLE" ? status.knownAtUtc : previous.lastSuccessfulAtUtc || null,
        lastSuccessfulVersion: status.status === "AVAILABLE" ? status.version : previous.lastSuccessfulVersion || null,
      };
      await atomicJson(statusFile, document);
      return document;
    },
  };
}

async function immutableFile(root, directory, hash, text, suffix) {
  const relative = path.join(directory, `${hash}${suffix}`);
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  try { await writeFile(filename, text, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (sha256(await readFile(filename)) !== hash) throw new Error("CALENDAR_ARCHIVE_HASH_CONFLICT");
  }
  return relative.replaceAll(path.sep, "/");
}

async function readStatus(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("CALENDAR_STATUS_READ_FAILED", { cause: error });
  }
}

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function documentContent({ text, bytes }) {
  if (bytes !== undefined) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
      throw new Error("CALENDAR_ARCHIVE_DOCUMENT_INVALID");
    return Buffer.from(bytes);
  }
  if (typeof text !== "string" || !text.length)
    throw new Error("CALENDAR_ARCHIVE_DOCUMENT_INVALID");
  return Buffer.from(text);
}

function archiveSuffix(source, bytes) {
  const suffix = source?.archiveSuffix || (bytes !== undefined ? ".bin" : ".txt");
  if (!/^\.[a-z0-9]{2,8}$/.test(suffix))
    throw new Error("CALENDAR_ARCHIVE_SUFFIX_INVALID");
  return suffix;
}
