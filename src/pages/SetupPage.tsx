import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DecisionDeskStrip, PositionCard, SetupCard } from "@/components/deskCards";
import { OperatorCommandPanel } from "@/components/OperatorCommandPanel";
import { deskDetailScope, useSetupDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function SetupPage() {
  return <DeskPage>{data => <SetupWorkspace initialData={data}/>}</DeskPage>;
}

function SetupWorkspace({ initialData }: { initialData: DeskSession }) {
  const query = useSetupDetail(initialData.setup.id, deskDetailScope(initialData));
  const data = {
    ...initialData,
    setup: query.data?.setup || initialData.setup,
    levels: query.data?.levels || initialData.levels
  };
  return <section className="view setup-workspace-v2">
    <PageHeading eyebrow="Exécution" title="Setup & Position" subtitle="Plan théorique séparé de l’exécution canonique"/>
    <DecisionDeskStrip
      data={data}
      focusLabel="Sécurité opérateur"
      focusValue={data.position.active ? `Position ${data.position.status}` : data.setup.statusLabel}
      focusDetail={`Setup ${data.setup.status} · commandes idempotentes`}
    />
    <div className="setup-control-grid">
      <SetupCard data={data}/>
      <section id="position"><PositionCard data={data}/></section>
    </div>
    <OperatorCommandPanel data={data}/>
    <Card className="source-rules-react">
      <div className="brief-card__header"><div><p className="eyebrow">Priorité des sources</p><h3>Règle opérationnelle</h3></div><span className="card-icon"><Icon name="database"/></span></div>
      <div className="source-priority-list">
        <div><span>1</span><p><strong>Position et stop réels</strong><small>Backend d’exécution</small></p></div>
        <div><span>2</span><p><strong>Statut du setup</strong><small>desk_setups</small></p></div>
        <div><span>3</span><p><strong>Action recommandée</strong><small>Dernier Monitor valide</small></p></div>
        <div><span>4</span><p><strong>Plan initial</strong><small>Analyse Master</small></p></div>
      </div>
    </Card>
    <SectionTitle title="Niveaux liés"/>
    <div className="levels-react">{data.levels.map(level => <Card key={level.price} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : "info"}>{level.state}</StatusBadge></Card>)}</div>
  </section>;
}
