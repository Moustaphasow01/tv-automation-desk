import { Link } from "react-router-dom";
import { FaLock } from "react-icons/fa";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { Sparkline } from "@/design-system/primitives";
import { operatorCode, operatorCopy, operatorDuration } from "@/design-system/operatorVocabulary";
import { displayDecimal, displayNumber, displayTime, statusLabel, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function HumanGatePanel({ humanGate }: { humanGate: CommandCenterView["humanGate"] }) {
  return (
    <CommandPanel code="A" title="Ordres proposés et votre validation" className="cc-panel--human" action={<Link to="/orders">Voir tout</Link>}>
      {humanGate.rows.length ? <div className="cc-table-scroll" role="region" aria-label="Ordres proposés et validations défilables" tabIndex={0}><table className="cc-table"><thead><tr><th>Ordre proposé</th><th>Instrument</th><th>Sens</th><th>Quantité</th><th>Mode d’exécution</th><th>Votre validation</th><th>Actions possibles</th><th>Âge</th></tr></thead>
        <tbody>{humanGate.rows.map((row) => <tr key={row.orderIntentId}><td><Link title={row.orderIntentId} to={`/execution/orders/${encodeURIComponent(row.orderIntentId)}`}>{row.instrument} · {operatorCode(row.side)} · {displayNumber(row.quantity)}</Link></td><td>{row.instrument}</td><td className={`cc-side cc-side--${row.side.toLowerCase()}`}>{operatorCode(row.side)}</td><td>{displayNumber(row.quantity)}</td><td>{operatorCode(row.executionMode)}</td><td><PanelStatus tone={statusTone(row.status)}>{statusLabel(row.status)}</PanelStatus></td><td><AllowedActions actions={row.allowedActions} orderIntentId={row.orderIntentId} /></td><td>{operatorDuration(row.ageSeconds)}</td></tr>)}</tbody>
      </table></div> : <EmptyPanelState status="Aucune confirmation requise" label="Aucun ordre proposé après contrôle du risque n’attend l’opérateur. Aucun ordre n’est simulé pour remplir cette file." />}
      <footer className="cc-immutability"><FaLock aria-hidden="true" />Après contrôle du risque, quantité, prix, stops, objectifs et risque sont immuables.</footer>
    </CommandPanel>
  );
}

export function ProviderRuntimePanel({ provider }: { provider: CommandCenterView["provider"] }) {
  return (
    <CommandPanel code="B" title="Exécution et fournisseur" className="cc-panel--provider" action={<PanelStatus tone="warning">Accusé reçu ≠ exécuté</PanelStatus>}>
      <div className="cc-provider-metrics"><span><small>Mode fournisseur</small><strong>{operatorCode(provider.mode)}</strong></span><span><small>Coupe-circuit</small><strong>{operatorCode(provider.circuitBreaker)}</strong></span><span><small>Santé du fournisseur</small><strong>{operatorCode(provider.health)}</strong></span><span><small>Latence d’accusé (p95)</small><strong>{provider.ackLatencyMs === null ? "Non publiée" : operatorDuration(provider.ackLatencyMs / 1000)}</strong></span><span><small>Écarts détectés</small><strong>{displayNumber(provider.mismatchCount)}</strong></span></div>
      {provider.events.length ? <div className="cc-table-scroll" role="region" aria-label="Cycle de vie du fournisseur défilable" tabIndex={0}><table className="cc-table"><thead><tr><th>Heure</th><th>Étape</th><th>Détail</th><th>Statut</th></tr></thead><tbody>{provider.events.map((event) => <tr key={event.id}><td>{displayTime(event.at)}</td><td>{operatorCopy(event.stage)}</td><td>{operatorCopy(event.detail)}</td><td><PanelStatus tone={statusTone(event.status)}>{statusLabel(event.status)}</PanelStatus></td></tr>)}</tbody></table></div> : <EmptyPanelState status={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "Désactivé par la politique du desk" : "Aucun événement fournisseur"} label={provider.physicalExecutionPolicy === "DISABLED_BY_POLICY" ? "L’exécution physique est fermée ; aucun accusé ni ordre exécuté n’est attendu." : "Aucun événement fournisseur n’a été publié."} />}
      <footer className="cc-provider-footer">Mode actuel : aucune exécution automatique chez le courtier n’est déduite par l’interface.</footer>
    </CommandPanel>
  );
}

export function ResearchPerformancePanel({ performance }: { performance: CommandCenterView["performance"] }) {
  return (
    <CommandPanel title="Performance de recherche (courbe de capital)" className="cc-panel--performance" action={<Link to="/performance">30 j</Link>}>
      <div className="cc-performance-metrics"><span><small>Capital de recherche</small><strong>{performance.curve.length > 1 ? "Série publiée" : "Non publiée"}</strong></span><span><small>Résultat sur 30 j</small><strong>{displayDecimal(performance.pnlR, " R")}</strong></span><span><small>Trades</small><strong>{displayNumber(performance.trades)}</strong></span><span><small>Drawdown maximal</small><strong>{displayDecimal(performance.maxDrawdownR, " R")}</strong></span></div>
      {performance.curve.length > 1 ? <div className="cc-equity-curve"><Sparkline points={performance.curve} tone="accent" /></div> : <EmptyPanelState label="Série de capital officielle non publiée" />}
    </CommandPanel>
  );
}

function actionLabel(action: string): string {
  if (action.toUpperCase() === "CONFIRM") return "Valider";
  if (action.toUpperCase() === "REJECT") return "Refuser";
  return operatorCode(action);
}

function AllowedActions({ actions, orderIntentId }: { actions: readonly string[]; orderIntentId: string }) {
  const visible = actions.filter((action) => ["CONFIRM", "REJECT"].includes(action.toUpperCase()));
  return <span className="cc-allowed-actions"><Link to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>Voir</Link>{visible.map((action) => <Link key={action} to={`/execution/orders/${encodeURIComponent(orderIntentId)}`}>{actionLabel(action)}</Link>)}</span>;
}
