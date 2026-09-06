import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { importGrainsCalendarEvidence } from "../src/adapters/grains-calendar-evidence-import.js";

export async function runCalendarEvidenceImport(argv = process.argv.slice(2)) {
  const args = argumentsByName(argv);
  const manifestPath = resolve(required(args.manifest, "manifest"));
  const output = resolve(required(args.output, "output"));
  const retrievedAtUtc = required(args["retrieved-at"], "retrieved-at");
  const documentRoot = args["document-dir"] ? resolve(args["document-dir"]) : dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const calendarVersion = await importGrainsCalendarEvidence({
    manifest, retrievedAtUtc,
    readDocument: (name) => readFile(documentPath(documentRoot, name)),
  });
  const replay = await augmentedReplayInput(args, calendarVersion);
  const paths = [output, replay?.path].filter(Boolean);
  if (new Set(paths).size !== paths.length || paths.includes(manifestPath))
    throw new Error("CALENDAR_OUTPUT_PATH_COLLISION");
  for (const path of paths) await requireNewFile(path);
  const artifact = {
    schema_version: "grains_calendar_evidence_import_v1", manifest: manifestPath,
    retrieved_at_utc: retrievedAtUtc, calendarVersion,
    replay_input: replay ? { path: replay.path, original_input_sha256: replay.originalHash } : null,
  };
  await saveNewJson(output, artifact);
  if (replay) await saveNewJson(replay.path, replay.value);
  return artifact;
}

async function augmentedReplayInput(args, version) {
  if (!args["base-input"] && !args["replay-input"]) return null;
  const input = resolve(required(args["base-input"], "base-input"));
  const path = resolve(required(args["replay-input"], "replay-input"));
  if (path === input) throw new Error("FROZEN_INPUT_OVERWRITE_FORBIDDEN");
  const text = await readFile(input, "utf8");
  const value = JSON.parse(text);
  const frozen = value.ledgerFrozen || value.ledger_frozen || value;
  if (!Array.isArray(frozen.candles)) throw new Error("FROZEN_CANDLES_REQUIRED");
  const existing = ["agriCalendarVersions", "agri_calendar_versions", "calendarVersions", "calendar_versions",
    "agriCalendarVersion", "agri_calendar_version", "calendarVersion", "calendar_version"];
  if (existing.some((key) => Array.isArray(frozen[key]) ? frozen[key].length > 0 : Boolean(frozen[key])))
    throw new Error("REPLAY_CALENDAR_ALREADY_PRESENT_REVIEW_REQUIRED");
  frozen.agriCalendarVersions = [version];
  return { path, value, originalHash: createHash("sha256").update(text).digest("hex") };
}

function documentPath(base, name) {
  const path = resolve(base, required(name, "documentFile"));
  const child = relative(base, path);
  if (child.startsWith("..") || /^[A-Za-z]:/.test(child))
    throw new Error("CALENDAR_DOCUMENT_OUTSIDE_MANIFEST_DIRECTORY");
  return path;
}
async function requireNewFile(path) {
  try { await access(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`CALENDAR_OUTPUT_ALREADY_EXISTS:${path}`);
}
async function saveNewJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
function argumentsByName(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error("CALENDAR_ARGUMENT_INVALID");
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}
function required(value, name) { if (!value) throw new Error(`CALENDAR_ARGUMENT_REQUIRED:${name}`); return value; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCalendarEvidenceImport();
  console.log(JSON.stringify({ status: result.calendarVersion.status,
    knownAtUtc: result.calendarVersion.knownAtUtc, events: result.calendarVersion.events.length,
    reasonCodes: result.calendarVersion.reasonCodes }));
}
