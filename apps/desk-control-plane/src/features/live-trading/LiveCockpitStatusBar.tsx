import { FaCircle, FaClock, FaLock, FaShieldAlt } from "react-icons/fa";
import { presentAvailability, presentExecutionMode } from "@/design-system/labels";
import { displayTime } from "./mapper";
import type { LiveTradingModel } from "./model";
import { operatorStateForSignal } from "./signalOperatorState";

type MarketScope = { instrument?: string; timeframe?: string };

export function LiveCockpitStatusBar({ model, requestedScope = {}, scopeUpdating = false, onScopeChange }: {
  model: LiveTradingModel;
  requestedScope?: MarketScope;
  scopeUpdating?: boolean;
  onScopeChange(scope: MarketScope): void;
}) {
  const currentInstrument = String(requestedScope.instrument ?? model.marketSeries.instrument ?? "").trim();
  const instruments = uniqueValues(model.marketSeries.supportedInstruments);
  const currentInstrumentIsPublished = instruments.some((value) => value.toUpperCase() === currentInstrument.toUpperCase());
  const instrumentOptions = uniqueValues([
    currentInstrumentIsPublished ? null : currentInstrument,
    ...instruments,
  ]);
  const timeframes = uniqueValues(model.marketSeries.supportedTimeframes.map(normalizeTimeframe))
    .sort((left, right) => timeframeRank(left) - timeframeRank(right));
  const activeTimeframe = normalizeTimeframe(requestedScope.timeframe ?? model.marketSeries.timeframe);
  const activeTimeframeIsPublished = timeframes.includes(activeTimeframe);
  const milestone = nextMilestone(model);
  const signalState = model.latestSignal ? operatorStateForSignal(model, model.latestSignal) : null;
  const operatorLabel = signalState?.label ?? model.operator.label;
  const operatorDetail = signalState?.detail ?? model.operator.detail;
  const operatorTone = signalState?.tone ?? model.operator.tone;

  return (
    <section className="lt-flight-bar" aria-label="Périmètre et état opérationnel du Live">
      <div className="lt-flight-bar__scope">
        <label>
          <span>Instrument</span>
          <select
            aria-label="Instrument du cockpit"
            value={currentInstrument}
            disabled={!instruments.length}
            onChange={(event) => onScopeChange({ instrument: event.target.value })}
          >
            {!currentInstrument ? <option value="">Non publié</option> : null}
            {instrumentOptions.map((instrument) => (
              <option
                key={instrument}
                value={instrument}
                disabled={instrument === currentInstrument && !currentInstrumentIsPublished}
              >
                {instrument}{instrument === currentInstrument && !currentInstrumentIsPublished ? " · périmètre actif non listé" : ""}
              </option>
            ))}
          </select>
          {!instruments.length ? <small className="lt-flight-bar__scope-empty">Périmètres disponibles non publiés</small> : null}
        </label>
        <div className="lt-flight-bar__timeframes" aria-label="Unité de temps du cockpit">
          {timeframes.length ? timeframes.map((timeframe) => (
            <button
              key={timeframe}
              type="button"
              aria-pressed={timeframe === activeTimeframe}
              onClick={() => onScopeChange({ timeframe })}
            >
              {formatTimeframe(timeframe)}
            </button>
          )) : <span className="lt-flight-bar__scope-empty">Unités disponibles non publiées{activeTimeframe ? ` · actif ${formatTimeframe(activeTimeframe)}` : ""}</span>}
          {timeframes.length && activeTimeframe && !activeTimeframeIsPublished ? (
            <span className="lt-flight-bar__scope-empty">Actif {formatTimeframe(activeTimeframe)} · hors catalogue publié</span>
          ) : null}
        </div>
        {scopeUpdating ? <span className="lt-flight-bar__scope-progress" role="status">Mise à jour du graphique…</span> : null}
      </div>

      <div className={`lt-flight-bar__operator lt-flight-bar__operator--${signalState?.code.toLowerCase() ?? "desk"} lt-flight-tone--${operatorTone}`} role="status">
        <FaCircle aria-hidden="true" />
        <div><small>Décision opérateur</small><strong>{operatorLabel}</strong></div>
        <span>{operatorDetail}</span>
      </div>

      <div className="lt-flight-bar__milestone">
        <FaClock aria-hidden="true" />
        <div><small>{milestone.label}</small><strong>{displayTime(milestone.at)}</strong><span>{remainingLabel(milestone.at, model.meta.asOf)}</span></div>
      </div>

      <div className="lt-flight-bar__authority">
        <span><FaShieldAlt aria-hidden="true" />{presentExecutionMode(model.mode.executionMode).label}</span>
        <span className={model.mode.autoExecutionEnabled ? "is-danger" : "is-safe"}><FaLock aria-hidden="true" />Auto {model.mode.autoExecutionEnabled ? "activée" : "désactivée"}</span>
        <small>{presentAvailability(model.freshness.marketData).label} · {model.marketSeries.source} · arrêté à {displayTime(model.marketSeries.asOf)}</small>
      </div>
    </section>
  );
}

function remainingLabel(value: string | null, reference: string): string {
  const valueAt = timestamp(value);
  const referenceAt = timestamp(reference);
  if (valueAt === null || referenceAt === null) return "Échéance non publiée";
  const seconds = Math.floor((valueAt - referenceAt) / 1000);
  if (seconds <= 0) return "Échéance dépassée";
  if (seconds < 60) return `${seconds} s restantes`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min restantes`;
  return `${Math.floor(seconds / 3600)} h ${Math.ceil((seconds % 3600) / 60)} min restantes`;
}

function nextMilestone(model: LiveTradingModel): { label: string; at: string | null } {
  const asOf = timestamp(model.meta.asOf);
  const gateExpiry = model.orderIntent?.allowedActions.expiresAt ?? null;
  if (gateExpiry) return { label: isAtOrBefore(gateExpiry, asOf) ? "Validation expirée" : "Expiration de votre validation", at: gateExpiry };
  if (model.latestSignal?.expiresAt) {
    return {
      label: isAtOrBefore(model.latestSignal.expiresAt, asOf) ? "Signal expiré" : "Expiration du signal",
      at: model.latestSignal.expiresAt,
    };
  }
  const evaluations = model.strategyInstances
    .map((instance) => instance.nextEvaluationAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => (timestamp(left) ?? Number.MAX_SAFE_INTEGER) - (timestamp(right) ?? Number.MAX_SAFE_INTEGER));
  const nextEvaluation = evaluations.find((value) => {
    const valueAt = timestamp(value);
    return valueAt !== null && (asOf === null || valueAt > asOf);
  }) ?? null;
  if (nextEvaluation) return { label: "Prochaine évaluation", at: nextEvaluation };
  return { label: evaluations.length ? "Évaluation en retard" : "Prochaine évaluation", at: evaluations.at(-1) ?? null };
}

function timestamp(value: string | null | undefined): number | null {
  const parsed = new Date(value ?? "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isAtOrBefore(value: string, reference: number | null): boolean {
  const valueAt = timestamp(value);
  return valueAt !== null && reference !== null && valueAt <= reference;
}

function uniqueValues(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function formatTimeframe(value: string): string {
  if (value === "60") return "H1";
  if (value === "240") return "H4";
  if (value === "D" || value === "1D") return "D1";
  return `M${value}`;
}

function normalizeTimeframe(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/^M/, "");
  if (["H1", "1H", "60"].includes(normalized)) return "60";
  if (["H4", "4H", "240"].includes(normalized)) return "240";
  if (["D", "D1", "1D", "1440"].includes(normalized)) return "D";
  return normalized;
}

function timeframeRank(value: string): number {
  return ["1", "5", "15", "60", "240", "D"].indexOf(value) === -1
    ? Number.MAX_SAFE_INTEGER
    : ["1", "5", "15", "60", "240", "D"].indexOf(value);
}
