import { canonicalSha256 } from "@tv-automation/desk-domain";
import {
  dataDrivenAnchorForFamily,
  dataDrivenParameterCombination,
  getDataDrivenStrategyFamilies,
} from "./data-driven-strategy-family-catalog.js";

const VERSION = "data_driven_mega_research_batch_v1";
const DEFAULT_SETUPS_PER_VARIANT = 5;

export function buildDataDrivenMegaResearchPlan({ scope = {}, dataset = {}, tradingDays = [], count = 1_000 } = {}) {
  const familySpecs = getDataDrivenStrategyFamilies(scope.family_set);
  const perFamily = Math.ceil(count / familySpecs.length);
  const variants = [];
  for (const [familyIndex, familySpec] of familySpecs.entries()) {
    for (let familyVariantIndex = 0; familyVariantIndex < perFamily && variants.length < count; familyVariantIndex += 1) {
      const parameters = parameterCombination(familyIndex, familyVariantIndex);
      const dailySetups = buildDailySetups({ familySpec, parameters, tradingDays, scope, familyVariantIndex });
      if (dailySetups.length === 0) continue;
      variants.push({
        family_id: familySpec.family_id,
        family_label: familySpec.label,
        family_index: familyIndex + 1,
        variant_index: familyVariantIndex + 1,
        global_index: variants.length + 1,
        direction: familySpec.direction,
        anchor_kind: familySpec.anchor_kind,
        parameters,
        runtime_setups: dailySetups,
        candidate_key: variantCandidateKey(scope, familySpec, familyVariantIndex + 1),
        strategy_external_key: `data-driven.${text(scope.instrument, "MNQ").toLowerCase()}.${familySpec.family_id}`,
        version_label: versionLabel({ familyIndex, familyVariantIndex, scope, familySpec, parameters, dataset }),
        primary_change_summary: `${familySpec.label}: ${dailySetups.length} setups journaliers, ancre ${familySpec.anchor_kind}, tolérance ${parameters.tolerance_points} pts, risk ${parameters.risk_points} pts, RR ${parameters.target_rr}.`,
      });
    }
  }
  return variants.slice(0, count);
}

export async function processVariantsWithConcurrency(variants, maxConcurrency, processVariant) {
  const items = Array.isArray(variants) ? variants : [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, maxConcurrency), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const variant = items[nextIndex];
      nextIndex += 1;
      await processVariant(variant);
    }
  }));
}

function parameterCombination(familyIndex, index) {
  return dataDrivenParameterCombination(familyIndex, index);
}

function buildDailySetups({ familySpec, parameters, tradingDays, scope, familyVariantIndex }) {
  return selectTradingDaysForVariant(tradingDays, familyVariantIndex, scope.setups_per_variant || DEFAULT_SETUPS_PER_VARIANT).flatMap(({ day, dayIndex }) => {
    const anchor = anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
    if (!anchor) return [];
    const level = roundPrice(anchor.level + parameters.break_offset_points);
    const retest = roundPrice(anchor.retest ?? level);
    const direction = familySpec.direction;
    const tolerance = parameters.tolerance_points;
    const entry = entryZone({ direction, retest, tolerance, orderType: parameters.order_type });
    const entryReference = direction === "long" ? entry.upper : entry.lower;
    const stop = direction === "long"
      ? roundPrice(entryReference - parameters.risk_points)
      : roundPrice(entryReference + parameters.risk_points);
    const risk = Math.max(0.25, Math.abs(entryReference - stop));
    const target = direction === "long"
      ? roundPrice(entryReference + risk * parameters.target_rr)
      : roundPrice(entryReference - risk * parameters.target_rr);
    const invalidation = direction === "long"
      ? roundPrice(Math.min(day.low, stop) - Math.max(4, tolerance))
      : roundPrice(Math.max(day.high, stop) + Math.max(4, tolerance));
    return [{
      setup_id: setupId({ familySpec, familyVariantIndex, dayIndex, day }),
      template_id: templateId(familySpec),
      instrument: text(scope.instrument, "MNQ"),
      direction,
      rank: dayIndex + 1,
      trading_date: day.trading_date,
      valid_from_paris: day.first_time,
      expires_at_paris: day.last_time,
      break_level: level,
      retest_level: retest,
      entry_zone: entry,
      stop_loss: stop,
      take_profit_1: target,
      invalidation_level: invalidation,
      tolerance_points: tolerance,
      max_bars: parameters.max_bars,
      order_type: parameters.order_type,
      require_rejection_confirmation: parameters.require_rejection_confirmation,
      rr_minimum: Math.min(2, parameters.target_rr),
      metadata: {
        source: VERSION,
        family_id: familySpec.family_id,
        anchor_kind: familySpec.anchor_kind,
        anchor_source: anchor.source,
      },
    }];
  });
}

function selectTradingDaysForVariant(tradingDays, familyVariantIndex, maxSetups) {
  const days = Array.isArray(tradingDays) ? tradingDays : [];
  if (days.length <= maxSetups) return days.map((day, dayIndex) => ({ day, dayIndex }));
  const selected = [];
  const used = new Set();
  const stride = Math.max(1, Math.floor(days.length / maxSetups));
  const offset = Math.abs(Number(familyVariantIndex) || 0) % days.length;
  for (let slot = 0; slot < maxSetups; slot += 1) {
    let dayIndex = (offset + slot * stride) % days.length;
    while (used.has(dayIndex)) dayIndex = (dayIndex + 1) % days.length;
    used.add(dayIndex);
    selected.push({ day: days[dayIndex], dayIndex });
  }
  return selected.sort((left, right) => left.dayIndex - right.dayIndex);
}

function anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex }) {
  return dataDrivenAnchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
}

function entryZone({ direction, retest, tolerance, orderType }) {
  const half = orderType === "MARKET" ? Math.max(0.25, tolerance / 4) : Math.max(0.25, tolerance);
  if (direction === "long") {
    return { lower: roundPrice(retest - half), upper: roundPrice(retest + Math.max(0.25, half / 2)) };
  }
  return { lower: roundPrice(retest - Math.max(0.25, half / 2)), upper: roundPrice(retest + half) };
}

function templateId(familySpec) {
  return `${familySpec.family_id}_${familySpec.direction}`;
}

function setupId({ familySpec, familyVariantIndex, dayIndex, day }) {
  return [
    "mega",
    familySpec.family_id,
    `v${String(familyVariantIndex + 1).padStart(3, "0")}`,
    day.trading_date.replaceAll("-", ""),
    `d${String(dayIndex + 1).padStart(3, "0")}`,
  ].join("_");
}

function variantCandidateKey(scope, familySpec, variantIndex) {
  return safeKey(`mega:${scope.batch_id}:${familySpec.family_id}:v${String(variantIndex).padStart(3, "0")}`);
}
function versionLabel({ familyIndex, familyVariantIndex, scope, familySpec, parameters, dataset }) {
  return [`1.${familyIndex + 1}.${familyVariantIndex + 1}`, canonicalSha256({ scope, family_id: familySpec.family_id, parameters, dataset_key: dataset.dataset_key }).slice(0, 12)].join("+");
}
function safeKey(value) {
  const normalized = String(value || "key").toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
  const bounded = normalized.slice(0, 180).replace(/[^a-z0-9]+$/, "");
  return bounded || "key";
}
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
