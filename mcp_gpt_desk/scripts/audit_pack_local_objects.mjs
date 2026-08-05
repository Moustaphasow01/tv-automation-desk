#!/usr/bin/env node
import process from "node:process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { createDeskStoreFromEnv } from "../src/store.js";

const packId = String(process.argv[2] || "").trim();
const packBuildId = String(process.argv[3] || "").trim();
if (!packId || !packBuildId) {
  console.error("Usage: node audit_pack_local_objects.mjs <pack_id> <pack_build_id>");
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const result = await store.getDeskPack({
      pack_id: packId,
      pack_build_id: packBuildId,
      mode: "replay",
      include_draft: true,
    });
    const refs = collectObjectRefs(result);
    const objects = [];
    for (const ref of refs) {
      const catalog = await store.persistence.getPackObject(ref.storage_path, ref.generation);
      const localPath = catalog?.local_relative_path
        ? resolve(store.persistence.objectRoot, catalog.local_relative_path)
        : null;
      let present = false;
      if (localPath) {
        try {
          await access(localPath);
          present = true;
        } catch {
          present = false;
        }
      }
      objects.push({
        dataset_id: ref.dataset_id,
        storage_path: ref.storage_path,
        generation: ref.generation,
        content_sha256: catalog?.content_sha256 || null,
        local_relative_path: catalog?.local_relative_path || null,
        catalog_status: catalog?.status || "NOT_CATALOGUED",
        present,
      });
    }
    console.log(JSON.stringify({
      pack_id: packId,
      pack_build_id: packBuildId,
      object_count: objects.length,
      missing_count: objects.filter((item) => !item.present).length,
      objects,
    }, null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

function collectObjectRefs(value) {
  const refs = [];
  const seen = new Set();
  visit(value, null);
  return refs;

  function visit(node, datasetId) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, datasetId);
      return;
    }
    const nextDatasetId = node.dataset_id || node.dataset || datasetId;
    const storagePath = node.storage_path || node.object_path;
    if (storagePath) {
      const generation = node.gcs_generation ?? node.generation ?? null;
      const key = `${storagePath}\n${generation ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          dataset_id: nextDatasetId || null,
          storage_path: String(storagePath),
          generation: generation === null ? null : String(generation),
        });
      }
    }
    for (const child of Object.values(node)) visit(child, nextDatasetId);
  }
}
