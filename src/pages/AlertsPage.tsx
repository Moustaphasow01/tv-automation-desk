import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { DeskPage } from "@/pages/pageState";

export default function AlertsPage() {
  return <DeskPage>{data => <section className="view">
    <SectionTitle title="Centre d’alertes" subtitle="Actions et événements nécessitant ton attention"/>
    <div className="alert-list-react">
      {data.alerts.map((alert, index) => <Card key={index} className={`alert-react alert-react--${alert.level}`}>
        <span className="alert-react__icon"><Icon name="alert"/></span><div><div className="alert-react__head"><h3>{alert.title}</h3><StatusBadge tone={alert.level === "critical" ? "critical" : "warning"}>{alert.time}</StatusBadge></div><p>{alert.message}</p></div>
      </Card>)}
    </div>
  </section>}</DeskPage>;
}
