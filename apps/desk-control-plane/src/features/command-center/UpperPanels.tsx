import { Link } from "react-router-dom";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { presentOperatorText } from "@/design-system/labels";
import { operatorCode, operatorDuration } from "@/design-system/operatorVocabulary";
import { displayDecimal, displayNumber, displayTime, statusLabel, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function MarketFreshnessPanel({ market }: { market: CommandCenterView["market"] }) {
  return (
    <CommandPanel code="A" title="Marché et données" className="cc-panel--market">
      {market.rows.length ? (
        <div className="cc-table-scroll" role="region" aria-label="Flux marché défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Instrument</th><th>Source</th><th>Arrêté à</th><th>Ancienneté</th><th>Statut</th></tr></thead>
          <tbody>{market.rows.map((row) => <tr key={row.id}><td><strong>{row.instrument}</strong><small>{row.timeframe}</small></td><td>{operatorCode(row.source)}</td><td>{displayTime(row.asOf)}</td><td>{operatorDuration(row.freshnessSeconds)}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td></tr>)}</tbody>
        </table></div>
      ) : <EmptyPanelState status="SOURCE NON PUBLIÉE" label="Aucun feed marché n'est disponible dans la projection autoritaire." />}
      <div className="cc-freshness-summary"><span>Ancienneté globale</span><strong>{operatorDuration(market.freshnessSeconds)}</strong><PanelStatus tone={statusTone(market.status)}>{statusLabel(market.status)}</PanelStatus></div>
    </CommandPanel>
  );
}

export function ResearchPipelinePanel({ research }: { research: CommandCenterView["research"] }) {
  const metrics = [
    ["Hypothèse", research.hypothesisCount], ["Expérience", research.experimentCount],
    ["Calcul", research.runCount], ["Candidat", research.candidateCount],
    ["Étape 1", null], ["Promouvoir", null],
  ] as const;
  return (
    <CommandPanel code="B" title="Recherche en cours" className="cc-panel--research" action={<Link to="/research">Voir tout</Link>}>
      <div className="cc-mini-metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{displayNumber(value)}</strong></span>)}</div>
      {research.rows.length ? <div className="cc-table-scroll" role="region" aria-label="Recherche en cours défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Mission</th><th>Jeux de données</th><th>Calcul</th><th>Statut</th><th>Agents de calcul</th><th>Résultats</th></tr></thead>
        <tbody>{research.rows.map((row) => <tr key={row.id}><td><Link to={`/research/experiments/${encodeURIComponent(row.id)}`}>{row.mission}</Link></td><td>{row.dataset}</td><td>{row.run}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td><td>{displayNumber(row.workers)}</td><td>{displayNumber(row.artifacts)}</td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="AUCUNE EXPÉRIENCE" label="Le Laboratoire de recherche ne publie actuellement aucune expérience." />}
      <footer className="cc-panel-stats"><span>Jeux de données : <strong>{displayNumber(research.datasetCount)}</strong></span><span>Résultats : <strong>{displayNumber(research.artifactCount)}</strong></span><span>Agents actifs : <strong>{displayNumber(research.activeWorkers)} / {displayNumber(research.expectedWorkers)}</strong></span></footer>
    </CommandPanel>
  );
}

export function SignalsRiskPanel({ signals }: { signals: CommandCenterView["signals"] }) {
  const selected = signals.rows[0];
  return (
    <CommandPanel code="C" title="Signaux et contrôle du risque" className="cc-panel--signals" action={<Link to="/live/signals">Voir tout</Link>}>
      {signals.rows.length ? <div className="cc-table-scroll" role="region" aria-label="Signaux et risque défilables" tabIndex={0}><table className="cc-table"><thead><tr><th>Heure</th><th>Instrument</th><th>Setup</th><th>Confiance</th><th>Contexte</th><th>Portefeuille</th><th>Risque</th></tr></thead>
        <tbody>{signals.rows.map((row) => <tr key={row.id}><td>{displayTime(row.at)}</td><td><strong>{presentOperatorText(row.instrument)}</strong></td><td>{presentOperatorText(row.setup)}</td><td>{displayDecimal(row.confidence)}</td><td>{statusLabel(row.gate)}</td><td><PanelStatus tone={statusTone(row.portfolioDecision)}>{statusLabel(row.portfolioDecision)}</PanelStatus></td><td><PanelStatus tone={statusTone(row.riskDecision)}>{statusLabel(row.riskDecision)}</PanelStatus></td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="Aucun signal actuel" label="Les stratégies en fonctionnement n’ont publié aucun signal pour la séance. Le contrôle du risque reste donc vide." />}
      {selected ? <div className="cc-signal-detail"><span>Signal affiché : <strong>{presentOperatorText(selected.instrument)} — {presentOperatorText(selected.setup)}</strong></span><PanelStatus tone={statusTone(selected.riskDecision)}>{statusLabel(selected.riskDecision)}</PanelStatus><dl><div><dt>Confiance</dt><dd>{displayDecimal(selected.confidence)}</dd></div><div><dt>Contexte</dt><dd>{statusLabel(selected.gate)}</dd></div><div><dt>Portefeuille</dt><dd>{statusLabel(selected.portfolioDecision)}</dd></div><div><dt>Risque</dt><dd>{statusLabel(selected.riskDecision)}</dd></div></dl></div> : null}
    </CommandPanel>
  );
}
