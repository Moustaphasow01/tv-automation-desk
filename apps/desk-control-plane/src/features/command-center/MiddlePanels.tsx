import { Link } from "react-router-dom";
import { FaLock } from "react-icons/fa";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { Sparkline } from "@/design-system/primitives";
import { displayDecimal, displayNumber, displayTime, statusLabel, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function HumanGatePanel({ humanGate }: { humanGate: CommandCenterView["humanGate"] }) {
  return (
    <CommandPanel code="A" title="OrderIntent & Human Gate" className="cc-panel--human" action={<Link to="/orders">Voir tout</Link>}>
      {humanGate.rows.length ? <div className="cc-table-scroll" role="region" aria-label="OrderIntent et Human Gate défilables" tabIndex={0}><table className="cc-table"><thead><tr><th>OrderIntent ID</th><th>Instrument</th><th>Sens</th><th>Qté</th><th>Mode exéc.</th><th>Human Gate</th><th>Actions autorisées</th><th>Âge</th></tr></thead>
        <tbody>{humanGate.rows.map((row) => <tr key={row.orderIntentId}><td><Link to={`/execution/orders/${encodeURIComponent(row.orderIntentId)}`}>{row.orderIntentId}</Link></td><td>{row.instrument}</td><td className={`cc-side cc-side--${row.side.toLowerCase()}`}>{row.side}</td><td>{displayNumber(row.quantity)}</td><td>{row.executionMode}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td><td><AllowedActions actions={row.allowedActions} orderIntentId={row.orderIntentId} /></td><td>{displayDecimal(row.ageSeconds, "s")}</td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="AUCUNE CONFIRMATION REQUISE" label="Aucun OrderIntent post-Risk n'attend l'opérateur. Aucun ordre n'est simulé pour remplir cette file." />}
      <footer className="cc-immutability"><FaLock aria-hidden="true" />Champs post-risk (qty autorisée, prix, stops, targets, risk) immuables.</footer>
    </CommandPanel>
  );
}

export function ProviderRuntimePanel({ provider }: { provider: CommandCenterView["provider"] }) {
  return (
    <CommandPanel code="B" title="Exécution & Provider Runtime" className="cc-panel--provider" action={<PanelStatus tone="warning">ACK ≠ FILL</PanelStatus>}>
      <div className="cc-provider-metrics"><span><small>Mode Provider</small><strong>{provider.mode}</strong></span><span><small>Circuit Breaker</small><strong>{provider.circuitBreaker}</strong></span><span><small>Santé Provider</small><strong>{provider.health}</strong></span><span><small>Latence (p95)</small><strong>{displayDecimal(provider.ackLatencyMs, " ms")}</strong></span><span><small>Nombre de mismatches</small><strong>{displayNumber(provider.mismatchCount)}</strong></span></div>
      {provider.events.length ? <div className="cc-table-scroll" role="region" aria-label="Cycle de vie provider défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Heure</th><th>Étape</th><th>Détail</th><th>Statut</th></tr></thead><tbody>{provider.events.map((event) => <tr key={event.id}><td>{displayTime(event.at)}</td><td>{event.stage}</td><td>{event.detail}</td><td><PanelStatus tone={statusTone(event.status)}>{statusLabel(event.status)}</PanelStatus></td></tr>)}</tbody></table></div> : <EmptyPanelState status={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "DÉSACTIVÉ PAR POLITIQUE" : "AUCUN ÉVÉNEMENT PROVIDER"} label={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "L'exécution physique est fermée ; aucun ACK ou Fill broker n'est attendu." : "Aucun événement provider canonique n'a été publié."} />}
      <footer className="cc-provider-footer">Mode actuel: aucune exécution broker automatique déduite par le frontend.</footer>
    </CommandPanel>
  );
}

export function ResearchPerformancePanel({ performance }: { performance: CommandCenterView["performance"] }) {
  return (
    <CommandPanel title="Performance de recherche (courbe d'equity)" className="cc-panel--performance" action={<Link to="/performance">30J</Link>}>
      <div className="cc-performance-metrics"><span><small>Equity Research</small><strong>{performance.curve.length > 1 ? "Série publiée" : "Non publiée"}</strong></span><span><small>PnL 30J</small><strong>{displayDecimal(performance.pnlR, " R")}</strong></span><span><small>Trades</small><strong>{displayNumber(performance.trades)}</strong></span><span><small>Drawdown max</small><strong>{displayDecimal(performance.maxDrawdownR, " R")}</strong></span></div>
      {performance.curve.length > 1 ? <div className="cc-equity-curve"><Sparkline points={performance.curve} tone="accent" /></div> : <EmptyPanelState label="Série d'equity officielle non publiée" />}
    </CommandPanel>
  );
}

function actionLabel(action: string): string {
  if (action.toUpperCase() === "CONFIRM") return "Confirmer";
  if (action.toUpperCase() === "REJECT") return "Rejeter";
  return action;
}

function AllowedActions({ actions, orderIntentId }: { actions: readonly string[]; orderIntentId: string }) {
  const visible = actions.filter((action) => ["CONFIRM", "REJECT"].includes(action.toUpperCase()));
  return <span className="cc-allowed-actions"><Link to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>Voir</Link>{visible.map((action) => <Link key={action} to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>{actionLabel(action)}</Link>)}</span>;
}
