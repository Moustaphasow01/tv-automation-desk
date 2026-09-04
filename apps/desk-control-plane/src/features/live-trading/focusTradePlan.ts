import type { LiveFocusView } from "@/domains/front-api/viewModels";
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

export function focusTradePlanFromCard(card: LiveFocusView["tradeCards"][number]): FocusTradePlan {
  const plan = recordValue(card.riskAuthorizedPlan ?? card.contextAdjustedPlan ?? card.strategyProposedPlan);
  const entry = recordValue(plan.entry);
  const stop = recordValue(plan.stop);
  const targets = recordRows(plan.targets)
    .map((target) => displayValue(target.price ?? target.value ?? target.targetPrice ?? target.target_price, ""))
    .filter(Boolean);
  const allowed = card.allowedActions.map((action) => String(action).trim().toUpperCase());
  return {
    authority: card.riskAuthorizedPlan ? "AUTHORIZED" : card.contextAdjustedPlan || card.strategyProposedPlan ? "PROPOSED" : "UNAVAILABLE",
    authorityLabel: card.riskAuthorizedPlan ? "Plan autorisé après contrôle du risque" : card.contextAdjustedPlan ? "Plan ajusté par le contexte — non final" : card.strategyProposedPlan ? "Plan proposé par la stratégie — non final" : "Niveaux non publiés",
    actionable: Boolean((card.actionable ?? allowed.includes("CONFIRM")) && !card.terminal && !card.expiredByTime),
    instrument: card.instrument,
    side: card.side,
    orderType: String(plan.orderType ?? plan.order_type ?? "Non publié"),
    quantity: displayValue(card.authorizedQuantity, "Non publiée"),
    entry: displayValue(entry.price ?? entry.value ?? entry.mid ?? plan.entryPrice ?? plan.entry_price, "Non publiée"),
    stop: displayValue(stop.price ?? stop.value ?? stop.mid ?? plan.stopPrice ?? plan.stop_price, "Non publié"),
    targets,
    expectedR: card.expectedR === null || card.expectedR === undefined ? "Non publié" : `${displayValue(card.expectedR)} R`,
  };
}

function stripTargetPrefix(value: string): string {
  return value.replace(/^(?:TP|T|TARGET|OBJECTIF)\s*\d+\s*[:·-]?\s*/i, "").trim() || value;
}

function recordRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
