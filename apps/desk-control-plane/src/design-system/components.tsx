import type { ReactNode } from "react";

export function SurfaceCard({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "warning";
}) {
  return <section className={`surface-card surface-card--${tone}`}>{children}</section>;
}

export function StatusPill({
  children,
  status = "neutral"
}: {
  children: ReactNode;
  status?: "neutral" | "ok" | "pending" | "warning";
}) {
  return <span className={`status-pill status-pill--${status}`}>{children}</span>;
}
