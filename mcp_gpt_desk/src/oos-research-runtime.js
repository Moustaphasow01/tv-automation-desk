import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ForensicResearchObserver, ResearchCycle, ResearchHypotheses, ResearchDiscovery, ResearchApi, PostgresResearchMemory } from "@tv-automation/desk-oos-research";
import { OosResearchModel } from "./oos-research-model.js";
import { discoverResearchModels } from "./oos-research-capabilities.js";

const fingerprint = value => createHash("sha256").update(String(value)).digest("hex");

/** Composition receives a READ-ONLY forensic function, not the full OOS runtime. */
export function createOosResearch({ pool, readForensic, model, readVisual, clock = () => new Date().toISOString() }) {
  const memory = new PostgresResearchMemory({ pool, clock });
  const observer = new ForensicResearchObserver({ readForensic, fingerprint });
  const cycle = new ResearchCycle({ observer, memory, model, readVisual, fingerprint, clock });
  const hypotheses = new ResearchHypotheses({ cycle, memory, model, fingerprint, clock });
  const discovery = new ResearchDiscovery({ cycle, hypotheses, memory, model, fingerprint });
  return new ResearchApi({ cycle, hypotheses, discovery, memory });
}

export function configuredResearchModel(config) {
  if (!config?.codex_bin) return null;
  let cache;
  return new OosResearchModel({ codexOptions: { codexBin: config.codex_bin, timeoutMs: config.timeout_ms ?? 780000 },
    capabilityReader: async () => {
      if (!config.capabilities_file) {
        if (!cache || Date.now() - cache.at > 60000) cache = { at: Date.now(), models: await discoverResearchModels({
          codex_bin: config.codex_bin, timeout_ms: config.discovery_timeout_ms ?? 60000, priority: config.model_priority }) };
        return cache.models;
      }
      return readVerifiedCapabilities(config.capabilities_file);
    } });
}

async function readVerifiedCapabilities(file) {
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  if (!snapshot.verified_at || !snapshot.models?.every(m => m.capability_source && m.verified_by)) {
    throw Object.assign(new Error("RESEARCH_MODEL_CAPABILITY_PROOF_REQUIRED"), { code: "RESEARCH_MODEL_CAPABILITY_PROOF_REQUIRED" });
  }
  const verifiedAt = Date.parse(snapshot.verified_at), age = Date.now() - verifiedAt;
  if (!Number.isFinite(verifiedAt) || age < 0 || age > 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error("RESEARCH_MODEL_CAPABILITIES_STALE"), { code: "RESEARCH_MODEL_CAPABILITIES_STALE" });
  }
  return snapshot.models;
}
