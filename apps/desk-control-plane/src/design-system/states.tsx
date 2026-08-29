import { useEffect, type ReactNode } from "react";
import { Card } from "@/design-system/primitives";
import type { ViewMeta } from "@/shared/contracts";
import { emitFrontTelemetry } from "@/core/telemetry/frontendTelemetry";
import { presentOperatorText } from "./labels";

export type ViewLoadState = "loading" | "ready" | "empty" | "partial" | "stale" | "error" | "forbidden";

const VIEW_STATE_EYEBROWS: Record<Exclude<ViewLoadState, "ready" | "partial" | "stale">, string> = {
  loading: "CHARGEMENT",
  empty: "VIDE",
  error: "ERREUR",
  forbidden: "INTERDIT",
};

export function ViewStatePanel({
  state,
  title,
  detail,
  onRetry,
}: {
  state: Exclude<ViewLoadState, "ready" | "partial" | "stale">;
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  useViewStateInstrumentation(state, title);
  return (
    <Card
      title={title}
      eyebrow={VIEW_STATE_EYEBROWS[state]}
      state={state === "loading" ? "loading" : state === "empty" ? "empty" : "error"}
      tone={state === "error" || state === "forbidden" ? "danger" : "neutral"}
      density="compact"
    >
      <p>{detail}</p>
      {onRetry && state === "error" ? <button type="button" onClick={onRetry}>Réessayer</button> : null}
    </Card>
  );
}

export function ViewTruthBanner({ meta }: { meta: ViewMeta }) {
  const state = meta.stale || meta.availability === "STALE"
    ? "stale"
    : meta.availability === "PARTIAL" || meta.availability === "UNAVAILABLE"
      ? "partial"
      : "ready";
  useViewStateInstrumentation(state, meta.correlationId);
  if (state === "ready") return null;
  return (
    <div className={`view-truth-banner view-truth-banner--${state}`} role="status">
      <strong>{state === "stale" ? "Données périmées" : "Projection partielle"}</strong>
      <span>{meta.warnings?.length ? meta.warnings.map((warning) => presentOperatorText(warning)).join(" · ") : "Une ou plusieurs sources backend ne répondent pas."}</span>
      <small>asOf {meta.asOf} · corrélation {meta.correlationId}</small>
    </div>
  );
}

export function DataBoundary<T>({
  value,
  children,
  empty,
}: {
  value: readonly T[];
  children: (value: readonly T[]) => ReactNode;
  empty: ReactNode;
}) {
  return value.length ? <>{children(value)}</> : <div className="data-empty-state">{empty}</div>;
}

function useViewStateInstrumentation(state: ViewLoadState, context: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    emitFrontTelemetry("front.view.state", { state, context });
  }, [context, state]);
}
