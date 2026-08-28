import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FaBullseye, FaChartLine, FaFilter, FaSearch } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentGeneric, presentSignalState } from "@/design-system/labels";
import { displayTime, displayValue } from "./mapper";
import type { LiveTradingModel } from "./model";
import { resolveSignalTemporalState } from "./signalTemporalState";

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
  const [instrument, setInstrument] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(12);
  const signals = useMemo(() => allSignals(model), [model]);
  const instruments = useMemo(() => unique(signals.map((signal) => signal.symbol)), [signals]);
  const states = useMemo(() => unique(signals.map((signal) => effectiveSignalState(signal, model.meta.asOf))), [model.meta.asOf, signals]);
  const filtered = useMemo(() => signals.filter((signal) => {
    const matchesInstrument = instrument === "ALL" || signal.symbol === instrument;
    const matchesStatus = status === "ALL" || effectiveSignalState(signal, model.meta.asOf) === status;
    const needle = search.trim().toLocaleLowerCase("fr-FR");
    const matchesSearch = !needle || `${signal.signalId} ${signal.strategyId} ${signal.symbol} ${signal.direction}`
      .toLocaleLowerCase("fr-FR")
      .includes(needle);
    return matchesInstrument && matchesStatus && matchesSearch;
  }), [instrument, model.meta.asOf, search, signals, status]);
  const visible = filtered.slice(0, limit);

  return (
    <section className="lt-signal-inbox" aria-labelledby="lt-signal-inbox-title">
      <header className="lt-signal-inbox__header">
        <div>
          <p className="eyebrow">Flux global · tous instruments</p>
          <h3 id="lt-signal-inbox-title">Inbox des signaux</h3>
          <span>{signals.length} signaux backend · asOf {displayTime(model.meta.asOf)}</span>
        </div>
        <div className="lt-signal-inbox__metrics" aria-label="Résumé du pipeline de signaux">
          <Metric label="Contexte OK" value={model.signalFunnel.contextTake} />
          <Metric label="Risk PASS" value={model.signalFunnel.riskPass} />
          <Metric label="Human Gate" value={model.signalFunnel.pendingHumanGates} />
          <Metric label="Suivis" value={model.signalFunnel.theoreticalTracked} />
        </div>
        {selectedSignalId && onClearSignal ? (
          <button className="lt-signal-inbox__unpin" type="button" onClick={onClearSignal}>
            Revenir au dossier prioritaire
          </button>
        ) : null}
      </header>

      <div className="lt-signal-inbox__filters" aria-label="Filtres de l'inbox">
        <label className="lt-signal-inbox__search">
          <FaSearch aria-hidden="true" />
          <span className="sr-only">Rechercher un signal</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, stratégie, instrument…" />
        </label>
        <label>
          <FaFilter aria-hidden="true" />
          <span className="sr-only">Filtrer par instrument</span>
          <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
            <option value="ALL">Tous les instruments</option>
            {instruments.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrer par état</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">Tous les états</option>
            {states.map((value) => <option key={value} value={value}>{presentSignalState(value).label}</option>)}
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
              const target = signalNavigationTarget(signal);
              return (
                <tr key={signal.signalId} data-selected={selected ? "true" : "false"} data-expired={temporal.effectiveState === "EXPIRED" ? "true" : "false"}>
                  <td><time dateTime={signal.createdAt}>{displayTime(signal.createdAt)}</time></td>
                  <td><strong>{signal.symbol}</strong></td>
                  <td title={signal.strategyId}>{compactId(signal.strategyId)}</td>
                  <td>
                    <StatusBadge tone={temporal.tone}>{presentGeneric(signal.direction).label} · {temporal.label}</StatusBadge>
                    {temporal.mismatch ? <small className="lt-signal-inbox__temporal-note">état brut {temporal.backendState}</small> : null}
                  </td>
                  <td><span className={`lt-signal-stage lt-signal-stage--${stage.tone}`}>{stage.label}</span></td>
                  <td>{displayValue(signal.rewardRisk)}</td>
                  <td>
                    <div className="lt-signal-inbox__actions">
                      <button type="button" aria-pressed={selected} onClick={() => onSelectSignal?.(target)} title="Examiner ce signal dans la chaîne de décision"><FaBullseye aria-hidden="true" /><span>Décision</span></button>
                      <button type="button" onClick={() => onShowOnChart?.(target)} title={`Centrer le graphique ${signal.symbol} sur ce signal`}><FaChartLine aria-hidden="true" /><span>Graphique</span></button>
                      <Link to={`/live/signals/${encodeURIComponent(signal.signalId)}`} title="Ouvrir le dossier signal complet">Dossier complet</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length ? <div className="lt-signal-inbox__empty" role="status"><strong>Aucun signal dans ce filtre</strong><span>La connexion reste active ; modifiez les filtres ou attendez une publication backend.</span></div> : null}
      </div>
      {visible.length < filtered.length ? <button className="lt-signal-inbox__more" type="button" onClick={() => setLimit((value) => value + 12)}>Afficher 12 signaux de plus</button> : null}
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
  if (intent?.humanGate.gateId) return { label: `Human Gate · ${presentGeneric(intent.humanGate.status).label}`, tone: intent.humanGate.allowedActions.length ? "warning" : "info" };
  if (intent) return { label: `OrderIntent · ${presentGeneric(intent.state).label}`, tone: "info" };
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

function effectiveSignalState(signal: SignalRow, asOf: string): string {
  return resolveSignalTemporalState(signal, asOf).effectiveState;
}

function signalNavigationTarget(signal: SignalRow): LiveSignalNavigationTarget {
  return {
    signalId: signal.signalId,
    instrument: signal.symbol,
    at: signal.sourceDataCutoffAt || signal.createdAt,
    timeframe: signal.timeframe,
  };
}
