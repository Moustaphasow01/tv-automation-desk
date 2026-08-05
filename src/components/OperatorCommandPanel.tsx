import { useState } from "react";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Card, Icon, StatusBadge } from "@/components/common";
import { useOverlay } from "@/context/OverlayContext";
import { useOperatorAuth, useOperatorCommand, useOperatorState } from "@/hooks/useOperator";
import type { DeskOperatorCapability, DeskOperatorCommandType, DeskSession } from "@/types";

const commandLabels: Record<DeskOperatorCommandType, string> = {
  cancel_setup: "Annuler le setup",
  confirm_trigger: "Confirmer le trigger",
  move_break_even: "Déplacer au break-even",
  take_partial: "Prendre un partiel",
  exit_position: "Sortir de la position",
  request_replan: "Demander un replan"
};

export function OperatorCommandPanel({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  const auth = useOperatorAuth();
  const stateQuery = useOperatorState(data);
  const command = useOperatorCommand(data);
  const [feedback, setFeedback] = useState<string | null>(null);
  const state = stateQuery.data;
  const canWrite = auth.status === "ready";

  const openConfirmation = (capability: DeskOperatorCapability) => {
    if (!state || !capability.enabled || !canWrite) return;
    overlay.openModal(commandLabels[capability.command], <OperatorConfirmation
      capability={capability}
      revision={state.revision}
      onCancel={overlay.closeModal}
      onConfirm={async values => {
        const result = await command.mutateAsync({
          command: capability.command,
          expectedRevision: state.revision,
          idempotencyKey: createIdempotencyKey(capability.command),
          confirmationPhrase: values.confirmationPhrase,
          targetId: capability.targetId || undefined,
          reason: values.reason,
          ...(capability.command === "take_partial" ? { partialFraction: values.partialFraction } : {})
        });
        setFeedback(`${commandLabels[capability.command]} enregistrée · révision ${result.command.revision} · audit ${result.command.auditId}`);
        overlay.closeModal();
      }}
    />);
  };

  return <Card className="operator-panel">
    <div className="operator-panel__head">
      <div><p className="eyebrow">Commandes opérateur</p><h3>État canonique uniquement</h3></div>
      <StatusBadge tone={canWrite ? "info" : auth.status === "loading" ? "warning" : "muted"}>
        {canWrite ? "AUTHENTIFIÉ" : auth.status === "loading" ? "CONNEXION" : "LECTURE SEULE"}
      </StatusBadge>
    </div>
    <p className="operator-panel__notice">Chaque action exige une confirmation textuelle, la révision courante et une clé d’idempotence. Aucun ordre broker n’est envoyé.</p>
    <div className="operator-panel__identity">
      <span>{auth.email || auth.message || "PIN opérateur requis pour écrire"}</span>
      {!canWrite && auth.status !== "loading" && auth.status !== "unavailable" && <button type="button" className="secondary-btn" onClick={() => void auth.signIn()}>Se connecter</button>}
      {canWrite && <button type="button" className="text-btn" onClick={() => void auth.signOut()}>Déconnexion</button>}
    </div>
    {stateQuery.isError && <p className="operator-feedback operator-feedback--error">{stateQuery.error.message}</p>}
    {feedback && <p className="operator-feedback"><Icon name="check" size={16}/>{feedback}</p>}
    <div className="operator-command-grid">
      {(state?.allowedCommands || []).map(capability => <button
        type="button"
        key={capability.command}
        className={`operator-command operator-command--${capability.dangerLevel}`}
        disabled={!canWrite || !capability.enabled || command.isPending}
        onClick={() => openConfirmation(capability)}
        title={capability.reason || commandLabels[capability.command]}
      >
        <strong>{commandLabels[capability.command]}</strong>
        <span>{capability.enabled ? capability.targetId || "Session active" : humanReason(capability.reason)}</span>
      </button>)}
    </div>
    {state && <div className="operator-panel__revision"><span>Révision opérateur</span><strong>{state.revision}</strong><span>Broker</span><strong>désactivé</strong></div>}
  </Card>;
}

export function OperatorConfirmation({
  capability,
  revision,
  onCancel,
  onConfirm
}: {
  capability: DeskOperatorCapability;
  revision: number;
  onCancel: () => void;
  onConfirm: (values: { confirmationPhrase: string; reason: string; partialFraction: number }) => Promise<void>;
}) {
  const [partialFraction, setPartialFraction] = useState(0.5);
  return <ConfirmActionForm
    target={capability.targetId || "Session active"}
    revision={revision}
    expectedPhrase={capability.confirmationPhrase}
    onCancel={onCancel}
    danger={capability.dangerLevel === "critical"}
    validateExtra={() => partialFraction > 0 && partialFraction < 1}
    onConfirm={({ confirmationPhrase, reason }) => onConfirm({ confirmationPhrase, reason, partialFraction })}
  >
    {capability.command === "take_partial" && <label>
      Fraction à sortir
      <select value={partialFraction} onChange={event => setPartialFraction(Number(event.target.value))}>
        <option value={0.25}>25 %</option><option value={0.5}>50 %</option><option value={0.75}>75 %</option>
      </select>
    </label>}
  </ConfirmActionForm>;
}

export function operatorConfirmationIsValid(confirmationPhrase: string, expectedPhrase: string, reason: string) {
  return confirmationPhrase === expectedPhrase && reason.trim().length >= 3;
}

function createIdempotencyKey(command: DeskOperatorCommandType) {
  const random = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `front:${command}:${random}`;
}

function humanReason(reason: string | null) {
  return ({
    canonical_setup_missing: "Aucun setup canonique",
    setup_terminal: "Setup déjà terminé",
    setup_already_triggered: "Trigger déjà confirmé",
    active_position_missing: "Aucune position active",
    position_not_active: "Position inactive",
    position_entry_missing: "Prix d’entrée manquant",
    active_thesis_missing: "Aucune thèse active"
  } as Record<string, string>)[reason || ""] || "Action indisponible";
}
