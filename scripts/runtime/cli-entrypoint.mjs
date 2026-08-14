import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function isCliEntrypoint(importMetaUrl, argv = process.argv) {
  const invokedPath = argv[1];
  if (!invokedPath) return false;

  try {
    return samePath(fileURLToPath(importMetaUrl), invokedPath);
  } catch {
    return importMetaUrl === pathToFileURL(path.resolve(invokedPath)).href;
  }
}

function samePath(left, right) {
  const normalizedLeft = canonicalPath(left);
  const normalizedRight = canonicalPath(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
