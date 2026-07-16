import { useNavigate } from "react-router-dom";
import { Card, Icon, type IconName, SectionTitle } from "@/components/common";

const links: Array<{to:string; label:string; text:string; icon:IconName}> = [
  {to:"/operations",label:"Cockpit opérations",text:"Tous les workflows automatisés",icon:"monitor"},
  {to:"/replay",label:"Replay Lab",text:"Backtests, journées et processus GPT",icon:"layers"},
  {to:"/performance/analysis",label:"Analyse performance",text:"Comparaisons et ventilations",icon:"chart"},
  {to:"/history",label:"Historique",text:"Sessions et décisions passées",icon:"database"},
  {to:"/strategies",label:"Stratégies",text:"Configurations et versions",icon:"settings"},
  {to:"/sessions",label:"Sessions",text:"Changer de workspace",icon:"layers"},
  {to:"/thesis",label:"Thèse",text:"État vivant du plan",icon:"brain"},
  {to:"/setup",label:"Setup & Position",text:"Exécution et gestion",icon:"position"},
  {to:"/news",label:"Macro & News",text:"Calendrier et digest",icon:"news"},
  {to:"/performance",label:"Calendrier R",text:"Résultats quotidiens et zoom",icon:"calendar"},
  {to:"/alerts",label:"Alertes",text:"Actions prioritaires",icon:"bell"},
  {to:"/audit",label:"Audit",text:"Qualité et contrats",icon:"audit"}
];

export default function MorePage() {
  const navigate = useNavigate();
  return <section className="view"><SectionTitle title="Navigation" subtitle="Tous les espaces du Desk"/>
    <div className="more-grid-react">{links.map(link => <Card key={link.to} onClick={() => navigate(link.to)} className="more-link-react"><span className="card-icon"><Icon name={link.icon}/></span><div><h3>{link.label}</h3><p>{link.text}</p></div><Icon name="arrow"/></Card>)}</div>
  </section>;
}
