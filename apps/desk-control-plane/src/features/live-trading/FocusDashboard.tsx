import { Link } from "react-router-dom";
import { focusDashboardPeriodOptions, focusResultKindLabel, formatFocusDashboardR, formatFocusResultTime, type LiveFocusDashboard, type LiveFocusDashboardPeriod } from "./focusDashboardModel";
import "./focus-dashboard.css";

export function FocusDashboard({ dashboard, period, onPeriodChange }: {
  dashboard: LiveFocusDashboard;
  period: LiveFocusDashboardPeriod;
  onPeriodChange(period: LiveFocusDashboardPeriod): void;
}) {
  return <section className="live-focus__dashboard" aria-labelledby="live-focus-dashboard-title">
    <header className="live-focus__dashboard-head">
      <div><h2 id="live-focus-dashboard-title">Chiffres clés <small>{dashboard.scopeLabel}</small></h2><span>{dashboard.windowLabel}</span></div>
      <div className="live-focus__dashboard-periods" role="group" aria-label="Filtrer les chiffres clés par période">
        {focusDashboardPeriodOptions.map((option) => <button key={option.id} type="button" aria-pressed={period === option.id} onClick={() => onPeriodChange(option.id)}>{option.label}</button>)}
      </div>
    </header>
    {dashboard.available ? <>
      <dl className="live-focus__dashboard-metrics">
        {dashboard.metrics.map((metric) => <div key={metric.id} data-tone={metric.tone} data-metric={metric.id}>
          <dt>{metric.label}</dt><dd><span>{metric.value}</span><small>{metric.helper}</small></dd>
        </div>)}
      </dl>
      <details className="live-focus__dashboard-details">
        <summary>Comprendre les chiffres et voir les clôtures ({dashboard.data?.results.count})</summary>
        <DashboardDetails dashboard={dashboard} />
      </details>
    </> : <p role="status">{dashboard.coverageLabel}</p>}
  </section>;
}

function DashboardDetails({ dashboard }: { dashboard: LiveFocusDashboard }) {
  const data = dashboard.data;
  if (!data) return null;
  return <div className="live-focus__dashboard-depth">
    <p>{dashboard.coverageLabel}</p><small>{dashboard.freshnessLabel} · heure de Paris</small>
    <p>{data.rawSignals} signaux distincts exposés · {data.qualifiedTickets} tickets créés · {data.expiredWithoutFill} expiration(s) d’entrée confirmée(s) · {data.unclassifiedExpiry} expiration(s) sans motif d’exécution publié.</p>
    {data.results.missingR > 0 || data.results.undated > 0 ? <p role="status" className="live-focus__dashboard-warning">
      Couverture partielle : {data.results.missingR} clôture(s) sans résultat ; {data.results.undated} clôture(s) sans date, exclue(s) des périodes calendaires.
    </p> : null}
    <dl className="live-focus__dashboard-breakdown" aria-label="Décomposition du R clôturé">
      {data.results.breakdown.map((row) => <div key={row.kind}><dt>{focusResultKindLabel(row.kind)} · {row.count}</dt><dd>{row.realizedR === null ? "Aucun résultat" : formatFocusDashboardR(row.realizedR)}</dd></div>)}
    </dl>
    <ul className="live-focus__dashboard-results" aria-label="Positions composant le R clôturé">
      {data.results.contributors.map((item) => <li key={item.orderIntentId}>
        <span><strong>{item.instrument}</strong> · {formatFocusResultTime(item.closedAt)}<small>{focusResultKindLabel(item.kind)}</small></span>
        <strong>{formatFocusDashboardR(item.realizedR)}</strong><Link to={item.route}>Dossier<span className="sr-only"> {item.instrument} {item.orderIntentId}</span></Link>
      </li>)}
    </ul>
    {!data.results.count ? <p>Aucune clôture avec résultat publié sur cette période.</p> : null}
  </div>;
}
