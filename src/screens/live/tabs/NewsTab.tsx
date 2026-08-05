import { useEffect, useRef } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { LiveSectionHeading } from "@/components/deskCards";
import type { DeskSession } from "@/types";

export function NewsTab({ data }: { data: DeskSession }) {
  const nextEventRef = useRef<HTMLElement | null>(null);
  const editorialHeadlines = data.news.headlines.filter(headline => headline.source !== "Calendrier macro");
  const nowMs = Date.now();
  const pastCount = data.macro.filter(event => {
    const timestamp = Date.parse(event.scheduledAt || "");
    return Number.isFinite(timestamp) && timestamp < nowMs;
  }).length;
  const upcomingCount = data.macro.filter(event => {
    const timestamp = Date.parse(event.scheduledAt || "");
    return Number.isFinite(timestamp) && timestamp >= nowMs;
  }).length;

  useEffect(() => {
    if (!nextEventRef.current) return;
    const timer = window.setTimeout(() => {
      nextEventRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data.date, data.macro]);

  return <>
    <LiveSectionHeading title="Macro & News" subtitle={"Calendrier ±48 h autour du " + data.date + " · actualités éditoriales des 48 dernières heures"}/>
    <div className="news-feed-status">
      <StatusBadge tone={data.news.status === "ready" ? "positive" : "warning"}>
        {(data.news.provider || "Flux news").toUpperCase()} · {data.news.freshness?.status || data.news.status}
      </StatusBadge>
      <span>{data.news.freshness?.ageMinutes == null ? "Actualisation en attente" : `Actualisé il y a ${data.news.freshness.ageMinutes} min`}</span>
    </div>
    <Card className="digest-react digest-react--compact">
      <div className="brief-card__header"><div><p className="eyebrow">Point quotidien · {data.news.digestUpdatedAt}</p><h3>Synthèse macro</h3></div><span className="card-icon"><Icon name="news"/></span></div>
      <p>{data.news.digest}</p>
    </Card>

    <div className="news-day-heading"><div><h2>Calendrier opérationnel</h2><p>{data.macro.length} publication{data.macro.length > 1 ? "s" : ""} · {pastCount} passée{pastCount > 1 ? "s" : ""} · {upcomingCount} à venir</p></div><span>Paris · défilement vertical</span></div>
    <div className="macro-list-react macro-list-react--compact macro-list-react--window">
      {data.macro.length ? data.macro.map(event => <article
        key={(event.scheduledAt || event.time) + "-" + event.title}
        className={"macro-event-react macro-event-react--compact " + (event.isNext ? "is-next" : "")}
        ref={event.isNext ? nextEventRef : undefined}
      >
        <div className="macro-event-react__time"><time>{event.time}</time><small>{macroDateLabel(event.date, data.date)}</small><small>{event.currency || "—"}</small></div>
        <div className="macro-event-react__content">
          <div className="macro-event-react__title"><h3>{event.title}</h3>{event.isNext && <span className="next-event-badge">PROCHAIN</span>}</div>
          <div className="macro-values">
            <div><span>Préc.</span><strong>{event.previous || "—"}</strong></div>
            <div><span>Prévu</span><strong>{event.forecast || "—"}</strong></div>
            <div className="macro-value--actual"><span>Réel</span><strong>{event.actual || "—"}</strong></div>
          </div>
        </div>
        <StatusBadge tone={macroImportanceTone(event.importance)}>{event.importance}</StatusBadge>
      </article>) : <Card className="macro-window-empty"><strong>Aucun événement dans la fenêtre disponible</strong><p>Le backend continuera de rechercher les dernières publications et les événements des prochaines 48 heures.</p></Card>}
    </div>

    <SectionTitle title={`Headlines · ${editorialHeadlines.length}`} subtitle="Dernières news éditoriales réellement collectées sur 48 h"/>
    {editorialHeadlines.length > 0 ? <div className="headline-list-react headline-list-react--window">
        {editorialHeadlines.map((headline, i) => <Card key={`${headline.publishedAt || headline.scheduledAt || headline.time}-${headline.title}-${i}`} className="headline-react">
          <time><strong>{headline.time}</strong><span>{headline.date && headline.date !== data.date ? shortDate(headline.date) : "AUJ."}</span></time>
          <div>
            <div className="headline-react__title">
              <h3>{headline.url
                ? <a href={headline.url} target="_blank" rel="noreferrer">{headline.title}</a>
                : headline.title}</h3>
              <StatusBadge tone={macroImportanceTone(headline.importance || "low")}>{headline.importance || "LOW"}</StatusBadge>
            </div>
            <small>{headline.source} · {headline.provider || "provider éditorial"}</small>
            <p>{headline.impact}</p>
            {(headline.assets?.length || headline.topics?.length) ? <div className="headline-react__tags">
              {(headline.assets || []).slice(0, 6).map(asset => <span key={asset}>{asset}</span>)}
              {(headline.topics || []).slice(0, 2).map(topic => <span key={topic}>{topic.replaceAll("_", " ")}</span>)}
            </div> : null}
          </div>
        </Card>)}
      </div>
      : <Card className="headline-window-empty"><strong>Aucun flux éditorial matérialisé</strong><p>Le calendrier macro ci-dessus sert de fallback réel : il reste visible le week-end et couvre les 48 heures passées et à venir.</p></Card>}
    <Card className="source-rules-react"><p><strong>Sources :</strong> calendrier backend autonome et collecte éditoriale GDELT DOC 2.0. Chaque article conserve son URL et son domaine d'origine. Les news sont filtrées au cutoff avant d'entrer dans les packs LIVE ou Replay.</p></Card>
  </>;
}

function macroDateLabel(date: string | undefined, deskDate: string) {
  if (!date) return "—";
  if (date === deskDate) return "AUJ.";
  return shortDate(date);
}

function shortDate(date: string) {
  const [, month = "", day = ""] = date.split("-");
  return `${day}/${month}`;
}

function macroImportanceTone(importance: string) {
  const normalized = importance.toLowerCase();
  if (["high", "critical", "red"].includes(normalized)) return "critical";
  if (["medium", "orange"].includes(normalized)) return "warning";
  return "muted";
}
