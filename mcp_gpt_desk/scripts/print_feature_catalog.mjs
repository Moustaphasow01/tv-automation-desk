#!/usr/bin/env node
import {
  buildPointInTimeFeatureCatalog,
  validatePointInTimeFeatureCatalog,
} from "../src/point-in-time-feature-catalog.js";

const summaryOnly = process.argv.includes("--summary") || process.env.DESK_FEATURE_CATALOG_SUMMARY_ONLY === "1";
const catalog = buildPointInTimeFeatureCatalog();
const validation = validatePointInTimeFeatureCatalog(catalog.features);

const payload = summaryOnly
  ? {
      schema_version: catalog.schema_version,
      version: catalog.version,
      feature_count: catalog.feature_count,
      validation,
      summary: catalog.summary,
      feature_keys: catalog.features.map((feature) => feature.feature_key),
    }
  : { ...catalog, validation };

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
if (!validation.ok) process.exitCode = 2;
