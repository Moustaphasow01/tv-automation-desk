import { useEffect, useId, useRef, type ReactNode } from "react";
import { FiX } from "react-icons/fi";

/** Native modal supplies focus trapping, background inertness and Escape semantics. */
export function WorkspaceDialog({ title, onClose, children, busy = false }: {
  title: string; onClose(): void; children: ReactNode; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="tw-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="Fermer"><FiX aria-hidden="true" /></button></header>
    <div className="tw-dialog__content">{children}</div>
  </dialog>;
}
