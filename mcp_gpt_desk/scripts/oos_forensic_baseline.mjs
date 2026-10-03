import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(root, relative = "") {
  const files = [];
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name), target = path.join(root, name);
    if ((await lstat(target)).isSymbolicLink()) throw new Error("BASELINE_SYMLINK_FORBIDDEN");
    if (item.isDirectory()) files.push(...await inventory(root, name));
    else files.push({ path: name.replaceAll("\\", "/"), sha256: sha(await readFile(target)) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function forensicBusinessBaseline({ pool, config }) {
  const tables = {};
  for (const name of ["oos_batch_days", "oos_batch_events", "oos_batch_commands", "oos_replay_progress",
    "oos_premarket_batches", "oos_premarket_batch_days", "oos_premarket_capture_repairs"]) {
    const { rows } = await pool.query(`SELECT row_to_json(t) AS data FROM ${name} t`);
    tables[name] = rows.map(r => JSON.stringify(r.data)).sort();
  }
  const files = await inventory(path.join(config.archive_root, config.batch_id));
  return { business_sha256: sha(JSON.stringify(tables)), archive_sha256: sha(JSON.stringify(files)),
    file_count: files.length, tables, files };
}
