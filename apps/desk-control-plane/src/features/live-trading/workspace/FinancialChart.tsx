import { useMemo, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiMaximize, FiMinus, FiPlus } from "react-icons/fi";
import type { ChartBar } from "./chartData";
import { useFinancialChart } from "./useFinancialChart";
import { numberLabel, parisTime } from "./workspaceModel";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { visibleTradeOverlay, type TradeOverlay } from "../chart/tradePlanOverlay";
import type { ChartAnnotations } from "./useChartAnnotations";

export function FinancialChart({ bars, instrument, overlay, annotations }: { bars: readonly ChartBar[]; instrument: string; overlay: TradeOverlay | null; annotations: ChartAnnotations }) {
  const [showData, setShowData] = useState(false);
  const [vwap, setVwap] = useState(false);
  const visiblePlan = useMemo(() => visibleTradeOverlay(overlay, Math.min(...bars.map((bar) => bar.low)), Math.max(...bars.map((bar) => bar.high))), [bars, overlay]);
  const { container, navigate } = useFinancialChart(bars, visiblePlan.overlay, vwap, annotations);
  const last = bars.at(-1);
  return <>
    <div className="tw-chart__ohlc" role="group" tabIndex={0} aria-label={`Dernière bougie ${instrument}`}>
      {([['O', last?.open], ['H', last?.high], ['B', last?.low], ['C', last?.close]] as const).map(([label, value]) => <span key={label}>{label} <b>{numberLabel(value)}</b></span>)}
      <span>Vol. <b>{numberLabel(last?.volume, 0)}</b></span>
    </div>
    <div ref={container} className="tw-chart__canvas" role="group" tabIndex={0} aria-label={`Graphique ${instrument}. Flèches pour déplacer, plus et moins pour zoomer, Origine pour réinitialiser. Tableau des données disponible ci-dessous.`}
      onKeyDown={(event) => {
        const action = ({ ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out", Home: "reset" } as const)[event.key as "ArrowLeft"];
        if (action) { event.preventDefault(); navigate(action); }
      }} />
    <div className="tw-chart__tools">
      <div className="tw-button-group" aria-label={`Navigation graphique ${instrument}`}>
        <button aria-label="Déplacer vers le passé" onClick={() => navigate("left")}><FiArrowLeft /></button>
        <button aria-label="Dézoomer" onClick={() => navigate("out")}><FiMinus /></button>
        <button aria-label="Zoomer" onClick={() => navigate("in")}><FiPlus /></button>
        <button aria-label="Déplacer vers le présent" onClick={() => navigate("right")}><FiArrowRight /></button>
        <button aria-label="Afficher toutes les bougies" onClick={() => navigate("reset")}><FiMaximize /></button>
      </div>
      {bars.some((bar) => bar.vwap !== null) ? <button aria-pressed={vwap} onClick={() => setVwap(!vwap)}>VWAP</button> : null}
      <button onClick={() => setShowData(true)}>Données</button>
      <span className="tw-chart__zone">Paris</span>
    </div>
    {overlay ? <p className="tw-chart__plan">Plan du ticket sélectionné · {visiblePlan.hiddenLevelCount ? `${visiblePlan.hiddenLevelCount} niveau(x) hors champ ; voir le ticket` : "entrée, protection et objectifs"}</p> : null}
    {annotations.events.length ? <details className="tw-source"><summary>Repères de séance et du ticket · {annotations.events.length}</summary><p>Repère posé sur la bougie reçue contenant l’événement ; aucune interpolation dans les trous de données. Horaires exacts ci-dessous.</p><ul>{annotations.events.map((event) => <li key={event.id}>{parisTime(event.at, true)} · {event.label}</li>)}</ul></details> : null}
    {showData ? <WorkspaceDialog title={`${instrument} · bougies reçues`} onClose={() => setShowData(false)}><CandleTable bars={bars} /></WorkspaceDialog> : null}
  </>;
}

function CandleTable({ bars }: { bars: readonly ChartBar[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? bars : bars.slice(-30);
  return <><p>Valeurs reçues du desk, sans interpolation. Heures de Paris. « — » signifie non publié.</p>
    <div className="tw-table-scroll" tabIndex={0} role="region" aria-label="Tableau des bougies">
      <table><caption>{rows.length} bougies affichées sur {bars.length}</caption><thead><tr>{["Heure", "Ouverture", "Haut", "Bas", "Clôture", "Volume"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{[...rows].reverse().map((bar) => <tr key={bar.time}><th scope="row">{parisTime(new Date(bar.time * 1_000).toISOString(), true)}</th>{[bar.open, bar.high, bar.low, bar.close, bar.volume].map((value, index) => <td key={index}>{numberLabel(value)}</td>)}</tr>)}</tbody></table>
    </div>{!all && bars.length > 30 ? <button onClick={() => setAll(true)}>Afficher tout l’historique reçu</button> : null}</>;
}
