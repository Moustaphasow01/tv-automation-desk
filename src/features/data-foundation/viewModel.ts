import type {
  DataFoundationDataset,
  DataFoundationEnvelope,
  DataFoundationFeature,
  DataFoundationHotSeriesWindow,
  DataFoundationMarketProfile,
  DataFoundationStorageObject,
} from "@/operationsTypes";

export type DataFoundationTone = "neutral" | "positive" | "warning" | "critical" | "info";

export interface DataFoundationMetric {
  label: string;
  value: string | number;
  detail?: string;
  tone?: DataFoundationTone;
}

export interface DataFoundationViewModel {
  generatedAt: string;
  directTableAccess: boolean;
  sourceLabel: string;
  metrics: DataFoundationMetric[];
  datasetRows: Array<{ key: string; label: string; status: string; cutoff: string; batches: number; lineage: string; hash: string }>;
  featureRows: Array<{ key: string; label: string; category: string; output: string; version: string; lineage: string; status: string }>;
  coverageRows: Array<{ key: string; label: string; state: string; tone: DataFoundationTone; missing: string; recommendation: string; rows: number; storage: string }>;
  storageRows: Array<{ key: string; label: string; tier: string; format: string; status: string; size: string; retention: string; uri: string }>;
  hotRows: Array<{ key: string; label: string; status: string; table: string; latest: string; rows: number; backingObject: string }>;
  warnings: string[];
}

export function buildDataFoundationViewModel(input: {
  overview?: DataFoundationEnvelope | null;
  datasets?: DataFoundationEnvelope<DataFoundationDataset> | null;
  features?: DataFoundationEnvelope<DataFoundationFeature> | null;
  marketProfiles?: DataFoundationEnvelope<DataFoundationMarketProfile> | null;
  storageObjects?: DataFoundationEnvelope<DataFoundationStorageObject> | null;
  hotSeriesWindows?: DataFoundationEnvelope<DataFoundationHotSeriesWindow> | null;
}): DataFoundationViewModel {
  const counts = input.overview?.counts || {};
  const datasets = input.datasets?.items || [];
  const features = input.features?.items || [];
  const profiles = input.marketProfiles?.items || [];
  const storageObjects = input.storageObjects?.items || [];
  const hotSeriesWindows = input.hotSeriesWindows?.items || [];
  const blockingProfiles = profiles.filter((profile) => profile.blocking_classification === "BLOCKING");
  const degradedProfiles = profiles.filter((profile) => profile.status === "PARTIAL" || profile.status === "MISSING");
  const readyDatasets = datasets.filter((dataset) => dataset.status === "READY").length || number(counts.ready_datasets);
  const publishedFeatures = features.filter((feature) => feature.published_version?.status === "PUBLISHED").length || number(counts.published_feature_versions);
  return {
    generatedAt: formatDateTime(input.overview?.generated_at_utc || input.datasets?.generated_at_utc || input.features?.generated_at_utc),
    directTableAccess: input.overview?.source?.direct_table_access === true,
    sourceLabel: `${String(input.overview?.source?.canonical || "data_foundation_v1")} · ${String(input.overview?.source?.storage || "postgres").toUpperCase()}`,
    metrics: [
      { label: "Datasets prêts", value: readyDatasets, detail: `${datasets.length || number(counts.datasets)} visibles`, tone: readyDatasets ? "positive" : "warning" },
      { label: "Features publiées", value: publishedFeatures, detail: `${features.length || number(counts.feature_definitions)} définitions`, tone: publishedFeatures ? "positive" : "warning" },
      { label: "Couverture bloquante", value: blockingProfiles.length, detail: `${degradedProfiles.length} dégradées`, tone: blockingProfiles.length ? "critical" : degradedProfiles.length ? "warning" : "positive" },
      { label: "Objets froids", value: storageObjects.length || number(counts.market_data_storage_objects), detail: "Parquet / archive", tone: storageObjects.length ? "info" : "neutral" },
      { label: "Fenêtres chaudes", value: hotSeriesWindows.length || number(counts.market_data_hot_series_windows), detail: "PostgreSQL", tone: hotSeriesWindows.length ? "positive" : "neutral" },
      { label: "Accès direct table", value: input.overview?.source?.direct_table_access ? "Oui" : "Non", detail: "front contrôlé", tone: input.overview?.source?.direct_table_access ? "critical" : "positive" },
    ],
    datasetRows: datasets.map((dataset) => ({
      key: dataset.dataset_key,
      label: readableKey(dataset.dataset_key),
      status: dataset.status,
      cutoff: formatDateTime(dataset.cutoff_paris || dataset.cutoff_utc),
      batches: dataset.source_batch_count || 0,
      lineage: datasetLineage(input.datasets?.lineage || [], dataset.dataset_key),
      hash: shortHash(dataset.provenance_hash || dataset.content_hash),
    })),
    featureRows: features.map((feature) => ({
      key: feature.feature_key,
      label: featureLabel(feature.feature_key, feature.name),
      category: categoryLabel(feature.category),
      output: outputKindLabel(feature.output_kind),
      version: feature.published_version?.version || "—",
      lineage: featureLineage(feature),
      status: feature.published_version?.status || feature.status,
    })),
    coverageRows: profiles.map((profile) => ({
      key: profile.source_key,
      label: `${instrumentLabel(profile.instrument_code)} · ${timeframeLabel(profile.timeframe)}`,
      state: coverageStateLabel(profile),
      tone: coverageTone(profile),
      missing: capabilityList(profile.missing_capabilities),
      recommendation: profile.recommendation || storageLabel(profile.storage_recommendation),
      rows: profile.observed_row_count || 0,
      storage: storageLabel(profile.storage_recommendation),
    })),
    storageRows: storageObjects.map((object) => ({
      key: object.object_key,
      label: `${instrumentLabel(object.instrument_code)} · ${timeframeLabel(object.timeframe)}`,
      tier: storageLabel(object.storage_tier),
      format: object.storage_format,
      status: object.status,
      size: formatBytes(object.byte_size),
      retention: object.retention_days ? `${object.retention_days} j` : "—",
      uri: object.uri,
    })),
    hotRows: hotSeriesWindows.map((window) => ({
      key: window.hot_series_window_id,
      label: `${instrumentLabel(window.instrument_code)} · ${timeframeLabel(window.timeframe)}`,
      status: window.status,
      table: window.hot_table,
      latest: formatDateTime(window.latest_timestamp_utc),
      rows: window.row_count || 0,
      backingObject: window.object_key ? readableObjectKey(window.object_key) : "Projection chaude sans objet froid lié",
    })),
    warnings: [
      ...(input.overview?.source?.direct_table_access ? ["Le front lit un endpoint qui annonce un accès direct table : à corriger."] : []),
      ...(blockingProfiles.length ? [`${blockingProfiles.length} source(s) market data bloquante(s).`] : []),
      ...(!features.length ? ["Aucune feature publiée visible depuis l’API Data Foundation."] : []),
    ],
  };
}

function datasetLineage(lineage: DataFoundationEnvelope["lineage"] = [], datasetKey: string) {
  const rows = (lineage || []).filter((item) => item.dataset_key === datasetKey);
  if (!rows.length) return "Lineage non matérialisé";
  return rows.map((item) => `${readableKey(item.source_key || item.batch_key)} (${item.role})`).join(", ");
}

function featureLineage(feature: DataFoundationFeature) {
  const metadata = feature.published_version?.metadata || feature.metadata || {};
  const datasets = Array.isArray(metadata.required_datasets) ? metadata.required_datasets : [];
  const cutoff = typeof metadata.cutoff_policy === "string" ? metadata.cutoff_policy : "cutoff requis";
  return `${datasets.map(readableKey).join(", ") || "datasets à préciser"} · ${readableKey(cutoff)}`;
}

function coverageStateLabel(profile: DataFoundationMarketProfile) {
  if (profile.blocking_classification === "BLOCKING") return "Bloquant";
  if (profile.status === "PARTIAL") return "Dégradé";
  if (profile.status === "MISSING") return "Absent non bloquant";
  return "Nominal";
}

function coverageTone(profile: DataFoundationMarketProfile): DataFoundationTone {
  if (profile.blocking_classification === "BLOCKING") return "critical";
  if (profile.status === "PARTIAL" || profile.status === "MISSING") return "warning";
  return "positive";
}

function readableKey(value?: string | null) {
  return String(value || "—")
    .replace(/^prod__tradingview__/, "")
    .replace(/__/g, " · ")
    .replace(/_/g, " ")
    .replace(/\./g, " ")
    .replace(/-/g, (match, offset, text) => (isDigit(text[offset - 1]) && isDigit(text[offset + 1]) ? match : " "))
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function featureLabel(key: string, fallback?: string) {
  const known: Record<string, string> = {
    wilder_atr_14: "ATR Wilder 14",
    session_vwap: "VWAP de session",
    volume_profile_poc: "POC volume",
    volume_profile_vah: "VAH volume",
    volume_profile_val: "VAL volume",
    initial_balance_range: "Initial Balance",
    overnight_high_low: "High/Low overnight",
    intermarket_mnq_mes_spread: "Spread MNQ/MES",
    cross_asset_risk_state: "Régime cross-asset",
    macro_event_blackout_window: "Blackout macro",
  };
  return known[key] || fallback || readableKey(key);
}

function categoryLabel(value: string) {
  const known: Record<string, string> = {
    volatility: "Volatilité",
    price: "Prix",
    volume_profile: "Volume profile",
    session_structure: "Structure session",
    intermarket: "Intermarket",
    cross_asset: "Cross-asset",
    macro: "Macro",
  };
  return known[value] || readableKey(value);
}

function outputKindLabel(value: string) {
  return ({ SERIES: "Série", SCALAR: "Valeur", MAP: "Carte", EVENT: "Événement" } as Record<string, string>)[value] || value;
}

function instrumentLabel(value: string) {
  return String(value || "Instrument inconnu").replace("!", "");
}

function timeframeLabel(value: string) {
  const normalized = String(value || "");
  if (normalized === "1") return "M1";
  if (normalized === "5") return "M5";
  if (normalized === "15") return "M15";
  if (normalized === "240") return "H4";
  return normalized.toUpperCase();
}

function storageLabel(value?: string | null) {
  const known: Record<string, string> = {
    HOT_SERIES: "Série chaude",
    COLD_PARQUET: "Parquet froid",
    RAW_ARCHIVE: "Archive brute",
    HOT_AND_COLD: "Chaud + froid",
    IGNORE: "Ignoré",
  };
  return known[String(value || "")] || readableKey(value);
}

function capabilityList(values?: string[]) {
  if (!values?.length) return "Aucun manque";
  return values.map(readableKey).join(", ");
}

function readableObjectKey(value: string) {
  const parts = String(value).split("/");
  return parts.slice(0, 3).map(readableKey).join(" · ");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value?: number | null) {
  const bytes = number(value);
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function shortHash(value?: string | null) {
  if (!value) return "—";
  return `${value.slice(0, 14)}…`;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDigit(value?: string) {
  return Boolean(value && value >= "0" && value <= "9");
}
