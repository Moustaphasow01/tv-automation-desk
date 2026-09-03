import { displayValue } from "./mapper";
import type { LiveTradingModel } from "./model";

export type FocusTradePlan = {
  authority: "AUTHORIZED" | "PROPOSED" | "UNAVAILABLE";
  authorityLabel: string;
  actionable: boolean;
  instrument: string;
  side: string;
  orderType: string;
  quantity: string;
  entry: string;
  stop: string;
  targets: readonly string[];
  expectedR: string;
};

export function focusTradePlan(model: LiveTradingModel): FocusTradePlan {
  const authorized = model.selectedTheoreticalExecution;
  const proposed = model.selectedSignalPlan;
  const quantity = authorized?.quantity ?? model.orderIntent?.quantity ?? null;
  const authorizedTargets = authorized?.targets
    .filter((target) => target.price !== null)
    .map((target) => displayValue(target.price)) ?? [];
  const referenceTime = Date.parse(model.meta.asOf);
  const expiresAt = model.orderIntent?.allowedActions.expiresAt ?? model.latestSignal?.expiresAt ?? null;
  const expiryTime = Date.parse(expiresAt ?? "");
  const expired = Number.isFinite(referenceTime) && Number.isFinite(expiryTime) && expiryTime <= referenceTime;
  const confirmAllowed = model.gateActions.some((action) => action.action === "CONFIRM" && action.permission === "ALLOWED");
  const manualAllowed = authorized?.manualExecution?.allowedActions.some((action) => action.permission === "ALLOWED") ?? false;
  const authorizedComplete = Boolean(
    authorized?.entry !== null
    && authorized?.entry !== undefined
    && authorized.stop !== null
    && authorized.stop !== undefined
    && authorizedTargets.length
    && Number.isFinite(Number(quantity))
    && Number(quantity) > 0,
  );

  if (authorizedComplete) {
    return {
      authority: "AUTHORIZED",
      authorityLabel: "Plan autorisé après contrôle du risque",
      actionable: !expired && (confirmAllowed || manualAllowed),
      instrument: authorized?.instrument ?? model.latestSignal?.symbol ?? "—",
      side: authorized?.side ?? model.latestSignal?.direction ?? "—",
      orderType: authorized?.orderType ?? "Non publié",
      quantity: displayValue(quantity, "Non publiée"),
      entry: displayValue(authorized?.entry, "Non publiée"),
      stop: displayValue(authorized?.stop, "Non publié"),
      targets: authorizedTargets,
      expectedR: authorized?.expectedR === null || authorized?.expectedR === undefined
        ? "Non publié"
        : `${authorized.expectedR.toFixed(2)} R`,
    };
  }

  if (proposed) {
    return {
      authority: "PROPOSED",
      authorityLabel: "Niveaux proposés — en attente d’autorisation",
      actionable: false,
      instrument: model.latestSignal?.symbol ?? "—",
      side: model.latestSignal?.direction ?? "—",
      orderType: proposed.orderType,
      quantity: "Non publiée",
      entry: proposed.entry,
      stop: proposed.stop,
      targets: proposed.targets.map(stripTargetPrefix),
      expectedR: proposed.expectedR,
    };
  }

  return {
    authority: "UNAVAILABLE",
    authorityLabel: "Niveaux non publiés",
    actionable: false,
    instrument: model.latestSignal?.symbol ?? "—",
    side: model.latestSignal?.direction ?? "—",
    orderType: "Non publié",
    quantity: "Non publiée",
    entry: "Non publiée",
    stop: "Non publié",
    targets: [],
    expectedR: "Non publié",
  };
}

function stripTargetPrefix(value: string): string {
  return value.replace(/^(?:TP|T|TARGET|OBJECTIF)\s*\d+\s*[:·-]?\s*/i, "").trim() || value;
}
