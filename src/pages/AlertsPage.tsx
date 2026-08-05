import { Link } from "react-router-dom";
import { Card, Icon, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DeskPage } from "@/pages/pageState";

export default function AlertsPage() {
  return <DeskPage>{data => <section className="view">
    <PageHeading eyebrow="Temps réel" title="Alertes Live" subtitle="Signaux de la session courante nécessitant ton attention"/>
    <Card className="alerts-scope-banner">
      <Icon name="info"/><div><strong>Alertes de marché en temps réel</strong><p>Cette vue suit uniquement la session active. Les incidents techniques et les interventions opérateur restent dans le cockpit.</p></div>
      <Link className="secondary-btn" to="/operations/incidents">Voir les incidents</Link>
    </Card>
    <div className="alert-list-react">
      {data.alerts.map((alert, index) => <Card key={index} className={`alert-react alert-react--${alert.level}`}>
        <span className="alert-react__icon"><Icon name="alert"/></span><div><div className="alert-react__head"><h3>{alert.title}</h3><StatusBadge tone={alert.level === "critical" ? "critical" : "warning"}>{alert.time}</StatusBadge></div><p>{alert.message}</p></div>
      </Card>)}
      {!data.alerts.length && <Card className="workspace-empty"><Icon name="check"/><h3>Aucune alerte Live</h3><p>La session courante ne requiert aucune action.</p></Card>}
    </div>
  </section>}</DeskPage>;
}
