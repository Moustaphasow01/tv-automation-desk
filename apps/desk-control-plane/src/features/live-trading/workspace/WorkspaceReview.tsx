import { Link } from "react-router-dom";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { operatorCopy } from "@/design-system/operatorVocabulary";
import { buildFocusDashboard, focusDashboardPeriodOptions, type LiveFocusDashboardPeriod } from "../focusDashboardModel";
import { buildFocusSignalFlowItems } from "../focusJournalModel";
import { parisTime, workspaceCopy } from "./workspaceModel";
import type { ReactNode } from "react";

export function WorkspaceReview({ focus, period, onPeriodChange, children }: { focus: LiveFocusView; period: LiveFocusDashboardPeriod; onPeriodChange(period: LiveFocusDashboardPeriod): void; children?: ReactNode }) {
  const dashboard = buildFocusDashboard(focus, period);
  return <section className="tw-review" aria-label="Bilan de séance">
    <header className="tw-section-header"><div><h2>Bilan de séance</h2><span>Suivi théorique · {dashboard.scopeLabel}</span></div><label><span className="tw-sr-only">Période du bilan</span><select value={period} onChange={(event) => onPeriodChange(event.target.value as LiveFocusDashboardPeriod)}>{focusDashboardPeriodOptions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label></header>
    <dl className="tw-review-metrics">{dashboard.metrics.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd data-tone={metric.tone}>{metric.value}</dd><small>{metric.helper}</small></div>)}</dl>
    <p>{dashboard.windowLabel}</p><p>{dashboard.coverageLabel}</p>
    {children}
    <SessionBrief focus={focus} />
    <details className="tw-signal-flow"><summary>Signaux observés · {focus.observedOpportunities.length}</summary><p>Ces observations ne sont pas des tickets autorisés à trader.</p>{buildFocusSignalFlowItems(focus).map((item) => <div key={item.key}><strong>{item.instrument} · {item.title}</strong><span>{item.status} · {parisTime(item.createdAt, true)}</span><p>{item.reasonLine}</p><Link to={item.route}>Consulter le signal</Link></div>)}</details>
    <small>{dashboard.freshnessLabel}</small>
  </section>;
}

export function SessionBrief({ focus }: { focus: LiveFocusView }) {
  const brief = focus.marketDeskBrief;
  return <section className="tw-session-brief" aria-label="Lecture de la séance"><h3>{workspaceCopy(brief.headline) || "Lecture de la séance"}</h3><p>{workspaceCopy(brief.operatorSummary) || "Synthèse non publiée."}</p>
    {brief.marketInterpretation ? <p>{workspaceCopy(brief.marketInterpretation)}</p> : null}
    {brief.whatDeskWants?.length ? <><h4>À rechercher</h4><ul>{brief.whatDeskWants.map((value, index) => <li key={index}>{operatorCopy(value)}</li>)}</ul></> : null}
    {brief.whatDeskAvoids?.length ? <><h4>À éviter</h4><ul>{brief.whatDeskAvoids.map((value, index) => <li key={index}>{operatorCopy(value)}</li>)}</ul></> : null}
    <small>Lecture publiée le {parisTime(focus.asOf, true)} · Paris</small>
  </section>;
}
