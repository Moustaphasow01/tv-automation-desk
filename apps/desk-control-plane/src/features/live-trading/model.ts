import type { LivePortfolioOrderIntent, LiveTradingView } from "@/domains/front-api/viewModels";
import type { HumanGateAction } from "@/features/order-intent/model";
import type { ViewEnvelope, ViewMeta } from "@/shared/contracts";

export type LiveTone = "neutral" | "info" | "success" | "warning" | "danger";

export type LiveOperatorState = {
  status: "DEGRADED" | "AWAITING_HUMAN_GATE" | "ORDER_INTENT_RECORDED" | "THEORETICAL_TRACKING" | "SIGNAL_DETECTED" | "NO_OPPORTUNITY";
  label: string;
  detail: string;
  tone: LiveTone;
};

export type LiveSignalFunnelStage = {
  key: string;
  label: string;
  value: number;
  tone: LiveTone;
  detail: string;
};

export type LiveSignalFunnel = {
  rawSignals: number;
  contextTake: number;
  contextWait: number;
  contextReject: number;
  portfolioAccepted: number;
  portfolioRejected: number;
  riskPass: number;
  riskWatch: number;
  riskBlock: number;
  orderIntents: number;
  pendingHumanGates: number;
  theoreticalTracked: number;
  theoreticalOpen: number;
  targetHit: number;
  stopHit: number;
  expired: number;
  totalClosedR: number | null;
  stages: readonly LiveSignalFunnelStage[];
};

export type LiveMarketIntelligence = {
  bias: string;
  regime: string;
  volatility: string;
  macroRisk: string;
  confidence: number | null;
  riskMultiplier: number | null;
  validUntil: string | null;
  reasonCodes: readonly string[];
  preferredFamilies: readonly string[];
  discouragedFamilies: readonly string[];
  zones: readonly {
    label: string;
    direction: string;
    range: string;
    detail: string;
    tone: LiveTone;
  }[];
};

export type LiveSignalPlanSummary = {
  source: string;
  orderType: string;
  entry: string;
  stop: string;
  targets: readonly string[];
  expectedR: string;
  rewardRisk: string;
  expiresAt: string | null;
  sourceCutoffAt: string | null;
};

export type LiveDataQuality = {
  availability: string;
  generatedAt: string;
  marketAsOf: string | null;
  marketAgeLabel: string;
  candleCount: number;
  sources: readonly {
    source: string;
    rows: number;
    latestAt: string | null;
    tone: LiveTone;
  }[];
  timeSeries: readonly {
    seriesId: string;
    label: string;
    source: string;
    availability: string;
    reason: string;
    tone: LiveTone;
  }[];
  telegram: {
    availability: string;
    enabled: boolean;
    healthy: boolean;
    lastDeliveryAt: string | null;
    status: string;
    tone: LiveTone;
  };
};

export type LiveTradingModel = {
  meta: ViewMeta;
  source: LiveTradingView;
  truth: { label: string; tone: LiveTone; detail: string };
  operator: LiveOperatorState;
  signalFunnel: LiveSignalFunnel;
  marketIntelligence: LiveMarketIntelligence;
  selectedSignalPlan: LiveSignalPlanSummary | null;
  dataQuality: LiveDataQuality;
  mode: LiveTradingView["canonicalRuntime"]["mode"];
  freshness: LiveTradingView["canonicalRuntime"]["freshness"];
  marketSeries: {
    availability: string;
    source: string;
    reason: string;
    asOf: string;
    instrument: string | null;
    timeframe: string | null;
    supportedInstruments: readonly string[];
    supportedTimeframes: readonly string[];
    points: NonNullable<LiveTradingView["marketSeries"]>["points"];
  };
  watchlist: NonNullable<LiveTradingView["watchlist"]>;
  strategyInstances: LiveTradingView["canonicalRuntime"]["activeStrategyInstances"];
  latestSignal: LiveTradingView["signals"][number] | null;
  latestContextDecision: LiveTradingView["canonicalRuntime"]["aiContextGate"][number] | null;
  orderIntent: LivePortfolioOrderIntent | null;
  targetPosition: Record<string, unknown> | null;
  theoreticalExecution: NonNullable<LiveTradingView["theoreticalExecution"]> | null;
  selectedTheoreticalExecution: NonNullable<LiveTradingView["theoreticalExecution"]>["rows"][number] | null;
  gateActions: readonly HumanGateAction[];
  gateBlockedReason: string;
  provider: LiveTradingView["providers"][number] | null;
  reconciliation: { status: string; detail: string; asOf: string; expected: Record<string, unknown> | null; broker: Record<string, unknown> | null; mismatchCount: number | null };
  timeline: LiveTradingView["timeline"];
  performance: {
    availability: string;
    totalR: number | null;
    drawdownR: number | null;
    reason: string;
    sourceType: string;
    sampleSize: number | null;
    hitRatePct: number | null;
    series: readonly { sequence: number; at: string; resultR: number; cumulativeR: number; drawdownR: number }[];
  };
};

export type LiveTradingEnvelope = ViewEnvelope<LiveTradingView>;
