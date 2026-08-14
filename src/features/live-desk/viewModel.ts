import { dataQualityLabel, sessionLabel } from "@/lib/presentation";
import type { ExecutionOverview } from "@/executionTypes";
import type { DeskSession } from "@/types";

export type LiveDeskMetricTone = "neutral" | "positive" | "negative" | "warning";
export type LiveProcessStageState = "waiting" | "done" | "active" | DeskSession["claim"]["nextTaskStatus"];

export interface LiveBrokerGuardCardViewModel {
  label: string;
  value: string;
  detail: string;
  tone: LiveDeskMetricTone;
}

export interface LiveBrokerGuardViewModel {
  available: boolean;
  headline: string;
  summary: string;
  tone: LiveDeskMetricTone;
  cards: LiveBrokerGuardCardViewModel[];
  alerts: string[];
}

export interface LiveDeskScreenViewModel {
  heading: {
    eyebrow: string;
    title: string;
    subtitle: string;
  };
  source: {
    label: string;
    detail: string;
  };
  sync: {
    title: string;
    detail: string;
  };
  metrics: {
    riskSetup: string;
    unrealizedR: string;
    unrealizedRTone: LiveDeskMetricTone;
    lastClaimAt: string;
    lastClaimDetail: string;
    nextTaskStatusLabel: string;
    nextTaskDetail: string;
    nextTaskTone: LiveDeskMetricTone;
    followingCheckpoint: string;
    followingWorkflow: string;
    claimLatency: string;
    claimLatencyDetail: string;
    claimLatencyTone: LiveDeskMetricTone;
    nextMacro: string;
  };
  process: {
    label: string;
    title: string;
    stages: LiveProcessStageViewModel[];
  };
  brokerGuard: LiveBrokerGuardViewModel;
}

export interface LiveProcessStageViewModel {
  label: string;
  detail: string;
  state: LiveProcessStageState;
}

export function buildLiveDeskScreenViewModel(data: DeskSession, input: {
  phaseLabel: string;
  refreshing: boolean;
  dataUpdatedAt: number;
  executionOverview?: ExecutionOverview | null;
}): LiveDeskScreenViewModel {
  const upcomingMacro = data.macro.find(event => event.isNext);
  const brokerGuard = buildLiveBrokerGuard(data, input.executionOverview);
  return {
    heading: {
      eyebrow: `Session automatique · ${input.phaseLabel}`,
      title: "Live Desk",
      subtitle: `${sessionLabel(data.label)} · ${data.date} · ${sessionLabel(data.strategyId)}`,
    },
    source: {
      label: "SOURCE LIVE",
      detail: dataQualityLabel(data.dataQuality.status),
    },
    sync: {
      title: input.refreshing ? "Synchronisation…" : "Desk actif",
      detail: `mis à jour ${formatUpdatedAt(input.dataUpdatedAt)}`,
    },
    metrics: {
      riskSetup: data.setup.risk == null ? "—" : `${fmtLive(data.setup.risk)}%`,
      unrealizedR: data.position.unrealizedR == null ? "—" : `${data.position.unrealizedR.toFixed(2)} R`,
      unrealizedRTone: data.position.unrealizedR == null ? "neutral" : data.position.unrealizedR >= 0 ? "positive" : "negative",
      lastClaimAt: data.claim.lastClaimAt,
      lastClaimDetail: data.claim.workerId || "Aucun worker",
      nextTaskStatusLabel: data.claim.nextTaskStatusLabel,
      nextTaskDetail: `${data.claim.nextTaskLabel} · ${data.claim.dueCheckpoint || data.claim.nextTaskCheckpoint}`,
      nextTaskTone: taskStatusTone(data.claim.nextTaskStatus),
      followingCheckpoint: data.nextCheckpointAt || data.claim.followingTaskCheckpoint || data.nextMonitorAt,
      followingWorkflow: workflowLabel(data.claim.followingTaskWorkflow),
      claimLatency: claimLatencyLabel(data.claim.latencySeconds),
      claimLatencyDetail: `dû ${data.claim.readyAt} · bundle → claim ${claimLatencyLabel(data.claim.bundleClaimLatencySeconds)} · cible < ${Math.round((data.claim.latencyTargetSeconds || 120) / 60)} min`,
      claimLatencyTone: data.claim.latencyStatus === "late" ? "negative" : data.claim.latencyStatus === "on_target" ? "positive" : "neutral",
      nextMacro: upcomingMacro ? `${upcomingMacro.time} · ${upcomingMacro.title}` : "Aucun à venir",
    },
    process: {
      label: "Moteur M1 · GPT M15 + événements",
      title: "Gestion déterministe des prix sur chaque clôture M1 ; analyse stratégique GPT toutes les 15 minutes et sur événement critique.",
      stages: [
        { label: "Données", detail: data.lastDataAt || "—", state: data.lastDataAt === "—" ? "waiting" : "done" },
        { label: "Bundle", detail: data.claim.readyAt || "—", state: data.claim.readyAt === "—" ? "waiting" : "done" },
        { label: "Claim", detail: data.claim.lastClaimAt || "—", state: data.claim.nextTaskStatus === "in_progress" ? "active" : data.claim.lastClaimAt === "—" ? "waiting" : "done" },
        { label: data.claim.nextTaskLabel, detail: data.claim.dueCheckpoint || "—", state: input.refreshing ? "active" : data.claim.nextTaskStatus },
      ],
    },
    brokerGuard,
  };
}

export function buildLiveBrokerGuard(data: DeskSession, overview?: ExecutionOverview | null): LiveBrokerGuardViewModel {
  const cards = [
    marketFreshnessCard(data),
    brokerConnectionCard(overview),
    reconciliationCard(overview),
    protectionCard(overview),
    executionLockCard(overview),
  ];
  const tone = worstTone(cards.map(card => card.tone));
  const alerts = cards
    .filter(card => card.tone === "negative" || card.tone === "warning")
    .map(card => `${card.label}: ${card.value} — ${card.detail}`);
  return {
    available: Boolean(overview),
    tone,
    headline: brokerGuardHeadline(tone, overview),
    summary: overview
      ? `Projection broker réelle générée ${formatParisDateTime(overview.generatedAt)}. Réconciliation, protections et verrous viennent de PostgreSQL/NinjaTrader.`
      : "Projection broker non chargée : le Live Desk n’invente pas l’état NinjaTrader tant que /execution/overview n’a pas répondu.",
    cards,
    alerts,
  };
}

function marketFreshnessCard(data: DeskSession): LiveBrokerGuardCardViewModel {
  const executionSymbols = new Set(["MNQ", "MES", "NQ", "ES"]);
  const executionFeeds = data.market.filter(item => executionSymbols.has(String(item.symbol || "").toUpperCase()));
  const unavailable = executionFeeds.filter(item => {
    const status = String(item.availability || "").toLowerCase();
    return status && !["fresh", "ready", "available", "ok"].includes(status);
  });
  const executionReady = data.dataQuality.executionReady === true && unavailable.length === 0;
  const status = String(data.dataQuality.status || "").toLowerCase();
  const tone: LiveDeskMetricTone = executionReady
    ? "positive"
    : status === "degraded" || unavailable.length
      ? "negative"
      : data.dataQuality.contextLimited
        ? "warning"
        : "neutral";
  return {
    label: "Flux marché",
    value: executionReady ? "Frais" : status === "degraded" ? "Dégradé" : data.dataQuality.contextLimited ? "Contexte limité" : "À vérifier",
    detail: unavailable.length
      ? `${unavailable.map(item => item.symbol).join(", ")} non frais · dernier ${data.lastDataAt || "—"}`
      : `${executionFeeds.length || data.market.length} flux suivis · dernier ${data.lastDataAt || "—"}`,
    tone,
  };
}

function brokerConnectionCard(overview?: ExecutionOverview | null): LiveBrokerGuardCardViewModel {
  if (!overview) return unavailableCard("Connexion broker");
  const startup = overview.ninjaTraderStartup;
  const tone: LiveDeskMetricTone = startup.connectionReady
    ? "positive"
    : startup.loginRequired || startup.state === "error"
      ? "negative"
      : startup.addonHeartbeatFresh
        ? "warning"
        : "negative";
  return {
    label: "Connexion broker",
    value: startup.connectionReady ? "Sim101 connecté" : startup.loginRequired ? "Login requis" : startup.addonHeartbeatFresh ? "AddOn en attente" : "AddOn stale",
    detail: `${startup.connectionName || "connexion non nommée"} · heartbeat ${startup.addonHeartbeatFresh ? "frais" : "absent/stale"}`,
    tone,
  };
}

function reconciliationCard(overview?: ExecutionOverview | null): LiveBrokerGuardCardViewModel {
  if (!overview) return unavailableCard("Réconciliation");
  const latest = overview.reconciliations[0];
  if (!latest) {
    return { label: "Réconciliation", value: "Aucun run", detail: "Aucun écart broker/base enregistré.", tone: "neutral" };
  }
  const status = String(latest.status || "").toLowerCase();
  const policy = reconciliationPolicyMode(latest.metadata);
  const tone: LiveDeskMetricTone = status === "diverged" && latest.mismatch_count > 0
    ? policy === "alert_only" ? "warning" : "negative"
    : status === "matched"
      ? "positive"
      : "neutral";
  return {
    label: "Réconciliation",
    value: status === "diverged" ? `${latest.mismatch_count} écart(s)` : status === "matched" ? "Alignée" : latest.status || "À vérifier",
    detail: `${policyLabel(policy)} · ${formatParisDateTime(latest.completed_at || latest.started_at)}`,
    tone,
  };
}

function protectionCard(overview?: ExecutionOverview | null): LiveBrokerGuardCardViewModel {
  if (!overview) return unavailableCard("Protection broker");
  const openTrades = overview.trades.filter(item => !["closed", "cancelled", "rejected", "expired"].includes(String(item.status || "").toLowerCase()));
  if (!openTrades.length) {
    return { label: "Protection broker", value: "Aucune position", detail: "Aucun stop broker post-fill à confirmer.", tone: "neutral" };
  }
  const states = openTrades.map(trade => String(trade.raw?.broker_protection_state || "unknown").toLowerCase());
  const failed = states.filter(state => state === "failed").length;
  const pending = states.filter(state => state === "pending" || state === "unknown").length;
  const confirmed = states.filter(state => state === "confirmed").length;
  const tone: LiveDeskMetricTone = failed ? "negative" : pending ? "warning" : confirmed === openTrades.length ? "positive" : "neutral";
  const firstReason = openTrades.map(trade => String(trade.raw?.broker_protection_reason || "")).find(Boolean);
  return {
    label: "Protection broker",
    value: failed ? "Stop à corriger" : pending ? "Confirmation attendue" : confirmed === openTrades.length ? "Stops confirmés" : "À vérifier",
    detail: `${confirmed}/${openTrades.length} protégée(s)${firstReason ? ` · ${firstReason}` : ""}`,
    tone,
  };
}

function executionLockCard(overview?: ExecutionOverview | null): LiveBrokerGuardCardViewModel {
  if (!overview) return unavailableCard("Verrous exécution");
  const locks = overview.locks || [];
  if (!locks.length) return { label: "Verrous exécution", value: "Aucun verrou", detail: "Aucun fail-closed actif en base.", tone: "positive" };
  const protectionOrRecon = locks.find(lock => /protection|reconciliation|divergence/i.test(`${lock.reason} ${lock.set_by}`));
  return {
    label: "Verrous exécution",
    value: `${locks.length} actif(s)`,
    detail: protectionOrRecon?.reason || locks[0]?.reason || "Soumission broker bloquée.",
    tone: "negative",
  };
}

function unavailableCard(label: string): LiveBrokerGuardCardViewModel {
  return { label, value: "Non projeté", detail: "API exécution non chargée.", tone: "neutral" };
}

function reconciliationPolicyMode(metadata: Record<string, unknown> | undefined) {
  const policy = metadata?.reconciliation_policy;
  if (policy && typeof policy === "object" && "mode" in policy) return String((policy as { mode?: unknown }).mode || "");
  return "";
}

function policyLabel(mode: string) {
  if (mode === "alert_only") return "alerte seule";
  if (mode === "blocking") return "bloquant";
  if (mode === "disabled") return "désactivée";
  return "mode non précisé";
}

function brokerGuardHeadline(tone: LiveDeskMetricTone, overview?: ExecutionOverview | null) {
  if (!overview) return "Projection broker en attente";
  if (tone === "negative") return "Exécution sous contrôle fail-closed";
  if (tone === "warning") return "Exécution surveillée";
  if (tone === "positive") return "Broker, données et protections alignés";
  return "Exécution sans anomalie bloquante";
}

function worstTone(tones: LiveDeskMetricTone[]): LiveDeskMetricTone {
  if (tones.includes("negative")) return "negative";
  if (tones.includes("warning")) return "warning";
  if (tones.includes("positive")) return "positive";
  return "neutral";
}

function fmtLive(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function formatUpdatedAt(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function claimLatencyLabel(value: number | null) {
  if (value == null) return "À mesurer";
  if (value < 60) return `${value} s`;
  return `${Math.floor(value / 60)} min ${value % 60} s`;
}

function formatParisDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

function workflowLabel(value: string | null) {
  if (value === "LIVE_MASTER") return "Master";
  if (value === "LIVE_M15_MONITOR") return "Monitor GPT M15";
  return "Planification backend";
}

function taskStatusTone(status: DeskSession["claim"]["nextTaskStatus"]): LiveDeskMetricTone {
  if (status === "executed") return "positive";
  if (status === "late") return "negative";
  if (status === "waiting") return "warning";
  return "neutral";
}
