import { useState } from "react";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import { buildHumanGateCommand, type HumanGateAction } from "./model";

export function useOrderDossier(orderId: string | undefined) {
  const query = useFrontView("order-detail", { orderId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const submit = async (action: HumanGateAction, reason: string) => {
    setSubmittingActionId(action.actionId);
    setError(null);
    try {
      const accepted = await repository.submitCommand(buildHumanGateCommand(action, reason));
      setCommand(accepted);
      await query.refetch();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "HUMAN_GATE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };
  return { query, command, error, submittingActionId, submit };
}
