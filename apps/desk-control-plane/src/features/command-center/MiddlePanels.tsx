import { Link } from "react-router-dom";
import { FaLock } from "react-icons/fa";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { Sparkline } from "@/design-system/primitives";
import { displayDecimal, displayNumber, displayTime, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function HumanGatePanel({ humanGate }: { humanGate: CommandCenterView["humanGate"] }) {
  return (
    <CommandPanel code="A" title="OrderIntent & Human Gate" className="cc-panel--human" action={<Link to="/orders">Voir tout</Link>}>
      {humanGate.rows.length ? <div className="cc-table-scroll"><table className="cc-table"><thead><tr><th>OrderIntent ID</th><th>Instrument</th><th>Side</th><th>Qty</th><th>Exec. Mode</th><th>Human Gate</th><th>Allowed Actions</th><th>Âge</th></tr></thead>
        <tbody>{humanGate.rows.map((row) => <tr key={row.orderIntentId}><td><Link to={`/execution/orders/${encodeURIComponent(row.orderIntentId)}`}>{row.orderIntentId}</Link></td><td>{row.instrument}</td><td className={`cc-side cc-side--${row.side.toLowerCase()}`}>{row.side}</td><td>{displayNumber(row.quantity)}</td><td>{row.executionMode}</td><td><PanelStatus tone={statusTone(row.status) === "success" ? "success" : statusTone(row.status) === "danger" ? "danger" : "warning"}>{row.status}</PanelStatus></td><td><AllowedActions actions={row.allowedActions} orderIntentId={row.orderIntentId} /></td><td>{displayDecimal(row.ageSeconds, "s")}</td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="AUCUNE CONFIRMATION REQUISE" label="Aucun OrderIntent post-Risk n'attend l'opérateur. Aucun ordre n'est simulé pour remplir cette file." />}
      <footer className="cc-immutability"><FaLock aria-hidden="true" />Champs post-risk (qty autorisée, prix, stops, targets, risk) immuables.</footer>
    </CommandPanel>
  );
}

export function ProviderRuntimePanel({ provider }: { provider: CommandCenterView["provider"] }) {
  return (
    <CommandPanel code="B" title="Execution & Provider Runtime" className="cc-panel--provider" action={<PanelStatus tone="warning">ACK ≠ FILL</PanelStatus>}>
      <div className="cc-provider-metrics"><span><small>Provider Mode</small><strong>{provider.mode}</strong></span><span><small>Circuit Breaker</small><strong>{provider.circuitBreaker}</strong></span><span><small>Provider Health</small><strong>{provider.health}</strong></span><span><small>Latence (p95)</small><strong>{displayDecimal(provider.ackLatencyMs, " ms")}</strong></span><span><small>Mismatch count</small><strong>{displayNumber(provider.mismatchCount)}</strong></span></div>
      {provider.events.length ? <div className="cc-table-scroll"><table className="cc-table"><thead><tr><th>Heure</th><th>Étape</th><th>Détail</th><th>Statut</th></tr></thead><tbody>{provider.events.map((event) => <tr key={event.id}><td>{displayTime(event.at)}</td><td>{event.stage}</td><td>{event.detail}</td><td><PanelStatus tone={statusTone(event.status) === "success" ? "success" : statusTone(event.status) === "danger" ? "danger" : "warning"}>{event.status}</PanelStatus></td></tr>)}</tbody></table></div> : <EmptyPanelState status={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "DÉSACTIVÉ PAR POLITIQUE" : "AUCUN ÉVÉNEMENT PROVIDER"} label={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "L'exécution physique est fermée ; aucun ACK ou Fill broker n'est attendu." : "Aucun événement provider canonique n'a été publié."} />}
      <footer className="cc-provider-footer">Mode actuel: aucune exécution broker automatique déduite par le frontend.</footer>
    </CommandPanel>
  );
}

export function ResearchPerformancePanel({ performance }: { performance: CommandCenterView["performance"] }) {
  return (
    <CommandPanel title="Performance Research (Equity Curve)" className="cc-panel--performance" action={<Link to="/performance">30J</Link>}>
      <div className="cc-performance-metrics"><span><small>Research Equity</small><strong>{performance.curve.length > 1 ? "Série publiée" : "Non publiée"}</strong></span><span><small>PnL 30J</small><strong>{displayDecimal(performance.pnlR, " R")}</strong></span><span><small>Trades</small><strong>{displayNumber(performance.trades)}</strong></span><span><small>Max Drawdown</small><strong>{displayDecimal(performance.maxDrawdownR, " R")}</strong></span></div>
      {performance.curve.length > 1 ? <div className="cc-equity-curve"><Sparkline points={performance.curve} tone="accent" /></div> : <EmptyPanelState label="Série d'equity officielle non publiée" />}
    </CommandPanel>
  );
}

function AllowedActions({ actions, orderIntentId }: { actions: readonly string[]; orderIntentId: string }) {
  const visible = actions.filter((action) => ["CONFIRM", "REJECT"].includes(action.toUpperCase()));
  return <span className="cc-allowed-actions"><Link to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>Voir</Link>{visible.map((action) => <Link key={action} to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>{action}</Link>)}</span>;
}
