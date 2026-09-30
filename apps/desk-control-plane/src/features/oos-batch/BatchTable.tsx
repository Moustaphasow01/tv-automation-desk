import type { OosDay, OosOverview, OosRequest } from "@/domains/front-api/oosBatchContract";
import { actions, dateLabel, dayRequest, states, valueLabel } from "./model";
export function BatchTable({ rows, select, submit, disabled, canWrite }: { rows: OosDay[]; select: (row: OosDay) => void; submit: (input: OosRequest) => void; disabled: boolean; canWrite: boolean }) {
  if (!rows.length) return <p className="oos-panel">Aucune journée dans cette sélection. Préparez un lancement pour constituer les premières captures.</p>;
  return <div className="oos-table-scroll" tabIndex={0} role="region" aria-label="Suivi des journées OOS"><table className="oos-table">
    <caption>Journées demandées · aucun résultat simulé dans cette interface</caption>
    <thead><tr><th>Journée / batch</th><th>Progression</th><th>Captures</th><th>Plan</th><th>Net R</th><th>Net USD</th><th>Fills / gains / pertes</th><th>Action</th></tr></thead>
    <tbody>{rows.map(row => <tr key={`${row.batch_id}:${row.day}`}>
      <td><button className="oos-link" onClick={() => select(row)}>{dateLabel(row.day)} · {row.definition.symbol}</button><small>{row.batch_id}</small>{row.sample_purpose === "TECHNICAL_SMOKE" && <small>Test technique · hors statistiques OOS</small>}</td>
      <td><span data-failed={row.state.startsWith("FAILED")}>{states[row.state]}</span>{row.error && <small>{row.error.code}</small>}</td>
      <td>{row.capture_count} / 8</td><td>{row.plan_sha256 ? <code title={row.plan_sha256}>{row.plan_sha256.slice(0, 12)}…</code> : "Non reçu"}</td>
      <td>{valueLabel(row.metrics.net_r)}</td><td>{valueLabel(row.metrics.net_usd)}</td>
      <td>{["fills", "wins", "losses"].map(key => valueLabel(row.metrics[key])).join(" / ")}</td>
      <td>{canWrite && row.allowed_actions.map(action => <button disabled={disabled} key={action} onClick={() => submit(dayRequest(row, action))}>{actions[action]}</button>)}</td>
    </tr>)}</tbody></table></div>;
}
export function BatchStats({ stats }: { stats: OosOverview["stats"] }) {
  return <section className="oos-panel"><h2>Statistiques descriptives</h2><p>{stats.completed} journées terminées sur {stats.days}. Les valeurs absentes ne sont ni estimées ni remplacées par zéro.</p>
    {!!stats.technical_smoke_days && <p>{stats.technical_smoke_days} journée(s) de test technique exclue(s) des métriques OOS.</p>}
    <div className="oos-table-scroll" role="region" aria-label="Statistiques disponibles" tabIndex={0}><table className="oos-table"><thead><tr><th>Métrique publiée</th><th>Jours renseignés</th><th>Somme</th><th>Moyenne</th><th>Médiane</th></tr></thead>
      <tbody>{Object.entries(stats.metrics).map(([key, metric]) => <tr key={key}><th>{key}</th><td>{metric.observed_days} / {metric.total_days}</td><td>{valueLabel(metric.sum)}</td><td>{valueLabel(metric.mean)}</td><td>{valueLabel(metric.median)}</td></tr>)}</tbody></table></div>
  </section>;
}
