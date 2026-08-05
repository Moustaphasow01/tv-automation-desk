import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/common";

export type ConfirmActionValues = {
  confirmationPhrase: string;
  reason: string;
};

type ConfirmActionFormProps = {
  target: string;
  revision: number;
  expectedPhrase: string;
  onCancel: () => void;
  onConfirm: (values: ConfirmActionValues) => Promise<void>;
  confirmLabel?: string;
  danger?: boolean;
  children?: ReactNode;
  validateExtra?: () => boolean;
};

export function ConfirmActionForm({
  target,
  revision,
  expectedPhrase,
  onCancel,
  onConfirm,
  confirmLabel = "Confirmer l’écriture",
  danger = false,
  children,
  validateExtra = () => true
}: ConfirmActionFormProps) {
  const reasonId = useId();
  const confirmationId = useId();
  const [reason, setReason] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirmationPhrase === expectedPhrase && reason.trim().length >= 3 && validateExtra();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ confirmationPhrase, reason: reason.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };

  return <form className="confirm-action" onSubmit={submit}>
    <div className="confirm-action__scope" aria-label="Portée de l’action">
      <div><span>Cible</span><strong>{target}</strong></div>
      <div><span>Révision attendue</span><strong className="mono">{revision}</strong></div>
    </div>
    <div className="confirm-action__warning">
      <Icon name="alert" size={18}/>
      <p>Cette écriture est journalisée et ne sera appliquée que si la révision canonique correspond toujours.</p>
    </div>
    <label htmlFor={reasonId}>
      Justification opérateur
      <textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Pourquoi cette action est-elle justifiée maintenant ?" autoFocus required/>
      <small>{reason.trim().length}/500 · minimum 3 caractères</small>
    </label>
    {children}
    <label htmlFor={confirmationId}>
      Confirmation explicite
      <span className="confirm-action__phrase">Recopiez <code>{expectedPhrase}</code></span>
      <input id={confirmationId} value={confirmationPhrase} onChange={event => setConfirmationPhrase(event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} placeholder={expectedPhrase} required/>
    </label>
    {error && <p className="operator-feedback operator-feedback--error" role="alert">{error}</p>}
    <div className="modal__actions">
      <button type="button" className="secondary-btn" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className={danger ? "danger-btn" : "primary-btn"} disabled={!confirmed || submitting}>
        {submitting ? "Enregistrement…" : confirmLabel}
      </button>
    </div>
  </form>;
}
