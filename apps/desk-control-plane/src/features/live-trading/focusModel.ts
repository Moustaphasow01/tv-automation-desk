import type { SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { LiveManualExecutionAction, LivePortfolioOrderIntent } from "@/domains/front-api/viewModels";
import type { LiveTone, LiveTradingModel } from "./model";

export type LiveFocusStateCode = "A" | "B" | "C" | "D" | "E" | "F";

export type LiveFocusState = {
  code: LiveFocusStateCode;
  label: "VEILLE" | "EN ÉVALUATION" | "PRENABLE" | "ORDRE DÉCLARÉ" | "EN POSITION" | "CLÔTURÉ";
  tone: LiveTone;
  headline: string;
  instruction: string;
};

export function resolveLiveFocusState(model: LiveTradingModel): LiveFocusState {
  const theoretical = model.selectedTheoreticalExecution;
  const manual = normalize(theoretical?.manualExecution?.status ?? theoretical?.manualExecutionStatus);
  const theoreticalStatus = normalize(theoretical?.status);
  const tradeStatus = normalize(theoretical?.tradeStatus);
  const gateStatus = normalize(model.orderIntent?.humanGate.status);
  const terminal = ["TARGET_HIT", "STOP_HIT", "ENTRY_EXPIRED", "EXPIRED", "CLOSED"].includes(theoreticalStatus)
    || ["CLOSED", "CANCELLED", "EXPIRED"].includes(tradeStatus);

  if (terminal) {
    return {
      code: "F",
      label: "CLÔTURÉ",
      tone: theoreticalStatus === "STOP_HIT" ? "danger" : theoreticalStatus === "TARGET_HIT" ? "success" : "warning",
      headline: focusOutcomeHeadline(theoreticalStatus, theoretical?.resultR ?? null),
      instruction: "Le résultat affiché provient du suivi théorique backend. Consultez l’audit pour la chronologie complète.",
    };
  }
  if (manual === "FILLED" || ["ENTRY_FILLED", "OPEN"].includes(theoreticalStatus) || (tradeStatus && !["CLOSED", "CANCELLED", "EXPIRED"].includes(tradeStatus))) {
    return { code: "E", label: "EN POSITION", tone: "success", headline: "Position suivie", instruction: "Surveillez le plan autorisé. Le R officiel n’est affiché que lorsqu’il est publié par le backend." };
  }
  if (manual === "PLACED") {
    return { code: "D", label: "ORDRE DÉCLARÉ", tone: "warning", headline: "Ordre manuel déclaré", instruction: "Attendez le fill réel et déclarez-le. La déclaration ne vaut ni ACK ni FILL broker." };
  }
  const manualActions = theoretical?.manualExecution?.allowedActions ?? [];
  if (model.gateActions.some((action) => action.permission === "ALLOWED") || manualActions.some((action) => action.permission === "ALLOWED") || gateStatus === "CONFIRMED") {
    return { code: "C", label: "PRENABLE", tone: "warning", headline: gateStatus === "CONFIRMED" ? "Dossier autorisé — ordre à déclarer" : "Décision opérateur requise", instruction: gateStatus === "CONFIRMED" ? "Passez l’ordre auprès du broker, puis consignez le prix réellement obtenu." : "Vérifiez le plan immuable puis autorisez ou refusez le dossier." };
  }
  if (model.latestSignal || model.latestContextDecision || model.riskCheck || model.orderIntent) {
    return { code: "B", label: "EN ÉVALUATION", tone: "info", headline: "Le dossier progresse dans les filtres", instruction: "Aucune action n’est autorisée tant que le backend ne publie pas explicitement une capability." };
  }
  return { code: "A", label: "VEILLE", tone: model.truth.tone === "warning" ? "warning" : "neutral", headline: "Aucune décision active", instruction: "Le Desk surveille le marché. Restez prêt sans anticiper de signal." };
}

export function buildManualExecutionCommand(action: LiveManualExecutionAction, input: { price?: number | null; quantity?: number | null; reason?: string }): SubmitDeskCommandInput {
  if (action.permission !== "ALLOWED") throw new Error("MANUAL_EXECUTION_ACTION_NOT_ALLOWED");
  if (action.requiresPrice && !Number.isFinite(input.price)) throw new Error("MANUAL_EXECUTION_PRICE_REQUIRED");
  if (action.requiresQuantity && (!Number.isFinite(input.quantity) || Number(input.quantity) <= 0)) throw new Error("MANUAL_EXECUTION_QUANTITY_REQUIRED");
  if (action.requiresReason && !String(input.reason ?? "").trim()) throw new Error("MANUAL_EXECUTION_REASON_REQUIRED");
  return {
    commandType: action.commandType,
    environment: action.environment,
    expectedVersion: action.expectedRevision,
    reason: String(input.reason ?? "").trim() || undefined,
    payload: {
      ...action.payload,
      actionId: action.actionId,
      ...(Number.isFinite(input.price) ? { price: Number(input.price) } : {}),
      ...(Number.isFinite(input.quantity) ? { quantity: Number(input.quantity) } : {}),
    },
  };
}

export function focusDecisionQueue(intents: readonly LivePortfolioOrderIntent[]): readonly LivePortfolioOrderIntent[] {
  return [...intents].sort((left, right) => {
    const leftActionable = left.humanGate.allowedActions.some((action) => action.permission === "ALLOWED") ? 1 : 0;
    const rightActionable = right.humanGate.allowedActions.some((action) => action.permission === "ALLOWED") ? 1 : 0;
    if (leftActionable !== rightActionable) return rightActionable - leftActionable;
    const leftExpiry = Date.parse(left.allowedActions.expiresAt ?? "");
    const rightExpiry = Date.parse(right.allowedActions.expiresAt ?? "");
    if (Number.isFinite(leftExpiry) && Number.isFinite(rightExpiry) && leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
    return Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
  });
}

function focusOutcomeHeadline(status: string, resultR: number | null): string {
  const outcome = status === "TARGET_HIT" ? "Objectif théorique touché" : status === "STOP_HIT" ? "Stop théorique touché" : "Décision terminée";
  return resultR === null ? outcome : `${outcome} · ${resultR > 0 ? "+" : ""}${resultR.toFixed(2)} R`;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}
