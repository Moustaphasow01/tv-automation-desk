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
  marketSeries: { availability: string; source: string; reason: string; asOf: string };
  strategyInstances: LiveTradingView["canonicalRuntime"]["activeStrategyInstances"];
  latestSignal: LiveTradingView["signals"][number] | null;
  latestContextDecision: LiveTradingView["canonicalRuntime"]["aiContextGate"][number] | null;
  orderIntent: LivePortfolioOrderIntent | null;
  gateActions: readonly HumanGateAction[];
  gateBlockedReason: string;
  provider: LiveTradingView["providers"][number] | null;
  reconciliation: { status: string; detail: string; asOf: string };
  performance: { availability: string; totalR: number | null; drawdownR: number | null; reason: string };
};

export type LiveTradingEnvelope = ViewEnvelope<LiveTradingView>;
