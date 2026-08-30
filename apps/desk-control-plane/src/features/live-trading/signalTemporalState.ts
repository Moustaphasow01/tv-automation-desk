import { presentSignalState } from "@/design-system/labels";

export type SignalTemporalInput = {
  state: string;
  effectiveState?: string | null;
  expiresAt?: string | null;
  stateAsOf?: string | null;
};

export type SignalTemporalPresentation = {
  backendState: string;
  effectiveState: string;
  label: string;
  tone: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  expiredByTime: boolean;
  mismatch: boolean;
  detail: string;
};

const NON_TERMINAL_STATES = new Set(["NEW", "ARBITRATED"]);

export function resolveSignalTemporalState(
  signal: SignalTemporalInput,
  projectionAsOf: string | number,
): SignalTemporalPresentation {
  const backendState = normalizeState(signal.state);
  const publishedEffectiveState = normalizeState(signal.effectiveState);
  const asOfMs = typeof projectionAsOf === "number" ? projectionAsOf : Date.parse(projectionAsOf);
  const expiresAtMs = Date.parse(signal.expiresAt ?? "");
  const expiredByClock = NON_TERMINAL_STATES.has(backendState)
    && Number.isFinite(asOfMs)
    && Number.isFinite(expiresAtMs)
    && expiresAtMs <= asOfMs;
  const effectiveState = publishedEffectiveState || (expiredByClock ? "EXPIRED" : backendState);
  const mismatch = effectiveState === "EXPIRED" && backendState !== "EXPIRED";
  const presentation = presentSignalState(effectiveState);
  const backendPresentation = presentSignalState(backendState);

  return {
    backendState,
    effectiveState,
    label: presentation.label,
    tone: presentation.tone,
    expiredByTime: effectiveState === "EXPIRED" && (expiredByClock || publishedEffectiveState === "EXPIRED"),
    mismatch,
    detail: mismatch
      ? `L’échéance est dépassée ; l’état enregistré reste « ${backendPresentation.label} ».`
      : effectiveState === "EXPIRED"
        ? "La fenêtre de validité du signal est terminée."
        : `État enregistré : ${backendPresentation.label}.`,
  };
}

function normalizeState(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}
