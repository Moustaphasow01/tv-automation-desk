import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FaBullseye, FaChartLine, FaClock, FaFilter, FaSearch } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentDataAbsence, presentGeneric } from "@/design-system/labels";
import { displayTime, displayValue } from "./mapper";
import type { LiveTradingModel } from "./model";
import { resolveSignalTemporalState } from "./signalTemporalState";
import { operatorStateForSignal, type SignalOperatorStateCode } from "./signalOperatorState";

type SignalRow = LiveTradingModel["source"]["signals"][number];

export type LiveSignalNavigationTarget = {
  signalId: string;
  instrument: string;
  at: string;
  timeframe?: string | null;
};

export type LiveSignalInboxProps = {
  model: LiveTradingModel;
  selectedSignalId?: string | null;
  onSelectSignal?(target: LiveSignalNavigationTarget): void;
  onClearSignal?(): void;
  onShowOnChart?(target: LiveSignalNavigationTarget): void;
};

export function LiveSignalInbox({
  model,
  selectedSignalId,
  onSelectSignal,
  onClearSignal,
  onShowOnChart,
}: LiveSignalInboxProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const instrument = searchParams.get("signalInstrument") || "ALL";
  const status = searchParams.get("signalState") || "ALL";
  const search = searchParams.get("signalQuery") || "";
  const lane = searchParams.get("signalLane") || "ACTIVE";
  const requestedPage = Number(searchParams.get("signalPage") || "1");
  const signals = useMemo(() => allSignals(model), [model]);
  const instruments = useMemo(() => unique(signals.map((signal) => signal.symbol)), [signals]);
  const states = useMemo(() => unique(signals.map((signal) => operatorStateForSignal(model, signal).code)), [model, signals]);
  const filtered = useMemo(() => signals.filter((signal) => {
    const operatorState = operatorStateForSignal(model, signal).code;
    const matchesInstrument = instrument === "ALL" || signal.symbol === instrument;
    const matchesStatus = status === "ALL" || operatorState === status;
    const matchesLane = lane === "ALL" || (lane === "ACTIVE" ? !["EXPIRED", "REJECTED"].includes(operatorState) : ["EXPIRED", "REJECTED"].includes(operatorState));
    const needle = search.trim().toLocaleLowerCase("fr-FR");
    const matchesSearch = !needle || `${signal.signalId} ${signal.strategyId} ${signal.symbol} ${signal.direction}`
      .toLocaleLowerCase("fr-FR")
      .includes(needle);
    return matchesInstrument && matchesStatus && matchesLane && matchesSearch;
  }).sort((left, right) => urgencyRank(model, left) - urgencyRank(model, right) || expiryRank(left) - expiryRank(right) || Date.parse(right.createdAt) - Date.parse(left.createdAt)), [instrument, lane, model, search, signals, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12));
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), pageCount) : 1;
  const visible = filtered.slice((page - 1) * 12, page * 12);
  const updateFilter = (key: string, value: string, fallback = "ALL") => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === fallback) next.delete(key); else next.set(key, value);
    next.delete("signalPage");
    setSearchParams(next, { replace: true });
  };

  return (
    <section className="lt-signal-inbox" aria-labelledby="lt-signal-inbox-title">
      <header className="lt-signal-inbox__header">
        <div>
          <p className="eyebrow">Flux global · tous instruments</p>
          <h3 id="lt-signal-inbox-title">Inbox des signaux</h3>
          <span>{signals.length} signaux publiés · arrêté à {displayTime(model.meta.asOf)}</span>
        </div>
        <div className="lt-signal-inbox__metrics" aria-label="Résumé du pipeline de signaux">
          <Metric label="À prendre" value={signals.filter((signal) => operatorStateForSignal(model, signal).code === "ACTIONABLE").length} />
          <Metric label="En évaluation" value={signals.filter((signal) => operatorStateForSignal(model, signal).code === "EVALUATING").length} />
          <Metric label="Surveillés" value={signals.filter((signal) => operatorStateForSignal(model, signal).code === "WATCHED").length} />
          <Metric label="Terminés" value={signals.filter((signal) => ["EXPIRED", "REJECTED"].includes(operatorStateForSignal(model, signal).code)).length} />
        </div>
        {selectedSignalId && onClearSignal ? (
          <button className="lt-signal-inbox__unpin" type="button" onClick={onClearSignal}>
            Revenir au dossier prioritaire
          </button>
        ) : null}
      </header>

      <div className="lt-signal-inbox__filters" aria-label="Filtres de l'inbox">
        <div className="lt-signal-inbox__lanes" aria-label="Périmètre de la file">
          <button type="button" aria-pressed={lane === "ACTIVE"} onClick={() => updateFilter("signalLane", "ACTIVE", "ACTIVE")}>À traiter</button>
          <button type="button" aria-pressed={lane === "HISTORY"} onClick={() => updateFilter("signalLane", "HISTORY", "ACTIVE")}>Historique</button>
          <button type="button" aria-pressed={lane === "ALL"} onClick={() => updateFilter("signalLane", "ALL", "ACTIVE")}>Tous</button>
        </div>
        <label className="lt-signal-inbox__search">
          <FaSearch aria-hidden="true" />
          <span className="sr-only">Rechercher un signal</span>
          <input value={search} onChange={(event) => updateFilter("signalQuery", event.target.value, "")} placeholder="ID, stratégie, instrument…" />
        </label>
        <label>
          <FaFilter aria-hidden="true" />
          <span className="sr-only">Filtrer par instrument</span>
          <select value={instrument} onChange={(event) => updateFilter("signalInstrument", event.target.value)}>
            <option value="ALL">Tous les instruments</option>
            {instruments.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrer par état</span>
          <select value={status} onChange={(event) => updateFilter("signalState", event.target.value)}>
            <option value="ALL">Tous les états</option>
            {states.map((value) => <option key={value} value={value}>{operatorStateLabel(value as SignalOperatorStateCode)}</option>)}
          </select>
        </label>
      </div>

      <div className="lt-signal-inbox__table-wrap" tabIndex={0} aria-label="Signaux, défilement disponible">
        <table>
          <thead>
            <tr><th scope="col">Heure</th><th scope="col">Instrument</th><th scope="col">Stratégie</th><th scope="col">Signal</th><th scope="col">Étape atteinte</th><th scope="col">RR</th><th scope="col">Actions</th></tr>
          </thead>
          <tbody>
            {visible.map((signal) => {
              const stage = signalStage(model, signal);
              const selected = selectedSignalId === signal.signalId || (!selectedSignalId && model.latestSignal?.signalId === signal.signalId);
              const temporal = resolveSignalTemporalState(signal, model.meta.asOf);
              const operatorState = operatorStateForSignal(model, signal);
              const target = signalNavigationTarget(signal);
              return (
                <tr
                  key={signal.signalId}
                  data-selected={selected ? "true" : "false"}
                  data-expired={temporal.effectiveState === "EXPIRED" ? "true" : "false"}
                  data-operator-state={operatorState.code}
                >
                  <td><time dateTime={signal.createdAt} title={displayTime(signal.createdAt)}>{relativeTime(signal.createdAt, model.meta.asOf)}</time></td>
                  <td><strong>{signal.symbol}</strong></td>
                  <td title={signal.strategyId}>{compactId(signal.strategyId)}</td>
                  <td>
                    <StatusBadge tone={operatorState.tone}>{operatorState.label}</StatusBadge>
                    <small>{presentGeneric(signal.direction).label} · {temporal.label}</small>
                    {temporal.mismatch ? <small className="lt-signal-inbox__temporal-note">état brut {temporal.backendState}</small> : null}
                  </td>
                  <td><span className={`lt-signal-stage lt-signal-stage--${stage.tone}`}>{stage.label}</span></td>
                  <td>{displayValue(signal.rewardRisk)}{operatorState.code === "ACTIONABLE" ? <small className="lt-signal-inbox__urgency"><FaClock aria-hidden="true" />{remainingTime(signal.expiresAt, model.meta.asOf)}</small> : null}</td>
                  <td>
                    <div className="lt-signal-inbox__actions">
                      <button type="button" aria-pressed={selected} onClick={() => onSelectSignal?.(target)} title="Examiner ce signal dans la chaîne de décision"><FaBullseye aria-hidden="true" /><span>Décision</span></button>
                      <button type="button" onClick={() => onShowOnChart?.(target)} title={`Centrer le graphique ${signal.symbol} sur ce signal`}><FaChartLine aria-hidden="true" /><span>Graphique</span></button>
                      <Link to={`/live/signals/${encodeURIComponent(signal.signalId)}`} title="Ouvrir le dossier signal complet">Dossier complet</Link>
                    </div>
                    <div className="lt-signal-inbox__preview" role="tooltip">
                      <strong>{signal.symbol} · {presentGeneric(signal.direction).label}</strong>
                      <span>RR {displayValue(signal.rewardRisk)} · confiance {displayValue(signal.confidence)} %</span>
                      <span>{operatorState.detail}</span>
                      <small>Échéance {displayTime(signal.expiresAt)} · {stage.label}</small>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length ? <div className="lt-signal-inbox__empty" role="status"><strong>Aucun signal dans ce filtre</strong><span>La connexion reste active ; modifiez les filtres ou attendez une publication backend.</span></div> : null}
      </div>
      {filtered.length > 12 ? (
        <nav className="lt-signal-inbox__pagination" aria-label="Pagination des signaux">
          <button type="button" disabled={page <= 1} onClick={() => updatePage(searchParams, setSearchParams, page - 1)}>Précédent</button>
          <span>Page {page} sur {pageCount}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => updatePage(searchParams, setSearchParams, page + 1)}>Suivant</button>
        </nav>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><strong>{value.toLocaleString("fr-FR")}</strong></span>;
}

function allSignals(model: LiveTradingModel): SignalRow[] {
  const byId = new Map<string, SignalRow>();
  for (const signal of [...model.source.signals, ...model.source.canonicalRuntime.latestSignals]) {
    if (signal.signalId) byId.set(signal.signalId, signal);
  }
  return [...byId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function signalStage(model: LiveTradingModel, signal: SignalRow): { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" } {
  const theoretical = model.theoreticalExecution?.rows.find((row) => row.strategySignalId === signal.signalId);
  if (theoretical) return { label: `Suivi · ${presentGeneric(theoretical.status).label}`, tone: theoretical.status === "STOP_HIT" ? "danger" : theoretical.status === "TARGET_HIT" ? "success" : "info" };
  const intent = [...model.source.canonicalRuntime.pendingOrderIntents, ...model.source.portfolioOrderIntents]
    .find((item) => item.signalId === signal.signalId);
  if (intent?.humanGate.gateId) return { label: `Votre validation · ${presentGeneric(intent.humanGate.status).label}`, tone: intent.humanGate.allowedActions.length ? "warning" : "info" };
  if (intent) return { label: `Ordre proposé · ${presentGeneric(intent.state).label}`, tone: "info" };
  const risk = model.source.riskChecks.find((item) => item.signalId === signal.signalId);
  if (risk) return { label: `Risk · ${presentGeneric(risk.status).label}`, tone: risk.status === "PASS" ? "success" : risk.status === "BLOCK" ? "danger" : "warning" };
  const portfolio = model.source.arbitrations.find((item) => item.signalId === signal.signalId);
  if (portfolio) return { label: `Portfolio · ${presentGeneric(portfolio.decision).label}`, tone: portfolio.decision === "REJECTED" ? "danger" : "success" };
  const context = model.source.canonicalRuntime.aiContextGate.find((item) => item.signalId === signal.signalId);
  if (context) return { label: `Contexte · ${presentGeneric(context.recommendation).label}`, tone: context.recommendation.includes("REJECT") ? "danger" : context.recommendation.includes("WAIT") ? "warning" : "success" };
  return { label: "Signal publié", tone: "info" };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function compactId(value: string): string {
  return value.length > 26 ? `${value.slice(0, 23)}…` : value;
}

function operatorStateLabel(value: SignalOperatorStateCode): string {
  return ({ ACTIONABLE: "À prendre", EVALUATING: "En cours d’évaluation", WATCHED: "Surveillé", EXPIRED: "Expiré", REJECTED: "Refusé" })[value];
}

function updatePage(searchParams: URLSearchParams, setSearchParams: ReturnType<typeof useSearchParams>[1], page: number) {
  const next = new URLSearchParams(searchParams);
  if (page <= 1) next.delete("signalPage"); else next.set("signalPage", String(page));
  setSearchParams(next, { replace: true });
}

function signalNavigationTarget(signal: SignalRow): LiveSignalNavigationTarget {
  return {
    signalId: signal.signalId,
    instrument: signal.symbol,
    at: signal.sourceDataCutoffAt || signal.createdAt,
    timeframe: signal.timeframe,
  };
}

function urgencyRank(model: LiveTradingModel, signal: SignalRow): number {
  const state = operatorStateForSignal(model, signal).code;
  return ({ ACTIONABLE: 0, EVALUATING: 1, WATCHED: 2, EXPIRED: 3, REJECTED: 4 } as const)[state];
}

function expiryRank(signal: SignalRow): number {
  const parsed = Date.parse(signal.expiresAt);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function relativeTime(value: string, reference: string): string {
  const at = Date.parse(value);
  const now = Date.parse(reference);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return presentDataAbsence("NOT_PUBLISHED").label;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  return `il y a ${Math.floor(seconds / 3600)} h`;
}

function remainingTime(value: string, reference: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(value) - Date.parse(reference)) / 1000));
  if (!Number.isFinite(seconds)) return presentDataAbsence("NOT_PUBLISHED").label;
  if (seconds <= 0) return "Expiré";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}
