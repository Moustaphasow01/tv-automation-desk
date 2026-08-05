import { Link } from "react-router-dom";
import { Icon } from "@/components/common";
import { navigationCatalog } from "@/navigation";
import { useDeskContext } from "@/context/DeskContext";
import { PageHeading } from "@/components/operations";

export default function MorePage() {
  const { phaseLabel, nextPhaseAt } = useDeskContext();
  return <section className="view workspace-view more-page-v2">
    <PageHeading eyebrow="Navigation" title="Tous les espaces" subtitle="La même organisation sur mobile et sur desktop."/>
    <div className="more-session-context"><span className="phase-orb">{phaseLabel.slice(0, 1)}</span><div><small>Phase automatique</small><strong>{phaseLabel}</strong></div><em>AUTO</em><span>Prochaine · {nextPhaseAt}</span></div>
    <div className="more-domains">{navigationCatalog.map(group => <section key={group.label}><h2>{group.label}</h2><div>{group.items.map(item => <Link key={`${group.label}:${item.to}`} to={item.to}><Icon name={item.icon}/><span><strong>{item.label}</strong><small>{item.description}</small></span><Icon name="arrow" size={16}/></Link>)}</div></section>)}</div>
  </section>;
}
