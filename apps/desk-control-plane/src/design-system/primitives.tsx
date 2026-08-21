import type { CSSProperties, ReactNode } from "react";
import type { DeskDensity, DeskTone } from "@/design-system/tokens";

export type CardState = "nominal" | "loading" | "empty" | "stale" | "partial" | "degraded" | "error" | "readonly";

type CardProps = {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: DeskTone;
  density?: DeskDensity;
  state?: CardState;
  interactive?: boolean;
  children: ReactNode;
};

export function Card({
  title,
  eyebrow,
  description,
  actions,
  footer,
  tone = "neutral",
  density = "comfortable",
  state = "nominal",
  interactive = false,
  children
}: CardProps) {
  return (
    <section
      className={[
        "ds-card",
        `ds-card--${tone}`,
        `ds-card--${density}`,
        `ds-card--${state}`,
        interactive ? "ds-card--interactive" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title || eyebrow || actions ? (
        <header className="ds-card__header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2>{title}</h2> : null}
            {description ? <p className="ds-card__description">{description}</p> : null}
          </div>
          {actions ? <div className="ds-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ds-card__body">{children}</div>
      {footer ? <footer className="ds-card__footer">{footer}</footer> : null}
    </section>
  );
}

type KpiCardProps = {
  label: string;
  value: string;
  delta?: string;
  tone?: DeskTone;
  state?: CardState;
  detail?: ReactNode;
};

export function KpiCard({ label, value, delta, tone = "neutral", state = "nominal", detail }: KpiCardProps) {
  return (
    <Card tone={tone} density="compact" state={state}>
      <div className="kpi-card">
        <span>{label}</span>
        <strong>{value}</strong>
        {delta ? <small>{delta}</small> : null}
        {detail ? <div className="kpi-card__detail">{detail}</div> : null}
      </div>
    </Card>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: DeskTone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function DataFreshnessBanner({
  stale,
  generatedAt,
  latencyMs
}: {
  stale: boolean;
  generatedAt: string;
  latencyMs?: number;
}) {
  return (
    <div className={`freshness-banner${stale ? " freshness-banner--stale" : ""}`}>
      <StatusBadge tone={stale ? "warning" : "success"}>{stale ? "Périmé" : "À jour"}</StatusBadge>
      <span>Généré {formatDateTime(generatedAt)}</span>
      {typeof latencyMs === "number" ? <span>{latencyMs} ms</span> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = "accent"
}: {
  value: number;
  label?: string;
  tone?: DeskTone;
}) {
  const numericValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(100, numericValue));
  return (
    <div className="progress-wrap" aria-label={label ?? `Progression ${Math.round(clamped)} %`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
      <div className={`progress-bar progress-bar--${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Sparkline({ points, tone = "accent" }: { points: readonly number[]; tone?: DeskTone }) {
  const width = 160;
  const height = 42;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min || 1;
  const d = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point - min) / spread) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`sparkline sparkline--${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mini-graphique">
      <path d={d} />
    </svg>
  );
}

export function Gauge({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="gauge" style={{ "--gauge-value": `${clamped}%` } as CSSProperties}>
      <div className="gauge__ring">
        <strong>{clamped}%</strong>
      </div>
      <span>{label}</span>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
