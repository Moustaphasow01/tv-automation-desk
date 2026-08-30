import { createHash } from "node:crypto";

export const US_GRAINS_STRATEGY_CATALOG_VERSION = "us_grains_strategy_catalog_v1";
export const US_GRAINS_RUNTIME_CONTRACT_BUNDLE_VERSION = "us_grains_runtime_contract_v1";
export const US_GRAINS_STRATEGY_VERSION_LABEL = "1.0.0";
export const US_GRAINS_SESSION_SCOPE = Object.freeze(["cbot_grains_rth"]);
export const US_GRAINS_INSTRUMENTS = Object.freeze(["ZW", "ZC"]);

export const US_GRAINS_STRATEGY_FAMILY_CATALOG = Object.freeze({
  VWAP_PULLBACK: Object.freeze({
    external_key: "us-grains.vwap-pullback.v1",
    name: "US Grains VWAP Pullback",
    description: "RTH pullback continuation around VWAP, certified by grains context.",
    preferred_contexts: ["TRENDING", "NORMAL_VOLATILITY"],
  }),
  OPENING_RANGE_BREAKOUT_RETEST: Object.freeze({
    external_key: "us-grains.opening-range-breakout-retest.v1",
    name: "US Grains Opening Range Breakout Retest",
    description: "Opening range continuation after breakout and retest during CBOT RTH.",
    preferred_contexts: ["TRENDING", "EXPANSION"],
  }),
  PRIOR_DAY_RECLAIM: Object.freeze({
    external_key: "us-grains.prior-day-reclaim.v1",
    name: "US Grains Prior Day Level Reclaim",
    description: "Reclaim of prior-day levels when current context supports continuation.",
    preferred_contexts: ["REVERSAL", "TREND_RESUMPTION"],
  }),
  PRIOR_DAY_REJECTION: Object.freeze({
    external_key: "us-grains.prior-day-rejection.v1",
    name: "US Grains Prior Day Level Rejection",
    description: "Rejection around prior-day levels when context supports fading the level.",
    preferred_contexts: ["RANGE", "REVERSAL"],
  }),
});

export function usGrainsStrategyFamilies() {
  return Object.keys(US_GRAINS_STRATEGY_FAMILY_CATALOG);
}

export function grainStrategyIdentity(family, instrument = null) {
  const key = requireFamily(family);
  return {
    strategy_definition_id: stableUuid(`strategy_definition:${familyKey(key)}`),
    strategy_version_id: stableUuid(`strategy_version:${familyKey(key)}:${US_GRAINS_STRATEGY_VERSION_LABEL}`),
    strategy_instance_id: instrument
      ? stableUuid(`strategy_instance:${familyKey(key)}:${String(instrument).toUpperCase()}:shadow`)
      : null,
  };
}

export function buildUsGrainsStrategyRegistryRecords(nowIso = new Date().toISOString()) {
  const definitions = [];
  const versions = [];
  const instances = [];
  for (const family of usGrainsStrategyFamilies()) {
    const catalog = US_GRAINS_STRATEGY_FAMILY_CATALOG[family];
    const ids = grainStrategyIdentity(family);
    const dslSource = dslSourceForFamily(family);
    const artifact = compiledArtifactForFamily(family);
    definitions.push({
      strategy_definition_id: ids.strategy_definition_id,
      external_key: catalog.external_key,
      name: catalog.name,
      description: catalog.description,
      owner: "desk-research",
      asset_class: "AGRICULTURE",
      default_instruments: [...US_GRAINS_INSTRUMENTS],
      tags: ["us-grains", "cbot", family.toLowerCase()],
      metadata: {
        catalog_version: US_GRAINS_STRATEGY_CATALOG_VERSION,
        family,
        preferred_contexts: catalog.preferred_contexts,
        execution_policy: "SEMI_MANUAL_SHADOW_ONLY",
      },
      created_at: nowIso,
      updated_at: nowIso,
    });
    versions.push({
      strategy_version_id: ids.strategy_version_id,
      strategy_definition_id: ids.strategy_definition_id,
      version_label: US_GRAINS_STRATEGY_VERSION_LABEL,
      status: "validated",
      dsl_source_hash: sha256Text(dslSource),
      compiled_artifact_ref: `mcp_gpt_desk/src/us-grains-strategy-suite.js#${family}`,
      compiled_artifact_hash: sha256Json(artifact),
      validated_metrics_ref: null,
      runtime_contract_bundle_version: US_GRAINS_RUNTIME_CONTRACT_BUNDLE_VERSION,
      metadata: {
        catalog_version: US_GRAINS_STRATEGY_CATALOG_VERSION,
        runtime_owner: "US_GRAINS_DETERMINISTIC_SUITE",
        suite_version: "us_grains_strategy_suite_v1",
        family,
        validation_scope: "LOCAL_REPLAY_ONLY",
      },
      created_at: nowIso,
      updated_at: nowIso,
      published_at: null,
      deprecated_at: null,
    });
    for (const instrument of US_GRAINS_INSTRUMENTS) {
      const instanceIds = grainStrategyIdentity(family, instrument);
      instances.push({
        strategy_instance_id: instanceIds.strategy_instance_id,
        strategy_version_id: ids.strategy_version_id,
        runtime_state: "created",
        execution_mode: "shadow",
        account_scope: null,
        instrument_scope: [instrument],
        session_scope: [...US_GRAINS_SESSION_SCOPE],
        risk_budget_ref: null,
        triple_lock_validated: false,
        last_heartbeat_at: null,
        started_at: null,
        stopped_at: null,
        failed_at: null,
        metadata: {
          catalog_version: US_GRAINS_STRATEGY_CATALOG_VERSION,
          runtime_owner: "US_GRAINS_DETERMINISTIC_SUITE",
          family,
          instrument,
          live_runtime_hooked: false,
          physical_broker_execution: "OFF",
        },
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
  }
  return { definitions, versions, instances };
}

function dslSourceForFamily(family) {
  return JSON.stringify({
    schema_version: "us_grains_strategy_family_dsl_v1",
    family,
    market_universe: "US_GRAINS_CBOT",
    session: "cbot_grains_rth",
    timeframe: "M5",
    execution_timeframe: "M1",
    order_type: "LIMIT",
    context_gate_required: true,
  });
}

function compiledArtifactForFamily(family) {
  return {
    schema_version: "us_grains_compiled_strategy_artifact_v1",
    family,
    module: "mcp_gpt_desk/src/us-grains-strategy-suite.js",
    entrypoint: "replayUsGrainsStrategySuiteV1",
    deterministic: true,
    broker_execution: false,
  };
}

function requireFamily(family) {
  const key = String(family || "").toUpperCase();
  if (!US_GRAINS_STRATEGY_FAMILY_CATALOG[key]) {
    throw new Error(`Unknown US grains strategy family: ${family}`);
  }
  return key;
}

function familyKey(family) {
  return `us-grains:${String(family).toLowerCase().replaceAll("_", "-")}:v1`;
}

function stableUuid(value) {
  const hash = hashHex(String(value));
  const variant = ((Number.parseInt(hash[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function sha256Text(value) {
  return `sha256:${hashHex(String(value ?? ""))}`;
}

function sha256Json(value) {
  return sha256Text(stableJson(value));
}

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
