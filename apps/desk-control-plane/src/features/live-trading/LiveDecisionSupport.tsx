import type { ReactNode } from "react";
import { FaBalanceScale, FaBullseye, FaChartLine, FaHistory } from "react-icons/fa";
import { presentConflictStatus, presentDataAbsence, presentGeneric } from "@/design-system/labels";
import type { LiveTradingModel } from "./model";
import { buildSignalDecisionSupport } from "./signalDecisionSupport";

export function LiveDecisionSupport({ model }: { model: LiveTradingModel }) {
  const support = buildSignalDecisionSupport(model);
  const notPublished = presentDataAbsence("NOT_PUBLISHED").label;
  const conflict = support.conflict.status === "NOT_PUBLISHED"
    ? { label: notPublished, tone: "neutral" as const }
    : presentConflictStatus(support.conflict.status);

  return (
    <section className="lt-decision-support" aria-label="Aides à la décision du signal sélectionné">
      <div className="lt-decision-support__metrics">
        <DecisionMetric icon={<FaBullseye aria-hidden="true" />} label="Distance entrée" value={support.distanceToEntryPoints === null ? notPublished : support.distanceToEntryPoints === 0 ? "Dans la zone" : `${formatNumber(support.distanceToEntryPoints)} pts`} />
        <DecisionMetric icon={<FaBalanceScale aria-hidden="true" />} label="Rendement / risque" value={support.rewardRisk === null ? notPublished : `${formatNumber(support.rewardRisk)} R`} prominent />
        <DecisionMetric icon={<FaHistory aria-hidden="true" />} label="Fenêtre moyenne" value={support.averageWindowMinutes === null ? notPublished : `${formatNumber(support.averageWindowMinutes)} min`} />
        <DecisionMetric icon={<FaChartLine aria-hidden="true" />} label="Conflit portefeuille" value={conflict.label} tone={conflict.tone} />
      </div>
      <details className="lt-decision-support__history">
        <summary>Historique et confiance du setup</summary>
        <div>
          <section>
            <h3>Historique publié</h3>
            <strong>{support.setupHistory.occurrences} occurrence{support.setupHistory.occurrences > 1 ? "s" : ""}</strong>
            <p>{support.setupHistory.hitRatePct === null ? "Taux de réussite non calculable" : `${formatNumber(support.setupHistory.hitRatePct)} % de réussite`} · {support.setupHistory.averageResultR === null ? notPublished : `${signed(support.setupHistory.averageResultR)} R de moyenne`}</p>
            <small>{support.setupHistory.scopeLabel} · {support.setupHistory.unresolved} sans résultat clos</small>
          </section>
          <section>
            <h3>Confiance</h3>
            {support.confidenceFactors.length ? support.confidenceFactors.map((factor) => (
              <div className="lt-decision-support__factor" key={factor.label}>
                <span>{presentGeneric(factor.label).label}</span>
                <strong>{factor.value === null ? presentGeneric(factor.status).label : formatNumber(factor.value)}</strong>
              </div>
            )) : <p>La décomposition du score n’est pas publiée par le moteur.</p>}
          </section>
          <section>
            <h3>Exposition</h3>
            <strong className={`lt-decision-support__conflict lt-decision-support__conflict--${support.conflict.status.toLowerCase()}`}>{conflict.label}</strong>
            <p>{support.conflict.detail}</p>
          </section>
        </div>
      </details>
    </section>
  );
}

function DecisionMetric({ icon, label, value, prominent = false, tone = "neutral" }: { icon: ReactNode; label: string; value: string; prominent?: boolean; tone?: string }) {
  return <span className={prominent ? "is-prominent" : ""} data-tone={tone}>{icon}<small>{label}</small><strong>{value}</strong></span>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}
