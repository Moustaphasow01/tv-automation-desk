import type { ReactNode } from "react";
import type { DeskTone } from "@/design-system/tokens";
import { useCommandStatus } from "@/domains/front-api/repositories";
import type { CommandAccepted, CommandStatus } from "@/domains/realtime/commandRuntime";

export type DeskButtonVariant = "primary" | "secondary" | "ghost" | "warning" | "danger" | "emergency";

export function DeskButton({
  children,
  variant = "secondary",
  type = "button",
  disabled = false,
  onClick
}: {
  children: ReactNode;
  variant?: DeskButtonVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`action-button action-button--${variant}`} type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function ActionToolbar({ children }: { children: ReactNode }) {
  return <div className="action-toolbar">{children}</div>;
}

export function DrawerShell({
  title,
  open,
  children,
  tone = "neutral"
}: {
  title: string;
  open: boolean;
  children: ReactNode;
  tone?: DeskTone;
}) {
  return (
    <aside className={`drawer-shell drawer-shell--${tone}${open ? " drawer-shell--open" : ""}`} aria-hidden={!open}>
      <header>
        <p className="eyebrow">Drawer</p>
        <h2>{title}</h2>
      </header>
      {children}
    </aside>
  );
}

export function CommandProgressToast({
  commandId,
  status
}: {
  commandId: string;
  status: CommandStatus;
}) {
  return (
    <div className={`command-toast command-toast--${status.toLowerCase()}`} role="status">
      <span>{status}</span>
      <strong>{commandId}</strong>
    </div>
  );
}

export function TrackedCommandReceipt({ command }: { command: CommandAccepted | null }) {
  if (!command) return null;
  return <TrackedCommandReceiptContent command={command} />;
}

function TrackedCommandReceiptContent({ command }: { command: CommandAccepted }) {
  const status = useCommandStatus(command.commandId);
  if (status.isError) return <div className="command-toast command-toast--failed" role="alert"><span>SUIVI INDISPONIBLE</span><strong>{command.commandId}</strong></div>;
  const snapshot = status.data;
  return (
    <div className="command-receipt" aria-live="polite">
      <CommandProgressToast commandId={command.commandId} status={snapshot?.status ?? command.status} />
      {snapshot?.status === "SUCCEEDED" ? (
        <small>Audit Receipt · {snapshot.auditId ?? "identifiant audit indisponible"}</small>
      ) : null}
      {snapshot?.message ? <small>{snapshot.message}</small> : null}
    </div>
  );
}

export function ReasonInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="reason-input">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
    </label>
  );
}
