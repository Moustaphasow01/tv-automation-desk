import { useState } from "react";
import { Card, SectionTitle, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { Conditions, DecisionDeskStrip, ExpectedRealized } from "@/components/deskCards";
import { deskDetailScope, useMonitorDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { MonitorItem } from "@/types";

function MonitorDetail({ monitor }: { monitor: MonitorItem }) {
  return <>
    <Card className="monitor-hero-react">
      <div><p className="eyebrow">Monitor #{monitor.sequence} · {monitor.time}</p><h1>{monitor.decision}</h1><p>{monitor.summary}</p></div>
      <MetricStrip className="monitor-health-strip">
        <MetricCard label="Santé avant" value={monitor.healthBefore}/>
        <MetricCard label="Santé après" value={monitor.healthAfter} tone={monitor.healthAfter < 40 ? "negative" : monitor.healthAfter < 70 ? "warning" : "neutral"}/>
      </MetricStrip>
    </Card>
    <Card className="brief-card">
      <div className="brief-card__header"><h3>Pourquoi cette décision ?</h3><StatusBadge tone={monitor.severity === "critical" ? "critical" : "warning"}>{monitor.statusAfter}</StatusBadge></div>
      <p>{monitor.detailedReason}</p>
      <div className="monitor-actions-react"><div><span>Action</span><strong>{monitor.nextAction}</strong></div><div><span>Prochain focus</span><strong>{monitor.nextFocus}</strong></div></div>
    </Card>
    <SectionTitle title="Attendu vs réalisé"/>
    <ExpectedRealized monitor={monitor}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={monitor.goConditions}/>
      <Conditions title="Invalidations" items={monitor.invalidationConditions}/>
    </div>
    <Card className="weak-signals-react"><h3>Signaux faibles</h3><div className="tag-list">{monitor.weakSignals.map(item => <span key={item}>{item}</span>)}</div></Card>
  </>;
}

export default function MonitorsPage() {
  return <DeskPage>{data => <MonitorWorkspace data={data}/>}</DeskPage>;
}

function MonitorWorkspace({ data }: { data: import("@/types").DeskSession }) {
  const [selectedId, setSelectedId] = useState(data.monitors.at(-1)?.id ?? "");
  const selectedBase = data.monitors.find(m => m.id === selectedId) ?? data.monitors[0];
  const query = useMonitorDetail(selectedBase?.id || "", deskDetailScope(data));
  const selected = query.data?.monitor || selectedBase;
  return <section className="view monitor-workspace-v2">
      <PageHeading eyebrow="Temps réel" title="Monitors" subtitle="Contrôle dynamique de la thèse active"/>
      <DecisionDeskStrip
        data={data}
        focusLabel="Monitor sélectionné"
        focusValue={selected ? `${selected.time} · ${selected.decision}` : data.liveBrief.nextAction}
        focusDetail={selected ? `${selected.nextAction} · ${selected.nextFocus}` : data.liveBrief.action}
      />
      {data.monitors.length > 1 && <div className="monitor-selector-react" aria-label="Choisir un monitor">
        {data.monitors.map(m => <button key={m.id} className={selected?.id === m.id ? "active" : ""} onClick={() => setSelectedId(m.id)}>
          <span>{m.time}</span><strong>{m.decision}</strong><small>{m.statusBefore} → {m.statusAfter}</small>
        </button>)}
      </div>}
      {selected ? <MonitorDetail monitor={selected}/> : <Card><p>Aucun monitor disponible.</p></Card>}
    </section>;
}
