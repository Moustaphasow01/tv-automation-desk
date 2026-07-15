import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { DeskPage } from "@/pages/pageState";

export default function AuditPage() {
  return <DeskPage>{data => <section className="view">
    <SectionTitle title="Audit" subtitle="Contrats, qualité, anti-lookahead et mapping API"/>
    <Card className="audit-summary-react">
      <div><span className={`audit-orb ${data.dataQuality.status}`}/><div><p className="eyebrow">Data readiness</p><h2>{data.dataQuality.label}</h2><p>Anti-lookahead : {data.dataQuality.antiLookahead ? "conforme" : "à vérifier"}</p></div></div>
      {data.dataQuality.warnings.length > 0 && <div className="audit-warnings-react">{data.dataQuality.warnings.map(w => <span key={w}><Icon name="alert" size={15}/>{w}</span>)}</div>}
    </Card>
    <div className="content-grid content-grid--start">
      <Card className="audit-detail-card"><h3>Contrats actifs</h3><div className="audit-list-react">{data.audit.contracts.map(item => <div key={item.name}><div><strong>{item.name}</strong><small>v{item.version}</small></div><StatusBadge tone="positive">{item.status}</StatusBadge></div>)}</div></Card>
      <Card className="audit-detail-card"><h3>Checks backend</h3><div className="audit-list-react">{data.audit.checks.map(item => <div key={item.label}><strong>{item.label}</strong><StatusBadge tone={item.status === "warning" ? "warning" : "positive"}>{item.status}</StatusBadge></div>)}</div></Card>
    </div>
    <Card className="audit-detail-card"><h3>Mapping front → backend</h3><div className="api-map-react">{data.audit.apiMap.map(item => <div key={item.view}><span>{item.view}</span><code>{item.endpoint}</code></div>)}</div></Card>
  </section>}</DeskPage>;
}
