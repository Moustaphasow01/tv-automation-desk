import { Link } from "react-router-dom";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { presentOperatorText } from "@/design-system/labels";
import { displayDecimal, displayNumber, displayTime, statusLabel, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function MarketFreshnessPanel({ market }: { market: CommandCenterView["market"] }) {
  return (
    <CommandPanel code="A" title="Marché & fraîcheur des données" className="cc-panel--market">
      {market.rows.length ? (
        <div className="cc-table-scroll" role="region" aria-label="Flux marché défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Instrument</th><th>Source</th><th>asOf</th><th>Fraîcheur</th><th>Statut</th></tr></thead>
          <tbody>{market.rows.map((row) => <tr key={row.id}><td><strong>{row.instrument}</strong><small>{row.timeframe}</small></td><td>{row.source}</td><td>{displayTime(row.asOf)}</td><td>{displayDecimal(row.freshnessSeconds, "s")}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td></tr>)}</tbody>
        </table></div>
      ) : <EmptyPanelState status="SOURCE NON PUBLIÉE" label="Aucun feed marché n'est disponible dans la projection autoritaire." />}
      <div className="cc-freshness-summary"><span>Fraîcheur globale</span><strong>{displayDecimal(market.freshnessSeconds, "s")}</strong><PanelStatus tone={statusTone(market.status)}>{statusLabel(market.status)}</PanelStatus></div>
    </CommandPanel>
  );
}

export function ResearchPipelinePanel({ research }: { research: CommandCenterView["research"] }) {
  const metrics = [
    ["Hypothèse", research.hypothesisCount], ["Expérience", research.experimentCount],
    ["Run", research.runCount], ["Candidat", research.candidateCount],
    ["Gate G1", null], ["Promouvoir", null],
  ] as const;
  return (
    <CommandPanel code="B" title="Pipeline de recherche" className="cc-panel--research" action={<Link to="/research">Voir tout</Link>}>
      <div className="cc-mini-metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{displayNumber(value)}</strong></span>)}</div>
      {research.rows.length ? <div className="cc-table-scroll" role="region" aria-label="Pipeline de recherche défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Mission</th><th>Dataset(s)</th><th>Run</th><th>Statut</th><th>Workers</th><th>Artefacts</th></tr></thead>
        <tbody>{research.rows.map((row) => <tr key={row.id}><td><Link to={`/research/experiments/${encodeURIComponent(row.id)}`}>{row.mission}</Link></td><td>{row.dataset}</td><td>{row.run}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td><td>{displayNumber(row.workers)}</td><td>{displayNumber(row.artifacts)}</td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="AUCUNE EXPÉRIENCE" label="Le Laboratoire de recherche ne publie actuellement aucune expérience." />}
      <footer className="cc-panel-stats"><span>Datasets: <strong>{displayNumber(research.datasetCount)}</strong></span><span>Artefacts: <strong>{displayNumber(research.artifactCount)}</strong></span><span>Workers actifs: <strong>{displayNumber(research.activeWorkers)} / {displayNumber(research.expectedWorkers)}</strong></span></footer>
    </CommandPanel>
  );
}

export function SignalsRiskPanel({ signals }: { signals: CommandCenterView["signals"] }) {
  const selected = signals.rows[0];
  return (
    <CommandPanel code="C" title="Signaux & file de risque" className="cc-panel--signals" action={<Link to="/live/signals">Voir tout</Link>}>
      {signals.rows.length ? <div className="cc-table-scroll" role="region" aria-label="Signaux et risque défilables" tabIndex={0}><table className="cc-table"><thead><tr><th>Heure</th><th>Instrument</th><th>Setup</th><th>Conf.</th><th>Gate</th><th>Port. Arb.</th><th>Risque</th></tr></thead>
        <tbody>{signals.rows.map((row) => <tr key={row.id}><td>{displayTime(row.at)}</td><td><strong>{presentOperatorText(row.instrument)}</strong></td><td>{presentOperatorText(row.setup)}</td><td>{displayDecimal(row.confidence)}</td><td>{statusLabel(row.gate)}</td><td><PanelStatus tone={statusTone(row.portfolioDecision)}>{statusLabel(row.portfolioDecision)}</PanelStatus></td><td><PanelStatus tone={statusTone(row.riskDecision)}>{statusLabel(row.riskDecision)}</PanelStatus></td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="AUCUN SIGNAL ACTUEL" label="Le runtime n'a publié aucun StrategySignal pour la session. La file Risque reste donc vide." />}
      {selected ? <div className="cc-signal-detail"><span>Signal affiché: <strong>{presentOperatorText(selected.instrument)} — {presentOperatorText(selected.setup)}</strong></span><PanelStatus tone={statusTone(selected.riskDecision)}>{statusLabel(selected.riskDecision)}</PanelStatus><dl><div><dt>Confiance</dt><dd>{displayDecimal(selected.confidence)}</dd></div><div><dt>Gate</dt><dd>{statusLabel(selected.gate)}</dd></div><div><dt>Portfolio</dt><dd>{statusLabel(selected.portfolioDecision)}</dd></div><div><dt>Risque</dt><dd>{statusLabel(selected.riskDecision)}</dd></div></dl></div> : null}
    </CommandPanel>
  );
}
