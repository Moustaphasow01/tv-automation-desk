import { useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { routeDisplayName } from "@/app/routes";
import { FaSkullCrossbones } from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import { presentGeneric, presentQueueStatus } from "@/design-system/labels";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { RiskView } from "@/domains/front-api/viewModels";
import "@/features/risk-center/risk-center.css";

type RiskLimit = RiskView["limits"][number];
type RiskAction = RiskView["commandActions"][number];
type RiskBreach = RiskView["breaches"][number];

const EMPTY_RISK_LIMITS: readonly RiskLimit[] = [];
const EMPTY_RISK_BREACHES: readonly RiskBreach[] = [];

const DONUT_COLORS = ["var(--rc-blue)", "var(--rc-amber)", "var(--rc-cyan)", "var(--rc-purple)", "var(--rc-green)", "var(--rc-red)"];

export function RiskCenterPage() {
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("risk");
  const repository = useFrontViewRepository();
  const [reason] = useState("Contrôle opérateur : validation Risk Center sans ordre broker direct.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [breachTab, setBreachTab] = useState<"active" | "all">("active");
  const [showAllLimits, setShowAllLimits] = useState(false);
  const [instrumentFilter, setInstrumentFilter] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const data = query.data?.data;
  const limits = data?.limits ?? EMPTY_RISK_LIMITS;
  const breaches = data?.breaches ?? EMPTY_RISK_BREACHES;
  const instrumentOptions = useMemo(() => uniqueTargets(limits, "INSTRUMENT"), [limits]);
  const accountOptions = useMemo(() => uniqueTargets(limits, "ACCOUNT"), [limits]);
  const visibleLimits = useMemo(() => limits.filter((limit) => {
    if (!showAllLimits && limit.status === "PASS" && limit.usedPct < 50) return false;
    if (instrumentFilter !== "ALL" && !(limit.scope === "INSTRUMENT" && limit.targetId === instrumentFilter)) return false;
    if (accountFilter !== "ALL" && !(limit.scope === "ACCOUNT" && limit.targetId === accountFilter)) return false;
    return true;
  }), [limits, showAllLimits, instrumentFilter, accountFilter]);
  const shownBreaches = useMemo(
    () => breachTab === "active" ? breaches.filter((breach) => breach.status === "OPEN") : breaches,
    [breachTab, breaches]
  );

  if (query.isLoading) return <RiskLoading />;

  if (query.isError) {
    return <div className="rc-page"><div className="rc-workspace"><p className="rc-empty">Centre de risque indisponible : {(query.error as Error).message}</p></div></div>;
  }

  if (!data) {
    return <div className="rc-page"><div className="rc-workspace"><p className="rc-empty">Le BFF ne retourne pas encore la projection `/views/risk`.</p></div></div>;
  }

  const primaryStressAction = data.commandActions.find((action) => action.commandType === "risk.stress_test.run");
  const killSwitchAction = data.commandActions.find((action) => action.commandType === "risk.emergency.kill_switch");

  const confirmAction = async (action: RiskAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildRiskCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RISK_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="rc-page" data-testid="risk-center-golden-master">
      <header className="rc-header">
        <div className="rc-header__title">
          <h1>{routeDisplayName("risk")}</h1>
          <p>Surveillance du risque en temps réel &amp; moteur de décision</p>
        </div>
        <div className="rc-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <span className={`rc-header__pill${["BREACH", "BLOCKED"].includes(data.summary.globalStatus) ? " rc-header__pill--breach" : " rc-header__pill--ok"}`}>
          {presentQueueStatus(data.summary.globalStatus).label}
        </span>
        <label className="rc-step-up">
          <span>Step-up (kill switch / stress test)</span>
          <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={killSwitchAction?.actionId ?? "actionId step-up"} />
        </label>
        {killSwitchAction ? (
          <button
            type="button"
            className="rc-header__kill"
            disabled={isActionDisabled(killSwitchAction, reason, stepUpToken) || submittingActionId === killSwitchAction.actionId}
            title={killSwitchAction.permission === "STEP_UP_REQUIRED" ? "Nécessite une confirmation renforcée (step-up)" : killSwitchAction.permission === "DENIED" ? "Action refusée par la politique en vigueur" : undefined}
            onClick={() => confirmAction(killSwitchAction)}
          >
            <FaSkullCrossbones aria-hidden="true" /> {submittingActionId === killSwitchAction.actionId ? "Envoi..." : "Kill Switch"}
          </button>
        ) : null}
      </header>

      <div className="rc-workspace">
        {(command || commandError) && (
          <div className="rc-panel"><div className="rc-panel__body">
            <strong>{command ? `Commande ${command.status}` : "Commande rejetée"}</strong>
            <p className="rc-empty">{command?.commandId ?? commandError}</p>
          </div></div>
        )}

        <section className="rc-kpi-strip" aria-label="Indicateurs Centre de risque">
          <KpiCell label="Risque utilisé" value={formatPercent(data.summary.riskUsedPct)} tone={data.summary.riskUsedPct >= 80 ? "danger" : data.summary.riskUsedPct >= 60 ? "warn" : undefined} />
          <KpiCell label="Risque ouvert" value={formatCurrency(data.summary.openRiskUsd)} />
          <KpiCell label="Exposition brute" value={Number.isFinite(data.summary.grossExposureUsd) ? formatCurrency(data.summary.grossExposureUsd) : "Non disponible"} />
          <KpiCell label="Exposition nette" value={Number.isFinite(data.summary.netExposureUsd) ? formatCurrency(data.summary.netExposureUsd) : "Non disponible"} />
          <KpiCell label="Perte journalière" value={formatSignedR(data.summary.dailyLossR)} tone={data.summary.dailyLossR < 0 ? "danger" : undefined} />
          <KpiCell label="Limite perte/jour" value={formatSignedR(data.summary.dailyLossLimitR)} />
          <KpiCell label="Drawdown glissant" value={Number.isFinite(data.summary.trailingDrawdownR) ? formatSignedR(data.summary.trailingDrawdownR) : "Non disponible"} />
          <KpiCell label="Dépassements actifs" value={String(data.summary.activeBreaches)} tone={data.summary.activeBreaches > 0 ? "danger" : undefined} />
          <KpiCell label="Stress tests (jour)" value={String(data.summary.stressTestsToday)} />
        </section>

        <div className="rc-row1">
          <section className="rc-panel" aria-label="Limites officielles">
            <header><h2>Limites</h2><small>{visibleLimits.length} / {data.limits.length}</small><button className="rc-show-all" type="button" onClick={() => setShowAllLimits((value) => !value)}>{showAllLimits ? "Voir les alertes" : "Voir tout"}</button></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <div className="rc-limit-filters" aria-label="Filtres des limites de risque">
                <label><span>Instrument</span><select value={instrumentFilter} onChange={(event) => setInstrumentFilter(event.target.value)}><option value="ALL">Tous les instruments</option>{instrumentOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>Compte</span><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="ALL">Tous les comptes</option>{accountOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                {!showAllLimits ? <p>Affichage prioritaire : anomalies et utilisation ≥ 50 %.</p> : <p>Catalogue complet des limites.</p>}
              </div>
              <div className="rc-table-scroll" role="region" aria-label="Limites de risque défilables" tabIndex={0}>
                <table className="rc-table">
                  <caption className="sr-only">Limites officielles de risque</caption>
                  <thead><tr><th>Limite</th><th>Utilisé</th><th>Limite</th><th>%</th><th>Marge</th><th>Statut</th></tr></thead>
                  <tbody>
                    {visibleLimits.map((limit, index) => (
                      <tr key={`${limit.limitId}-${index}`}>
                        <td><LimitCell row={limit} /></td>
                        <td>{formatRiskValue(limit.usedValue, limit.unit)}</td>
                        <td>{formatRiskValue(limit.limitValue, limit.unit)}</td>
                        <td>{formatPercent(limit.usedPct)}</td>
                        <td>{formatRiskValue(limit.headroomValue, limit.unit)}</td>
                        <td><StatusBadge tone={statusTone(limit.status)}>{presentQueueStatus(limit.status).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!visibleLimits.length ? <tr><td colSpan={6}><p className="rc-empty">{data.limits.length ? "Aucune limite ne correspond aux filtres actifs." : "Aucune limite de risque publiée."}</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rc-panel" aria-label="Exposition par instrument">
            <header><h2>Exposition</h2><small>Par instrument</small></header>
            <div className="rc-panel__body">
              {data.exposures.length ? (
                <div className="rc-donut-panel">
                  <Donut items={data.exposures.slice(0, 6).map((item, index) => ({ value: Math.abs(item.grossUsd), color: DONUT_COLORS[index % DONUT_COLORS.length] }))} centerLabel={formatCurrency(data.exposures.reduce((sum, item) => sum + Math.abs(item.grossUsd), 0))} />
                  <ul className="rc-donut-legend">
                    {data.exposures.slice(0, 6).map((item, index) => (
                      <li key={`${item.exposureId}-${index}`}>
                        <span className="dot" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                        <span>{item.topInstrument || item.assetClass}</span>
                        <strong>{formatCurrency(item.grossUsd)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="rc-empty">Exposition par instrument non publiée.</p>}
            </div>
          </section>

          <section className="rc-panel" aria-label="Contraintes prop firm">
            <header><h2>Contraintes prop</h2><small>{data.propConstraints.length}</small></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <div className="rc-table-scroll" role="region" aria-label="Contraintes prop firm défilables" tabIndex={0}>
                <table className="rc-table">
                  <caption className="sr-only">Contraintes de risque prop firm</caption>
                  <thead><tr><th>Règle</th><th>Utilisé</th><th>Limite</th><th>Statut</th></tr></thead>
                  <tbody>
                    {data.propConstraints.map((item, index) => (
                      <tr key={`${item.constraintId}-${index}`}>
                        <td><strong>{item.label}</strong><br /><small style={{ color: "var(--rc-muted)" }}>{item.rule}</small></td>
                        <td>{formatRiskValue(item.usedValue, item.unit)}</td>
                        <td>{formatRiskValue(item.limitValue, item.unit)}</td>
                        <td><StatusBadge tone={statusTone(item.status)}>{presentQueueStatus(item.status).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.propConstraints.length ? <tr><td colSpan={4}><p className="rc-empty">Aucune contrainte prop firm publiée.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <div className="rc-row2">
          <section className="rc-panel" aria-label="Corrélations">
            <header><h2>Corrélations</h2><small>{data.correlations.length}</small></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <div className="rc-table-scroll" role="region" aria-label="Corrélations défilables" tabIndex={0}>
                <table className="rc-table">
                  <caption className="sr-only">Corrélations surveillées par le moteur de risque</caption>
                  <thead><tr><th>Paire</th><th>Valeur</th><th>Limite</th><th>Statut</th></tr></thead>
                  <tbody>
                    {data.correlations.map((item, index) => (
                      <tr key={`${item.correlationId}-${index}`}>
                        <td><strong>{item.pair}</strong></td>
                        <td>{item.value.toFixed(2)}</td>
                        <td>{item.limit.toFixed(2)}</td>
                        <td><StatusBadge tone={statusTone(item.status)}>{presentQueueStatus(item.status).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.correlations.length ? <tr><td colSpan={4}><p className="rc-empty">Aucune corrélation publiée.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rc-panel" aria-label="Stress tests">
            <header>
              <h2>Stress tests</h2>
              {primaryStressAction ? (
                <DeskButton variant="warning" disabled={isActionDisabled(primaryStressAction, reason, stepUpToken) || submittingActionId === primaryStressAction.actionId} onClick={() => confirmAction(primaryStressAction)}>
                  {submittingActionId === primaryStressAction.actionId ? "Envoi..." : "Lancer un test"}
                </DeskButton>
              ) : null}
            </header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <div className="rc-table-scroll" role="region" aria-label="Stress tests défilables" tabIndex={0}>
                <table className="rc-table">
                  <caption className="sr-only">Résultats des stress tests</caption>
                  <thead><tr><th>Scénario</th><th>État</th><th>Perte (R)</th><th>Marge utilisée</th></tr></thead>
                  <tbody>
                    {data.stressTests.map((item, index) => (
                      <tr key={`${item.stressTestId}-${index}`}>
                        <td><Link to={item.route}>{item.scenario}</Link></td>
                        <td><StatusBadge tone={item.state === "PASSED" ? "success" : item.state === "FAILED" ? "danger" : "accent"}>{item.state}</StatusBadge></td>
                        <td className={item.lossR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(item.lossR)}</td>
                        <td>{formatPercent(item.marginUsedPct)}</td>
                      </tr>
                    ))}
                    {!data.stressTests.length ? <tr><td colSpan={4}><p className="rc-empty">Aucun stress test publié.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rc-panel" aria-label="Dépassements et alertes">
            <header>
              <h2>Dépassements</h2>
              <div className="rc-panel__tabs">
                <button type="button" className={`rc-tab${breachTab === "active" ? " rc-tab--active" : ""}`} onClick={() => setBreachTab("active")}>Actifs</button>
                <button type="button" className={`rc-tab${breachTab === "all" ? " rc-tab--active" : ""}`} onClick={() => setBreachTab("all")}>Tous</button>
              </div>
            </header>
            <div className="rc-panel__body">
              {shownBreaches.length ? shownBreaches.map((breach, index) => (
                <div key={`${breach.breachId}-${index}`} className="rc-breach-row">
                  <time>{formatTime(breach.openedAt)}</time>
                  <div><strong>{breach.title}</strong><small>{breach.detail}</small></div>
                  <StatusBadge tone={breach.severity === "HIGH" || breach.severity === "EMERGENCY" ? "danger" : breach.severity === "MEDIUM" ? "warning" : "accent"}>{breach.severity}</StatusBadge>
                </div>
              )) : <p className="rc-empty">{breachTab === "active" ? "Aucun dépassement actif." : "Aucun dépassement publié."}</p>}
            </div>
          </section>
        </div>

        <div className="rc-row3">
          <section className="rc-panel" aria-label="Risque par compte">
            <header><h2>Risque par compte</h2><small>{data.riskByAccount.length}</small></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <table className="rc-table">
                <caption className="sr-only">Risque agrégé par compte</caption>
                <thead><tr><th>Compte</th><th>Equity</th><th>Risque ouvert</th><th>Statut</th></tr></thead>
                <tbody>
                  {data.riskByAccount.map((row, index) => (
                    <tr key={`${row.accountId}-${index}`}>
                      <td><strong>{row.label}</strong></td>
                      <td>{row.equityUsd != null ? formatCurrency(row.equityUsd) : "Non disponible"}</td>
                      <td>{formatCurrency(row.openRiskUsd)}</td>
                      <td><StatusBadge tone={row.status === "CONTROLLED" ? "success" : "warning"}>{row.status}</StatusBadge></td>
                    </tr>
                  ))}
                  {!data.riskByAccount.length ? <tr><td colSpan={4}><p className="rc-empty">Aucun compte publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rc-panel" aria-label="Risque par stratégie">
            <header><h2>Risque par stratégie</h2><small>Top {data.riskByStrategy.length}</small></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <table className="rc-table">
                <caption className="sr-only">Risque agrégé par stratégie</caption>
                <thead><tr><th>Stratégie</th><th>Risque</th><th>Décisions</th></tr></thead>
                <tbody>
                  {data.riskByStrategy.map((row, index) => (
                    <tr key={`${row.strategyInstanceId}-${index}`}>
                      <td><strong>{row.label}</strong></td>
                      <td>{formatCurrency(row.riskAmount)}</td>
                      <td>{row.decisions}</td>
                    </tr>
                  ))}
                  {!data.riskByStrategy.length ? <tr><td colSpan={3}><p className="rc-empty">Aucune décision de risque publiée par stratégie.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rc-panel" aria-label="Risque par instrument">
            <header><h2>Risque par instrument</h2></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <table className="rc-table">
                <caption className="sr-only">Risque agrégé par instrument</caption>
                <thead><tr><th>Instrument</th><th>Risque</th><th>Décisions</th></tr></thead>
                <tbody>
                  {data.riskByInstrument.map((row, index) => (
                    <tr key={`${row.instrument}-${index}`}>
                      <td><strong>{row.instrument}</strong></td>
                      <td>{formatCurrency(row.riskAmount)}</td>
                      <td>{row.decisions}</td>
                    </tr>
                  ))}
                  {!data.riskByInstrument.length ? <tr><td colSpan={3}><p className="rc-empty">Aucune décision de risque publiée par instrument.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="rc-row4">
          <section className="rc-panel" aria-label="Décisions de risque du jour">
            <header><h2>Décisions (jour)</h2><small>{data.riskDecisions.summary.today}</small></header>
            <div className="rc-panel__body">
              {data.riskDecisions.summary.total ? (
                <div className="rc-donut-panel">
                  <Donut
                    items={[
                      { value: data.riskDecisions.summary.approved, color: "var(--rc-green)" },
                      { value: data.riskDecisions.summary.reduced, color: "var(--rc-amber)" },
                      { value: data.riskDecisions.summary.rejected, color: "var(--rc-red)" },
                    ]}
                    centerLabel={String(data.riskDecisions.summary.total)}
                  />
                  <ul className="rc-donut-legend">
                    <li><span className="dot" style={{ background: "var(--rc-green)" }} /><span>Approuvées</span><strong>{data.riskDecisions.summary.approved}</strong></li>
                    <li><span className="dot" style={{ background: "var(--rc-amber)" }} /><span>Réduites</span><strong>{data.riskDecisions.summary.reduced}</strong></li>
                    <li><span className="dot" style={{ background: "var(--rc-red)" }} /><span>Rejetées</span><strong>{data.riskDecisions.summary.rejected}</strong></li>
                  </ul>
                </div>
              ) : <p className="rc-empty">Aucune décision de risque publiée.</p>}
            </div>
          </section>

          <section className="rc-panel" aria-label="Dernières décisions de risque">
            <header><h2>Dernières décisions</h2><small>{data.riskDecisions.items.length}</small></header>
            <div className="rc-panel__body" style={{ padding: 0 }}>
              <div className="rc-table-scroll" role="region" aria-label="Décisions de risque défilables" tabIndex={0}>
                <table className="rc-table">
                  <caption className="sr-only">Dernières décisions de risque</caption>
                  <thead><tr><th>Heure</th><th>Signal</th><th>Instrument</th><th>Demandé</th><th>Autorisé</th><th>Décision</th></tr></thead>
                  <tbody>
                    {data.riskDecisions.items.map((item, index) => (
                      <tr key={`${item.orderIntentId}-${index}`}>
                        <td>{formatTime(item.at)}</td>
                        <td>{shortId(item.signalId)}</td>
                        <td>{item.instrument}</td>
                        <td>{item.requestedQty}</td>
                        <td>{item.authorizedQty}</td>
                        <td><StatusBadge tone={item.verdict === "APPROVED" ? "success" : item.verdict === "REDUCED" ? "warning" : "danger"}>{item.verdict}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.riskDecisions.items.length ? <tr><td colSpan={6}><p className="rc-empty">Aucune décision de risque publiée.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rc-panel" aria-label="Kill switch et disjoncteurs">
            <header><h2>Kill Switch &amp; Disjoncteurs</h2></header>
            <div className="rc-panel__body">
              <div className="rc-kill-panel">
                {data.circuitBreakers.map((breaker, index) => (
                  <div key={`${breaker.breakerId}-${index}`} className="rc-kill-row">
                    <strong>{breaker.label}</strong>
                    <StatusBadge tone={breaker.armed ? "danger" : "success"}>{breaker.armed ? "BLOQUANT" : "OK"}</StatusBadge>
                    <small>{breaker.detail}</small>
                  </div>
                ))}
                {!data.circuitBreakers.length ? <p className="rc-empty">Aucun disjoncteur publié.</p> : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function buildRiskCommand(action: RiskAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("RISK_REASON_REQUIRED"), { code: "RISK_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("RISK_PERMISSION_DENIED"), { code: "RISK_PERMISSION_DENIED" });
  }

  const normalizedStepUp = stepUpToken.trim();
  if (action.permission === "STEP_UP_REQUIRED" && normalizedStepUp !== action.actionId) {
    throw Object.assign(new Error("RISK_STEP_UP_REQUIRED"), { code: "RISK_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      criticality: action.criticality,
      impactSummary: action.impactSummary,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

function isActionDisabled(action: RiskAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function KpiCell({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" }) {
  return (
    <article className={`rc-kpi-card${tone ? ` rc-kpi-card--${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function Donut({ items, centerLabel }: { items: readonly { value: number; color: string }[]; centerLabel: string }) {
  const normalizedValues = items.map((item) => Number.isFinite(item.value) ? Math.max(0, item.value) : 0);
  const total = normalizedValues.reduce((sum, value) => sum + value, 0) || 1;
  let cumulative = 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 100 100" width="110" height="110" role="img" aria-label="Répartition du risque">
      <g transform="rotate(-90 50 50)">
        {items.map((item, index) => {
          const fraction = normalizedValues[index] / total;
          const dash = fraction * circumference;
          const offset = cumulative * circumference;
          cumulative += fraction;
          return <circle key={index} cx="50" cy="50" r={radius} fill="none" stroke={item.color} strokeWidth="14" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
        })}
      </g>
      <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--rc-text)" fontWeight="700">{centerLabel}</text>
    </svg>
  );
}

function LimitCell({ row }: { row: RiskLimit }) {
  return (
    <span>
      <strong>{row.label ?? "Limite non publiée"}</strong>
      <br />
      <small style={{ color: "var(--rc-muted)" }}>{row.officialSource ?? "Source non publiée"} · {(row.reasonCodes ?? []).map((code) => presentGeneric(code).label).join(", ")}</small>
    </span>
  );
}

function uniqueTargets(limits: RiskView["limits"], scope: RiskLimit["scope"]): string[] {
  return [...new Set(limits.filter((limit) => limit.scope === scope).map((limit) => limit.targetId).filter(Boolean))].sort();
}

function RiskLoading() {
  return (
    <div className="rc-page">
      <div className="rc-workspace">
        <section className="rc-kpi-strip">
          {Array.from({ length: 9 }).map((_, index) => <article key={index} className="rc-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function statusTone(status: "PASS" | "WATCH" | "BREACH" | "BLOCKED") {
  if (status === "PASS") return "success" as const;
  if (status === "WATCH") return "warning" as const;
  return "danger" as const;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatSignedR(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  if (absolute >= 1_000_000) return `${value < 0 ? "−" : ""}${formatter.format(absolute / 1_000_000)} M$`;
  if (absolute >= 1_000) return `${value < 0 ? "−" : ""}${formatter.format(absolute / 1_000)} k$`;
  return `${value < 0 ? "−" : ""}${formatter.format(absolute)} $`;
}

function formatRiskValue(value: number, unit: RiskLimit["unit"] | RiskView["propConstraints"][number]["unit"]) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "USD") return formatCurrency(value);
  if (unit === "R") return formatSignedR(value);
  if (unit === "LOTS") return `${value.toFixed(0)} lots`;
  if (unit === "CONTRACTS") return `${value.toFixed(0)} contrats`;
  if (unit === "X") return `${value.toFixed(2)}×`;
  return `${value.toFixed(value < 1 ? 2 : 1).replace(".", ",")}%`;
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
