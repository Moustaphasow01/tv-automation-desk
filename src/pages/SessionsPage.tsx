import { Card, SectionTitle } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";

export default function SessionsPage() {
  const { phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const phases = [
    { id: "asia", label: "Asia", hours: "00:00–08:00", detail: "Ouverture et flux Asie" },
    { id: "london", label: "London", hours: "08:00–15:30", detail: "Session européenne" },
    { id: "ny", label: "New York", hours: "15:30–00:00", detail: "Cash US et clôture" },
  ] as const;
  return <section className="view">
    <SectionTitle title="Sessions" subtitle={"Sélection automatique Europe/Paris · " + phaseLabel + " active · prochaine phase " + nextPhaseAt}/>
    <div className="session-list-react">
      {phases.map(item => <Card className={"session-card-react session-card-react--auto " + (phase === item.id ? "active" : "")} key={item.id}>
        <div><p className="eyebrow">{item.hours}</p><h2>{item.label}</h2><p>{item.detail}</p></div>
        <span className="automatic-phase-state">{phase === item.id ? "ACTIVE AUTO" : "PROGRAMMÉE"}</span>
      </Card>)}
    </div>
  </section>;
}
