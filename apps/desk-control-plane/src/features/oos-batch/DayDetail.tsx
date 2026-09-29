import { useState } from "react";
import { useOosClient, useOosDetail } from "@/domains/front-api/oosBatchRepository";
import { dateLabel, errorLabel, states } from "./model";
function Capture({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <figure><figcaption>{name.replace("premarket/", "").replace("replay/", "")}</figcaption>
    {failed ? <p role="status">Image indisponible. <a href={url} target="_blank" rel="noreferrer">Réessayer l’ouverture</a></p>
      : <a href={url} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${name} en taille réelle`}><img src={url} alt={`Capture ${name}`} loading="lazy" onError={() => setFailed(true)} /></a>}
  </figure>;
}
export function DayDetail({ batch, date, close }: { batch: string; date: string; close: () => void }) {
  const query = useOosDetail(batch, date), client = useOosClient();
  if (query.isLoading) return <p role="status">Chargement des preuves…</p>;
  if (!query.data) return <p role="alert">{errorLabel(query.error)} <button onClick={() => void query.refetch()}>Réessayer</button> <button onClick={close}>Fermer</button></p>;
  const { day, artifacts, plan_text, timeline } = query.data;
  return <section className="oos-detail oos-panel" aria-label={`Détail du ${date}`}>
    <header><div><h2>{dateLabel(date)} · {day.definition.symbol}</h2><p>{states[day.state]} · Cutoff {dateLabel(day.definition.cutoff)} · Paris</p></div><button onClick={close}>Fermer le détail</button></header>
    {query.isError && <p role="alert">Lecture ancienne : l’actualisation a échoué. {errorLabel(query.error)}</p>}
    <h3>Pré-market · huit preuves attendues</h3>
    <div className="oos-captures">{artifacts.filter(name => name.startsWith("premarket/") && name.endsWith(".png")).map(name => <Capture key={name} name={name} url={client.artifact(batch, date, name)} />)}</div>
    {!artifacts.includes("premarket/manifest.json") && <p>Le pré-market complet n’est pas encore archivé.</p>}
    <h3>Plan original</h3><p>Empreinte SHA-256 : <code className="oos-hash">{day.plan_sha256 || "Plan non figé"}</code></p>
    {plan_text === null ? <p>En attente du Scenario Builder.</p> : <pre className="oos-plan" tabIndex={0}>{plan_text}</pre>}
    <h3>Résultats du replay</h3><div className="oos-captures">{artifacts.filter(name => name.startsWith("replay/") && name.endsWith(".png")).map(name => <Capture key={name} name={name} url={client.artifact(batch, date, name)} />)}</div>
    <details><summary>Audit publié, sans interprétation</summary><pre className="oos-plan">{day.audit ? JSON.stringify(day.audit, null, 2) : "Audit non disponible"}</pre></details>
    <h3>Historique et reprises</h3><ol className="oos-timeline">{timeline.map(event => <li key={event.revision}><time>{dateLabel(event.occurred_at)}</time> {states[event.state] || event.state}{event.error && <code> · {event.error.code}</code>}</li>)}</ol>
    <details><summary>Tous les artefacts archivés</summary><ul>{artifacts.map(name => <li key={name}><a href={client.artifact(batch, date, name)} target="_blank" rel="noreferrer">{name}</a></li>)}</ul></details>
  </section>;
}
