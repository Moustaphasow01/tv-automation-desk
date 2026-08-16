import type { ReactNode } from "react";
import { FaInfoCircle } from "react-icons/fa";

export function CommandPanel({ title, code, action, className = "", children }: { title: string; code?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`cc-panel ${className}`}>
      <header><h2>{code ? <b>{code}. </b> : null}{title}</h2><FaInfoCircle aria-hidden="true" />{action ? <div>{action}</div> : null}</header>
      <div className="cc-panel__body">{children}</div>
    </section>
  );
}

export function PanelStatus({ tone, children }: { tone: "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  return <span className={`cc-status cc-status--${tone}`}>{children}</span>;
}

export function EmptyPanelState({ label = "Données non publiées par le backend" }: { label?: string }) {
  return <div className="cc-empty"><strong>UNAVAILABLE</strong><span>{label}</span></div>;
}
