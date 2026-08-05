import { Card, Icon, StatusBadge } from "@/components/common";
import { DeskReading, LiveSectionHeading } from "@/components/deskCards";
import { TechnicalDetails } from "@/components/operations";
import type { DeskSession } from "@/types";

function StepList({ title, items, tone }: { title: string; items: string[]; tone: "critical" | "warning" | "info" }) {
  return <Card className="step-card"><div className="brief-card__header"><h3>{title}</h3><StatusBadge tone={tone}>{items.length}</StatusBadge></div>
    <ol className="step-list">{items.map((item, index) => <li key={index}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
  </Card>;
}

export function MasterTab({ data }: { data: DeskSession }) {
  return <>
    <LiveSectionHeading title="Master Analysis" subtitle={`Créé au cutoff · ${data.master.createdAt}`}/>
    <div className="master-document-grid">
      <article className="master-document-content">
        <Card className="master-hero-react">
          <div className="master-hero-react__top"><div><p className="eyebrow">Décision initiale</p><h1>{data.master.decision}</h1><p>{data.master.summary}</p></div><StatusBadge tone="warning">Confiance {data.master.confidence}%</StatusBadge></div>
          <div className="detail-pairs"><div><span>Instrument</span><strong>{data.master.instrument}</strong></div><div><span>Direction</span><strong>{data.master.direction}</strong></div><div><span>Régime</span><strong>{data.master.regime}</strong></div></div>
        </Card>
        <section className="master-prose-section"><h2>Lecture structurée du Desk</h2><DeskReading data={data}/></section>
        <section id="contexte" className="master-prose-section"><h2>Contexte & sélection</h2><div className="content-grid"><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Thèse macro</p><h3>Contexte fondamental</h3></div><span className="card-icon"><Icon name="globe"/></span></div><p>{data.master.macroThesis}</p></Card><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Sélection d’actif</p><h3>Pourquoi {data.master.instrument}</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.master.assetSelection}</p></Card></div></section>
        {data.master.sections.map((section, index) => <section className="master-prose-section" id={`section-${index + 1}`} key={section.title}><p className="eyebrow">Chapitre {String(index + 1).padStart(2, "0")}</p><h2>{section.title}</h2><p>{section.content}</p></section>)}
        <TechnicalDetails items={[
          { label: "Analyse Master", value: data.master.id },
          { label: "Créée au cutoff", value: data.master.createdAt },
        ]}/>
      </article>
      <aside className="master-document-rail">
        <Card className="master-toc"><p className="eyebrow">Sommaire</p><nav aria-label="Sommaire du Master"><a href="#contexte">Contexte & sélection</a>{data.master.sections.map((section, index) => <a href={`#section-${index + 1}`} key={section.title}>{section.title}</a>)}</nav></Card>
        <Card className="workspace-panel"><h2>Niveaux saillants</h2><div className="master-levels">{data.levels.map(level => <div key={`${level.price}:${level.role}`}><strong>{level.price}</strong><span>{level.role}</span><small>{level.state}</small></div>)}</div></Card>
        <StepList title="Chemin attendu" items={data.master.expectedPath} tone="info"/>
        <StepList title="Chemin d’échec" items={data.master.failurePath} tone="critical"/>
        <StepList title="Playbook de monitoring" items={data.master.monitoringPlaybook} tone="info"/>
      </aside>
    </div>
  </>;
}
