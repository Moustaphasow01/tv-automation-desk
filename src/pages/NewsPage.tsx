import { useEffect, useRef } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function NewsPage() {
  return <DeskPage>{data => <NewsContent data={data}/>}</DeskPage>;
}

function NewsContent({ data }: { data: DeskSession }) {
  const nextEventRef = useRef<HTMLElement | null>(null);
  const editorialHeadlines = data.news.headlines.filter(headline => headline.source !== "Calendrier macro");

  useEffect(() => {
    if (!nextEventRef.current) return;
    const timer = window.setTimeout(() => {
      nextEventRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data.date, data.macro]);

  return <section className="view news-view">
    <SectionTitle title="Macro & News" subtitle={"Calendrier quotidien · " + data.date + " · prochain événement mis en évidence"}/>
    <Card className="digest-react digest-react--compact">
      <div className="brief-card__header"><div><p className="eyebrow">Point quotidien · {data.news.digestUpdatedAt}</p><h3>Synthèse macro</h3></div><span className="card-icon"><Icon name="news"/></span></div>
      <p>{data.news.digest}</p>
    </Card>

    <div className="news-day-heading"><div><h2>Événements du jour</h2><p>{data.macro.length} publication{data.macro.length > 1 ? "s" : ""}</p></div><span>Heure de Paris</span></div>
    <div className="macro-list-react macro-list-react--compact">
      {data.macro.map(event => <article
        key={(event.scheduledAt || event.time) + "-" + event.title}
        className={"macro-event-react macro-event-react--compact " + (event.isNext ? "is-next" : "")}
        ref={event.isNext ? nextEventRef : undefined}
      >
        <div className="macro-event-react__time"><time>{event.time}</time><small>{event.currency || "—"}</small></div>
        <div className="macro-event-react__content">
          <div className="macro-event-react__title"><h3>{event.title}</h3>{event.isNext && <span className="next-event-badge">PROCHAIN</span>}</div>
          <div className="macro-values">
            <div><span>Préc.</span><strong>{event.previous || "—"}</strong></div>
            <div><span>Prévu</span><strong>{event.forecast || "—"}</strong></div>
            <div className="macro-value--actual"><span>Réel</span><strong>{event.actual || "—"}</strong></div>
          </div>
        </div>
        <StatusBadge tone={event.importance.toLowerCase() === "high" ? "critical" : "warning"}>{event.importance}</StatusBadge>
      </article>)}
    </div>

    {editorialHeadlines.length > 0 && <>
      <SectionTitle title="Headlines" subtitle="Flux éditorial complémentaire"/>
      <div className="headline-list-react">
        {editorialHeadlines.map((headline, i) => <Card key={headline.scheduledAt || i} className="headline-react"><time>{headline.time}</time><div><h3>{headline.title}</h3><small>{headline.source}</small><p>{headline.impact}</p></div></Card>)}
      </div>
    </>}
    <Card className="source-rules-react"><p><strong>Source :</strong> calendrier quotidien backend. Les valeurs précédent, prévision et réel sont affichées telles qu’elles sont disponibles, indépendamment des sessions et des workers.</p></Card>
  </section>;
}
