import { useMemo, useState } from "react";
import type { CommandSnapshot } from "@/domains/realtime/commandRuntime";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { CommandCenterHeader } from "@/features/command-center/CommandCenterHeader";
import { CommandCenterKpis } from "@/features/command-center/CommandCenterKpis";
import { DeskControlPanel } from "@/features/command-center/DeskControlPanel";
import { MarketFreshnessPanel, ResearchPipelinePanel, SignalsRiskPanel } from "@/features/command-center/UpperPanels";
import { HumanGatePanel, ProviderRuntimePanel, ResearchPerformancePanel } from "@/features/command-center/MiddlePanels";
import { AuditTimelinePanel, IncidentsOperationsPanel, JarvisPanel } from "@/features/command-center/LowerPanels";
import { toCommandCenterModel } from "@/features/command-center/mapper";
import type { DeskControlCommand } from "@/features/command-center/model";
import "@/features/command-center/command-center.css";

function useCommandCenterSupervision() {
  const query = useFrontView("command-center");
  const capabilities = useCapabilityCatalog();
  const repository = useFrontViewRepository();
  const { session } = useOperatorSession();
  const [commandState, setCommandState] = useState<CommandUiState>({ submitting: null, last: null, error: null });
  const model = useMemo(() => query.data ? toCommandCenterModel(query.data) : null, [query.data]);

  const submitDeskControl = async (commandType: DeskControlCommand) => {
    if (session?.summary.environment !== "PAPER") {
      setCommandState({ submitting: null, last: commandState.last, error: "DESK_CONTROL_ENVIRONMENT_NOT_AUTHORIZED" });
      return;
    }
    setCommandState({ submitting: commandType, last: commandState.last, error: null });
    try {
      const accepted = await repository.submitCommand({
        commandType,
        environment: session.summary.environment,
        reason: deskControlReason(commandType),
        payload: { source: "command-center" },
      });
      const terminal = await repository.getCommand(accepted.commandId).catch(() => null);
      setCommandState({ submitting: null, last: terminal ?? { ...accepted, updatedAt: accepted.acceptedAt }, error: null });
      await Promise.all([query.refetch(), capabilities.refetch()]);
    } catch (error) {
      setCommandState({ submitting: null, last: commandState.last, error: error instanceof Error ? error.message : "DESK_CONTROL_COMMAND_FAILED" });
    }
  };
  return { query, capabilities, session, commandState, model, submitDeskControl };
}

export function CommandCenterSupervision() {
  const { query, capabilities, session, commandState, model, submitDeskControl } = useCommandCenterSupervision();
  if (query.isError) return <CommandCenterFailure message={(query.error as Error).message} retry={() => query.refetch()} />;
  if (query.isLoading || !model) return <CommandCenterLoading />;

  const data = model.source;
  return (
    <div className="cc-page" data-testid="command-center-golden-master">
      <CommandCenterHeader model={model} />
      <div className="cc-workspace" role="region" aria-label="Synthèse du Trading Desk">
        <CommandCenterKpis model={model} />
        <section className="cc-grid cc-grid--top" aria-label="Contrôle et pipelines">
          <DeskControlPanel actions={capabilities.data?.actions ?? []} deskStatus={data.summary.deskStatus} systems={data.systems} disabled={capabilities.isLoading || capabilities.isError || session?.summary.environment !== "PAPER"} submitting={commandState.submitting} lastCommand={commandState.last} error={commandState.error} onSubmit={submitDeskControl} />
          <MarketFreshnessPanel market={data.market} />
          <ResearchPipelinePanel research={data.research} />
          <SignalsRiskPanel signals={data.signals} />
        </section>
        <section className="cc-grid cc-grid--middle" aria-label="Votre validation et exécution">
          <HumanGatePanel humanGate={data.humanGate} />
          <ProviderRuntimePanel provider={data.provider} />
          <ResearchPerformancePanel performance={data.performance} />
        </section>
        <section className="cc-grid cc-grid--bottom" aria-label="Incidents, assistant et audit">
          <IncidentsOperationsPanel incidents={data.incidents} operations={data.operations} />
          <JarvisPanel assistant={data.assistant} />
          <AuditTimelinePanel audit={data.audit} />
        </section>
      </div>
    </div>
  );
}

type CommandUiState = { submitting: DeskControlCommand | null; last: CommandSnapshot | null; error: string | null };

function deskControlReason(commandType: DeskControlCommand) {
  return `Operator requested ${commandType} from VNext Command Center; broker/live/auto execution must remain fail-closed.`;
}

function CommandCenterLoading() {
  return <div className="cc-page cc-page--loading" aria-busy="true" aria-live="polite"><h1 className="sr-only">Synthèse</h1><div className="cc-loading-header" /><div className="cc-loading-grid">{Array.from({ length: 12 }, (_, index) => <div key={index} />)}</div></div>;
}

function CommandCenterFailure({ message: _message, retry }: { message: string; retry(): void }) {
  return <div className="cc-page cc-page--failure"><h1 className="sr-only">Synthèse</h1><section role="alert"><strong>Synthèse non joignable</strong><p>La projection opérateur ne répond pas. Aucun état n'est extrapolé localement.</p><button type="button" onClick={retry}>Réessayer</button></section></div>;
}
