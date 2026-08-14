import type { ReactNode } from "react";

export function OperatorPageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="operator-page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="operator-page-actions">{actions}</div> : null}
    </section>
  );
}

export function InlineAction({ children }: { children: ReactNode }) {
  return <span className="inline-label" aria-label={`Contexte : ${String(children)}`}>{children}</span>;
}

export function MetricBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="metric-box">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}
