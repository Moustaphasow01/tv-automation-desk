import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CommandAccepted, CommandStatus } from "@/domains/realtime/commandRuntime";
import { presentAvailability, presentGeneric, presentSignalState } from "@/design-system/labels";
import { StatusBadge } from "@/design-system/primitives";
import type { HumanGateAction } from "@/features/order-intent/model";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { LiveHumanGate } from "./LiveHumanGate";
import { displayTime, displayValue, recordValue } from "./mapper";
import type { LiveTradingModel } from "./model";

export type LiveDecisionStackProps = {
  model: LiveTradingModel;
  onSubmit(action: HumanGateAction, reason: string): Promise<void>;
  submittingActionId: string | null;
  command: CommandAccepted | null;
  commandStatus?: CommandStatus | null;
  error: string | null;
  onScopeChange?: (scope: { instrument?: string; timeframe?: string }) => void;
};

type DecisionStageId = "signal" | "context" | "portfolio-risk" | "order-intent" | "human-gate";

export function LiveDecisionStack(props: LiveDecisionStackProps) {
  const { model, onScopeChange } = props;
  const signalInstrument = model.latestSignal?.symbol ?? null;
  const chartInstrument = model.marketSeries.instrument;
  const scopeMismatch = Boolean(
    signalInstrument && chartInstrument && signalInstrument.toUpperCase() !== chartInstrument.toUpperCase(),
  );
  const canSwitchToSignal = Boolean(signalInstrument && model.marketSeries.supportedInstruments.some(
    (instrument) => instrument.trim().toUpperCase() === signalInstrument.trim().toUpperCase(),
  ));
  const mostAdvancedStage = mostAdvancedPublishedStage(model);

  return (
    <section className="lt-decision-stack" aria-labelledby="lt-decision-stack-title">
      <header className="lt-decision-stack__header">
        <div>
          <p className="eyebrow">Chaîne de décision</p>
          <h2 id="lt-decision-stack-title">Du signal à l’autorisation humaine</h2>
          <p>Chaque étage reprend uniquement les décisions et capacités publiées par le backend.</p>
        </div>
        <StatusBadge tone={model.operator.tone}>{model.operator.label}</StatusBadge>
      </header>

      {scopeMismatch ? (
        <div className="lt-decision-stack__scope-alert" role="status">
          <div>
            <strong>Le graphique affiche {chartInstrument}</strong>
            <span>Le signal courant concerne {signalInstrument}. Ses niveaux restent hors du graphique tant que le périmètre diffère.</span>
          </div>
          {onScopeChange && canSwitchToSignal ? (
            <button type="button" onClick={() => onScopeChange({ instrument: signalInstrument ?? undefined })}>
              Afficher {signalInstrument}
            </button>
          ) : <small>Changement de périmètre indisponible : cet instrument n’est pas publié comme sélectionnable.</small>}
        </div>
      ) : null}

      <div className="lt-decision-stack__dossier" aria-label="Dossier de décision sélectionné">
        <span><small>Dossier</small><strong>{model.latestSignal ? shortId(model.latestSignal.signalId) : "Aucun signal sélectionné"}</strong></span>
        <span><small>Instrument</small><strong>{model.latestSignal?.symbol ?? "—"}</strong></span>
        <span><small>Cutoff source</small><strong>{displayTime(model.latestSignal?.sourceDataCutoffAt ?? model.latestSignal?.createdAt)}</strong></span>
        <span><small>Étape atteinte</small><strong>{stageLabel(mostAdvancedStage)}</strong></span>
      </div>

      <ol className="lt-decision-stack__flow" aria-label="Progression causale de la décision">
        <SignalStage model={model} defaultExpanded={mostAdvancedStage === "signal"} />
        <ContextStage model={model} defaultExpanded={mostAdvancedStage === "context"} />
        <PortfolioRiskStage model={model} defaultExpanded={mostAdvancedStage === "portfolio-risk"} />
        <OrderIntentStage model={model} defaultExpanded={mostAdvancedStage === "order-intent"} />
        <HumanGateStage model={model} defaultExpanded={mostAdvancedStage === "human-gate"}>
          <LiveHumanGate
            model={model}
            onSubmit={props.onSubmit}
            submittingActionId={props.submittingActionId}
            command={props.command}
            commandStatus={props.commandStatus}
            error={props.error}
            embedded
          />
        </HumanGateStage>
      </ol>
    </section>
  );
}

function SignalStage({ model, defaultExpanded }: { model: LiveTradingModel; defaultExpanded: boolean }) {
  const signal = model.latestSignal;
  const presentation = signal ? presentSignalState(signal.state) : presentAvailability("CONNECTED_EMPTY");
  return (
    <StageShell stage="signal" index="01" title="Signal de stratégie" status={<DecisionStatusBadge tone={presentation.tone} label={presentation.label} />} defaultExpanded={defaultExpanded}>
      {signal ? (
        <>
          <div className="lt-decision-stack__headline">
            <strong>{signal.symbol} · {presentGeneric(signal.direction).label}</strong>
            <span>{displayTime(signal.createdAt)} · confiance {displayValue(signal.confidence)}%</span>
          </div>
          <dl className="lt-decision-stack__facts">
            <Fact label="Stratégie" value={shortId(signal.strategyId)} />
            <Fact label="Setup" value={displayValue(recordValue(signal.setup, ["setup", "setupType", "setup_type", "name"]))} />
            <Fact label="R attendu" value={`${displayValue(signal.expectancyR)} R`} />
            <Fact label="Expiration" value={displayTime(signal.expiresAt)} />
          </dl>
          <Link to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Ouvrir le signal</Link>
        </>
      ) : <EmptyEvidence text="Aucun StrategySignal courant n’est publié." />}
    </StageShell>
  );
}

function ContextStage({ model, defaultExpanded }: { model: LiveTradingModel; defaultExpanded: boolean }) {
  const context = model.latestContextDecision;
  const presentation = context ? presentGeneric(context.recommendation) : presentAvailability("CONNECTED_EMPTY");
  return (
    <StageShell stage="context" index="02" title="Avis contexte IA" status={<DecisionStatusBadge tone={presentation.tone} label={presentation.label} />} advisory defaultExpanded={defaultExpanded}>
      {context ? (
        <>
          <div className="lt-decision-stack__headline">
            <strong>{presentGeneric(context.mode).label}</strong>
            <span>Décidé {displayTime(context.decidedAt)} · confiance {context.confidence === null ? "—" : `${Math.round(context.confidence)}%`}</span>
          </div>
          <dl className="lt-decision-stack__facts">
            <Fact label="Recommandation" value={presentation.label} />
            <Fact label="Multiplicateur risque" value={context.riskMultiplier === null ? "—" : `${context.riskMultiplier.toFixed(2)}×`} />
          </dl>
          <ReasonCodes values={context.reasonCodes} empty="Aucun code motif publié." />
          <p className="lt-decision-stack__authority">Avis consultatif : l’autorité de risque reste au backend déterministe.</p>
        </>
      ) : <EmptyEvidence text="Aucune décision de contexte consultative n’est publiée." />}
    </StageShell>
  );
}

function PortfolioRiskStage({ model, defaultExpanded }: { model: LiveTradingModel; defaultExpanded: boolean }) {
  const signalId = model.latestSignal?.signalId;
  const arbitration = model.source.arbitrations.find((item) => item.signalId === signalId);
  const risk = model.riskCheck;
  const portfolioStatus = arbitration ? presentGeneric(arbitration.decision) : presentAvailability("CONNECTED_EMPTY");
  const riskStatus = risk ? presentBackendStatus(risk.status) : presentAvailability("CONNECTED_EMPTY");
  const collapsedStatus = !arbitration && !risk
    ? <DecisionStatusBadge tone="info" label="Connecté, sans décision publiée" compactLabel="Sans décision" />
    : <div className="lt-decision-stack__badges">
      <DecisionStatusBadge tone={portfolioStatus.tone} label={`Portefeuille : ${portfolioStatus.label}`} compactLabel={`P · ${compactDecisionStatus(portfolioStatus.label)}`} />
      <DecisionStatusBadge tone={riskStatus.tone} label={`Risque : ${riskStatus.label}`} compactLabel={`R · ${compactDecisionStatus(riskStatus.label)}`} />
    </div>;
  return (
    <StageShell stage="portfolio-risk" index="03" title="Portefeuille & risque" status={collapsedStatus} defaultExpanded={defaultExpanded}>
      {arbitration || risk ? (
        <div className="lt-decision-stack__authority-grid">
          <AuthorityEvidence title="Arbitrage portefeuille" status={portfolioStatus.label} facts={[
            ["Quantité cible", displayValue(arbitration?.targetQuantity)],
            ["Conflit", displayValue(arbitration?.conflictStatus)],
            ["Motif", displayValue(arbitration?.reasonCode)],
          ]} />
          <AuthorityEvidence title="Risque global" status={riskStatus.label} facts={[
            ["Limite", displayValue(risk?.limitLabel)],
            ["Utilisation", risk?.usedPct === null || risk?.usedPct === undefined ? "Non publiée" : `${risk.usedPct.toFixed(1)}%`],
            ["Motif", displayValue(risk?.reasonCode)],
          ]} />
        </div>
      ) : <EmptyEvidence text="Aucune décision portefeuille ou risque n’est publiée pour ce signal." />}
    </StageShell>
  );
}

function OrderIntentStage({ model, defaultExpanded }: { model: LiveTradingModel; defaultExpanded: boolean }) {
  const intent = model.orderIntent;
  const presentation = intent ? presentBackendStatus(intent.state) : presentAvailability("CONNECTED_EMPTY");
  const unrelated = Boolean(intent && model.latestSignal && intent.signalId !== model.latestSignal.signalId);
  return (
    <StageShell stage="order-intent" index="04" title="Position cible & ordre" status={<DecisionStatusBadge tone={presentation.tone} label={presentation.label} />} defaultExpanded={defaultExpanded}>
      {intent ? (
        <>
          {unrelated ? <p className="lt-decision-stack__warning" role="status">Cette intention est liée au signal {shortId(intent.signalId)}, pas au signal affiché ci-dessus.</p> : null}
          <div className="lt-decision-stack__readonly">Lecture seule après décision Risk</div>
          {!unrelated && model.selectedSignalPlan ? (
            <div className="lt-plan-comparison" aria-label="Comparaison du plan proposé et du plan autorisé">
              <section><small>Stratégie proposée</small><strong>{model.selectedSignalPlan.entry}</strong><span>Stop {model.selectedSignalPlan.stop} · {model.selectedSignalPlan.targets.join(" · ") || "cible non publiée"}</span></section>
              <section><small>Plan autorisé post-Risk</small><strong>{formatTradeTerm(recordValue(intent.executionTerms, ["entry", "entryPrice", "entry_price"]) ?? intent.limitPrice)}</strong><span>Stop {formatTradeTerm(recordValue(intent.executionTerms, ["stop", "stopPrice", "stop_price"]) ?? intent.stopPrice)} · cible {formatTradeTerm(recordValue(intent.executionTerms, ["targets", "target", "targetPrice", "target_price"]) ?? intent.targetPrice)}</span></section>
            </div>
          ) : null}
          <dl className="lt-decision-stack__facts">
            <Fact label="Instrument / sens" value={`${intent.symbol} · ${presentGeneric(intent.side).label}`} />
            <Fact label="Quantité autorisée" value={displayValue(recordValue(intent.riskSnapshot, ["authorizedQty", "authorized_qty"]) ?? intent.quantity)} />
            <Fact label="Entrée" value={formatTradeTerm(recordValue(intent.executionTerms, ["entry", "entryPrice", "entry_price"]) ?? intent.limitPrice)} />
            <Fact label="Stop" value={formatTradeTerm(recordValue(intent.executionTerms, ["stop", "stopPrice", "stop_price"]) ?? intent.stopPrice)} />
            <Fact label="Cible" value={formatTradeTerm(recordValue(intent.executionTerms, ["targets", "target", "targetPrice", "target_price"]) ?? intent.targetPrice)} />
            <Fact label="Révision" value={displayValue(intent.allowedActions.revision || intent.expectedVersion)} />
          </dl>
          <Link to={intent.route}>Ouvrir le dossier canonique</Link>
        </>
      ) : <EmptyEvidence text="Aucun OrderIntent post-Risk n’est publié ; aucun terme de trade n’est supposé." />}
    </StageShell>
  );
}

function HumanGateStage({ model, defaultExpanded, children }: { model: LiveTradingModel; defaultExpanded: boolean; children: ReactNode }) {
  const status = model.orderIntent?.humanGate.status ?? "CONNECTED_EMPTY";
  const presentation = status === "CONNECTED_EMPTY" ? presentAvailability(status) : presentBackendStatus(status);
  const actionable = model.gateActions.some((action) => action.permission === "ALLOWED");

  return (
    <StageShell
      stage="human-gate"
      index="05"
      title="Validation humaine"
      status={<DecisionStatusBadge tone={presentation.tone} label={presentation.label} />}
      priority={actionable || model.operator.status === "AWAITING_HUMAN_GATE"}
      defaultExpanded={defaultExpanded}
    >
      {children}
    </StageShell>
  );
}

function StageShell({ stage, index, title, status, advisory = false, priority = false, defaultExpanded, children }: {
  stage: DecisionStageId;
  index: string;
  title: string;
  status: ReactNode;
  advisory?: boolean;
  priority?: boolean;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const titleId = `lt-decision-stage-${index}`;
  const panelId = `${titleId}-panel`;
  return (
    <li
      className={`lt-decision-stack__step${advisory ? " lt-decision-stack__step--advisory" : ""}${stage === "human-gate" ? " lt-decision-stack__step--gate" : ""}`}
      data-priority={priority ? "true" : "false"}
    >
      <span className="lt-decision-stack__index" aria-hidden="true">{index}</span>
      <article aria-labelledby={titleId}>
        <details name="lt-decision-stack-stage" open={defaultExpanded}>
          <summary aria-controls={panelId}>
            <span className="lt-decision-stack__stage-label">
              <small>Étape {index}</small>
              <span className="lt-decision-stack__stage-title" id={titleId}>{title}</span>
            </span>
            <span className="lt-decision-stack__stage-status">
              {status}
              <span className="lt-decision-stack__chevron" aria-hidden="true">▾</span>
            </span>
          </summary>
          <div className="lt-decision-stack__body" id={panelId}>{children}</div>
        </details>
      </article>
    </li>
  );
}

function DecisionStatusBadge({ tone, label, compactLabel }: {
  tone: Parameters<typeof StatusBadge>[0]["tone"];
  label: string;
  compactLabel?: string;
}) {
  return (
    <span className="lt-decision-stack__status-help" title={label} aria-label={label}>
      <StatusBadge tone={tone}>{compactLabel ?? compactDecisionStatus(label)}</StatusBadge>
    </span>
  );
}

function compactDecisionStatus(label: string): string {
  const normalized = label.trim().toLocaleUpperCase("fr-FR");
  if (normalized === "CONNECTÉ, SANS DONNÉE" || normalized === "CONNECTE, SANS DONNEE") return "Sans donnée";
  return label;
}

function mostAdvancedPublishedStage(model: LiveTradingModel): DecisionStageId {
  const signalId = model.latestSignal?.signalId;
  const alignedIntent = model.orderIntent && (!signalId || model.orderIntent.signalId === signalId)
    ? model.orderIntent
    : null;
  if (alignedIntent && (alignedIntent.humanGate.gateId || alignedIntent.humanGate.status !== "CONNECTED_EMPTY" || model.gateActions.length > 0)) {
    return "human-gate";
  }
  if (alignedIntent) return "order-intent";
  if (model.source.arbitrations.some((item) => item.signalId === signalId) || model.source.riskChecks.some((item) => item.signalId === signalId)) {
    return "portfolio-risk";
  }
  if (model.latestContextDecision) return "context";
  return "signal";
}

function stageLabel(stage: DecisionStageId): string {
  if (stage === "human-gate") return "Human Gate";
  if (stage === "order-intent") return "OrderIntent";
  if (stage === "portfolio-risk") return "Portfolio & Risk";
  if (stage === "context") return "Contexte";
  return "Signal";
}

function AuthorityEvidence({ title, status, facts }: { title: string; status: string; facts: readonly (readonly [string, string])[] }) {
  return <section><header><strong>{title}</strong><span>{status}</span></header><dl>{facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}</dl></section>;
}

function ReasonCodes({ values, empty }: { values: readonly string[]; empty: string }) {
  return values.length ? <ul className="lt-decision-stack__reasons">{values.map((value) => <li key={value}>{presentGeneric(value).label}</li>)}</ul> : <p className="lt-decision-stack__muted">{empty}</p>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function EmptyEvidence({ text }: { text: string }) {
  return <p className="lt-decision-stack__empty" role="status">{text}</p>;
}

function shortId(value: string): string {
  return value.length > 28 ? `${value.slice(0, 25)}…` : value;
}

function formatTradeTerm(value: unknown): string {
  if (Array.isArray(value)) {
    const values = value.map((item) => formatTradeTerm(item)).filter((item) => item !== "—");
    return values.length ? values.join(" · ") : "—";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label = record.label ?? record.name;
    const price = record.price ?? record.value ?? record.level ?? record.mid ?? record.center;
    if (price !== undefined && price !== null) {
      const formatted = displayValue(price);
      return label ? `${displayValue(label)} ${formatted}` : formatted;
    }
    return "—";
  }
  return displayValue(value);
}
