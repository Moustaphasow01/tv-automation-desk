import type { LivePortfolioOrderIntent, LiveTradingView } from "@/domains/front-api/viewModels";
import type { HumanGateAction } from "@/features/order-intent/model";
import type { ViewEnvelope, ViewMeta } from "@/shared/contracts";

export type LiveTone = "neutral" | "info" | "success" | "warning" | "danger";

export type LiveTradingModel = {
  meta: ViewMeta;
  source: LiveTradingView;
  truth: { label: string; tone: LiveTone; detail: string };
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
