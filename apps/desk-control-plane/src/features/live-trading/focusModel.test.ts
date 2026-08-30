import { describe, expect, it } from "vitest";
import type { LiveManualExecutionAction } from "@/domains/front-api/viewModels";
import { buildManualExecutionCommand, focusDecisionQueue, resolveLiveFocusState } from "./focusModel";
import type { LiveTradingModel } from "./model";

describe("Live Focus state machine", () => {
  it("keeps Human Gate confirmation distinct from a manual order declaration", () => {
    const model = baseModel({ gateStatus: "CONFIRMED", manualStatus: "NOT_REPORTED", manualActions: [manualAction("REPORT_PLACED")] });
    const state = resolveLiveFocusState(model);
    expect(state.code).toBe("C");
    expect(state.headline).toContain("ordre à déclarer");
  });

  it("maps manual placement, theoretical fill and terminal outcome to distinct states", () => {
    expect(resolveLiveFocusState(baseModel({ manualStatus: "PLACED" })).code).toBe("D");
    expect(resolveLiveFocusState(baseModel({ manualStatus: "FILLED" })).code).toBe("E");
    expect(resolveLiveFocusState(baseModel({ theoreticalStatus: "TARGET_HIT", tradeStatus: "CLOSED", resultR: 1.5 })).code).toBe("F");
  });

  it("requires backend-provided values before building a manual declaration", () => {
    const action = manualAction("REPORT_PLACED");
    expect(() => buildManualExecutionCommand(action, { price: null, quantity: 2 })).toThrow("MANUAL_EXECUTION_PRICE_REQUIRED");
    expect(buildManualExecutionCommand(action, { price: 471.25, quantity: 2 })).toMatchObject({
      commandType: "execution.order_intent.manual_placed",
      environment: "PAPER",
      payload: { price: 471.25, quantity: 2 },
    });
  });

  it("prioritizes actionable decisions then the nearest expiry", () => {
    const queue = focusDecisionQueue([
      intent("late", "2026-08-30T15:30:00.000Z", false),
      intent("urgent", "2026-08-30T15:05:00.000Z", true),
      intent("actionable-later", "2026-08-30T15:10:00.000Z", true),
    ]);
    expect(queue.map((item) => item.signalId)).toEqual(["urgent", "actionable-later", "late"]);
  });
});

function baseModel({ gateStatus = "AWAITING_MANUAL_CONFIRMATION", manualStatus = "NOT_REPORTED", manualActions = [], theoreticalStatus = "AWAITING_ENTRY", tradeStatus = "", resultR = null }: { gateStatus?: string; manualStatus?: string; manualActions?: LiveManualExecutionAction[]; theoreticalStatus?: string; tradeStatus?: string; resultR?: number | null } = {}): LiveTradingModel {
  return {
    truth: { tone: "success" },
    gateActions: [],
    latestSignal: { signalId: "signal-1" },
    latestContextDecision: null,
    riskCheck: null,
    orderIntent: { humanGate: { status: gateStatus } },
    selectedTheoreticalExecution: {
      status: theoreticalStatus,
      tradeStatus,
      resultR,
      manualExecutionStatus: manualStatus,
      manualExecution: { status: manualStatus, allowedActions: manualActions, denialReasons: [] },
    },
  } as unknown as LiveTradingModel;
}

function manualAction(action: LiveManualExecutionAction["action"]): LiveManualExecutionAction {
  return {
    action,
    actionId: `manual.${action}`,
    eventType: action.replace("REPORT_", "") as LiveManualExecutionAction["eventType"],
    commandType: `execution.order_intent.manual_${action.replace("REPORT_", "").toLowerCase()}`,
    label: action,
    environment: "PAPER",
    permission: "ALLOWED",
    requiresConfirmation: true,
    requiresReason: false,
    requiresPrice: ["REPORT_PLACED", "REPORT_FILLED", "REPORT_CLOSED"].includes(action),
    requiresQuantity: ["REPORT_PLACED", "REPORT_FILLED"].includes(action),
    expectedRevision: "7",
    impactPreview: "Observation only",
    payload: { portfolioOrderIntentId: "intent-1" },
  };
}

function intent(signalId: string, expiresAt: string, actionable: boolean) {
  return {
    portfolioOrderIntentId: `intent-${signalId}`,
    signalId,
    createdAt: "2026-08-30T14:00:00.000Z",
    humanGate: { allowedActions: actionable ? [{ permission: "ALLOWED" }] : [] },
    allowedActions: { expiresAt },
  } as unknown as LiveTradingModel["source"]["portfolioOrderIntents"][number];
}
