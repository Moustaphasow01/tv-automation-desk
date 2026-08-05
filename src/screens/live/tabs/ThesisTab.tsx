import { Card, Icon, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip } from "@/components/operations";
import { Conditions, LiveSectionHeading } from "@/components/deskCards";
import type { ConditionItem, DeskSession } from "@/types";

export interface ThesisTabConditions {
  monitorId?: string;
  go: ConditionItem[];
  invalidations: ConditionItem[];
}

export function ThesisTab({ data, conditions }: { data: DeskSession; conditions: ThesisTabConditions }) {
  return <>
    <LiveSectionHeading title="Thèse active" subtitle="État vivant mis à jour par les Monitors"/>
    <Card className="thesis-page-hero">
      <div className="thesis-page-hero__copy">
        <div className="instrument-title"><span className="instrument-badge">{data.thesis.instrument}</span><div><p className="eyebrow">{data.thesis.direction}</p><h1>{data.thesis.status}</h1></div></div>
        <p>{data.thesis.dominantScenario}</p>
        <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.previousStatus} → {data.thesis.status}</StatusBadge>
      </div>
      <MetricStrip className="thesis-health-strip">
        <MetricCard label="Santé" value={`${data.thesis.health}/100`} tone={data.thesis.health < 40 ? "negative" : data.thesis.health < 70 ? "warning" : "neutral"}/>
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Valide jusqu'à" value={data.thesis.validUntil}/>
      </MetricStrip>
    </Card>
    <div className="content-grid">
      <Card className="score-drivers-react positive"><h3><Icon name="trendUp"/> Facteurs positifs</h3>{data.thesis.scoreDriversPositive.length ? <ul>{data.thesis.scoreDriversPositive.map(x => <li key={x}>{x}</li>)}</ul> : <p>Aucun facteur positif dominant.</p>}</Card>
      <Card className="score-drivers-react negative"><h3><Icon name="trendDown"/> Facteurs négatifs</h3><ul>{data.thesis.scoreDriversNegative.map(x => <li key={x}>{x}</li>)}</ul></Card>
    </div>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Scénario secondaire</p><h3>Transformation possible</h3></div><span className="card-icon"><Icon name="change"/></span></div><p>{data.thesis.secondaryScenario}</p></Card>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Prochain focus</p><h3>Ce que le prochain monitor doit vérifier</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.thesis.nextFocus}</p><div className="brief-card__verdict">Valide jusqu'à {data.thesis.validUntil}</div></Card>

    <LiveSectionHeading title="Niveaux de la thèse"/>
    <div className="levels-react">
      {data.levels.map(level => <Card key={`${level.price}-${level.role}`} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : level.state === "tested" ? "warning" : "info"}>{level.state}</StatusBadge></Card>)}
    </div>
    <LiveSectionHeading title="Conditions courantes" subtitle={`Dernier Monitor · ${conditions.monitorId || "indisponible"}`}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={conditions.go}/>
      <Conditions title="Invalidations" items={conditions.invalidations}/>
    </div>
  </>;
}
