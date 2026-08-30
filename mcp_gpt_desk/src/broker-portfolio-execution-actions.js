const PORTFOLIO_EXECUTION_ACTIONS = new Set([
  "ensure_human_execution_gate",
  "confirm_human_execution_gate",
  "reject_human_execution_gate",
  "undo_human_execution_gate",
  "claim_provider_command",
  "complete_provider_dispatch",
  "record_broker_provider_event",
]);

export async function maybeExecutePortfolioExecutionAction({
  input,
  actorName,
  service,
  requirePhrase,
} = {}) {
  if (!PORTFOLIO_EXECUTION_ACTIONS.has(input?.action)) return { handled: false, result: null };
  if (input.action === "ensure_human_execution_gate") return handled(await service.ensureHumanGate(input));
  if (input.action === "confirm_human_execution_gate") {
    requirePhrase(input.confirmationPhrase, "CONFIRM_PORTFOLIO_ORDER_INTENT");
    return handled(await service.confirmHumanGate({ ...input, operatorId: actorName }));
  }
  if (input.action === "reject_human_execution_gate") {
    requirePhrase(input.confirmationPhrase, "CONFIRM_REJECT");
    return handled(await service.rejectHumanGate({ ...input, operatorId: actorName }));
  }
  if (input.action === "undo_human_execution_gate") {
    requirePhrase(input.confirmationPhrase, "CONFIRM_UNDO_HUMAN_GATE");
    return handled(await service.undoHumanGate({ ...input, operatorId: actorName }));
  }
  if (input.action === "claim_provider_command") return handled(await service.claimProviderCommand(input));
  if (input.action === "complete_provider_dispatch") return handled(await service.completeProviderDispatch(input));
  return handled(await service.recordBrokerProviderEvent(input));
}

function handled(result) {
  return { handled: true, result };
}
