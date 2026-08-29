import type { LiveTradingModel } from "./model";
import type { SignalTemporalInput } from "./signalTemporalState";
import { resolveSignalTemporalState } from "./signalTemporalState";

export type SignalOperatorStateCode = "ACTIONABLE" | "EVALUATING" | "WATCHED" | "EXPIRED" | "REJECTED";

export type SignalOperatorState = {
  code: SignalOperatorStateCode;
  label: "À prendre" | "En cours d’évaluation" | "Surveillé" | "Expiré" | "Refusé";
  tone: "success" | "info" | "neutral" | "warning" | "danger";
  detail: string;
};

export type SignalOperatorFacts = {
  temporalState: string;
  projectionAvailable: boolean;
  contextDecision?: string | null;
  portfolioDecision?: string | null;
  riskDecision?: string | null;
  intentState?: string | null;
  gateState?: string | null;
  confirmAllowed?: boolean;
  theoreticallyTracked?: boolean;
};

export function resolveSignalOperatorState(facts: SignalOperatorFacts): SignalOperatorState {
  const context = normalize(facts.contextDecision);
  const portfolio = normalize(facts.portfolioDecision);
  const risk = normalize(facts.riskDecision);
  const intent = normalize(facts.intentState);
  const gate = normalize(facts.gateState);
  const temporal = normalize(facts.temporalState);
  const rejected = temporal === "REJECTED"
    || includesAny(context, ["REJECT", "BLOCK"])
    || includesAny(portfolio, ["REJECT"])
    || includesAny(risk, ["BLOCK", "REJECT"])
    || includesAny(intent, ["REJECT", "CANCEL"])
    || includesAny(gate, ["REJECT"]);

  if (rejected) return { code: "REJECTED", label: "Refusé", tone: "danger", detail: "Une autorité backend a refusé ce signal." };
  if (temporal === "EXPIRED" || includesAny(intent, ["EXPIRED"]) || includesAny(gate, ["EXPIRED"])) {
    return { code: "EXPIRED", label: "Expiré", tone: "warning", detail: "La fenêtre de validité publiée est terminée." };
  }
  if (facts.projectionAvailable && facts.confirmAllowed) {
    return { code: "ACTIONABLE", label: "À prendre", tone: "success", detail: "Le backend publie une confirmation Human Gate autorisée et fraîche." };
  }
  if (facts.theoreticallyTracked || includesAny(intent, ["CONFIRM", "APPROV", "FILLED", "TRACKING"])) {
    return { code: "WATCHED", label: "Surveillé", tone: "neutral", detail: "Le signal fait l’objet d’un suivi backend, sans action à inventer côté front." };
  }
  if (context || portfolio || risk || intent || gate) {
    return { code: "EVALUATING", label: "En cours d’évaluation", tone: "info", detail: "Le signal progresse dans la chaîne de décision backend." };
  }
  return { code: "WATCHED", label: "Surveillé", tone: "neutral", detail: "Le signal est publié et attend une décision backend." };
}

export function operatorStateForSignal(
  model: LiveTradingModel,
  signal: SignalTemporalInput & { signalId: string },
): SignalOperatorState {
  const temporal = resolveSignalTemporalState(signal, model.meta.asOf);
  const intent = [...model.source.canonicalRuntime.pendingOrderIntents, ...model.source.portfolioOrderIntents]
    .find((item) => item.signalId === signal.signalId);
  const actionExpiresAt = Date.parse(intent?.allowedActions.expiresAt ?? "");
  const projectionAsOf = Date.parse(model.meta.asOf);
  const actionWindowOpen = !Number.isFinite(actionExpiresAt)
    || (Number.isFinite(projectionAsOf) && actionExpiresAt > projectionAsOf);
  const confirmAllowed = Boolean(intent
    && actionWindowOpen
    && intent.allowedActions.allowedActions.some((action) => normalize(action) === "CONFIRM")
    && intent.humanGate.allowedActions.some((action) => action.action === "CONFIRM" && action.permission === "ALLOWED"));

  return resolveSignalOperatorState({
    temporalState: temporal.effectiveState,
    projectionAvailable: model.meta.availability === "AVAILABLE" && !model.meta.stale,
    contextDecision: model.source.canonicalRuntime.aiContextGate.find((item) => item.signalId === signal.signalId)?.recommendation,
    portfolioDecision: model.source.arbitrations.find((item) => item.signalId === signal.signalId)?.decision,
    riskDecision: model.source.riskChecks.find((item) => item.signalId === signal.signalId)?.status,
    intentState: intent?.state,
    gateState: intent?.humanGate.status,
    confirmAllowed,
    theoreticallyTracked: Boolean(model.theoreticalExecution?.rows.some((row) => row.strategySignalId === signal.signalId)),
  });
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function includesAny(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}
