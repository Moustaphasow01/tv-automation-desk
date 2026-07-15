import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { deskDetailScope, useMasterDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

function StepList({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "critical" | "info" }) {
  return <Card className="step-card"><div className="brief-card__header"><h3>{title}</h3><StatusBadge tone={tone}>{items.length}</StatusBadge></div>
    <ol className="step-list">{items.map((item, index) => <li key={index}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
  </Card>;
}

export default function MasterPage() {
  return <DeskPage>{data => <MasterWorkspace initialData={data}/>}</DeskPage>;
}

function MasterWorkspace({ initialData }: { initialData: DeskSession }) {
  const query = useMasterDetail(initialData.master.id, deskDetailScope(initialData));
  const data = { ...initialData, master: query.data?.master || initialData.master };
  return <section className="view">
    <SectionTitle title="Master Analysis" subtitle={`Plan figé au cutoff · ${data.master.createdAt}`}/>
    <Card className="master-hero-react">
      <div className="master-hero-react__top"><div><p className="eyebrow">Décision initiale</p><h1>{data.master.decision}</h1><p>{data.master.summary}</p></div><StatusBadge tone="warning">{data.master.confidence}%</StatusBadge></div>
      <div className="detail-pairs detail-pairs--four">
        <div><span>Instrument</span><strong>{data.master.instrument}</strong></div>
        <div><span>Direction</span><strong>{data.master.direction}</strong></div>
        <div><span>Régime</span><strong>{data.master.regime}</strong></div>
        <div><span>ID</span><strong className="truncate">{data.master.id}</strong></div>
      </div>
    </Card>

    <div className="content-grid">
      <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Macro Thesis</p><h3>Contexte fondamental</h3></div><span className="card-icon"><Icon name="globe"/></span></div><p>{data.master.macroThesis}</p></Card>
      <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Asset Selection</p><h3>Pourquoi {data.master.instrument}</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.master.assetSelection}</p></Card>
    </div>

    <div className="content-grid">
      <StepList title="Expected path" items={data.master.expectedPath} tone="positive"/>
      <StepList title="Failure path" items={data.master.failurePath} tone="critical"/>
    </div>
    <StepList title="Monitoring playbook" items={data.master.monitoringPlaybook} tone="info"/>

    <SectionTitle title="Analyse complète" subtitle="Chapitres du contrat Master v4.0.0"/>
    <div className="accordion-list">
      {data.master.sections.map((section, index) => <details className="accordion-react card" key={index} open={index === 0}>
        <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title}</strong><Icon name="chevron"/></summary>
        <div><p>{section.content}</p></div>
      </details>)}
    </div>
  </section>;
}
