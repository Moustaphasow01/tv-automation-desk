import { Card, StatusBadge } from "@/components/common";
import { LiveSectionHeading } from "@/components/deskCards";
import type { DeskSession } from "@/types";

const phases = [
  { id: "asia", label: "Asia", start: 0, end: 8, hours: "00:00–08:00" },
  { id: "london", label: "London", start: 8, end: 15.5, hours: "08:00–15:30" },
  { id: "ny", label: "New York", start: 15.5, end: 24, hours: "15:30–00:00" }
] as const;

export function SessionsTab({
  phase,
  phaseLabel,
  nextPhaseAt,
  asiaData,
  asiaLoading,
  nyData,
  nyLoading
}: {
  phase: string;
  phaseLabel: string;
  nextPhaseAt: string;
  asiaData?: DeskSession;
  asiaLoading: boolean;
  nyData?: DeskSession;
  nyLoading: boolean;
}) {
  const now = parisHour();
  return <>
    <LiveSectionHeading title="Sessions" subtitle={`${phaseLabel} active · prochaine transition à ${nextPhaseAt}`}/>
    <Card className="session-day-timeline">
      <header><div><p className="eyebrow">Journée Europe/Paris</p><h2>Chronologie des phases</h2></div><StatusBadge tone="info">AUTOMATIQUE</StatusBadge></header>
      <div className="session-day-timeline__track" aria-label={`Phase active ${phaseLabel} ; prochaine transition à ${nextPhaseAt}`}>
        {phases.map(item => <div key={item.id} className={phase === item.id ? "active" : ""} style={{ width: `${((item.end - item.start) / 24) * 100}%` }}><strong>{item.label}</strong><span>{item.hours}</span></div>)}
        <i className="session-now" style={{ left: `${(now / 24) * 100}%` }}><span>Maintenant</span></i>
      </div>
      <p>La session est choisie par l’heure de Paris. Cette chronologie est indicative et ne permet aucune sélection manuelle.</p>
    </Card>
    <div className="session-context-grid">
      <SessionContextCard title="Contexte Asia" data={asiaData} loading={asiaLoading} active={phase === "asia" || phase === "london"}/>
      <SessionContextCard title="Contexte New York" data={nyData} loading={nyLoading} active={phase === "ny"}/>
    </div>
  </>;
}

function SessionContextCard({ title, data, loading, active }: { title: string; data?: DeskSession; loading: boolean; active: boolean }) {
  return <Card className={`session-context-detail ${active ? "active" : ""}`}>
    <header><div><p className="eyebrow">{title}</p><h2>{data?.label || (loading ? "Chargement…" : "Non disponible")}</h2></div><StatusBadge tone={active ? "info" : "muted"}>{active ? "CONTEXTE ACTIF" : "EN ATTENTE"}</StatusBadge></header>
    {data ? <dl className="definition-grid"><dt>Stratégie</dt><dd>{data.strategyId}</dd><dt>Mode</dt><dd>{data.mode}</dd><dt>État</dt><dd>{data.status}</dd><dt>Prochain monitor</dt><dd>{data.nextMonitorAt}</dd></dl> : !loading && <p className="muted-copy">Le contexte n’est pas matérialisé par le backend.</p>}
  </Card>;
}

function parisHour() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour")?.value || 0) + Number(parts.find(part => part.type === "minute")?.value || 0) / 60;
}
