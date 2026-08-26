import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import { buildHumanGateCommand, type HumanGateAction } from "@/features/order-intent/model";
import { LiveHumanGate } from "@/features/live-trading/LiveHumanGate";
import { LiveTradingHeader } from "@/features/live-trading/LiveTradingHeader";
import {
  AuditTimelinePanel,
  InstrumentChartPanel,
  JarvisPanel,
  LatestSignalPanel,
  MacroSessionPanel,
  MarketContextPanel,
  OrderIntentPanel,
  PerformancePanel,
  ProviderRuntimePanel,
  ReconciliationPanel,
  RiskAuthorityPanel,
  StrategyInstancesPanel,
} from "@/features/live-trading/LiveTradingPanels";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import "@/features/live-trading/live-trading.css";

export function LiveTradingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const marketScope = useMemo(() => ({
    instrument: searchParams.get("instrument") || undefined,
    timeframe: searchParams.get("timeframe") || undefined,
  }), [searchParams]);
  const query = useFrontView("live-trading", marketScope);
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const model = useMemo(() => query.data ? toLiveTradingModel(query.data) : null, [query.data]);

  const updateMarketScope = (nextScope: { instrument?: string; timeframe?: string }) => {
    const next = new URLSearchParams(searchParams);
    if (nextScope.instrument) next.set("instrument", nextScope.instrument);
    if (nextScope.timeframe) next.set("timeframe", nextScope.timeframe);
    setSearchParams(next, { replace: true });
  };

  const submitGateAction = async (action: HumanGateAction, reason: string) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildHumanGateCommand(action, reason));
      setCommand(accepted);
      await query.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "HUMAN_GATE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  if (query.isError) return <LiveTradingFailure message={(query.error as Error).message} retry={() => query.refetch()} />;
  if (query.isLoading || !model) return <LiveTradingLoading />;

  return (
    <div className="lt-page" data-testid="live-trading-golden-master">
      <LiveTradingHeader model={model} onRefresh={() => void query.refetch()} refreshing={query.isFetching} />
      <div className="lt-grid" aria-label="Cockpit Live Trading semi-manuel">
        <div className="lt-left-rail">
          <MarketContextPanel model={model} />
          <StrategyInstancesPanel model={model} />
          <MacroSessionPanel model={model} />
        </div>
        <InstrumentChartPanel model={model} onScopeChange={updateMarketScope} />
        <div className="lt-signal-rail">
          <LatestSignalPanel model={model} />
          <OrderIntentPanel model={model} />
        </div>
        <div className="lt-execution-rail">
          <RiskAuthorityPanel model={model} />
          <LiveHumanGate model={model} onSubmit={submitGateAction} submittingActionId={submittingActionId} command={command} error={commandError} />
          <ProviderRuntimePanel model={model} />
        </div>
        <div className="lt-lower-row">
          <ReconciliationPanel model={model} />
          <AuditTimelinePanel model={model} />
          <PerformancePanel model={model} />
          <JarvisPanel model={model} />
        </div>
      </div>
      <div className="lt-accessible-status" aria-live="polite">Projection {model.truth.label}. {model.mode.executionMode}. Human Gate {model.mode.humanGateRequired ? "requis" : "non requis"}.</div>
    </div>
  );
}

function LiveTradingLoading() {
  return <div className="lt-page lt-page--loading" aria-busy="true" aria-live="polite"><div className="lt-loading-header" /><div className="lt-loading-policy" /><div className="lt-loading-grid">{Array.from({ length: 8 }, (_, index) => <div key={index} />)}</div></div>;
}

function LiveTradingFailure({ message, retry }: { message: string; retry(): void }) {
  return <div className="lt-page lt-page--failure"><section role="alert"><strong>Live Trading indisponible</strong><p>{message}</p><button type="button" onClick={retry}>Réessayer</button></section></div>;
}
